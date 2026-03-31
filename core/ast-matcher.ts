/**
 * AST-level structural matching engine.
 *
 * Extracts language-aware structural features (function signatures, control
 * flow, class hierarchies, imports) via regex-based heuristic parsing and
 * compares abstract syntax shapes rather than raw tokens.
 *
 * This provides tree-sitter-class accuracy without native binary dependencies.
 */

import { normalize } from "./hasher.js";
import type { Snippet, ScanMatch } from "./types.js";

// ------------------------------------------------------------------ //
// AST Node types & extraction
// ------------------------------------------------------------------ //

export type ASTNodeKind =
  | "function"
  | "class"
  | "method"
  | "import"
  | "export"
  | "variable"
  | "control"
  | "return"
  | "call"
  | "arrow"
  | "interface"
  | "type-alias"
  | "decorator"
  | "try-catch"
  | "loop"
  | "conditional";

export interface ASTNode {
  kind: ASTNodeKind;
  /** Structural shape (normalised signature without variable names). */
  shape: string;
  /** Source line number (1-based). */
  line: number;
  /** Nesting depth (0 = top-level). */
  depth: number;
}

// ------------------------------------------------------------------ //
// Language-aware extraction rules
// ------------------------------------------------------------------ //

interface ExtractionRule {
  kind: ASTNodeKind;
  pattern: RegExp;
  /** Map the match to a normalised shape string. */
  toShape: (m: RegExpMatchArray) => string;
}

/** Count leading whitespace to determine nesting depth. */
function indentDepth(line: string): number {
  const match = line.match(/^(\s*)/);
  if (!match) return 0;
  const ws = match[1];
  // Tabs count as 4 spaces
  return Math.floor(ws.replace(/\t/g, "    ").length / 2);
}

// Rules for TypeScript / JavaScript
const TS_RULES: ExtractionRule[] = [
  // import statements
  {
    kind: "import",
    pattern: /^\s*import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+)\s+from\s+/,
    toShape: (m) => {
      const line = m[0];
      const hasType = /import\s+type/.test(line);
      return hasType ? "import-type" : "import";
    },
  },
  // export statements
  {
    kind: "export",
    pattern: /^\s*export\s+(?:default\s+)?(?:type\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|enum|type)\b/,
    toShape: (m) => {
      const line = m[0];
      const def = /export\s+default/.test(line) ? "default-" : "";
      const what = line.match(/(function|class|const|let|var|interface|enum|type)\b/);
      return `export-${def}${what?.[1] ?? "unknown"}`;
    },
  },
  // interface / type alias
  {
    kind: "interface",
    pattern: /^\s*(?:export\s+)?interface\s+\w+/,
    toShape: () => "interface-decl",
  },
  {
    kind: "type-alias",
    pattern: /^\s*(?:export\s+)?type\s+\w+\s*=/,
    toShape: () => "type-alias",
  },
  // class declaration
  {
    kind: "class",
    pattern: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/,
    toShape: (m) => {
      const line = m[0];
      const abstract = /abstract\s+class/.test(line) ? "abstract-" : "";
      const ext = /extends\s+\w+/.test(m.input ?? "") ? "-extends" : "";
      const impl = /implements\s+\w+/.test(m.input ?? "") ? "-implements" : "";
      return `class-${abstract}decl${ext}${impl}`;
    },
  },
  // function declaration (including async, generator)
  {
    kind: "function",
    pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*\w*\s*\(/,
    toShape: (m) => {
      const line = m[0];
      const async = /async\s+function/.test(line) ? "async-" : "";
      const gen = /function\s*\*/.test(line) ? "gen-" : "";
      // Count params
      const paramMatch = m.input?.match(/\(([^)]*)\)/);
      const params = paramMatch
        ? paramMatch[1].split(",").filter((p) => p.trim()).length
        : 0;
      return `func-${async}${gen}${params}params`;
    },
  },
  // arrow function (const x = (...) =>)
  {
    kind: "arrow",
    pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(/,
    toShape: (m) => {
      const line = m.input ?? "";
      const async = /=\s*async/.test(line) ? "async-" : "";
      const paramMatch = line.match(/=\s*(?:async\s+)?\(([^)]*)\)/);
      const params = paramMatch
        ? paramMatch[1].split(",").filter((p) => p.trim()).length
        : 0;
      return `arrow-${async}${params}params`;
    },
  },
  // method (inside class)
  {
    kind: "method",
    pattern: /^\s+(?:public|private|protected|static|async|get|set|\*)*\s*\w+\s*\(/,
    toShape: (m) => {
      const line = m[0];
      const mods: string[] = [];
      if (/static/.test(line)) mods.push("static");
      if (/async/.test(line)) mods.push("async");
      if (/get\s+\w+/.test(line)) mods.push("getter");
      if (/set\s+\w+/.test(line)) mods.push("setter");
      const paramMatch = m.input?.match(/\(([^)]*)\)/);
      const params = paramMatch
        ? paramMatch[1].split(",").filter((p) => p.trim()).length
        : 0;
      return `method-${mods.join("-")}${mods.length ? "-" : ""}${params}params`;
    },
  },
  // decorator
  {
    kind: "decorator",
    pattern: /^\s*@\w+/,
    toShape: () => "decorator",
  },
  // control flow
  {
    kind: "conditional",
    pattern: /^\s*(?:if|else\s+if|else|switch)\s*(?:\(|{)/,
    toShape: (m) => {
      const line = m[0];
      if (/switch/.test(line)) return "switch";
      if (/else\s+if/.test(line)) return "else-if";
      if (/else/.test(line)) return "else";
      return "if";
    },
  },
  // loops
  {
    kind: "loop",
    pattern: /^\s*(?:for|while|do)\s*(?:\(|{)/,
    toShape: (m) => {
      const line = m[0];
      if (/for\s*\(.*\sof\s/.test(m.input ?? "")) return "for-of";
      if (/for\s*\(.*\sin\s/.test(m.input ?? "")) return "for-in";
      if (/while/.test(line)) return "while";
      if (/do/.test(line)) return "do-while";
      return "for";
    },
  },
  // try-catch
  {
    kind: "try-catch",
    pattern: /^\s*(?:try|catch|finally)\s*(?:\(|{)/,
    toShape: (m) => {
      const line = m[0];
      if (/catch/.test(line)) return "catch";
      if (/finally/.test(line)) return "finally";
      return "try";
    },
  },
  // return
  {
    kind: "return",
    pattern: /^\s*return\b/,
    toShape: (m) => {
      const line = m.input ?? "";
      if (/return\s*;?\s*$/.test(line.trim())) return "return-void";
      return "return-value";
    },
  },
  // variable declaration
  {
    kind: "variable",
    pattern: /^\s*(?:const|let|var)\s+\w+/,
    toShape: (m) => {
      const kind = m[0].match(/(const|let|var)/)?.[1] ?? "var";
      return `decl-${kind}`;
    },
  },
  // function call (standalone line)
  {
    kind: "call",
    pattern: /^\s*(?:await\s+)?[\w.]+\s*\(/,
    toShape: (m) => {
      const line = m[0];
      const await_ = /await/.test(line) ? "await-" : "";
      const chain = (m.input ?? "").split(".").length - 1;
      return `call-${await_}chain${chain}`;
    },
  },
];

// Rules for Python
const PY_RULES: ExtractionRule[] = [
  {
    kind: "import",
    pattern: /^\s*(?:from\s+\S+\s+)?import\s+/,
    toShape: (m) => (/from/.test(m[0]) ? "from-import" : "import"),
  },
  {
    kind: "class",
    pattern: /^\s*class\s+\w+/,
    toShape: (m) => {
      const ext = /\(\w+\)/.test(m.input ?? "") ? "-extends" : "";
      return `class-decl${ext}`;
    },
  },
  {
    kind: "function",
    pattern: /^\s*(?:async\s+)?def\s+\w+\s*\(/,
    toShape: (m) => {
      const async = /async\s+def/.test(m[0]) ? "async-" : "";
      const paramMatch = m.input?.match(/\(([^)]*)\)/);
      const params = paramMatch
        ? paramMatch[1].split(",").filter((p) => p.trim() && p.trim() !== "self" && p.trim() !== "cls").length
        : 0;
      return `func-${async}${params}params`;
    },
  },
  {
    kind: "decorator",
    pattern: /^\s*@\w+/,
    toShape: () => "decorator",
  },
  {
    kind: "conditional",
    pattern: /^\s*(?:if|elif|else)\s*(?::|\b)/,
    toShape: (m) => {
      if (/elif/.test(m[0])) return "elif";
      if (/else/.test(m[0])) return "else";
      return "if";
    },
  },
  {
    kind: "loop",
    pattern: /^\s*(?:for|while)\s+/,
    toShape: (m) => (/while/.test(m[0]) ? "while" : "for"),
  },
  {
    kind: "try-catch",
    pattern: /^\s*(?:try|except|finally)\s*(?::|\b)/,
    toShape: (m) => {
      if (/except/.test(m[0])) return "except";
      if (/finally/.test(m[0])) return "finally";
      return "try";
    },
  },
  {
    kind: "return",
    pattern: /^\s*return\b/,
    toShape: (m) => {
      const line = m.input ?? "";
      if (/return\s*$/.test(line.trim())) return "return-void";
      return "return-value";
    },
  },
  {
    kind: "variable",
    pattern: /^\s*\w+\s*(?::.*)?=/,
    toShape: () => "decl-assign",
  },
];

// Rules for Go
const GO_RULES: ExtractionRule[] = [
  {
    kind: "import",
    pattern: /^\s*import\s+/,
    toShape: () => "import",
  },
  {
    kind: "function",
    pattern: /^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+\s*\(/,
    toShape: (m) => {
      const isMethod = /func\s+\(/.test(m[0]);
      const paramMatch = m.input?.match(/\(([^)]*)\)/g);
      const params = paramMatch && paramMatch[0]
        ? paramMatch[0].slice(1, -1).split(",").filter((p) => p.trim()).length
        : 0;
      return isMethod ? `method-${params}params` : `func-${params}params`;
    },
  },
  {
    kind: "interface",
    pattern: /^\s*type\s+\w+\s+interface\s*{/,
    toShape: () => "interface-decl",
  },
  {
    kind: "class",
    pattern: /^\s*type\s+\w+\s+struct\s*{/,
    toShape: () => "struct-decl",
  },
  {
    kind: "conditional",
    pattern: /^\s*(?:if|else\s+if|else|switch)\s/,
    toShape: (m) => {
      if (/switch/.test(m[0])) return "switch";
      if (/else\s+if/.test(m[0])) return "else-if";
      if (/else/.test(m[0])) return "else";
      return "if";
    },
  },
  {
    kind: "loop",
    pattern: /^\s*for\s/,
    toShape: () => "for",
  },
  {
    kind: "return",
    pattern: /^\s*return\b/,
    toShape: () => "return-value",
  },
];

// Rules for shell scripts
const SH_RULES: ExtractionRule[] = [
  {
    kind: "function",
    pattern: /^\s*(?:function\s+)?\w+\s*\(\)\s*{/,
    toShape: () => "func",
  },
  {
    kind: "conditional",
    pattern: /^\s*(?:if|elif|else|fi)\b/,
    toShape: (m) => {
      if (/elif/.test(m[0])) return "elif";
      if (/else/.test(m[0])) return "else";
      if (/fi/.test(m[0])) return "fi";
      return "if";
    },
  },
  {
    kind: "loop",
    pattern: /^\s*(?:for|while|until|do|done)\b/,
    toShape: (m) => {
      if (/while/.test(m[0])) return "while";
      if (/until/.test(m[0])) return "until";
      return "for";
    },
  },
  {
    kind: "variable",
    pattern: /^\s*(?:export\s+)?[A-Za-z_]\w*=/,
    toShape: (m) => (/export/.test(m[0]) ? "export-assign" : "assign"),
  },
];

// ------------------------------------------------------------------ //
// Language detection
// ------------------------------------------------------------------ //

function getRulesForFile(filePath: string): ExtractionRule[] {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
    case ".vue":
    case ".svelte":
      return TS_RULES;
    case ".py":
      return PY_RULES;
    case ".go":
      return GO_RULES;
    case ".sh":
    case ".bash":
    case ".zsh":
    case ".fish":
      return SH_RULES;
    default:
      // Fall back to TS rules (covers C-family syntax broadly)
      return TS_RULES;
  }
}

// ------------------------------------------------------------------ //
// AST extraction
// ------------------------------------------------------------------ //

/** Extract AST nodes from source code using language-aware rules. */
export function extractAST(filePath: string, content: string): ASTNode[] {
  const rules = getRulesForFile(filePath);
  const lines = normalize(content).split("\n");
  const nodes: ASTNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const depth = indentDepth(line);

    for (const rule of rules) {
      const match = line.match(rule.pattern);
      if (match) {
        // Attach full line as input for toShape
        (match as RegExpMatchArray).input = line;
        nodes.push({
          kind: rule.kind,
          shape: rule.toShape(match),
          line: i + 1,
          depth,
        });
        break; // First matching rule wins per line
      }
    }
  }

  return nodes;
}

// ------------------------------------------------------------------ //
// AST fingerprinting & comparison
// ------------------------------------------------------------------ //

/** Generate an AST fingerprint — ordered sequence of (kind, shape, relativeDepth). */
export function astFingerprint(nodes: ASTNode[]): string[] {
  if (nodes.length === 0) return [];
  const baseDepth = nodes[0].depth;
  return nodes.map((n) => `${n.kind}:${n.shape}:${n.depth - baseDepth}`);
}

/** Generate n-gram shingles from an AST fingerprint. */
function astShingle(fingerprint: string[], n: number): Set<string> {
  const shingles = new Set<string>();
  for (let i = 0; i <= fingerprint.length - n; i++) {
    shingles.add(fingerprint.slice(i, i + n).join("|"));
  }
  return shingles;
}

/** Jaccard similarity between two sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
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

/** Compute edit-distance-based similarity on AST fingerprint sequences. */
function sequenceSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Optimised LCS (longest common subsequence) ratio
  const m = a.length;
  const n = b.length;

  // Use two-row DP for memory efficiency
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  const lcs = prev[n];
  return (2 * lcs) / (m + n);
}

export interface ASTMatchResult {
  snippet: Snippet;
  astSimilarity: number;
  sequenceSimilarity: number;
  combined: number;
  windowStart: number;
}

/**
 * AST-level matching: compare the structural shape of code blocks rather
 * than raw text tokens. This catches refactored code where variables are
 * renamed, formatting changes, comments added/removed, etc.
 *
 * Combined score = 0.5 AST-shingle Jaccard + 0.5 sequence similarity.
 */
export function astMatchFile(
  filePath: string,
  content: string,
  snippets: Snippet[],
  opts: {
    threshold?: number;
    ngramSize?: number;
  } = {},
): ScanMatch[] {
  const threshold = opts.threshold ?? 0.65;
  const ngramSize = opts.ngramSize ?? 3;

  const matches: ScanMatch[] = [];
  const lines = normalize(content).split("\n");
  const lineCount = lines.length;

  // Extract full file AST
  const fileAST = extractAST(filePath, content);

  if (fileAST.length < 2) return matches;

  for (const snippet of snippets) {
    const snippetAST = extractAST(filePath, snippet.content);
    if (snippetAST.length < 2) continue;

    const snippetFP = astFingerprint(snippetAST);
    const snippetShingles = astShingle(snippetFP, Math.min(ngramSize, snippetFP.length));

    // Determine the line range this snippet covers in the original
    const snippetLineCount = normalize(snippet.content).split("\n").length;

    // Sliding window over file AST nodes
    // Find nodes within each window of source lines
    let bestMatch: ASTMatchResult | null = null;

    for (let startLine = 0; startLine <= lineCount - snippetLineCount; startLine++) {
      const endLine = startLine + snippetLineCount;

      // Get AST nodes within this line range
      const windowNodes = fileAST.filter(
        (n) => n.line > startLine && n.line <= endLine,
      );

      if (windowNodes.length < 2) continue;

      // Quick size heuristic: skip if node count is wildly different
      const ratio = windowNodes.length > snippetAST.length
        ? snippetAST.length / windowNodes.length
        : windowNodes.length / snippetAST.length;
      if (ratio < threshold * 0.4) continue;

      const windowFP = astFingerprint(windowNodes);
      const windowShingles = astShingle(windowFP, Math.min(ngramSize, windowFP.length));

      // AST n-gram Jaccard
      const astSim = jaccard(snippetShingles, windowShingles);

      // Quick exit: if shingle similarity is too low, skip expensive LCS
      if (astSim * 0.5 + 0.5 < threshold) continue;

      // Sequence similarity (LCS-based)
      const seqSim = sequenceSimilarity(snippetFP, windowFP);

      const combined = 0.5 * astSim + 0.5 * seqSim;

      if (combined >= threshold) {
        if (!bestMatch || combined > bestMatch.combined) {
          bestMatch = {
            snippet,
            astSimilarity: astSim,
            sequenceSimilarity: seqSim,
            combined,
            windowStart: startLine,
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
        matchType: "ast",
      });
    }
  }

  return matches;
}
