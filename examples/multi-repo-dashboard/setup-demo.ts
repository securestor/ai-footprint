// examples/multi-repo-dashboard/setup-demo.ts
// Generates synthetic scan history for demonstrating the dashboard with multiple repos.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface ScanReport {
  filesAnalyzed: number;
  aiAttributedFiles: number;
  unattributedSuspicious: number;
  topModel: string | null;
  matches: Array<{
    file: string;
    line: number;
    pattern?: string;
    confidence: string;
    matchType: string;
    similarity?: number;
    snippet?: { model: string; source: string };
  }>;
}

interface HistoryEntry {
  timestamp: string;
  repo: string;
  branch: string;
  commit: string;
  report: ScanReport;
}

interface HistoryStore {
  version: number;
  entries: HistoryEntry[];
}

// ── Synthetic data ───────────────────────────────────────────────────

const REPOS = [
  { name: "platform-api", baseFiles: 340, baseAi: 45, model: "gpt-4.1" },
  { name: "mobile-app", baseFiles: 220, baseAi: 62, model: "claude-3.5-sonnet" },
  { name: "data-service", baseFiles: 180, baseAi: 28, model: "gpt-4.1" },
  { name: "auth-service", baseFiles: 95, baseAi: 12, model: "codex" },
  { name: "web-frontend", baseFiles: 410, baseAi: 98, model: "gpt-4.1" },
];

function randomCommit(): string {
  return Math.random().toString(16).slice(2, 9);
}

function generateHistory(): HistoryStore {
  const entries: HistoryEntry[] = [];

  for (const repo of REPOS) {
    // Generate 30 days of scan history with realistic growth
    for (let day = 0; day < 30; day++) {
      const date = new Date();
      date.setDate(date.getDate() - (30 - day));

      // AI code grows gradually over time
      const growthFactor = 1 + (day / 30) * 0.3;
      const aiFiles = Math.round(repo.baseAi * growthFactor + (Math.random() - 0.5) * 5);
      const totalFiles = Math.round(repo.baseFiles * (1 + day * 0.005));
      const suspicious = Math.max(0, Math.round(Math.random() * 4 - 1));

      entries.push({
        timestamp: date.toISOString(),
        repo: repo.name,
        branch: "main",
        commit: randomCommit(),
        report: {
          filesAnalyzed: totalFiles,
          aiAttributedFiles: Math.min(aiFiles, totalFiles),
          unattributedSuspicious: suspicious,
          topModel: repo.model,
          matches: [
            // Representative sample match
            {
              file: `src/${repo.name}/core.ts`,
              line: 42,
              confidence: "high",
              matchType: "exact",
              similarity: 1.0,
              snippet: { model: repo.model, source: "copilot" },
            },
            ...(suspicious > 0
              ? [
                  {
                    file: `src/${repo.name}/utils.ts`,
                    line: 15,
                    pattern: "marker",
                    confidence: "medium" as const,
                    matchType: "pattern",
                  },
                ]
              : []),
          ],
        },
      });
    }
  }

  return { version: 1, entries };
}

// ── Write to disk ────────────────────────────────────────────────────

const HISTORY_DIR = join(homedir(), ".ai-footprint", "history");

if (!existsSync(HISTORY_DIR)) {
  mkdirSync(HISTORY_DIR, { recursive: true });
}

const store = generateHistory();
writeFileSync(join(HISTORY_DIR, "scans.json"), JSON.stringify(store, null, 2));

console.log(`Generated ${store.entries.length} scan entries for ${REPOS.length} repos.`);
console.log(`Written to ${join(HISTORY_DIR, "scans.json")}`);
console.log(`\nLaunch the dashboard to view:\n  ai-footprint dashboard`);
