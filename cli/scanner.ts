import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
import { matchFile } from "../core/matcher.js";
import { loadRegistry } from "./registry.js";
import { MAX_FILE_SIZE } from "../core/security.js";
import type { ScanMatch, ScanOptions, ScanReport } from "../core/types.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
  ".vue", ".svelte", ".astro",
  ".sh", ".bash", ".zsh", ".fish",
  ".md",
]);

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    // Skip symlinks to prevent traversal into unexpected directories
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

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i);
}

export function scan(targetDir: string, options: ScanOptions = {}): ScanReport {
  const files = collectFiles(targetDir);
  const registry = loadRegistry();
  const allMatches: ScanMatch[] = [];
  const attributedFiles = new Set<string>();
  const suspiciousFiles = new Set<string>();
  const modelCounts = new Map<string, number>();

  for (const file of files) {
    // Enforce file size limit to prevent OOM
    try {
      const stat = lstatSync(file);
      if (stat.size > MAX_FILE_SIZE) continue;
    } catch { continue; }
    const content = readFileSync(file, "utf-8");
    const relPath = relative(targetDir, file);
    const matches = matchFile(relPath, content, registry.snippets, options);

    for (const m of matches) {
      allMatches.push(m);

      if (m.snippet) {
        attributedFiles.add(m.file);
        if (m.snippet.model) {
          modelCounts.set(
            m.snippet.model,
            (modelCounts.get(m.snippet.model) ?? 0) + 1,
          );
        }
      } else {
        suspiciousFiles.add(m.file);
      }
    }
  }

  // Remove files that are both attributed and suspicious (attributed wins)
  for (const f of attributedFiles) suspiciousFiles.delete(f);

  let topModel: string | null = null;
  let topCount = 0;
  for (const [model, count] of modelCounts) {
    if (count > topCount) {
      topModel = model;
      topCount = count;
    }
  }

  return {
    filesAnalyzed: files.length,
    aiAttributedFiles: attributedFiles.size,
    unattributedSuspicious: suspiciousFiles.size,
    topModel,
    matches: allMatches,
  };
}
