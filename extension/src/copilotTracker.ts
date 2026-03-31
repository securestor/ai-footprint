import * as vscode from "vscode";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { join, relative } from "node:path";

/**
 * Tracks Copilot-originated edits and writes a marker file so that
 * the AI Footprint git hook can attribute commits accurately — even when
 * the generated code contains no detectable AI patterns.
 *
 * Detection heuristic:
 *  1. Checks if GitHub Copilot Chat extension is installed & active.
 *  2. Listens for document changes that occur while Copilot is active.
 *  3. Uses edit-burst detection (rapid successive programmatic edits on
 *     a file without corresponding cursor movements) as a signal that
 *     an AI agent is applying changes.
 *  4. Writes changed files to `.ai-footprint/copilot-pending.json`.
 *
 * The marker file is consumed (and cleared) by the commit-msg git hook.
 */

const COPILOT_EXTENSION_IDS = [
  "github.copilot-chat",
  "github.copilot",
];

const MARKER_DIR = ".ai-footprint";
const MARKER_FILE = "copilot-pending.json";

/** Minimum burst of programmatic edits in a window to flag as Copilot. */
const BURST_THRESHOLD = 3;
const BURST_WINDOW_MS = 1000;

interface EditBurst {
  count: number;
  firstAt: number;
}

export class CopilotTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private copilotActive = false;
  private pendingFiles = new Set<string>();
  private editBursts = new Map<string, EditBurst>();
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("AI Footprint — Copilot Tracker");
  }

  activate(context: vscode.ExtensionContext): void {
    // Check if Copilot is installed
    this.refreshCopilotStatus();

    // Re-check when extensions change
    this.disposables.push(
      vscode.extensions.onDidChange(() => this.refreshCopilotStatus()),
    );

    // Listen for document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChange(e)),
    );

    // Listen for file saves — flush marker when saves happen
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(() => this.flushMarker()),
    );

    // Register manual mark command
    this.disposables.push(
      vscode.commands.registerCommand("aiFootprint.markCopilotEdit", () => {
        this.markCurrentFile();
      }),
    );

    this.outputChannel.appendLine("Copilot tracker activated");
  }

  private refreshCopilotStatus(): void {
    const wasActive = this.copilotActive;
    this.copilotActive = COPILOT_EXTENSION_IDS.some((id) => {
      const ext = vscode.extensions.getExtension(id);
      return ext?.isActive ?? false;
    });

    if (this.copilotActive !== wasActive) {
      this.outputChannel.appendLine(
        `Copilot status: ${this.copilotActive ? "active" : "inactive"}`,
      );
    }
  }

  /**
   * Detect programmatic edit bursts that indicate Copilot agent activity.
   * When Copilot applies changes, it typically produces a rapid burst of
   * edits on a single file (faster than human typing).
   */
  private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    if (!this.copilotActive) return;
    if (e.document.uri.scheme !== "file") return;
    if (e.contentChanges.length === 0) return;

    // Undo/redo are not Copilot edits
    if (e.reason === vscode.TextDocumentChangeReason.Undo ||
        e.reason === vscode.TextDocumentChangeReason.Redo) {
      return;
    }

    const filePath = e.document.uri.fsPath;
    const now = Date.now();

    // Track edit bursts per file
    const burst = this.editBursts.get(filePath);
    if (burst && (now - burst.firstAt) < BURST_WINDOW_MS) {
      burst.count += e.contentChanges.length;
      if (burst.count >= BURST_THRESHOLD) {
        this.trackFile(filePath);
        this.editBursts.delete(filePath);
      }
    } else {
      this.editBursts.set(filePath, {
        count: e.contentChanges.length,
        firstAt: now,
      });
    }
  }

  private trackFile(fsPath: string): void {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;

    const relPath = relative(workspaceRoot, fsPath);
    if (this.pendingFiles.has(relPath)) return;

    this.pendingFiles.add(relPath);
    this.outputChannel.appendLine(`Tracked Copilot edit: ${relPath}`);
    this.flushMarker();
  }

  /** Manually mark the current file as a Copilot edit. */
  private markCurrentFile(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active file to mark.");
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;

    const relPath = relative(workspaceRoot, editor.document.uri.fsPath);
    this.pendingFiles.add(relPath);
    this.flushMarker();
    vscode.window.showInformationMessage(`Marked as Copilot edit: ${relPath}`);
  }

  /** Write pending files to the marker file. */
  private flushMarker(): void {
    if (this.pendingFiles.size === 0) return;

    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;

    const dir = join(workspaceRoot, MARKER_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const markerPath = join(dir, MARKER_FILE);

    // Merge with existing
    let existing: string[] = [];
    if (existsSync(markerPath)) {
      try {
        const data = JSON.parse(readFileSync(markerPath, "utf-8"));
        if (Array.isArray(data.files)) existing = data.files;
      } catch {
        /* corrupted — overwrite */
      }
    }

    const merged = [...new Set([...existing, ...this.pendingFiles])];
    writeFileSync(
      markerPath,
      JSON.stringify(
        { files: merged, updatedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.outputChannel.dispose();
  }
}
