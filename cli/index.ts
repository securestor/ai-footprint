#!/usr/bin/env node

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { init, addSnippet } from "./registry.js";
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
  scan [dir]      Scan a directory for AI-generated code
  report [dir]    Alias for scan (detailed output)
  dashboard       Launch the web dashboard
  hook            Run as a git hook (internal)

Options for add-snippet:
  --file <path>   File containing the snippet
  --source <src>  Where the snippet came from (e.g. "chatgpt session")
  --model <name>  AI model (e.g. "gpt-4.1")
  --tool <name>   Tool used (e.g. "copilot")

Examples:
  npx ai-footprint init
  npx ai-footprint add-snippet --file snippet.ts --source "chatgpt" --model "gpt-4.1"
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
    const sourceIdx = args.indexOf("--source");
    const modelIdx = args.indexOf("--model");
    const toolIdx = args.indexOf("--tool");

    if (fileIdx === -1 || sourceIdx === -1) {
      console.error("Usage: ai-footprint add-snippet --file <path> --source <source> [--model <model>] [--tool <tool>]");
      process.exit(1);
    }

    const filePath = args[fileIdx + 1];
    const source = args[sourceIdx + 1];
    const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
    const tool = toolIdx !== -1 ? args[toolIdx + 1] : undefined;

    if (!filePath || !source) {
      console.error("--file and --source are required.");
      process.exit(1);
    }

    const content = readFileSync(resolve(filePath), "utf-8");
    const snippet = addSnippet({ content, source, model, tool });
    console.log(`Added snippet ${snippet.id} (hash: ${snippet.hash.slice(0, 12)}…)`);
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
