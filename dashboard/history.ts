import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ScanReport } from "../core/types.js";

const DATA_DIR = join(homedir(), ".ai-footprint", "history");

export interface HistoryEntry {
  timestamp: string;
  repo: string;
  branch: string;
  commit: string;
  report: ScanReport;
}

export interface HistoryStore {
  version: number;
  entries: HistoryEntry[];
}

function historyPath(): string {
  return join(DATA_DIR, "scans.json");
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadHistory(): HistoryStore {
  const p = historyPath();
  if (!existsSync(p)) return { version: 1, entries: [] };
  return JSON.parse(readFileSync(p, "utf-8")) as HistoryStore;
}

export function saveEntry(entry: HistoryEntry): void {
  ensureDir();
  const store = loadHistory();
  store.entries.push(entry);
  writeFileSync(historyPath(), JSON.stringify(store, null, 2));
}

export function getRepoSummaries(): {
  repo: string;
  entries: number;
  latest: HistoryEntry | null;
  trend: { date: string; aiFiles: number; totalFiles: number; topModel: string | null }[];
}[] {
  const store = loadHistory();
  const byRepo = new Map<string, HistoryEntry[]>();

  for (const entry of store.entries) {
    const list = byRepo.get(entry.repo) ?? [];
    list.push(entry);
    byRepo.set(entry.repo, list);
  }

  const summaries = [];
  for (const [repo, entries] of byRepo) {
    entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    summaries.push({
      repo,
      entries: entries.length,
      latest: entries[entries.length - 1] ?? null,
      trend: entries.map((e) => ({
        date: e.timestamp.slice(0, 10),
        aiFiles: e.report.aiAttributedFiles,
        totalFiles: e.report.filesAnalyzed,
        topModel: e.report.topModel,
      })),
    });
  }

  return summaries;
}
