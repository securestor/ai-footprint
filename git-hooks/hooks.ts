import { execSync } from "node:child_process";
import { matchFile } from "../core/matcher.js";
import { loadRegistry } from "../cli/registry.js";

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
  console.log(`[ai-footprint] Detected AI code — ${trailer}`);

  // Store as a git note on HEAD after commit (called from commit-msg hook)
  // For pre-commit we just print the warning. The commit-msg hook adds metadata.
}

/**
 * commit-msg hook logic.
 * Appends an AI-Footprint trailer to the commit message file if AI code detected.
 */
export function commitMsg(commitMsgFile: string): void {
  const diff = execSync("git diff --cached --unified=0", {
    encoding: "utf-8",
  });

  if (!diff) return;

  const registry = loadRegistry();
  const matches = matchFile("staged-diff", diff, registry.snippets);

  if (matches.length === 0) return;

  const models = new Set<string>();
  let total = matches.length;

  for (const m of matches) {
    if (m.snippet?.model) models.add(m.snippet.model);
  }

  const value = [
    `${total} match(es)`,
    models.size > 0 ? `model(s): ${[...models].join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");

  // Append trailer using git interpret-trailers
  execSync(
    `git interpret-trailers --in-place --trailer "AI-Footprint: ${value}" "${commitMsgFile}"`,
  );
  console.log(`[ai-footprint] Added trailer → AI-Footprint: ${value}`);
}
