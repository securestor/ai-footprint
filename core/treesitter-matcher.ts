/**
 * Tree-sitter native matching engine.
 *
 * Uses the optional `tree-sitter` native binary + language grammars to parse
 * code into real ASTs, then compares structural shapes for deep refactor
 * detection. Falls back gracefully to the regex-based AST matcher when
 * tree-sitter is not installed.
 *
 * Install tree-sitter support:
 *   npm install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-bash
 */

import { normalize } from "./hasher.js";
import { astMatchFile as regexAstMatchFile } from "./ast-matcher.js";
import type { Snippet, ScanMatch } from "./types.js";

// ------------------------------------------------------------------ //
// Dynamic imports — tree-sitter is optional
// ------------------------------------------------------------------ //

interface TSParser {
  setLanguage(lang: unknown): void;
  parse(input: string): TSTree;
  delete(): void;
}

interface TSTree {
  rootNode: TSNode;
  delete(): void;
}

interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  children: TSNode[];
  namedChildCount: number;
  namedChildren: TSNode[];
  parent: TSNode | null;
}

interface TSLanguageModule {
  default?: unknown;
  [key: string]: unknown;
}

let _parserClass: (new () => TSParser) | null = null;
let _available: boolean | null = null;
const _languageCache = new Map<string, unknown>();

/**
 * Check whether tree-sitter is installed and available.
 * Result is cached after the first call.
 */
export async function isTreeSitterAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  try {
    // Dynamic import — tree-sitter is an optional peer dependency
    // Use indirect eval to prevent TypeScript from resolving the module at compile time
    const modName = "tree-sitter";
    const mod = await (Function("m", "return import(m)")(modName) as Promise<Record<string, unknown>>);
    _parserClass = (mod.default ?? mod) as new () => TSParser;
    _available = true;
  } catch {
    _available = false;
  }
  return _available;
}

// ------------------------------------------------------------------ //
// Language grammar loading
// ------------------------------------------------------------------ //

const GRAMMAR_MODULES: Record<string, string[]> = {
  typescript: ["tree-sitter-typescript/typescript"],
  tsx: ["tree-sitter-typescript/tsx"],
  javascript: ["tree-sitter-javascript"],
  python: ["tree-sitter-python"],
  go: ["tree-sitter-go"],
  bash: ["tree-sitter-bash"],
};

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".fish": "bash",
};

function langFromPath(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

async function loadLanguage(lang: string): Promise<unknown | null> {
  if (_languageCache.has(lang)) return _languageCache.get(lang)!;

  const modulePaths = GRAMMAR_MODULES[lang];
  if (!modulePaths) return null;

  for (const modPath of modulePaths) {
    try {
      const mod = await (Function("m", "return import(m)")(modPath) as Promise<TSLanguageModule>);
      const grammar = mod.default ?? mod;
      _languageCache.set(lang, grammar);
      return grammar;
    } catch {
      // Grammar not installed — try next candidate
    }
  }
  return null;
}

// ------------------------------------------------------------------ //
// Structural node types we care about (normalised from tree-sitter types)
// ------------------------------------------------------------------ //

type StructuralKind =
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
  | "try"
  | "catch"
  | "loop"
  | "conditional"
  | "block"
  | "parameter"
  | "assignment"
  | "expression-statement";

/**
 * Map tree-sitter node types to our normalised structural kinds.
 * Covers TypeScript/JavaScript, Python, Go, and Bash grammars.
 */
const NODE_KIND_MAP: Record<string, StructuralKind> = {
  // Functions
  function_declaration: "function",
  function_definition: "function",
  function: "function",
  arrow_function: "arrow",
  generator_function_declaration: "function",
  async_function_declaration: "function",
  func_literal: "function", // Go

  // Classes & methods
  class_declaration: "class",
  class_definition: "class",
  class_body: "block",
  method_definition: "method",
  method_declaration: "method",

  // Imports / exports
  import_statement: "import",
  import_declaration: "import",
  import_from_statement: "import",
  export_statement: "export",
  export_declaration: "export",

  // Variables
  variable_declaration: "variable",
  variable_declarator: "variable",
  lexical_declaration: "variable",
  short_var_declaration: "variable", // Go
  assignment_statement: "assignment",
  assignment_expression: "assignment",
  augmented_assignment: "assignment",

  // Control flow
  if_statement: "conditional",
  else_clause: "conditional",
  elif_clause: "conditional",
  switch_statement: "conditional",
  switch_case: "conditional",
  case_clause: "conditional",
  ternary_expression: "conditional",

  // Loops
  for_statement: "loop",
  for_in_statement: "loop",
  while_statement: "loop",
  do_statement: "loop",
  for_range_statement: "loop", // Go

  // Try/catch
  try_statement: "try",
  catch_clause: "catch",
  finally_clause: "catch",
  except_clause: "catch",

  // Return
  return_statement: "return",

  // Calls
  call_expression: "call",
  new_expression: "call",

  // Types (TS)
  interface_declaration: "interface",
  type_alias_declaration: "type-alias",

  // Decorators
  decorator: "decorator",

  // Parameters
  formal_parameters: "parameter",
  required_parameter: "parameter",
  optional_parameter: "parameter",

  // Expression statements
  expression_statement: "expression-statement",

  // Blocks
  statement_block: "block",
  block: "block",

  // Bash
  compound_statement: "block",
  command: "call",
  pipeline: "call",
  redirected_statement: "call",
};

// ------------------------------------------------------------------ //
// AST extraction via tree-sitter
// ------------------------------------------------------------------ //

interface StructuralNode {
  kind: StructuralKind;
  /** Normalised shape string (kind + child count + depth). */
  shape: string;
  /** Source line (0-based). */
  line: number;
  /** Nesting depth. */
  depth: number;
}

function extractStructuralNodes(
  node: TSNode,
  depth: number = 0,
  results: StructuralNode[] = [],
): StructuralNode[] {
  const kind = NODE_KIND_MAP[node.type];
  if (kind) {
    // Build a shape string that captures structural essence
    const namedChildCount = node.namedChildCount;
    const childTypes = node.namedChildren
      .slice(0, 8) // Cap to avoid huge shapes
      .map((c) => NODE_KIND_MAP[c.type] ?? c.type.slice(0, 12))
      .join(",");

    results.push({
      kind,
      shape: `${kind}:${namedChildCount}:d${depth}[${childTypes}]`,
      line: node.startPosition.row,
      depth,
    });
  }

  for (const child of node.namedChildren) {
    extractStructuralNodes(child, depth + (kind ? 1 : 0), results);
  }

  return results;
}

// ------------------------------------------------------------------ //
// Fingerprinting & comparison (matching core/ast-matcher.ts interface)
// ------------------------------------------------------------------ //

function fingerprint(nodes: StructuralNode[]): string[] {
  if (nodes.length === 0) return [];
  const baseDepth = nodes[0].depth;
  return nodes.map((n) => `${n.kind}:${n.shape}:${n.depth - baseDepth}`);
}

function shingle(fp: string[], n: number): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i <= fp.length - n; i++) {
    s.add(fp.slice(i, i + n).join("|"));
  }
  return s;
}

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

function lcsRatio(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return (2 * prev[n]) / (m + n);
}

/**
 * Subtree similarity: compares shapes of structural subtrees rooted at
 * functions/classes — this goes deeper than the regex-based matcher by
 * examining actual parse-tree child hierarchies.
 */
function subtreeSimilarity(a: StructuralNode[], b: StructuralNode[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  // Extract function/class subtrees
  const aRoots = a.filter(
    (n) => n.kind === "function" || n.kind === "class" || n.kind === "method" || n.kind === "arrow",
  );
  const bRoots = b.filter(
    (n) => n.kind === "function" || n.kind === "class" || n.kind === "method" || n.kind === "arrow",
  );

  if (aRoots.length === 0 || bRoots.length === 0) return 0;

  // For each root in A, find best match in B
  let totalSim = 0;
  const usedB = new Set<number>();

  for (const aRoot of aRoots) {
    const aChildren = a.filter((n) => n.depth > aRoot.depth && n.line >= aRoot.line);
    const aSubFP = aChildren.slice(0, 20).map((n) => n.shape);
    let bestSim = 0;
    let bestIdx = -1;

    for (let bi = 0; bi < bRoots.length; bi++) {
      if (usedB.has(bi)) continue;
      const bRoot = bRoots[bi];
      const bChildren = b.filter((n) => n.depth > bRoot.depth && n.line >= bRoot.line);
      const bSubFP = bChildren.slice(0, 20).map((n) => n.shape);

      const sim = lcsRatio(aSubFP, bSubFP);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = bi;
      }
    }

    if (bestIdx >= 0) usedB.add(bestIdx);
    totalSim += bestSim;
  }

  return totalSim / Math.max(aRoots.length, bRoots.length);
}

// ------------------------------------------------------------------ //
// Public API
// ------------------------------------------------------------------ //

export interface TreeSitterMatchResult {
  snippet: Snippet;
  shingleSimilarity: number;
  sequenceSimilarity: number;
  subtreeSimilarity: number;
  combined: number;
  windowStart: number;
}

/**
 * Parse source code with tree-sitter and extract structural nodes.
 * Returns null if tree-sitter is unavailable or the language isn't supported.
 */
export async function treesitterParse(
  filePath: string,
  content: string,
): Promise<StructuralNode[] | null> {
  if (!await isTreeSitterAvailable() || !_parserClass) return null;

  const lang = langFromPath(filePath);
  if (!lang) return null;

  const grammar = await loadLanguage(lang);
  if (!grammar) return null;

  const parser = new _parserClass();
  try {
    parser.setLanguage(grammar);
    const tree = parser.parse(content);
    const nodes = extractStructuralNodes(tree.rootNode);
    tree.delete();
    return nodes;
  } catch {
    return null;
  } finally {
    parser.delete();
  }
}

/**
 * Tree-sitter-powered file matching with deep structural comparison.
 *
 * Combined score = 0.35 shingle Jaccard + 0.35 LCS sequence + 0.30 subtree.
 * Falls back to regex-based AST matching if tree-sitter is unavailable.
 */
export async function treesitterMatchFile(
  filePath: string,
  content: string,
  snippets: Snippet[],
  opts: {
    threshold?: number;
    ngramSize?: number;
  } = {},
): Promise<ScanMatch[]> {
  // Fall back to regex AST matcher if tree-sitter is unavailable
  if (!await isTreeSitterAvailable()) {
    return regexAstMatchFile(filePath, content, snippets, opts);
  }

  const threshold = opts.threshold ?? 0.65;
  const ngramSize = opts.ngramSize ?? 3;
  const matches: ScanMatch[] = [];
  const normalised = normalize(content);
  const lines = normalised.split("\n");
  const lineCount = lines.length;

  // Parse full file
  const fileNodes = await treesitterParse(filePath, content);
  if (!fileNodes || fileNodes.length < 2) {
    // Fall back for unsupported languages
    return regexAstMatchFile(filePath, content, snippets, opts);
  }

  const fileFP = fingerprint(fileNodes);

  for (const snippet of snippets) {
    const snippetNodes = await treesitterParse(filePath, snippet.content);

    // If snippet can't be parsed with tree-sitter, skip
    if (!snippetNodes || snippetNodes.length < 2) continue;

    const snippetFP = fingerprint(snippetNodes);
    const snippetShingles = shingle(snippetFP, Math.min(ngramSize, snippetFP.length));
    const snippetLineCount = normalize(snippet.content).split("\n").length;

    let bestMatch: TreeSitterMatchResult | null = null;

    // Sliding window over file
    for (let startLine = 0; startLine <= lineCount - snippetLineCount; startLine++) {
      const endLine = startLine + snippetLineCount;

      const windowNodes = fileNodes.filter(
        (n) => n.line >= startLine && n.line < endLine,
      );
      if (windowNodes.length < 2) continue;

      // Quick size check
      const ratio = windowNodes.length > snippetNodes.length
        ? snippetNodes.length / windowNodes.length
        : windowNodes.length / snippetNodes.length;
      if (ratio < threshold * 0.35) continue;

      const windowFP = fingerprint(windowNodes);
      const windowShingles = shingle(windowFP, Math.min(ngramSize, windowFP.length));

      // Shingle similarity
      const shingleSim = jaccard(snippetShingles, windowShingles);

      // Quick exit
      if (shingleSim * 0.35 + 0.65 < threshold) continue;

      // Sequence similarity
      const seqSim = lcsRatio(snippetFP, windowFP);

      // Quick exit
      if (shingleSim * 0.35 + seqSim * 0.35 + 0.30 < threshold) continue;

      // Subtree similarity (the tree-sitter bonus — deeper structural comparison)
      const subSim = subtreeSimilarity(snippetNodes, windowNodes);

      const combined = 0.35 * shingleSim + 0.35 * seqSim + 0.30 * subSim;

      if (combined >= threshold) {
        if (!bestMatch || combined > bestMatch.combined) {
          bestMatch = {
            snippet,
            shingleSimilarity: shingleSim,
            sequenceSimilarity: seqSim,
            subtreeSimilarity: subSim,
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

/**
 * Get a diagnostic summary of tree-sitter support.
 */
export async function treesitterStatus(): Promise<{
  available: boolean;
  languages: string[];
}> {
  const available = await isTreeSitterAvailable();
  const languages: string[] = [];

  if (available) {
    for (const lang of Object.keys(GRAMMAR_MODULES)) {
      const grammar = await loadLanguage(lang);
      if (grammar) languages.push(lang);
    }
  }

  return { available, languages };
}
