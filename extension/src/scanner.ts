import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import type { ScanMatch, ScanOptions, ScanReport, Snippet, SnippetRegistry } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// ── Registry ──────────────────────────────────────────────────────────

const REGISTRY_PATH = join(homedir(), ".ai-footprint", "snippets.json");

function loadSnippets(): Snippet[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as SnippetRegistry;
    return data.snippets ?? [];
  } catch {
    return [];
  }
}

// ── Core helpers ──────────────────────────────────────────────────────

function normalize(code: string): string {
  return code.split("\n").map((l) => l.trimEnd()).join("\n").replace(/\r\n/g, "\n").trim();
}

function hashSnippet(code: string): string {
  return createHash("sha256").update(normalize(code)).digest("hex");
}

// ── Heuristic AI patterns ─────────────────────────────────────────────

const AI_PATTERNS: { pattern: RegExp; tag: string }[] = [
  { pattern: /\/\/\s*generated\s+by\s+(gpt|copilot|claude|gemini|codex|ai)/i, tag: "comment-tag" },
  { pattern: /\/\*\s*@ai[- ]generated/i, tag: "jsdoc-tag" },
  { pattern: /#\s*generated\s+by\s+(gpt|copilot|claude|gemini|codex|ai)/i, tag: "hash-comment-tag" },
  { pattern: /AI-generated|ai_generated/i, tag: "marker" },
  { pattern: /copilot|GitHub Copilot/i, tag: "copilot-ref" },
];

// ── Fuzzy matching (n-gram Jaccard) ───────────────────────────────────

const DEFAULT_NGRAM_SIZE = 3;
const DEFAULT_FUZZY_THRESHOLD = 0.6;

function tokenize(code: string): string[] {
  return normalize(code)
    .replace(/[{}()\[\];,.:]/g, " $& ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function structuralTokenize(code: string): string[] {
  return normalize(code)
    .replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, "STR")
    .replace(/\b\d+(?:\.\d+)?\b/g, "NUM")
    .replace(/\b[a-z_$][a-zA-Z0-9_$]*\b/g, "ID")
    .replace(/[{}()\[\];,.:]/g, " $& ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function shingle(tokens: string[], n: number): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    s.add(tokens.slice(i, i + n).join(" "));
  }
  return s;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
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

function fuzzyMatchFile(
  filePath: string,
  content: string,
  snippets: Snippet[],
  opts: { threshold?: number; ngramSize?: number } = {},
): ScanMatch[] {
  const threshold = opts.threshold ?? DEFAULT_FUZZY_THRESHOLD;
  const ngramSize = opts.ngramSize ?? DEFAULT_NGRAM_SIZE;
  const matches: ScanMatch[] = [];
  const lines = content.split("\n");
  const lineCount = lines.length;

  const lineTokens: string[][] = lines.map((l) => tokenize(l));
  const lineStructTokens: string[][] = lines.map((l) => structuralTokenize(l));

  const cumTokenCount: number[] = new Array(lineCount + 1);
  cumTokenCount[0] = 0;
  for (let i = 0; i < lineCount; i++) {
    cumTokenCount[i + 1] = cumTokenCount[i] + lineTokens[i].length;
  }

  for (const snippet of snippets) {
    const snippetLines = normalize(snippet.content).split("\n");
    const baseWindowSize = snippetLines.length;
    const snippetTokenArr = tokenize(snippet.content);
    const snippetStructArr = structuralTokenize(snippet.content);
    const snippetTokenShingles = shingle(snippetTokenArr, ngramSize);
    const snippetStructShingles = shingle(snippetStructArr, ngramSize);
    const snippetTokenCount = snippetTokenArr.length;

    if (snippetTokenShingles.size < 2) continue;
    if (lineCount < baseWindowSize - 5) continue;

    let bestCombined = 0;
    let bestLine = -1;

    const winSize = Math.min(baseWindowSize, lineCount);
    for (let i = 0; i <= lineCount - winSize; i++) {
      const windowTokenCount = cumTokenCount[i + winSize] - cumTokenCount[i];
      const ratio = windowTokenCount > snippetTokenCount
        ? snippetTokenCount / windowTokenCount
        : windowTokenCount / snippetTokenCount;
      if (ratio < threshold * 0.5) continue;

      let windowTokenArr: string[] = [];
      let windowStructArr: string[] = [];
      for (let j = i; j < i + winSize; j++) {
        windowTokenArr = windowTokenArr.concat(lineTokens[j]);
        windowStructArr = windowStructArr.concat(lineStructTokens[j]);
      }

      const windowStructShingles = shingle(windowStructArr, ngramSize);
      const structSim = jaccardSimilarity(snippetStructShingles, windowStructShingles);
      if (structSim * 0.6 + 0.4 < threshold) continue;

      const windowTokenShingles = shingle(windowTokenArr, ngramSize);
      const tokenSim = jaccardSimilarity(snippetTokenShingles, windowTokenShingles);
      const combined = 0.4 * tokenSim + 0.6 * structSim;

      if (combined >= threshold && combined > bestCombined) {
        bestCombined = combined;
        bestLine = i;
      }
    }

    if (bestLine >= 0) {
      matches.push({
        file: filePath,
        line: bestLine + 1,
        snippet,
        confidence: bestCombined >= 0.85 ? "high" : "medium",
        similarity: bestCombined,
        matchType: "fuzzy",
      });
    }
  }
  return matches;
}

// ── AST matching ──────────────────────────────────────────────────────

type ASTNodeKind = "function" | "class" | "method" | "import" | "export" | "variable"
  | "control" | "return" | "call" | "arrow" | "interface" | "type-alias"
  | "decorator" | "try-catch" | "loop" | "conditional";

interface ASTNode {
  kind: ASTNodeKind;
  shape: string;
  line: number;
  depth: number;
}

interface ExtractionRule {
  kind: ASTNodeKind;
  pattern: RegExp;
  toShape: (m: RegExpMatchArray) => string;
}

function indentDepth(line: string): number {
  const match = line.match(/^(\s*)/);
  if (!match) return 0;
  return Math.floor(match[1].replace(/\t/g, "    ").length / 2);
}

const TS_RULES: ExtractionRule[] = [
  { kind: "import", pattern: /^\s*import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+)\s+from\s+/, toShape: (m) => /import\s+type/.test(m[0]) ? "import-type" : "import" },
  { kind: "export", pattern: /^\s*export\s+(?:default\s+)?(?:type\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|enum|type)\b/, toShape: (m) => { const d = /export\s+default/.test(m[0]) ? "default-" : ""; const w = m[0].match(/(function|class|const|let|var|interface|enum|type)\b/); return `export-${d}${w?.[1] ?? "unknown"}`; } },
  { kind: "interface", pattern: /^\s*(?:export\s+)?interface\s+\w+/, toShape: () => "interface-decl" },
  { kind: "type-alias", pattern: /^\s*(?:export\s+)?type\s+\w+\s*=/, toShape: () => "type-alias" },
  { kind: "class", pattern: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/, toShape: (m) => { const a = /abstract\s+class/.test(m[0]) ? "abstract-" : ""; const e = /extends\s+\w+/.test(m.input ?? "") ? "-extends" : ""; const i = /implements\s+\w+/.test(m.input ?? "") ? "-implements" : ""; return `class-${a}decl${e}${i}`; } },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*\w*\s*\(/, toShape: (m) => { const a = /async\s+function/.test(m[0]) ? "async-" : ""; const g = /function\s*\*/.test(m[0]) ? "gen-" : ""; const p = m.input?.match(/\(([^)]*)\)/); const c = p ? p[1].split(",").filter((s) => s.trim()).length : 0; return `func-${a}${g}${c}params`; } },
  { kind: "arrow", pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(/, toShape: (m) => { const l = m.input ?? ""; const a = /=\s*async/.test(l) ? "async-" : ""; const p = l.match(/=\s*(?:async\s+)?\(([^)]*)\)/); const c = p ? p[1].split(",").filter((s) => s.trim()).length : 0; return `arrow-${a}${c}params`; } },
  { kind: "method", pattern: /^\s+(?:public|private|protected|static|async|get|set|\*)*\s*\w+\s*\(/, toShape: (m) => { const mods: string[] = []; if (/static/.test(m[0])) mods.push("static"); if (/async/.test(m[0])) mods.push("async"); if (/get\s+\w+/.test(m[0])) mods.push("getter"); if (/set\s+\w+/.test(m[0])) mods.push("setter"); const p = m.input?.match(/\(([^)]*)\)/); const c = p ? p[1].split(",").filter((s) => s.trim()).length : 0; return `method-${mods.join("-")}${mods.length ? "-" : ""}${c}params`; } },
  { kind: "decorator", pattern: /^\s*@\w+/, toShape: () => "decorator" },
  { kind: "conditional", pattern: /^\s*(?:if|else\s+if|else|switch)\s*(?:\(|{)/, toShape: (m) => { if (/switch/.test(m[0])) return "switch"; if (/else\s+if/.test(m[0])) return "else-if"; if (/else/.test(m[0])) return "else"; return "if"; } },
  { kind: "loop", pattern: /^\s*(?:for|while|do)\s*(?:\(|{)/, toShape: (m) => { if (/for\s*\(.*\sof\s/.test(m.input ?? "")) return "for-of"; if (/for\s*\(.*\sin\s/.test(m.input ?? "")) return "for-in"; if (/while/.test(m[0])) return "while"; if (/do/.test(m[0])) return "do-while"; return "for"; } },
  { kind: "try-catch", pattern: /^\s*(?:try|catch|finally)\s*(?:\(|{)/, toShape: (m) => { if (/catch/.test(m[0])) return "catch"; if (/finally/.test(m[0])) return "finally"; return "try"; } },
  { kind: "return", pattern: /^\s*return\b/, toShape: (m) => /return\s*;?\s*$/.test((m.input ?? "").trim()) ? "return-void" : "return-value" },
  { kind: "variable", pattern: /^\s*(?:const|let|var)\s+\w+/, toShape: (m) => `decl-${m[0].match(/(const|let|var)/)?.[1] ?? "var"}` },
  { kind: "call", pattern: /^\s*(?:await\s+)?[\w.]+\s*\(/, toShape: (m) => { const a = /await/.test(m[0]) ? "await-" : ""; const c = (m.input ?? "").split(".").length - 1; return `call-${a}chain${c}`; } },
];

const PY_RULES: ExtractionRule[] = [
  { kind: "import", pattern: /^\s*(?:from\s+\S+\s+)?import\s+/, toShape: (m) => /from/.test(m[0]) ? "from-import" : "import" },
  { kind: "class", pattern: /^\s*class\s+\w+/, toShape: (m) => `class-decl${/\(\w+\)/.test(m.input ?? "") ? "-extends" : ""}` },
  { kind: "function", pattern: /^\s*(?:async\s+)?def\s+\w+\s*\(/, toShape: (m) => { const a = /async\s+def/.test(m[0]) ? "async-" : ""; const p = m.input?.match(/\(([^)]*)\)/); const c = p ? p[1].split(",").filter((s) => s.trim() && s.trim() !== "self" && s.trim() !== "cls").length : 0; return `func-${a}${c}params`; } },
  { kind: "decorator", pattern: /^\s*@\w+/, toShape: () => "decorator" },
  { kind: "conditional", pattern: /^\s*(?:if|elif|else)\s*(?::|\b)/, toShape: (m) => { if (/elif/.test(m[0])) return "elif"; if (/else/.test(m[0])) return "else"; return "if"; } },
  { kind: "loop", pattern: /^\s*(?:for|while)\s+/, toShape: (m) => /while/.test(m[0]) ? "while" : "for" },
  { kind: "try-catch", pattern: /^\s*(?:try|except|finally)\s*(?::|\b)/, toShape: (m) => { if (/except/.test(m[0])) return "except"; if (/finally/.test(m[0])) return "finally"; return "try"; } },
  { kind: "return", pattern: /^\s*return\b/, toShape: (m) => /return\s*$/.test((m.input ?? "").trim()) ? "return-void" : "return-value" },
  { kind: "variable", pattern: /^\s*\w+\s*(?::.*)?=/, toShape: () => "decl-assign" },
];

const GO_RULES: ExtractionRule[] = [
  { kind: "import", pattern: /^\s*import\s+/, toShape: () => "import" },
  { kind: "function", pattern: /^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+\s*\(/, toShape: (m) => { const isMethod = /func\s+\(/.test(m[0]); const p = m.input?.match(/\(([^)]*)\)/g); const c = p?.[0] ? p[0].slice(1, -1).split(",").filter((s) => s.trim()).length : 0; return isMethod ? `method-${c}params` : `func-${c}params`; } },
  { kind: "interface", pattern: /^\s*type\s+\w+\s+interface\s*{/, toShape: () => "interface-decl" },
  { kind: "class", pattern: /^\s*type\s+\w+\s+struct\s*{/, toShape: () => "struct-decl" },
  { kind: "conditional", pattern: /^\s*(?:if|else\s+if|else|switch)\s/, toShape: (m) => { if (/switch/.test(m[0])) return "switch"; if (/else\s+if/.test(m[0])) return "else-if"; if (/else/.test(m[0])) return "else"; return "if"; } },
  { kind: "loop", pattern: /^\s*for\s/, toShape: () => "for" },
  { kind: "return", pattern: /^\s*return\b/, toShape: () => "return-value" },
];

const SH_RULES: ExtractionRule[] = [
  { kind: "function", pattern: /^\s*(?:function\s+)?\w+\s*\(\)\s*{/, toShape: () => "func" },
  { kind: "conditional", pattern: /^\s*(?:if|elif|else|fi)\b/, toShape: (m) => { if (/elif/.test(m[0])) return "elif"; if (/else/.test(m[0])) return "else"; if (/fi/.test(m[0])) return "fi"; return "if"; } },
  { kind: "loop", pattern: /^\s*(?:for|while|until|do|done)\b/, toShape: (m) => { if (/while/.test(m[0])) return "while"; if (/until/.test(m[0])) return "until"; return "for"; } },
  { kind: "variable", pattern: /^\s*(?:export\s+)?[A-Za-z_]\w*=/, toShape: (m) => /export/.test(m[0]) ? "export-assign" : "assign" },
];

function getRulesForFile(filePath: string): ExtractionRule[] {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".ts": case ".tsx": case ".js": case ".jsx": case ".mjs": case ".cjs": case ".vue": case ".svelte": return TS_RULES;
    case ".py": return PY_RULES;
    case ".go": return GO_RULES;
    case ".sh": case ".bash": case ".zsh": case ".fish": return SH_RULES;
    default: return TS_RULES;
  }
}

function extractAST(filePath: string, content: string): ASTNode[] {
  const rules = getRulesForFile(filePath);
  const lines = normalize(content).split("\n");
  const nodes: ASTNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const depth = indentDepth(line);
    for (const rule of rules) {
      const match = line.match(rule.pattern);
      if (match) {
        (match as RegExpMatchArray).input = line;
        nodes.push({ kind: rule.kind, shape: rule.toShape(match), line: i + 1, depth });
        break;
      }
    }
  }
  return nodes;
}

function astFingerprint(nodes: ASTNode[]): string[] {
  if (nodes.length === 0) return [];
  const baseDepth = nodes[0].depth;
  return nodes.map((n) => `${n.kind}:${n.shape}:${n.depth - baseDepth}`);
}

function astShingle(fp: string[], n: number): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i <= fp.length - n; i++) {
    s.add(fp.slice(i, i + n).join("|"));
  }
  return s;
}

function sequenceSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return (2 * prev[n]) / (m + n);
}

function astMatchFile(
  filePath: string,
  content: string,
  snippets: Snippet[],
  opts: { threshold?: number; ngramSize?: number } = {},
): ScanMatch[] {
  const threshold = opts.threshold ?? 0.65;
  const ngramSize = opts.ngramSize ?? 3;
  const matches: ScanMatch[] = [];
  const lines = normalize(content).split("\n");
  const lineCount = lines.length;
  const fileAST = extractAST(filePath, content);
  if (fileAST.length < 2) return matches;

  for (const snippet of snippets) {
    const snippetAST = extractAST(filePath, snippet.content);
    if (snippetAST.length < 2) continue;
    const snippetFP = astFingerprint(snippetAST);
    const snippetShingles = astShingle(snippetFP, Math.min(ngramSize, snippetFP.length));
    const snippetLineCount = normalize(snippet.content).split("\n").length;
    let bestCombined = 0;
    let bestLine = -1;

    for (let startLine = 0; startLine <= lineCount - snippetLineCount; startLine++) {
      const endLine = startLine + snippetLineCount;
      const windowNodes = fileAST.filter((n) => n.line > startLine && n.line <= endLine);
      if (windowNodes.length < 2) continue;
      const ratio = windowNodes.length > snippetAST.length
        ? snippetAST.length / windowNodes.length
        : windowNodes.length / snippetAST.length;
      if (ratio < threshold * 0.4) continue;
      const windowFP = astFingerprint(windowNodes);
      const windowShingles = astShingle(windowFP, Math.min(ngramSize, windowFP.length));
      const astSim = jaccardSimilarity(snippetShingles, windowShingles);
      if (astSim * 0.5 + 0.5 < threshold) continue;
      const seqSim = sequenceSimilarity(snippetFP, windowFP);
      const combined = 0.5 * astSim + 0.5 * seqSim;
      if (combined >= threshold && combined > bestCombined) {
        bestCombined = combined;
        bestLine = startLine;
      }
    }

    if (bestLine >= 0) {
      matches.push({
        file: filePath,
        line: bestLine + 1,
        snippet,
        confidence: bestCombined >= 0.85 ? "high" : "medium",
        similarity: bestCombined,
        matchType: "ast",
      });
    }
  }
  return matches;
}

// ── Combined content matching ─────────────────────────────────────────

function matchContent(filePath: string, content: string, snippets: Snippet[], options: ScanOptions = {}): ScanMatch[] {
  const matches: ScanMatch[] = [];
  const lines = content.split("\n");
  const exactMatchedLines = new Set<number>();

  // 1. Exact snippet hash matches (sliding window)
  for (const snippet of snippets) {
    const snippetLines = normalize(snippet.content).split("\n");
    const windowSize = snippetLines.length;
    for (let i = 0; i <= lines.length - windowSize; i++) {
      const window = lines.slice(i, i + windowSize).join("\n");
      if (hashSnippet(window) === snippet.hash) {
        matches.push({ file: filePath, line: i + 1, snippet, confidence: "high", similarity: 1.0, matchType: "exact" });
        for (let j = i; j < i + windowSize; j++) exactMatchedLines.add(j);
      }
    }
  }

  // 2. Fuzzy matching
  if (options.fuzzy !== false && snippets.length > 0) {
    const fuzzyMatches = fuzzyMatchFile(filePath, content, snippets, {
      threshold: options.fuzzyThreshold,
      ngramSize: options.ngramSize,
    });
    for (const fm of fuzzyMatches) {
      if (!exactMatchedLines.has(fm.line - 1)) {
        matches.push(fm);
      }
    }
  }

  // 3. AST-level matching
  if (options.ast !== false && snippets.length > 0) {
    const astMatches = astMatchFile(filePath, content, snippets, {
      threshold: options.astThreshold,
      ngramSize: options.ngramSize,
    });
    const matchedLines = new Set(matches.map((m) => m.line));
    for (const am of astMatches) {
      if (!matchedLines.has(am.line)) {
        matches.push(am);
      }
    }
  }

  // 4. Regex heuristic patterns (line-by-line)
  for (let i = 0; i < lines.length; i++) {
    for (const { pattern, tag } of AI_PATTERNS) {
      if (pattern.test(lines[i])) {
        matches.push({ file: filePath, line: i + 1, pattern: tag, confidence: "medium", matchType: "pattern" });
      }
    }
  }

  return matches;
}

// ── Workspace scan ────────────────────────────────────────────────────

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__", "out"]);
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
  ".vue", ".svelte", ".astro",
  ".sh", ".bash", ".zsh", ".fish",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i);
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    try {
      if (lstatSync(full).isSymbolicLink()) continue;
    } catch { continue; }
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (CODE_EXTENSIONS.has(extOf(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

function scanDirectory(targetDir: string): ScanReport {
  const files = collectFiles(targetDir);
  const snippets = loadSnippets();
  const allMatches: ScanMatch[] = [];
  const attributedFiles = new Set<string>();
  const suspiciousFiles = new Set<string>();
  const modelCounts = new Map<string, number>();

  for (const file of files) {
    try {
      const stat = lstatSync(file);
      if (stat.size > MAX_FILE_SIZE) continue;
    } catch { continue; }
    const content = readFileSync(file, "utf-8");
    const relPath = relative(targetDir, file);
    const matches = matchContent(relPath, content, snippets);
    for (const m of matches) {
      allMatches.push(m);
      if (m.snippet) {
        attributedFiles.add(m.file);
        if (m.snippet.model) modelCounts.set(m.snippet.model, (modelCounts.get(m.snippet.model) ?? 0) + 1);
      } else {
        suspiciousFiles.add(m.file);
      }
    }
  }

  for (const f of attributedFiles) suspiciousFiles.delete(f);

  let topModel: string | null = null;
  let topCount = 0;
  for (const [model, count] of modelCounts) {
    if (count > topCount) { topModel = model; topCount = count; }
  }

  return { filesAnalyzed: files.length, aiAttributedFiles: attributedFiles.size, unattributedSuspicious: suspiciousFiles.size, topModel, matches: allMatches };
}

// ── Public scanner class ──────────────────────────────────────────────

export interface ScanDocumentOptions {
  fuzzyThreshold?: number;
}

export class Scanner {
  private cache = new Map<string, { version: number; matches: ScanMatch[] }>();

  async scanDocument(
    document: vscode.TextDocument,
    options: ScanDocumentOptions = {},
  ): Promise<ScanMatch[]> {
    const uri = document.uri.toString();
    const cached = this.cache.get(uri);
    if (cached && cached.version === document.version) {
      return cached.matches;
    }

    const content = document.getText();
    const snippets = loadSnippets();
    const matches = matchContent(
      vscode.workspace.asRelativePath(document.uri),
      content,
      snippets,
      { fuzzyThreshold: options.fuzzyThreshold },
    );

    this.cache.set(uri, { version: document.version, matches });
    return matches;
  }

  async scanWorkspace(rootPath: string): Promise<ScanReport> {
    return scanDirectory(rootPath);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
