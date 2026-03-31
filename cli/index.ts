#!/usr/bin/env node

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { init, addSnippet, addDirectory } from "./registry.js";
import { scan } from "./scanner.js";
import { preCommit, commitMsg } from "../git-hooks/hooks.js";
import { startDashboard } from "../dashboard/server.js";
import { configureTeam, teamPull, teamPush, teamStatus } from "./team-registry.js";
import { exportSBOM } from "./sbom.js";
import { startInterceptProxy, interceptStatus } from "./llm-proxy.js";
import { treesitterStatus } from "../core/treesitter-matcher.js";
import type { ScanReport } from "../core/types.js";
import type { SBOMFormat } from "../core/types.js";

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
        ? `${m.matchType === "ast" ? "ast" : "snippet"} [${m.snippet.model ?? m.snippet.source}]`
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
  sbom [dir]      Export an SBOM (CycloneDX or SPDX)
  team            Manage the shared team registry
  intercept       Start the LLM API interception proxy
  treesitter      Show tree-sitter native support status
  dashboard       Launch the web dashboard
  hook            Run as a git hook (internal)

Options for add-snippet:
  --file <path>   Single file to register
  --dir <path>    Directory to register (all code files)
  --source <src>  Where the snippet came from (e.g. "chatgpt session")
  --model <name>  AI model (e.g. "gpt-4.1")
  --tool <name>   Tool used (e.g. "copilot")

Options for sbom:
  --format <fmt>  SBOM format: cyclonedx (default) or spdx
  --output <path> Output file path (default: ai-footprint-sbom.json)

Options for intercept:
  --port <num>    Proxy port (default: 8990)
  --model <name>  Override model name (default: auto-detect)
  --verbose       Print each intercepted snippet

Team subcommands:
  team config     Configure the team registry
    --git-url <url>   Git repo URL for shared registry
    --api-url <url>   API endpoint for registry server
    --api-key <key>   API authentication key
    --team <name>     Team / namespace name
  team pull       Pull snippets from the team registry
  team push       Push local snippets to the team registry
  team status     Show team registry status

Examples:
  npx ai-footprint init
  npx ai-footprint add-snippet --file snippet.ts --source "chatgpt" --model "gpt-4.1"
  npx ai-footprint track ./src --source "copilot" --model "gpt-4.1"
  npx ai-footprint scan
  npx ai-footprint sbom --format cyclonedx --output bom.json
  npx ai-footprint intercept --port 8990
  npx ai-footprint treesitter
  npx ai-footprint team config --git-url git@github.com:myorg/ai-registry.git --team backend
  npx ai-footprint team pull
  npx ai-footprint team push
  npx ai-footprint dashboard
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
    const report = scan(dir, { fuzzy: true, ast: true });
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

  case "sbom": {
    const sbomDir = args[1] && !args[1].startsWith("--") ? resolve(args[1]) : process.cwd();
    const formatIdx = args.indexOf("--format");
    const outputIdx = args.indexOf("--output");
    const sbomFormat: SBOMFormat = formatIdx !== -1 ? (args[formatIdx + 1] as SBOMFormat) : "cyclonedx";
    const sbomOutput = outputIdx !== -1 ? args[outputIdx + 1] : "ai-footprint-sbom.json";

    if (sbomFormat !== "cyclonedx" && sbomFormat !== "spdx") {
      console.error(`Unsupported format: ${sbomFormat}. Use 'cyclonedx' or 'spdx'.`);
      process.exit(1);
    }

    const sbomReport = scan(sbomDir, { fuzzy: true, ast: true });
    printReport(sbomReport);
    exportSBOM(sbomReport, sbomFormat, sbomOutput, sbomDir);
    break;
  }

  case "team": {
    const subCmd = args[1];
    switch (subCmd) {
      case "config": {
        const gitUrlIdx = args.indexOf("--git-url");
        const apiUrlIdx = args.indexOf("--api-url");
        const apiKeyIdx = args.indexOf("--api-key");
        const teamIdx = args.indexOf("--team");

        const teamGitUrl = gitUrlIdx !== -1 ? args[gitUrlIdx + 1] : undefined;
        const teamApiUrl = apiUrlIdx !== -1 ? args[apiUrlIdx + 1] : undefined;
        const teamApiKey = apiKeyIdx !== -1 ? args[apiKeyIdx + 1] : undefined;
        const teamName = teamIdx !== -1 ? args[teamIdx + 1] : undefined;

        try {
          configureTeam({ gitUrl: teamGitUrl, apiUrl: teamApiUrl, apiKey: teamApiKey, team: teamName });
        } catch (e) {
          console.error((e as Error).message);
          process.exit(1);
        }
        break;
      }
      case "pull":
        teamPull().catch((e) => {
          console.error((e as Error).message);
          process.exit(1);
        });
        break;
      case "push":
        teamPush().catch((e) => {
          console.error((e as Error).message);
          process.exit(1);
        });
        break;
      case "status":
        teamStatus();
        break;
      default:
        console.error("Usage: ai-footprint team <config|pull|push|status>");
        process.exit(1);
    }
    break;
  }

  case "intercept": {
    const interceptPortIdx = args.indexOf("--port");
    const interceptModelIdx = args.indexOf("--model");
    const interceptPort = interceptPortIdx !== -1 ? parseInt(args[interceptPortIdx + 1], 10) : undefined;
    const interceptModel = interceptModelIdx !== -1 ? args[interceptModelIdx + 1] : undefined;
    const interceptVerbose = args.includes("--verbose");
    startInterceptProxy({ port: interceptPort, model: interceptModel, verbose: interceptVerbose });
    break;
  }

  case "intercept-status": {
    const statusPortIdx = args.indexOf("--port");
    const statusPort = statusPortIdx !== -1 ? parseInt(args[statusPortIdx + 1], 10) : undefined;
    interceptStatus(statusPort).catch((e) => {
      console.error((e as Error).message);
      process.exit(1);
    });
    break;
  }

  case "treesitter": {
    treesitterStatus().then((status) => {
      console.log("");
      console.log("Tree-sitter Native Support");
      console.log("─".repeat(30));
      console.log(`Available: ${status.available ? "yes" : "no"}`);
      if (status.available) {
        console.log(`Languages: ${status.languages.length > 0 ? status.languages.join(", ") : "(no grammars installed)"}`);
      } else {
        console.log("");
        console.log("Install tree-sitter support:");
        console.log("  npm install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-bash");
      }
      console.log("");
    });
    break;
  }

  default:
    usage();
    break;
}
