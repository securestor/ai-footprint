import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  canonicalJSON,
  signPayload,
  verifyPayload,
  validateNoControlChars,
  validateGitUrl,
  validateApiUrl,
  validateTeamName,
  validatePort,
  validateSnippet,
  validateRegistry,
  isAllowedLLMHost,
} from "../core/security.js";

// ------------------------------------------------------------------ //
// Canonical JSON
// ------------------------------------------------------------------ //

describe("canonicalJSON", () => {
  it("sorts keys deterministically", () => {
    const a = canonicalJSON({ z: 1, a: 2, m: 3 });
    const b = canonicalJSON({ a: 2, m: 3, z: 1 });
    assert.equal(a, b);
    assert.equal(a, '{"a":2,"m":3,"z":1}');
  });

  it("handles nested objects", () => {
    const result = canonicalJSON({ b: { d: 1, c: 2 }, a: 0 });
    assert.equal(result, '{"a":0,"b":{"c":2,"d":1}}');
  });

  it("preserves arrays as-is", () => {
    const result = canonicalJSON({ arr: [3, 1, 2] });
    assert.equal(result, '{"arr":[3,1,2]}');
  });
});

// ------------------------------------------------------------------ //
// Signing / Verification
// ------------------------------------------------------------------ //

describe("signPayload / verifyPayload", () => {
  it("signs and verifies a payload successfully", () => {
    const data = { version: 1, snippets: [{ id: "abc" }] };
    const signed = signPayload(data);
    assert.equal(signed.algorithm, "hmac-sha256");
    assert.equal(typeof signed.signature, "string");
    assert.equal(signed.signature.length, 64);
    assert.ok(verifyPayload(signed));
  });

  it("detects tampered data", () => {
    const signed = signPayload({ test: true });
    signed.data = '{"test":false}';
    assert.ok(!verifyPayload(signed));
  });

  it("detects tampered signature", () => {
    const signed = signPayload({ test: true });
    signed.signature = "0".repeat(64);
    assert.ok(!verifyPayload(signed));
  });

  it("rejects unknown algorithm", () => {
    const signed = signPayload({ test: true });
    (signed as { algorithm: string }).algorithm = "md5";
    assert.ok(!verifyPayload(signed));
  });
});

// ------------------------------------------------------------------ //
// Input validation
// ------------------------------------------------------------------ //

describe("validateNoControlChars", () => {
  it("accepts normal strings", () => {
    assert.doesNotThrow(() => validateNoControlChars("hello world", "test"));
  });

  it("rejects null bytes", () => {
    assert.throws(
      () => validateNoControlChars("hello\x00world", "test"),
      /control characters/,
    );
  });

  it("rejects other control chars", () => {
    assert.throws(
      () => validateNoControlChars("hello\x01world", "test"),
      /control characters/,
    );
  });
});

describe("validateGitUrl", () => {
  it("accepts HTTPS URLs", () => {
    assert.doesNotThrow(() => validateGitUrl("https://github.com/org/repo.git"));
  });

  it("accepts SSH URLs", () => {
    assert.doesNotThrow(() => validateGitUrl("git@github.com:org/repo.git"));
  });

  it("accepts git:// URLs", () => {
    assert.doesNotThrow(() => validateGitUrl("git://github.com/repo.git"));
  });

  it("rejects shell injection", () => {
    assert.throws(
      () => validateGitUrl("; rm -rf /"),
      /Invalid git URL/,
    );
  });

  it("rejects URLs with control chars", () => {
    assert.throws(
      () => validateGitUrl("https://evil.com/\x00foo"),
      /control characters/,
    );
  });
});

describe("validateApiUrl", () => {
  it("accepts HTTPS URLs", () => {
    assert.doesNotThrow(() => validateApiUrl("https://api.example.com"));
  });

  it("accepts localhost HTTP", () => {
    assert.doesNotThrow(() => validateApiUrl("http://localhost:3000"));
  });

  it("accepts 127.0.0.1 HTTP", () => {
    assert.doesNotThrow(() => validateApiUrl("http://127.0.0.1:8080"));
  });

  it("rejects non-HTTPS remote URLs", () => {
    assert.throws(
      () => validateApiUrl("http://api.example.com"),
      /must use HTTPS/,
    );
  });
});

describe("validateTeamName", () => {
  it("accepts alphanumeric names", () => {
    assert.doesNotThrow(() => validateTeamName("my-team_123"));
  });

  it("rejects shell metacharacters", () => {
    assert.throws(
      () => validateTeamName('"; rm -rf /'),
      /alphanumeric/,
    );
  });

  it("rejects empty string", () => {
    assert.throws(
      () => validateTeamName(""),
      /alphanumeric/,
    );
  });

  it("rejects names over 128 chars", () => {
    assert.throws(
      () => validateTeamName("a".repeat(129)),
      /alphanumeric/,
    );
  });
});

describe("validatePort", () => {
  it("accepts valid ports", () => {
    assert.doesNotThrow(() => validatePort(8080));
    assert.doesNotThrow(() => validatePort(1));
    assert.doesNotThrow(() => validatePort(65535));
  });

  it("rejects NaN", () => {
    assert.throws(() => validatePort(NaN), /Invalid port/);
  });

  it("rejects negative", () => {
    assert.throws(() => validatePort(-1), /Invalid port/);
  });

  it("rejects zero", () => {
    assert.throws(() => validatePort(0), /Invalid port/);
  });

  it("rejects > 65535", () => {
    assert.throws(() => validatePort(70000), /Invalid port/);
  });

  it("rejects float", () => {
    assert.throws(() => validatePort(80.5), /Invalid port/);
  });
});

// ------------------------------------------------------------------ //
// Snippet / Registry validation
// ------------------------------------------------------------------ //

describe("validateSnippet", () => {
  const valid = {
    id: "abc-123",
    hash: "a".repeat(64),
    source: "chatgpt",
    content: "const x = 1;",
  };

  it("accepts valid snippets", () => {
    assert.ok(validateSnippet(valid));
  });

  it("rejects non-objects", () => {
    assert.ok(!validateSnippet(null));
    assert.ok(!validateSnippet("string"));
    assert.ok(!validateSnippet(42));
    assert.ok(!validateSnippet([]));
  });

  it("rejects missing fields", () => {
    assert.ok(!validateSnippet({ id: "x", hash: "y" }));
  });

  it("rejects invalid hash length", () => {
    assert.ok(!validateSnippet({ ...valid, hash: "short" }));
  });

  it("rejects invalid hash chars", () => {
    assert.ok(!validateSnippet({ ...valid, hash: "z".repeat(64) }));
  });

  it("rejects __proto__ pollution", () => {
    const polluted = Object.create(null);
    Object.assign(polluted, valid);
    polluted["__proto__"] = {};
    assert.ok(!validateSnippet(polluted));
  });
});

describe("validateRegistry", () => {
  it("accepts valid registries", () => {
    const reg = validateRegistry({
      version: 1,
      snippets: [
        { id: "x", hash: "a".repeat(64), source: "test", content: "code" },
      ],
    });
    assert.equal(reg.version, 1);
    assert.equal(reg.snippets.length, 1);
  });

  it("filters invalid snippets silently", () => {
    const reg = validateRegistry({
      version: 1,
      snippets: [
        { id: "x", hash: "a".repeat(64), source: "test", content: "code" },
        { bad: true },
        "not an object",
      ],
    });
    assert.equal(reg.snippets.length, 1);
  });

  it("rejects non-object input", () => {
    assert.throws(() => validateRegistry("string"), /expected an object/);
  });

  it("rejects missing snippets array", () => {
    assert.throws(() => validateRegistry({ version: 1 }), /missing snippets array/);
  });
});

// ------------------------------------------------------------------ //
// LLM host allowlist
// ------------------------------------------------------------------ //

describe("isAllowedLLMHost", () => {
  it("allows OpenAI", () => {
    assert.ok(isAllowedLLMHost("api.openai.com"));
  });

  it("allows Anthropic", () => {
    assert.ok(isAllowedLLMHost("api.anthropic.com"));
  });

  it("allows Azure OpenAI", () => {
    assert.ok(isAllowedLLMHost("myorg.openai.azure.com"));
  });

  it("allows localhost", () => {
    assert.ok(isAllowedLLMHost("localhost"));
    assert.ok(isAllowedLLMHost("127.0.0.1"));
  });

  it("blocks arbitrary hosts", () => {
    assert.ok(!isAllowedLLMHost("evil.com"));
    assert.ok(!isAllowedLLMHost("internal.corp.net"));
  });
});
