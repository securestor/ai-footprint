import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { hashSnippet } from "../core/hasher.js";
import type { Snippet, SnippetRegistry } from "../core/types.js";
import { audit, MAX_FILE_SIZE } from "../core/security.js";

const CONFIG_DIR = join(homedir(), ".ai-footprint");
const REGISTRY_PATH = join(CONFIG_DIR, "snippets.json");

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** Find the .git directory for the current working directory. */
function findGitDir(): string | null {
  try {
    const gitDir = execSync("git rev-parse --git-dir", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return gitDir;
  } catch {
    return null;
  }
}

/** Install git hooks (pre-commit and commit-msg) into the repo's .git/hooks/. */
function installGitHooks(): void {
  const gitDir = findGitDir();
  if (!gitDir) {
    console.log("Not a git repository — skipping hook installation.");
    return;
  }

  const hooksDir = join(gitDir, "hooks");
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const preCommitContent = `#!/bin/sh
# ai-footprint pre-commit hook (auto-installed)
npx ai-footprint hook --pre-commit
`;

  const commitMsgContent = `#!/bin/sh
# ai-footprint commit-msg hook (auto-installed)
npx ai-footprint hook --commit-msg "$1"
`;

  const preCommitPath = join(hooksDir, "pre-commit");
  const commitMsgPath = join(hooksDir, "commit-msg");

  let installed = 0;

  if (existsSync(preCommitPath)) {
    console.log("  pre-commit hook already exists — skipping (back up manually if needed).");
  } else {
    writeFileSync(preCommitPath, preCommitContent, { mode: 0o755 });
    installed++;
    console.log("  ✓ Installed pre-commit hook");
  }

  if (existsSync(commitMsgPath)) {
    console.log("  commit-msg hook already exists — skipping (back up manually if needed).");
  } else {
    writeFileSync(commitMsgPath, commitMsgContent, { mode: 0o755 });
    installed++;
    console.log("  ✓ Installed commit-msg hook");
  }

  if (installed > 0) {
    console.log(`Git hooks installed in ${hooksDir}`);
  }
}

/** Initialise the local snippet registry and install git hooks. */
export function init(): void {
  ensureDir();
  if (existsSync(REGISTRY_PATH)) {
    console.log(`Registry already exists at ${REGISTRY_PATH}`);
  } else {
    const registry: SnippetRegistry = { version: 1, snippets: [] };
    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
    console.log(`Initialized snippet registry at ${REGISTRY_PATH}`);
  }

  // Always try to install hooks (even if registry existed)
  console.log("\nInstalling git hooks...");
  installGitHooks();
}

/** Load the registry from disk. */
export function loadRegistry(): SnippetRegistry {
  if (!existsSync(REGISTRY_PATH)) {
    return { version: 1, snippets: [] };
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as SnippetRegistry;
}

/** Save the registry to disk. */
function saveRegistry(registry: SnippetRegistry): void {
  ensureDir();
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

/** Add a snippet to the local registry. */
export function addSnippet(opts: {
  content: string;
  source: string;
  model?: string;
  tool?: string;
}): Snippet {
  const registry = loadRegistry();
  const snippet: Snippet = {
    id: randomUUID(),
    hash: hashSnippet(opts.content),
    source: opts.source,
    model: opts.model,
    tool: opts.tool,
    addedAt: new Date().toISOString(),
    content: opts.content,
  };
  registry.snippets.push(snippet);
  saveRegistry(registry);
  audit("snippet.add", `Added snippet ${snippet.id} (hash: ${snippet.hash.slice(0, 12)})`);
  return snippet;
}

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
  ".vue", ".svelte", ".astro",
]);

function collectCodeFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    // Skip symlinks to prevent traversal into unexpected directories
    try {
      if (lstatSync(full).isSymbolicLink()) continue;
    } catch { continue; }
    if (entry.isDirectory()) {
      results.push(...collectCodeFiles(full));
    } else {
      const ext = entry.name.lastIndexOf(".") === -1
        ? ""
        : entry.name.slice(entry.name.lastIndexOf("."));
      if (CODE_EXTENSIONS.has(ext)) results.push(full);
    }
  }
  return results;
}

/** Add all code files in a directory to the registry in bulk. */
export function addDirectory(opts: {
  dir: string;
  source: string;
  model?: string;
  tool?: string;
}): Snippet[] {
  const files = collectCodeFiles(opts.dir);
  const registry = loadRegistry();
  const existingHashes = new Set(registry.snippets.map((s) => s.hash));
  const added: Snippet[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const hash = hashSnippet(content);
    if (existingHashes.has(hash)) continue; // skip duplicates

    const snippet: Snippet = {
      id: randomUUID(),
      hash,
      source: opts.source,
      model: opts.model,
      tool: opts.tool,
      addedAt: new Date().toISOString(),
      content,
    };
    registry.snippets.push(snippet);
    existingHashes.add(hash);
    added.push(snippet);
  }

  saveRegistry(registry);
  return added;
}
