import * as vscode from "vscode";
import type { ScanMatch } from "./types.js";

export class OverlayManager implements vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType;
  private enabled = true;
  private matchesByUri = new Map<string, ScanMatch[]>();

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("aiFootprint.attributionBackground"),
      isWholeLine: true,
      overviewRulerColor: "#4fc3f7",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
        margin: "0 0 0 2em",
      },
    });

    // Re-apply decorations when editors change
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && this.enabled) {
        this.applyDecorations(editor);
      }
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      if (this.enabled) {
        this.applyDecorations(editor);
      } else {
        editor.setDecorations(this.decorationType, []);
      }
    }
  }

  update(uri: vscode.Uri, matches: ScanMatch[]): void {
    this.matchesByUri.set(uri.toString(), matches);
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.toString() === uri.toString() && this.enabled) {
      this.applyDecorations(editor);
    }
  }

  private applyDecorations(editor: vscode.TextEditor): void {
    const matches = this.matchesByUri.get(editor.document.uri.toString());
    if (!matches || matches.length === 0) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const decorations: vscode.DecorationOptions[] = matches.map((m) => {
      const line = Math.max(0, m.line - 1);
      const range = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length);

      const label = m.snippet
        ? `AI: ${m.snippet.model ?? m.snippet.source}${m.similarity != null ? ` (${Math.round(m.similarity * 100)}%)` : ""}`
        : `AI pattern: ${m.pattern}`;

      return {
        range,
        hoverMessage: new vscode.MarkdownString(
          `**AI Footprint** — ${m.confidence} confidence\n\n` +
          `Type: \`${m.matchType ?? "unknown"}\`\n\n` +
          (m.snippet ? `Source: ${m.snippet.source}\nModel: ${m.snippet.model ?? "unknown"}\nTool: ${m.snippet.tool ?? "unknown"}` : `Pattern: \`${m.pattern}\``) +
          (m.similarity != null ? `\n\nSimilarity: ${Math.round(m.similarity * 100)}%` : ""),
        ),
        renderOptions: {
          after: {
            contentText: `  ← ${label}`,
          },
        },
      };
    });

    editor.setDecorations(this.decorationType, decorations);
  }

  dispose(): void {
    this.decorationType.dispose();
  }
}
