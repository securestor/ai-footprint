import { createHash } from "node:crypto";

/**
 * Normalize whitespace so that minor formatting differences
 * don't prevent matching against known snippets.
 */
export function normalize(code: string): string {
  return code
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

/** SHA-256 hash of normalized code. */
export function hashSnippet(code: string): string {
  return createHash("sha256").update(normalize(code)).digest("hex");
}
