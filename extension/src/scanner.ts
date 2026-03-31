import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import type { ScanMatch, ScanReport, Snippet, SnippetRegistry } from "./types.js";

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

// ── Core matching (inlined to avoid cross-rootDir imports) ────────────

function normalize(code: string): string {
  return code.split("\n").map((l) => l.trimEnd()).join("\n").replace(/\r\n/g, "\n").trim();
}

function hashSnippet(code: string): string {
  return createHash("sha256").update(normalize(code)).digest("hex");
}

const AI_PATTERNS: { pattern: RegExp; tag: string }[] = [
  { pattern: /\/\/\s*generated\s+by\s+(gpt|copilot|claude|gemini|codex|ai)/i, tag: "comment-tag" },
  { pattern: /\/\*\s*@ai[- ]generated/i, tag: "jsdoc-tag" },
  { pattern: /#\s*generated\s+by\s+(gpt|copilot|claude|gemini|codex|ai)/i, tag: "hash-comment-tag" },
  { pattern: /AI-generated|ai_generated/i, tag: "marker" },
  { pattern: /copilot|GitHub Copilot/i, tag: "copilot-ref" },
];

function matchContent(filePath: string, content: string, snippets: Snippet[]): ScanMatch[] {
  const matches: ScanMatch[] = [];
  const lines = content.split("\n");

  for (const snippet of snippets) {
    const snippetLines = normalize(snippet.content).split("\n");
    const windowSize = snippetLines.length;
    for (let i = 0; i <= lines.length - windowSize; i++) {
      const window = lines.slice(i, i + windowSize).join("\n");
      if (hashSnippet(window) === snippet.hash) {
        matches.push({ file: filePath, line: i + 1, snippet, confidence: "high", similarity: 1.0, matchType: "exact" });
      }
    }
  }

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
