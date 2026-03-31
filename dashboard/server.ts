import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { execSync } from "node:child_process";
import { resolve, basename } from "node:path";
import { scan } from "../cli/scanner.js";
import { saveEntry, loadHistory, getRepoSummaries, HistoryEntry } from "./history.js";
import { renderDashboardHtml } from "./ui.js";

const DEFAULT_PORT = 3120;

function getGitInfo(cwd: string): { repo: string; branch: string; commit: string } {
  try {
    const remote = execSync("git remote get-url origin", { cwd, encoding: "utf-8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
    const commit = execSync("git rev-parse --short HEAD", { cwd, encoding: "utf-8" }).trim();
    const repoName = basename(remote.replace(/\.git$/, ""));
    return { repo: repoName, branch, commit };
  } catch {
    return { repo: basename(cwd), branch: "unknown", commit: "unknown" };
  }
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function startDashboard(opts: { port?: number; scanPath?: string } = {}): void {
  const port = opts.port ?? DEFAULT_PORT;
  const scanPath = resolve(opts.scanPath ?? ".");

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // ── API routes ───────────────────────────────────────────────────
    if (url.pathname === "/api/scan" && req.method === "POST") {
      try {
        const report = scan(scanPath, { fuzzy: true });
        const gitInfo = getGitInfo(scanPath);
        const entry: HistoryEntry = {
          timestamp: new Date().toISOString(),
          repo: gitInfo.repo,
          branch: gitInfo.branch,
          commit: gitInfo.commit,
          report,
        };
        saveEntry(entry);
        json(res, { ok: true, report, git: gitInfo });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, { ok: false, error: message }, 500);
      }
      return;
    }

    if (url.pathname === "/api/history") {
      json(res, loadHistory());
      return;
    }

    if (url.pathname === "/api/repos") {
      json(res, getRepoSummaries());
      return;
    }

    if (url.pathname === "/api/health") {
      json(res, { ok: true, version: "0.1.0" });
      return;
    }

    // ── Dashboard UI ──────────────────────────────────────────────────
    html(res, renderDashboardHtml());
  });

  server.listen(port, () => {
    console.log(`\nAI Footprint Dashboard`);
    console.log(`──────────────────────`);
    console.log(`Running at  http://localhost:${port}`);
    console.log(`Scan path   ${scanPath}`);
    console.log(`\nAPI endpoints:`);
    console.log(`  POST /api/scan      Trigger a new scan`);
    console.log(`  GET  /api/history   Full scan history`);
    console.log(`  GET  /api/repos     Per-repo summaries with trends`);
    console.log(`  GET  /api/health    Health check\n`);
  });
}
