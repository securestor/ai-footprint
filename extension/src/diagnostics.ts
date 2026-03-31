import * as vscode from "vscode";
import type { ScanMatch } from "./types.js";

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
  Error: vscode.DiagnosticSeverity.Error,
  Warning: vscode.DiagnosticSeverity.Warning,
  Information: vscode.DiagnosticSeverity.Information,
  Hint: vscode.DiagnosticSeverity.Hint,
};

export class DiagnosticsManager implements vscode.Disposable {
  private collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("ai-footprint");
  }

  update(uri: vscode.Uri, matches: ScanMatch[], config: vscode.WorkspaceConfiguration): void {
    const severityName = config.get<string>("diagnosticSeverity", "Information");
    const severity = SEVERITY_MAP[severityName] ?? vscode.DiagnosticSeverity.Information;

    const diagnostics: vscode.Diagnostic[] = matches.map((m) => {
      const line = Math.max(0, m.line - 1);
      const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

      const message = m.snippet
        ? `AI-generated code detected (${m.matchType ?? "exact"}, ${m.confidence} confidence) — ${m.snippet.model ?? m.snippet.source}${m.similarity != null ? ` [${Math.round(m.similarity * 100)}% similar]` : ""}`
        : `AI code pattern detected: ${m.pattern} (${m.confidence} confidence)`;

      const diag = new vscode.Diagnostic(range, message, severity);
      diag.source = "AI Footprint";
      diag.code = m.matchType ?? (m.snippet ? "exact" : "pattern");
      return diag;
    });

    this.collection.set(uri, diagnostics);
  }

  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }
}
