import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalize, hashSnippet } from "../core/hasher.js";

describe("normalize", () => {
  it("trims trailing whitespace from lines", () => {
    assert.equal(normalize("hello   \nworld  "), "hello\nworld");
  });

  it("unifies CRLF to LF", () => {
    assert.equal(normalize("a\r\nb\r\nc"), "a\nb\nc");
  });

  it("trims leading and trailing newlines", () => {
    assert.equal(normalize("\n\nhello\n\n"), "hello");
  });

  it("handles empty string", () => {
    assert.equal(normalize(""), "");
  });

  it("preserves indentation (leading whitespace is trimmed on first/last line by trim())", () => {
    // normalize() calls .trim() on the whole string, so leading whitespace
    // on the very first line gets stripped. Interior lines keep their indent.
    assert.equal(normalize("  indented\n    more"), "indented\n    more");
  });
});

describe("hashSnippet", () => {
  it("returns a 64-char hex SHA-256", () => {
    const hash = hashSnippet("const x = 1;");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("produces deterministic hashes", () => {
    const a = hashSnippet("function foo() {}");
    const b = hashSnippet("function foo() {}");
    assert.equal(a, b);
  });

  it("produces the same hash despite trailing whitespace differences", () => {
    const a = hashSnippet("const x = 1;   ");
    const b = hashSnippet("const x = 1;");
    assert.equal(a, b);
  });

  it("produces the same hash despite CRLF vs LF", () => {
    const a = hashSnippet("line1\r\nline2");
    const b = hashSnippet("line1\nline2");
    assert.equal(a, b);
  });

  it("produces different hashes for different content", () => {
    const a = hashSnippet("const x = 1;");
    const b = hashSnippet("const y = 2;");
    assert.notEqual(a, b);
  });
});
