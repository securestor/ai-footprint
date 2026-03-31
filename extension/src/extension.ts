import * as vscode from "vscode";
import { Scanner } from "./scanner.js";
import { OverlayManager } from "./overlay.js";
import { DiagnosticsManager } from "./diagnostics.js";
import { StatusBarManager } from "./statusBar.js";
import { ReportPanel } from "./reportPanel.js";

let scanner: Scanner;
let overlay: OverlayManager;
let diagnostics: DiagnosticsManager;
let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext): void {
  scanner = new Scanner();
  overlay = new OverlayManager();
  diagnostics = new DiagnosticsManager();
  statusBar = new StatusBarManager();

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("aiFootprint.scanWorkspace", async () => {
      await scanWorkspace();
    }),

    vscode.commands.registerCommand("aiFootprint.scanCurrentFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active file to scan.");
        return;
      }
      await scanDocument(editor.document);
    }),

    vscode.commands.registerCommand("aiFootprint.toggleOverlay", () => {
      overlay.toggle();
      const state = overlay.isEnabled() ? "enabled" : "disabled";
      vscode.window.showInformationMessage(`AI Footprint overlay ${state}.`);
    }),

    vscode.commands.registerCommand("aiFootprint.showReport", async () => {
      await ReportPanel.show(context.extensionUri, scanner);
    }),
  );

  // Scan on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const config = vscode.workspace.getConfiguration("aiFootprint");
      if (config.get<boolean>("enableOnSave", true)) {
        await scanDocument(doc);
      }
    }),
  );

  // Scan on active editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor) {
        await scanDocument(editor.document);
      }
    }),
  );

  // Scan on workspace open
  if (vscode.window.activeTextEditor) {
    scanDocument(vscode.window.activeTextEditor.document);
  }

  // Register CodeLens provider
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      new AiFootprintCodeLensProvider(),
    ),
  );

  // Cleanup
  context.subscriptions.push(
    overlay,
    diagnostics,
    statusBar,
  );

  statusBar.show();
}

async function scanDocument(document: vscode.TextDocument): Promise<void> {
  if (document.uri.scheme !== "file") return;

  const config = vscode.workspace.getConfiguration("aiFootprint");
  const threshold = config.get<number>("fuzzyThreshold", 0.6);

  const matches = await scanner.scanDocument(document, { fuzzyThreshold: threshold });

  diagnostics.update(document.uri, matches, config);
  overlay.update(document.uri, matches);
  statusBar.update(matches.length);
}

async function scanWorkspace(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    vscode.window.showWarningMessage("No workspace folder open.");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "AI Footprint: Scanning workspace…",
      cancellable: true,
    },
    async (progress, token) => {
      let totalMatches = 0;
      let filesScanned = 0;

      for (const folder of folders) {
        if (token.isCancellationRequested) break;
        const report = await scanner.scanWorkspace(folder.uri.fsPath);
        totalMatches += report.matches.length;
        filesScanned += report.filesAnalyzed;
      }

      statusBar.update(totalMatches);
      vscode.window.showInformationMessage(
        `AI Footprint: Scanned ${filesScanned} files, found ${totalMatches} match(es).`,
      );
    },
  );
}

class AiFootprintCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration("aiFootprint");
    if (!config.get<boolean>("overlayEnabled", true)) return [];

    const threshold = config.get<number>("fuzzyThreshold", 0.6);
    const matches = await scanner.scanDocument(document, { fuzzyThreshold: threshold });
    const lenses: vscode.CodeLens[] = [];

    for (const match of matches) {
      const line = Math.max(0, match.line - 1);
      const range = new vscode.Range(line, 0, line, 0);

      const label = match.snippet
        ? `🤖 AI: ${match.snippet.model ?? match.snippet.source} (${Math.round((match.similarity ?? 1) * 100)}% match)`
        : `🤖 AI pattern: ${match.pattern}`;

      lenses.push(
        new vscode.CodeLens(range, {
          title: label,
          command: "aiFootprint.scanCurrentFile",
          tooltip: `Confidence: ${match.confidence} | Type: ${match.matchType ?? "unknown"}`,
        }),
      );
    }

    return lenses;
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
