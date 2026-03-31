import { execSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { matchFile } from "../core/matcher.js";
import { loadRegistry } from "../cli/registry.js";
import { audit, validateNoControlChars } from "../core/security.js";
import {
  detectCopilotSignals,
  formatCopilotTrailer,
  clearCopilotMarker,
  findGitRoot,
} from "../core/copilot-detect.js";

/**
 * Pre-commit hook logic.
 * Scans staged diff for AI-generated patterns and, if found, appends a
 * `AI-Footprint: <summary>` trailer to the commit message via git-interpret-trailers.
 */
export function preCommit(): void {
  const diff = execSync("git diff --cached --unified=0", {
    encoding: "utf-8",
  });

  if (!diff) return;

  const registry = loadRegistry();
  const matches = matchFile("staged-diff", diff, registry.snippets);

  if (matches.length === 0) return;

  const models = new Set<string>();
  let snippetHits = 0;
  let patternHits = 0;

  for (const m of matches) {
    if (m.snippet) {
      snippetHits++;
      if (m.snippet.model) models.add(m.snippet.model);
    } else {
      patternHits++;
    }
  }

  const parts: string[] = [];
  if (snippetHits > 0) parts.push(`${snippetHits} known snippet(s)`);
  if (patternHits > 0) parts.push(`${patternHits} pattern match(es)`);
  if (models.size > 0) parts.push(`model(s): ${[...models].join(", ")}`);

  const trailer = parts.join("; ");
  audit("hook.pre-commit", `Detected ${matches.length} match(es)`);
  console.log(`[ai-footprint] Detected AI code — ${trailer}`);

  // Store as a git note on HEAD after commit (called from commit-msg hook)
  // For pre-commit we just print the warning. The commit-msg hook adds metadata.
}

/**
 * Pre-commit hook logic — Copilot agent check.
 * Detects Copilot signals even when no AI code patterns are found.
 * Called after the standard preCommit() scan.
 */
export function preCommitCopilot(): void {
  const repoRoot = findGitRoot();
  const signals = detectCopilotSignals({ repoRoot: repoRoot ?? undefined });
  if (signals.length === 0) return;

  const copilotTrailer = formatCopilotTrailer(signals);
  const evidence = signals.flatMap((s) => s.evidence);
  audit("hook.pre-commit", `Copilot detected: ${copilotTrailer}`);
  console.log(`[ai-footprint] Copilot agent detected — ${copilotTrailer}`);
  for (const e of evidence) {
    console.log(`  • ${e}`);
  }
}

/**
 * commit-msg hook logic.
 * Appends an AI-Footprint trailer to the commit message file if AI code detected,
 * or if Copilot agent signals are present.
 */
export function commitMsg(commitMsgFile: string): void {
  // Sanitise the commit message file path early
  validateNoControlChars(commitMsgFile, "commit message file path");

  const diff = execSync("git diff --cached --unified=0", {
    encoding: "utf-8",
  });

  const registry = loadRegistry();
  const matches = diff ? matchFile("staged-diff", diff, registry.snippets) : [];

  // Read commit message for Copilot pattern detection
  let commitMessage = "";
  try {
    commitMessage = readFileSync(commitMsgFile, "utf-8");
  } catch {
    /* best-effort */
  }

  // Check for Copilot agent signals
  const repoRoot = findGitRoot();
  const copilotSignals = detectCopilotSignals({
    commitMessage,
    repoRoot: repoRoot ?? undefined,
  });

  // Nothing detected at all — bail
  if (matches.length === 0 && copilotSignals.length === 0) return;

  // Build trailer parts
  const trailerParts: string[] = [];

  // Code pattern matches
  if (matches.length > 0) {
    const models = new Set<string>();
    for (const m of matches) {
      if (m.snippet?.model) models.add(m.snippet.model);
    }
    trailerParts.push(`${matches.length} match(es)`);
    if (models.size > 0) {
      trailerParts.push(`model(s): ${[...models].join(", ")}`);
    }
  }

  // Copilot agent attribution
  if (copilotSignals.length > 0) {
    trailerParts.push(formatCopilotTrailer(copilotSignals));
  }

  const value = trailerParts.join("; ");

  validateNoControlChars(value, "trailer value");

  // Use execFileSync with argument array — no shell interpolation
  execFileSync("git", [
    "interpret-trailers",
    "--in-place",
    "--trailer",
    `AI-Footprint: ${value}`,
    commitMsgFile,
  ]);

  // Clear the Copilot marker file after successful attribution
  if (copilotSignals.length > 0 && repoRoot) {
    clearCopilotMarker(repoRoot);
  }

  audit("hook.commit-msg", `Added trailer: ${value}`);
  console.log(`[ai-footprint] Added trailer → AI-Footprint: ${value}`);
}
