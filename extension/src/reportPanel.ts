import * as vscode from "vscode";
import type { Scanner } from "./scanner.js";

export class ReportPanel {
  private static panel: vscode.WebviewPanel | undefined;

  static async show(extensionUri: vscode.Uri, scanner: Scanner): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      vscode.window.showWarningMessage("No workspace folder open.");
      return;
    }

    const report = await scanner.scanWorkspace(folders[0].uri.fsPath);

    if (ReportPanel.panel) {
      ReportPanel.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      ReportPanel.panel = vscode.window.createWebviewPanel(
        "aiFootprintReport",
        "AI Footprint Report",
        vscode.ViewColumn.Beside,
        { enableScripts: false },
      );
      ReportPanel.panel.onDidDispose(() => {
        ReportPanel.panel = undefined;
      });
    }

    const matchRows = report.matches
      .map(
        (m) =>
          `<tr>
            <td>${escapeHtml(m.file)}</td>
            <td>${m.line}</td>
            <td>${m.matchType ?? (m.snippet ? "exact" : "pattern")}</td>
            <td>${m.confidence}</td>
            <td>${m.snippet ? escapeHtml(m.snippet.model ?? m.snippet.source) : escapeHtml(m.pattern ?? "")}</td>
            <td>${m.similarity != null ? Math.round(m.similarity * 100) + "%" : "—"}</td>
          </tr>`,
      )
      .join("\n");

    ReportPanel.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Footprint Report</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 1rem; }
    h1 { font-size: 1.4em; margin-bottom: 0.5em; }
    .stat { display: inline-block; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 0.3em 0.8em; border-radius: 4px; margin: 0.2em 0.4em 0.2em 0; font-size: 0.9em; }
    table { width: 100%; border-collapse: collapse; margin-top: 1em; }
    th, td { text-align: left; padding: 0.4em 0.6em; border-bottom: 1px solid var(--vscode-panel-border); font-size: 0.85em; }
    th { background: var(--vscode-editor-selectionBackground); }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; margin-top: 1em; }
  </style>
</head>
<body>
  <h1>AI Footprint Report</h1>
  <div>
    <span class="stat">Files analyzed: ${report.filesAnalyzed}</span>
    <span class="stat">AI-attributed: ${report.aiAttributedFiles}</span>
    <span class="stat">Top model: ${escapeHtml(report.topModel ?? "none")}</span>
    <span class="stat">Suspicious: ${report.unattributedSuspicious}</span>
  </div>
  ${
    report.matches.length > 0
      ? `<table>
      <thead><tr><th>File</th><th>Line</th><th>Type</th><th>Confidence</th><th>Source</th><th>Similarity</th></tr></thead>
      <tbody>${matchRows}</tbody>
    </table>`
      : `<p class="empty">No AI-generated code detected.</p>`
  }
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
