#!/usr/bin/env node

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { init, addSnippet, addDirectory } from "./registry.js";
import { scan } from "./scanner.js";
import { preCommit, commitMsg } from "../git-hooks/hooks.js";
import { startDashboard } from "../dashboard/server.js";
import type { ScanReport } from "../core/types.js";

const args = process.argv.slice(2);
const command = args[0];

function printReport(report: ScanReport): void {
  console.log("");
  console.log("AI Footprint Report");
  console.log("-------------------");
  console.log(`Files analyzed:            ${report.filesAnalyzed}`);
  console.log(`AI-attributed files:       ${report.aiAttributedFiles}`);
  console.log(`Top model:                 ${report.topModel ?? "(none)"}`);
  console.log(`Unattributed suspicious:   ${report.unattributedSuspicious} file(s)`);
  console.log("");

  if (report.matches.length > 0) {
    console.log("Matches:");
    for (const m of report.matches) {
      const tag = m.snippet
        ? `snippet [${m.snippet.model ?? m.snippet.source}]`
        : `pattern [${m.pattern}]`;
      console.log(`  ${m.file}:${m.line}  ${tag}  (${m.confidence})`);
    }
    console.log("");
  }
}

function usage(): void {
  console.log(`
ai-footprint v0.1

Commands:
  init            Initialise the local snippet registry (~/.ai-footprint/)
  add-snippet     Add an AI snippet to the registry
  track [dir]     Register all code files in a directory (bulk add)
  scan [dir]      Scan a directory for AI-generated code
  report [dir]    Alias for scan (detailed output)
  dashboard       Launch the web dashboard
  hook            Run as a git hook (internal)

Options for add-snippet:
  --file <path>   Single file to register
  --dir <path>    Directory to register (all code files)
  --source <src>  Where the snippet came from (e.g. "chatgpt session")
  --model <name>  AI model (e.g. "gpt-4.1")
  --tool <name>   Tool used (e.g. "copilot")

Examples:
  npx ai-footprint init
  npx ai-footprint add-snippet --file snippet.ts --source "chatgpt" --model "gpt-4.1"
  npx ai-footprint add-snippet --dir ./src --source "copilot" --model "gpt-4.1"
  npx ai-footprint track ./src --source "copilot" --model "gpt-4.1"
  npx ai-footprint scan
  npx ai-footprint scan ./src
  npx ai-footprint dashboard
  npx ai-footprint dashboard --port 8080
`);
}

switch (command) {
  case "init":
    init();
    break;

  case "add-snippet": {
    const fileIdx = args.indexOf("--file");
    const dirIdx = args.indexOf("--dir");
    const sourceIdx = args.indexOf("--source");
    const modelIdx = args.indexOf("--model");
    const toolIdx = args.indexOf("--tool");

    if ((fileIdx === -1 && dirIdx === -1) || sourceIdx === -1) {
      console.error("Usage: ai-footprint add-snippet --file <path> --source <source> [--model <model>] [--tool <tool>]");
      console.error("   or: ai-footprint add-snippet --dir <path> --source <source> [--model <model>] [--tool <tool>]");
      process.exit(1);
    }

    const source = args[sourceIdx + 1];
    const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
    const tool = toolIdx !== -1 ? args[toolIdx + 1] : undefined;

    if (!source) {
      console.error("--source is required.");
      process.exit(1);
    }

    if (dirIdx !== -1) {
      const dirPath = resolve(args[dirIdx + 1] || ".");
      const added = addDirectory({ dir: dirPath, source, model, tool });
      console.log(`Registered ${added.length} file(s) from ${dirPath}`);
    } else {
      const filePath = args[fileIdx + 1];
      if (!filePath) {
        console.error("--file requires a path.");
        process.exit(1);
      }
      const content = readFileSync(resolve(filePath), "utf-8");
      const snippet = addSnippet({ content, source, model, tool });
      console.log(`Added snippet ${snippet.id} (hash: ${snippet.hash.slice(0, 12)}…)`);
    }
    break;
  }

  case "track": {
    const trackDir = args[1] ? resolve(args[1]) : process.cwd();
    const trackSourceIdx = args.indexOf("--source");
    const trackModelIdx = args.indexOf("--model");
    const trackToolIdx = args.indexOf("--tool");

    if (trackSourceIdx === -1) {
      console.error("Usage: ai-footprint track [dir] --source <source> [--model <model>] [--tool <tool>]");
      process.exit(1);
    }

    const trackSource = args[trackSourceIdx + 1];
    const trackModel = trackModelIdx !== -1 ? args[trackModelIdx + 1] : undefined;
    const trackTool = trackToolIdx !== -1 ? args[trackToolIdx + 1] : undefined;

    const tracked = addDirectory({ dir: trackDir, source: trackSource, model: trackModel, tool: trackTool });
    console.log(`Registered ${tracked.length} file(s) from ${trackDir}`);
    break;
  }

  case "scan":
  case "report": {
    const dir = args[1] ? resolve(args[1]) : process.cwd();
    const report = scan(dir, { fuzzy: true });
    printReport(report);
    break;
  }

  case "dashboard": {
    const portIdx = args.indexOf("--port");
    const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : undefined;
    const dashDir = args[1] && args[1] !== "--port" ? resolve(args[1]) : process.cwd();
    startDashboard({ port, scanPath: dashDir });
    break;
  }

  case "hook": {
    if (args.includes("--pre-commit")) {
      preCommit();
    } else if (args.includes("--commit-msg")) {
      const msgFile = args[args.indexOf("--commit-msg") + 1];
      if (!msgFile) {
        console.error("commit-msg hook requires a message file path.");
        process.exit(1);
      }
      commitMsg(msgFile);
    } else {
      console.error("Unknown hook. Use --pre-commit or --commit-msg <file>.");
      process.exit(1);
    }
    break;
  }

  default:
    usage();
    break;
}
