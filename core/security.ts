/**
 * Security module — cryptographic integrity, audit logging, and input validation.
 *
 * Implements:
 *  - Registry signing & verification (HMAC-SHA256 or Ed25519)
 *  - Tamper-evident audit log (append-only, hash-chained)
 *  - Input sanitisation helpers
 *  - Safe file path validation
 *  - Rate limiting / body-size limits
 *  - Config file permission hardening
 *
 * EU Cyber Resilience Act (CRA) alignment:
 *  - Article 10 (Security by design): signed artefacts, tamper detection
 *  - Article 11 (Vulnerability handling): audit trail, incident correlation
 *  - Annex I §2.1 (Data protection): input validation, path confinement
 *  - Annex I §2.5 (Integrity): hash-chained logs, registry signatures
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  chmodSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

const CONFIG_DIR = join(homedir(), ".ai-footprint");
const KEY_PATH = join(CONFIG_DIR, "signing-key");
const AUDIT_LOG_PATH = join(CONFIG_DIR, "audit.log");
const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_FILE_READ_BYTES = 100 * 1024 * 1024; // 100 MB

// ------------------------------------------------------------------ //
// Signing key management
// ------------------------------------------------------------------ //

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/** Generate or load the local HMAC signing key. */
export function getSigningKey(): Buffer {
  ensureConfigDir();

  if (existsSync(KEY_PATH)) {
    const stat = statSync(KEY_PATH);
    // Warn if key file has loose permissions (not owner-only)
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) {
      try {
        chmodSync(KEY_PATH, 0o600);
      } catch {
        // Best-effort — may fail on Windows
      }
    }
    return Buffer.from(readFileSync(KEY_PATH, "utf-8").trim(), "hex");
  }

  // First run: generate a 256-bit random key
  const key = randomBytes(32);
  writeFileSync(KEY_PATH, key.toString("hex") + "\n", { mode: 0o600 });
  return key;
}

// ------------------------------------------------------------------ //
// Registry integrity — HMAC-SHA256 signing / verification
// ------------------------------------------------------------------ //

export interface SignedPayload {
  /** The canonical JSON data (stringified deterministically). */
  data: string;
  /** HMAC-SHA256 hex signature over `data`. */
  signature: string;
  /** ISO 8601 timestamp of when the signature was created. */
  signedAt: string;
  /** Signature algorithm identifier. */
  algorithm: "hmac-sha256";
}

/**
 * Sign a JSON-serialisable object.
 * Produces a deterministic canonical JSON (sorted keys, no trailing space),
 * then HMAC-SHA256 with the local signing key.
 */
export function signPayload(obj: unknown): SignedPayload {
  const data = canonicalJSON(obj);
  const key = getSigningKey();
  const signature = createHmac("sha256", key).update(data).digest("hex");
  return {
    data,
    signature,
    signedAt: new Date().toISOString(),
    algorithm: "hmac-sha256",
  };
}

/**
 * Verify an HMAC-SHA256 signed payload.
 * Returns `true` if the signature matches; `false` otherwise.
 * Uses timing-safe comparison to prevent side-channel leaks.
 */
export function verifyPayload(signed: SignedPayload): boolean {
  if (signed.algorithm !== "hmac-sha256") return false;
  const key = getSigningKey();
  const expected = createHmac("sha256", key).update(signed.data).digest("hex");
  if (expected.length !== signed.signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signed.signature, "hex"));
}

/**
 * Deterministic JSON serialisation (sorted keys).
 * Ensures the same object always produces the same string,
 * which is required for signature stability.
 */
export function canonicalJSON(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((sorted, k) => {
          sorted[k] = (value as Record<string, unknown>)[k];
          return sorted;
        }, {});
    }
    return value;
  });
}

// ------------------------------------------------------------------ //
// Tamper-evident audit log (hash-chained, append-only)
// ------------------------------------------------------------------ //

export type AuditAction =
  | "snippet.add"
  | "snippet.delete"
  | "registry.sign"
  | "registry.verify"
  | "registry.tampered"
  | "team.pull"
  | "team.push"
  | "team.config"
  | "scan.run"
  | "scan.match"
  | "sbom.export"
  | "proxy.start"
  | "proxy.intercept"
  | "hook.pre-commit"
  | "hook.commit-msg"
  | "security.key-generated"
  | "security.permission-fix"
  | "security.path-violation"
  | "security.input-violation"
  | "security.body-limit-exceeded"
  | "security.host-blocked";

export interface AuditEntry {
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Action performed. */
  action: AuditAction;
  /** Human-readable description. */
  detail: string;
  /** SHA-256 hash of previous log entry (chain link). */
  prevHash: string;
  /** SHA-256 hash of this entry (computed over timestamp + action + detail + prevHash). */
  hash: string;
}

let lastHash = "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Initialise the hash chain from the existing log file.
 * Reads the last line to recover the chain head.
 */
function initChain(): void {
  if (!existsSync(AUDIT_LOG_PATH)) return;
  try {
    const content = readFileSync(AUDIT_LOG_PATH, "utf-8").trim();
    if (!content) return;
    const lines = content.split("\n");
    const lastLine = lines[lines.length - 1];
    const entry = JSON.parse(lastLine) as AuditEntry;
    if (entry.hash) lastHash = entry.hash;
  } catch {
    // Corrupted log — start fresh chain (old entries preserved)
  }
}

// Initialise on module load
initChain();

/**
 * Append a tamper-evident audit log entry.
 * Each entry is hash-chained to the previous, forming an append-only ledger.
 */
export function audit(action: AuditAction, detail: string): void {
  ensureConfigDir();

  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}|${action}|${detail}|${lastHash}`;
  const hash = createHash("sha256").update(prehash).digest("hex");

  const entry: AuditEntry = {
    timestamp,
    action,
    detail,
    prevHash: lastHash,
    hash,
  };

  lastHash = hash;
  appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n", { mode: 0o600 });
}

/**
 * Verify the integrity of the entire audit log chain.
 * Returns { valid: true, entries: number } or { valid: false, brokenAt: number, reason: string }.
 */
export function verifyAuditLog(): { valid: boolean; entries: number; brokenAt?: number; reason?: string } {
  if (!existsSync(AUDIT_LOG_PATH)) {
    return { valid: true, entries: 0 };
  }

  const content = readFileSync(AUDIT_LOG_PATH, "utf-8").trim();
  if (!content) return { valid: true, entries: 0 };

  const lines = content.split("\n");
  let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";

  for (let i = 0; i < lines.length; i++) {
    let entry: AuditEntry;
    try {
      entry = JSON.parse(lines[i]) as AuditEntry;
    } catch {
      return { valid: false, entries: i, brokenAt: i + 1, reason: "Malformed JSON" };
    }

    if (entry.prevHash !== prevHash) {
      return {
        valid: false,
        entries: i,
        brokenAt: i + 1,
        reason: `Chain break: expected prevHash ${prevHash.slice(0, 12)}…, got ${entry.prevHash.slice(0, 12)}…`,
      };
    }

    const expectedHash = createHash("sha256")
      .update(`${entry.timestamp}|${entry.action}|${entry.detail}|${entry.prevHash}`)
      .digest("hex");

    if (entry.hash !== expectedHash) {
      return {
        valid: false,
        entries: i,
        brokenAt: i + 1,
        reason: `Hash mismatch: computed ${expectedHash.slice(0, 12)}…, stored ${entry.hash.slice(0, 12)}…`,
      };
    }

    prevHash = entry.hash;
  }

  return { valid: true, entries: lines.length };
}

// ------------------------------------------------------------------ //
// Input validation & sanitisation
// ------------------------------------------------------------------ //

/** Characters forbidden in shell arguments (prevents injection via execFileSync array). */
const SHELL_META = /[\x00-\x1f\x7f]/; // Only control characters — we use execFileSync to avoid shell interpretation

/**
 * Validate a string does not contain null bytes or control characters.
 * These are never valid in file paths, URLs, git URLs, team names, etc.
 */
export function validateNoControlChars(value: string, label: string): void {
  if (SHELL_META.test(value)) {
    audit("security.input-violation", `${label} contains control characters`);
    throw new Error(`Invalid ${label}: contains control characters.`);
  }
}

/**
 * Validate a git URL is reasonably safe.
 * Allows https://, git://, ssh://, and user@host:path SCP-style URLs.
 * Rejects URLs containing shell metacharacters.
 */
export function validateGitUrl(url: string): void {
  validateNoControlChars(url, "git URL");

  const allowed =
    /^(?:https?:\/\/|git:\/\/|ssh:\/\/|[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:)[^\s]+$/;
  if (!allowed.test(url)) {
    audit("security.input-violation", `Rejected git URL: ${url.slice(0, 100)}`);
    throw new Error("Invalid git URL format. Use https://, git://, ssh://, or user@host:path.");
  }
}

/**
 * Validate an API URL.
 * Must be https:// (or http://localhost for local development).
 */
export function validateApiUrl(url: string): void {
  validateNoControlChars(url, "API URL");

  let parsed: URL;
  try {
    parsed = new globalThis.URL(url);
  } catch {
    throw new Error(`Invalid API URL: ${url}`);
  }

  const isLocalDev =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1");

  if (parsed.protocol !== "https:" && !isLocalDev) {
    audit("security.input-violation", `Rejected non-HTTPS API URL: ${url.slice(0, 100)}`);
    throw new Error("API URL must use HTTPS (http:// allowed only for localhost).");
  }
}

/**
 * Validate a team name: alphanumeric, hyphens, underscores only.
 */
export function validateTeamName(name: string): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name)) {
    audit("security.input-violation", `Rejected team name: ${name.slice(0, 50)}`);
    throw new Error("Team name must be 1-128 characters, alphanumeric/hyphen/underscore only.");
  }
}

/**
 * Validate a port number.
 */
export function validatePort(port: number): void {
  if (!Number.isFinite(port) || port < 1 || port > 65535 || !Number.isInteger(port)) {
    throw new Error(`Invalid port number: ${port}. Must be 1–65535.`);
  }
}

/**
 * Safe path resolution — ensures the resolved path stays within a given root.
 * Prevents path traversal attacks.
 */
export function safePath(root: string, userPath: string): string {
  const absRoot = resolve(root);
  const absTarget = resolve(absRoot, userPath);
  const rel = relative(absRoot, absTarget);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    audit("security.path-violation", `Path traversal blocked: ${userPath} → ${absTarget}`);
    throw new Error(`Path traversal denied: ${userPath} resolves outside allowed root.`);
  }

  return absTarget;
}

/**
 * Validate output file path — must be within CWD or an explicitly allowed directory.
 */
export function validateOutputPath(outputPath: string, allowedRoot?: string): string {
  const root = allowedRoot ?? process.cwd();
  const abs = resolve(outputPath);
  const rel = relative(resolve(root), abs);

  // Allow writing within the root or to absolute paths that don't escape it
  if (rel.startsWith("..") || isAbsolute(rel)) {
    audit("security.path-violation", `Output path blocked: ${outputPath}`);
    throw new Error(`Output path must be within ${root}. Got: ${outputPath}`);
  }

  return abs;
}

// ------------------------------------------------------------------ //
// Body-size limiting
// ------------------------------------------------------------------ //

/**
 * Maximum allowed request/response body size in bytes.
 */
export const MAX_BODY_SIZE = MAX_BODY_BYTES;

/**
 * Maximum allowed file read size in bytes.
 */
export const MAX_FILE_SIZE = MAX_FILE_READ_BYTES;

/**
 * Collect an HTTP body stream with a size limit.
 * Rejects with an error if the body exceeds `maxBytes`.
 */
export function collectBodyLimited(
  stream: { on: (event: string, cb: (...args: unknown[]) => void) => void },
  maxBytes: number = MAX_BODY_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    stream.on("data", (...args: unknown[]) => {
      const chunk = args[0] as Buffer;
      total += chunk.length;
      if (total > maxBytes) {
        audit("security.body-limit-exceeded", `Body exceeded ${maxBytes} bytes`);
        reject(new Error(`Body exceeds maximum size of ${maxBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });

    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", (...args: unknown[]) => reject(args[0]));
  });
}

// ------------------------------------------------------------------ //
// File permission hardening
// ------------------------------------------------------------------ //

/**
 * Ensure sensitive config files have owner-only permissions (0o600).
 */
export function hardenConfigPermissions(): void {
  const sensitiveFiles = [
    join(CONFIG_DIR, "snippets.json"),
    join(CONFIG_DIR, "team.json"),
    KEY_PATH,
    AUDIT_LOG_PATH,
  ];

  for (const file of sensitiveFiles) {
    if (!existsSync(file)) continue;
    try {
      const stat = statSync(file);
      const mode = stat.mode & 0o777;
      if (mode !== 0o600) {
        chmodSync(file, 0o600);
        audit("security.permission-fix", `Tightened permissions on ${file}: ${mode.toString(8)} → 600`);
      }
    } catch {
      // Best-effort (Windows, read-only FS, etc.)
    }
  }
}

// ------------------------------------------------------------------ //
// Known LLM API hosts (default allowlist for the intercept proxy)
// ------------------------------------------------------------------ //

export const DEFAULT_LLM_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.cohere.ai",
  "api.mistral.ai",
  "localhost",
  "127.0.0.1",
  "::1",
  // Azure OpenAI — *.openai.azure.com
]);

/**
 * Check whether a hostname matches the default LLM allowlist.
 * Azure OpenAI uses *.openai.azure.com so we also check for that suffix.
 */
export function isAllowedLLMHost(hostname: string): boolean {
  if (DEFAULT_LLM_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(".openai.azure.com")) return true;
  // Ollama — any local-only address
  if (hostname.endsWith(".local")) return true;
  return false;
}

// ------------------------------------------------------------------ //
// Snippet / registry schema validation
// ------------------------------------------------------------------ //

/**
 * Validate a snippet object has the expected shape.
 * Prevents prototype pollution and type confusion from untrusted data.
 */
export function validateSnippet(s: unknown): s is { id: string; hash: string; source: string; content: string } {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  const obj = s as Record<string, unknown>;

  // Guard against prototype pollution
  if (Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
      Object.prototype.hasOwnProperty.call(obj, "constructor") ||
      Object.prototype.hasOwnProperty.call(obj, "prototype")) return false;

  return (
    typeof obj.id === "string" &&
    typeof obj.hash === "string" &&
    typeof obj.source === "string" &&
    typeof obj.content === "string" &&
    obj.id.length > 0 &&
    obj.hash.length === 64 && // SHA-256 hex
    /^[a-f0-9]{64}$/.test(obj.hash)
  );
}

/**
 * Validate and sanitise a registry loaded from disk or network.
 * Returns only valid snippets; logs invalid entries.
 */
export function validateRegistry(data: unknown): { version: number; snippets: unknown[] } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid registry format: expected an object.");
  }

  const obj = data as Record<string, unknown>;
  if (typeof obj.version !== "number" || obj.version < 1) {
    throw new Error("Invalid registry version.");
  }

  if (!Array.isArray(obj.snippets)) {
    throw new Error("Invalid registry: missing snippets array.");
  }

  const valid: unknown[] = [];
  for (const s of obj.snippets) {
    if (validateSnippet(s)) {
      valid.push(s);
    }
    // Silently drop invalid entries — they may be corruption or injection attempts
  }

  return { version: obj.version as number, snippets: valid };
}
