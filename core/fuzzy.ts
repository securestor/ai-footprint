import { normalize } from "./hasher.js";
import type { Snippet, ScanMatch } from "./types.js";

// ------------------------------------------------------------------ //
// N-gram shingling + Jaccard similarity for fuzzy code matching
// ------------------------------------------------------------------ //

const DEFAULT_NGRAM_SIZE = 3;
const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

/** Tokenize code into meaningful tokens (identifiers, operators, literals). */
export function tokenize(code: string): string[] {
  const normalized = normalize(code);
  // Split on whitespace and punctuation boundaries, keep meaningful tokens
  return normalized
    .replace(/[{}()\[\];,.:]/g, " $& ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Generate n-gram shingles from a token array. */
export function shingle(tokens: string[], n: number = DEFAULT_NGRAM_SIZE): Set<string> {
  const shingles = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    shingles.add(tokens.slice(i, i + n).join(" "));
  }
  return shingles;
}

/** Jaccard similarity coefficient between two sets. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Compute structural fingerprint — strips variable names, keeps shape. */
export function structuralTokenize(code: string): string[] {
  const normalized = normalize(code);
  return normalized
    // Replace string literals with placeholder
    .replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, "STR")
    // Replace numbers with placeholder
    .replace(/\b\d+(?:\.\d+)?\b/g, "NUM")
    // Replace identifiers that look like variable names (camelCase, snake_case)
    .replace(/\b[a-z_$][a-zA-Z0-9_$]*\b/g, "ID")
    .replace(/[{}()\[\];,.:]/g, " $& ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export interface FuzzyMatchResult {
  snippet: Snippet;
  similarity: number;
  structural: number;
  combined: number;
  windowStart: number;
}

/**
 * Fuzzy-match a code block against known snippets.
 *
 * Uses two complementary signals:
 *  1. Token n-gram Jaccard similarity (catches renamed variables)
 *  2. Structural n-gram Jaccard similarity (catches reformatted code)
 *
 * Combined score = weighted average (0.4 token + 0.6 structural).
 */
export function fuzzyMatchFile(
  filePath: string,
  content: string,
  snippets: Snippet[],
  opts: {
    threshold?: number;
    ngramSize?: number;
    windowSlack?: number;
  } = {},
): ScanMatch[] {
  const threshold = opts.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const ngramSize = opts.ngramSize ?? DEFAULT_NGRAM_SIZE;
  const windowSlack = opts.windowSlack ?? 5;

  const matches: ScanMatch[] = [];
  const lines = content.split("\n");
  const lineCount = lines.length;

  // ── Pre-tokenize every line ONCE ────────────────────────────────
  const lineTokens: string[][] = lines.map((l) => tokenize(l));
  const lineStructTokens: string[][] = lines.map((l) => structuralTokenize(l));

  // Pre-compute cumulative token counts for fast window size estimation
  const cumTokenCount: number[] = new Array(lineCount + 1);
  cumTokenCount[0] = 0;
  for (let i = 0; i < lineCount; i++) {
    cumTokenCount[i + 1] = cumTokenCount[i] + lineTokens[i].length;
  }

  for (const snippet of snippets) {
    const snippetLines = normalize(snippet.content).split("\n");
    const baseWindowSize = snippetLines.length;

    // Pre-compute snippet shingles
    const snippetTokenArr = tokenize(snippet.content);
    const snippetStructArr = structuralTokenize(snippet.content);
    const snippetTokenShingles = shingle(snippetTokenArr, ngramSize);
    const snippetStructShingles = shingle(snippetStructArr, ngramSize);
    const snippetTokenCount = snippetTokenArr.length;

    // Skip if snippet is too small for meaningful comparison
    if (snippetTokenShingles.size < 2) continue;

    // Quick skip: if file is much smaller than snippet, no point checking
    if (lineCount < baseWindowSize - windowSlack) continue;

    let bestMatch: FuzzyMatchResult | null = null;

    // Only check the base window size (not all ±slack sizes)
    const winSize = Math.min(baseWindowSize, lineCount);

    for (let i = 0; i <= lineCount - winSize; i++) {
      // ── Fast token count heuristic ──────────────────────────────
      // If window has wildly different token count, skip expensive shingling.
      // Jaccard can't exceed min(|A|,|B|)/max(|A|,|B|) for same-sized shingles,
      // and token count is a proxy for shingle count.
      const windowTokenCount = cumTokenCount[i + winSize] - cumTokenCount[i];
      const ratio = windowTokenCount > snippetTokenCount
        ? snippetTokenCount / windowTokenCount
        : windowTokenCount / snippetTokenCount;
      if (ratio < threshold * 0.5) continue; // impossible to reach threshold

      // Build window token arrays from pre-tokenized lines
      let windowTokenArr: string[] = [];
      let windowStructArr: string[] = [];
      for (let j = i; j < i + winSize; j++) {
        windowTokenArr = windowTokenArr.concat(lineTokens[j]);
        windowStructArr = windowStructArr.concat(lineStructTokens[j]);
      }

      const windowTokenShingles = shingle(windowTokenArr, ngramSize);
      const windowStructShingles = shingle(windowStructArr, ngramSize);

      // Early exit: check structural similarity first (weighted 0.6)
      const structSim = jaccardSimilarity(snippetStructShingles, windowStructShingles);
      if (structSim * 0.6 + 0.4 < threshold) continue; // even perfect token sim can't save it

      const tokenSim = jaccardSimilarity(snippetTokenShingles, windowTokenShingles);
      const combined = 0.4 * tokenSim + 0.6 * structSim;

      if (combined >= threshold) {
        if (!bestMatch || combined > bestMatch.combined) {
          bestMatch = {
            snippet,
            similarity: tokenSim,
            structural: structSim,
            combined,
            windowStart: i,
          };
        }
      }
    }

    if (bestMatch) {
      matches.push({
        file: filePath,
        line: bestMatch.windowStart + 1,
        snippet: bestMatch.snippet,
        confidence: bestMatch.combined >= 0.85 ? "high" : "medium",
        similarity: bestMatch.combined,
        matchType: "fuzzy",
      });
    }
  }

  return matches;
}
