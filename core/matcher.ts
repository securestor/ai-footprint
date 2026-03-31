import type { ScanMatch, ScanOptions, Snippet } from "./types.js";
import { hashSnippet, normalize } from "./hasher.js";
import { fuzzyMatchFile } from "./fuzzy.js";

// ------------------------------------------------------------------ //
// Heuristic AI-code patterns (regex, v0.1 — tree-sitter comes later)
// ------------------------------------------------------------------ //

const AI_PATTERNS: { pattern: RegExp; tag: string }[] = [
  { pattern: /\/\/\s*generated\s+by\s+(gpt|copilot|claude|gemini|codex|ai)/i, tag: "comment-tag" },
  { pattern: /\/\*\s*@ai[- ]generated/i, tag: "jsdoc-tag" },
  { pattern: /#\s*generated\s+by\s+(gpt|copilot|claude|gemini|codex|ai)/i, tag: "hash-comment-tag" },
  { pattern: /AI-generated|ai_generated/i, tag: "marker" },
  { pattern: /copilot|GitHub Copilot/i, tag: "copilot-ref" },
];

// ------------------------------------------------------------------ //
// Matching
// ------------------------------------------------------------------ //

/** Check a single file's content against known snippets + heuristics. */
export function matchFile(
  filePath: string,
  content: string,
  snippets: Snippet[],
  options: ScanOptions = {},
): ScanMatch[] {
  const matches: ScanMatch[] = [];
  const lines = content.split("\n");
  const exactMatchedLines = new Set<number>();

  // 1. Exact snippet hash matches (sliding window per snippet length)
  for (const snippet of snippets) {
    const snippetLines = normalize(snippet.content).split("\n");
    const windowSize = snippetLines.length;
    for (let i = 0; i <= lines.length - windowSize; i++) {
      const window = lines.slice(i, i + windowSize).join("\n");
      if (hashSnippet(window) === snippet.hash) {
        matches.push({
          file: filePath,
          line: i + 1,
          snippet,
          confidence: "high",
          similarity: 1.0,
          matchType: "exact",
        });
        for (let j = i; j < i + windowSize; j++) exactMatchedLines.add(j);
      }
    }
  }

  // 2. Fuzzy snippet matching (when enabled)
  if (options.fuzzy !== false && snippets.length > 0) {
    const fuzzyMatches = fuzzyMatchFile(filePath, content, snippets, {
      threshold: options.fuzzyThreshold,
      ngramSize: options.ngramSize,
    });
    // Only add fuzzy matches for lines not already exact-matched
    for (const fm of fuzzyMatches) {
      if (!exactMatchedLines.has(fm.line - 1)) {
        matches.push(fm);
      }
    }
  }

  // 3. Regex heuristic patterns (line-by-line)
  for (let i = 0; i < lines.length; i++) {
    for (const { pattern, tag } of AI_PATTERNS) {
      if (pattern.test(lines[i])) {
        matches.push({
          file: filePath,
          line: i + 1,
          pattern: tag,
          confidence: "medium",
          matchType: "pattern",
        });
      }
    }
  }

  return matches;
}
