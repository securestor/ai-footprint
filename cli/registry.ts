import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { hashSnippet } from "../core/hasher.js";
import type { Snippet, SnippetRegistry } from "../core/types.js";

const CONFIG_DIR = join(homedir(), ".ai-footprint");
const REGISTRY_PATH = join(CONFIG_DIR, "snippets.json");

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** Initialise the local snippet registry. */
export function init(): void {
  ensureDir();
  if (existsSync(REGISTRY_PATH)) {
    console.log(`Registry already exists at ${REGISTRY_PATH}`);
    return;
  }
  const registry: SnippetRegistry = { version: 1, snippets: [] };
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  console.log(`Initialized snippet registry at ${REGISTRY_PATH}`);
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
  return snippet;
}
