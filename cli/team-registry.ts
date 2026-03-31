/**
 * Team Registry — shared snippet database.
 *
 * Two modes:
 *  1. Git-backed: clones / pulls a shared registry repo, merges snippets.
 *  2. API-backed: fetches / pushes snippets via HTTP REST API.
 *
 * The team registry supplements the local ~/.ai-footprint/snippets.json
 * registry. On `pull`, remote snippets are merged locally; on `push`,
 * local snippets are published to the shared store.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Snippet, SnippetRegistry, TeamRegistryConfig } from "../core/types.js";
import { loadRegistry } from "./registry.js";
import {
  audit,
  validateGitUrl,
  validateApiUrl,
  validateTeamName,
  validateNoControlChars,
  validateSnippet,
  validateRegistry,
} from "../core/security.js";

const CONFIG_DIR = join(homedir(), ".ai-footprint");
const TEAM_CONFIG_PATH = join(CONFIG_DIR, "team.json");
const TEAM_REPO_DIR = join(CONFIG_DIR, "team-repo");
const REGISTRY_PATH = join(CONFIG_DIR, "snippets.json");

// ------------------------------------------------------------------ //
// Config management
// ------------------------------------------------------------------ //

/** Load team registry configuration. */
export function loadTeamConfig(): TeamRegistryConfig | null {
  if (!existsSync(TEAM_CONFIG_PATH)) return null;
  return JSON.parse(readFileSync(TEAM_CONFIG_PATH, "utf-8")) as TeamRegistryConfig;
}

/** Save team registry configuration. */
export function saveTeamConfig(config: TeamRegistryConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(TEAM_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** Configure the team registry. */
export function configureTeam(opts: {
  gitUrl?: string;
  apiUrl?: string;
  apiKey?: string;
  team?: string;
}): void {
  const config: TeamRegistryConfig = {
    gitUrl: opts.gitUrl,
    apiUrl: opts.apiUrl,
    apiKey: opts.apiKey,
    team: opts.team ?? "default",
  };

  if (!config.gitUrl && !config.apiUrl) {
    throw new Error("Either --git-url or --api-url is required.");
  }

  // Validate inputs
  if (config.gitUrl) validateGitUrl(config.gitUrl);
  if (config.apiUrl) validateApiUrl(config.apiUrl);
  if (config.team) validateTeamName(config.team);

  saveTeamConfig(config);
  audit("team.config", `Configured: git=${!!config.gitUrl} api=${!!config.apiUrl} team=${config.team}`);
  console.log("Team registry configured:");
  if (config.gitUrl) console.log(`  Git URL: ${config.gitUrl}`);
  if (config.apiUrl) console.log(`  API URL: ${config.apiUrl}`);
  console.log(`  Team:    ${config.team}`);
}

// ------------------------------------------------------------------ //
// Git-backed operations
// ------------------------------------------------------------------ //

/** Clone or pull the shared registry repo. */
function gitSync(gitUrl: string): string {
  const registryFile = join(TEAM_REPO_DIR, "snippets.json");

  if (existsSync(TEAM_REPO_DIR)) {
    // Pull latest
    try {
      execFileSync("git", ["pull", "--rebase"], {
        cwd: TEAM_REPO_DIR,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      throw new Error(`Failed to pull team registry from ${gitUrl}`);
    }
  } else {
    // Clone — use execFileSync with separate args (no shell injection)
    mkdirSync(TEAM_REPO_DIR, { recursive: true });
    try {
      execFileSync("git", ["clone", gitUrl, TEAM_REPO_DIR], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Clean up on failure
      rmSync(TEAM_REPO_DIR, { recursive: true, force: true });
      throw new Error(`Failed to clone team registry from ${gitUrl}`);
    }
  }

  // Ensure the snippets file exists
  if (!existsSync(registryFile)) {
    const empty: SnippetRegistry = { version: 1, snippets: [] };
    writeFileSync(registryFile, JSON.stringify(empty, null, 2));
  }

  return registryFile;
}

/** Load snippets from the git-backed registry. */
function gitLoadSnippets(gitUrl: string): Snippet[] {
  const registryFile = gitSync(gitUrl);
  const registry = JSON.parse(readFileSync(registryFile, "utf-8")) as SnippetRegistry;
  return registry.snippets;
}

/** Push local snippets to the git-backed registry. */
function gitPushSnippets(gitUrl: string, snippets: Snippet[], team: string): number {
  const registryFile = gitSync(gitUrl);
  const remote = JSON.parse(readFileSync(registryFile, "utf-8")) as SnippetRegistry;

  // Merge: add new snippets (by hash) that don't exist remotely
  const remoteHashes = new Set(remote.snippets.map((s) => s.hash));
  let added = 0;

  for (const snippet of snippets) {
    if (!remoteHashes.has(snippet.hash)) {
      remote.snippets.push(snippet);
      remoteHashes.add(snippet.hash);
      added++;
    }
  }

  if (added === 0) {
    console.log("No new snippets to push.");
    return 0;
  }

  writeFileSync(registryFile, JSON.stringify(remote, null, 2));

  try {
    execFileSync("git", ["add", "snippets.json"], {
      cwd: TEAM_REPO_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    execFileSync(
      "git",
      ["commit", "-m", `ai-footprint: sync ${added} snippet(s) from team ${team}`],
      {
        cwd: TEAM_REPO_DIR,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    execFileSync("git", ["push"], {
      cwd: TEAM_REPO_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Failed to push to team registry. Check git credentials and permissions.");
  }

  audit("team.push", `Pushed ${added} snippet(s) to team ${team}`);
  return added;
}

// ------------------------------------------------------------------ //
// API-backed operations
// ------------------------------------------------------------------ //

/** Fetch snippets from the API-backed registry. */
async function apiFetchSnippets(
  apiUrl: string,
  team: string,
  apiKey?: string,
): Promise<Snippet[]> {
  const url = `${apiUrl}/api/team/${encodeURIComponent(team)}/snippets`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`API fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  // Validate response against expected schema
  if (typeof data !== "object" || data === null || !Array.isArray((data as Record<string, unknown>).snippets)) {
    throw new Error("API response has unexpected format.");
  }
  const snippets = ((data as Record<string, unknown>).snippets as unknown[]).filter(
    (s): s is Snippet => validateSnippet(s) as boolean,
  ) as Snippet[];
  return snippets;
}

/** Push snippets to the API-backed registry. */
async function apiPushSnippets(
  apiUrl: string,
  team: string,
  snippets: Snippet[],
  apiKey?: string,
): Promise<number> {
  const url = `${apiUrl}/api/team/${encodeURIComponent(team)}/snippets`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ snippets }),
  });

  if (!response.ok) {
    throw new Error(`API push failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { added: number };
  return data.added;
}

// ------------------------------------------------------------------ //
// Public API
// ------------------------------------------------------------------ //

/** Merge snippets: add remote snippets not already present locally. */
function mergeSnippets(local: SnippetRegistry, remote: Snippet[]): number {
  const localHashes = new Set(local.snippets.map((s) => s.hash));
  let merged = 0;

  for (const snippet of remote) {
    if (!localHashes.has(snippet.hash)) {
      local.snippets.push(snippet);
      localHashes.add(snippet.hash);
      merged++;
    }
  }

  return merged;
}

/** Pull snippets from the team registry into the local registry. */
export async function teamPull(): Promise<void> {
  const config = loadTeamConfig();
  if (!config) {
    throw new Error("Team registry not configured. Run: ai-footprint team config --git-url <url> or --api-url <url>");
  }

  const team = config.team ?? "default";
  let remoteSnippets: Snippet[];

  if (config.gitUrl) {
    console.log(`Pulling from git: ${config.gitUrl}...`);
    remoteSnippets = gitLoadSnippets(config.gitUrl);
  } else if (config.apiUrl) {
    console.log(`Pulling from API: ${config.apiUrl}...`);
    remoteSnippets = await apiFetchSnippets(config.apiUrl, team, config.apiKey);
  } else {
    throw new Error("No git-url or api-url configured.");
  }

  // Merge into local
  const local = loadRegistry();
  const merged = mergeSnippets(local, remoteSnippets);

  if (merged > 0) {
    writeFileSync(REGISTRY_PATH, JSON.stringify(local, null, 2));
    console.log(`Merged ${merged} new snippet(s) from team registry.`);
  } else {
    console.log("Local registry is already up to date.");
  }

  console.log(`Total local snippets: ${local.snippets.length}`);
}

/** Push local snippets to the team registry. */
export async function teamPush(): Promise<void> {
  const config = loadTeamConfig();
  if (!config) {
    throw new Error("Team registry not configured. Run: ai-footprint team config --git-url <url> or --api-url <url>");
  }

  const team = config.team ?? "default";
  const local = loadRegistry();

  if (local.snippets.length === 0) {
    console.log("No local snippets to push.");
    return;
  }

  let pushed: number;

  if (config.gitUrl) {
    console.log(`Pushing to git: ${config.gitUrl}...`);
    pushed = gitPushSnippets(config.gitUrl, local.snippets, team);
  } else if (config.apiUrl) {
    console.log(`Pushing to API: ${config.apiUrl}...`);
    pushed = await apiPushSnippets(config.apiUrl, team, local.snippets, config.apiKey);
  } else {
    throw new Error("No git-url or api-url configured.");
  }

  console.log(`Pushed ${pushed} snippet(s) to team registry [${team}].`);
}

/** Show current team registry status. */
export function teamStatus(): void {
  const config = loadTeamConfig();
  if (!config) {
    console.log("Team registry: not configured");
    console.log("Run: ai-footprint team config --git-url <url> or --api-url <url>");
    return;
  }

  const local = loadRegistry();

  console.log("\nTeam Registry Status");
  console.log("--------------------");
  console.log(`Mode:    ${config.gitUrl ? "git-backed" : "api-backed"}`);
  if (config.gitUrl) console.log(`Git URL: ${config.gitUrl}`);
  if (config.apiUrl) console.log(`API URL: ${config.apiUrl}`);
  console.log(`Team:    ${config.team ?? "default"}`);
  console.log(`Local snippets: ${local.snippets.length}`);

  if (config.gitUrl && existsSync(TEAM_REPO_DIR)) {
    console.log(`Cache:   ${TEAM_REPO_DIR}`);
    try {
      const remoteReg = JSON.parse(
        readFileSync(join(TEAM_REPO_DIR, "snippets.json"), "utf-8"),
      ) as SnippetRegistry;
      console.log(`Remote snippets (cached): ${remoteReg.snippets.length}`);
    } catch {
      // ignore
    }
  }
  console.log("");
}
