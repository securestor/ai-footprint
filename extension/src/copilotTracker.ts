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
 * Tracks AI-agent-originated edits and writes a marker file so that
 * the AI Footprint git hook can attribute commits accurately — even when
 * the generated code contains no detectable AI patterns.
 *
 * Supported agents:
 *  - GitHub Copilot (VS Code extension)
 *  - Cursor (detected via env var at startup — Cursor is a VS Code fork)
 *  - Claude Code (detected via CLAUDE_CODE env var when shell-integrated)
 *
 * Detection heuristic:
 *  1. Checks if known AI coding extensions are installed & active.
 *  2. Checks environment variables for Cursor / Claude Code identity.
 *  3. Listens for document changes that occur while an agent is active.
 *  4. Uses edit-burst detection (rapid successive programmatic edits on
 *     a file without corresponding cursor movements) as a signal that
 *     an AI agent is applying changes.
 *  5. Writes changed files to `.ai-footprint/copilot-pending.json`.
 *
 * The marker file is consumed (and cleared) by the commit-msg git hook.
 */

// ------------------------------------------------------------------ //
// Known AI-coding extension IDs
// ------------------------------------------------------------------ //

interface AgentExtension {
  id: string;
  agent: string;
}

const AI_EXTENSIONS: AgentExtension[] = [
  { id: "github.copilot-chat", agent: "copilot-agent" },
  { id: "github.copilot", agent: "copilot-agent" },
  { id: "anthropics.claude-code", agent: "claude-code" },
  { id: "saoudrizwan.claude-dev", agent: "claude-code" },  // Cline (Claude Dev)
  { id: "continue.continue", agent: "claude-code" },       // Continue.dev
];

const MARKER_DIR = ".ai-footprint";
const MARKER_FILE = "copilot-pending.json";

/** Minimum burst of programmatic edits in a window to flag as agent. */
const BURST_THRESHOLD = 3;
const BURST_WINDOW_MS = 1000;

interface EditBurst {
  count: number;
  firstAt: number;
}

export class CopilotTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private activeAgent: string | null = null;
  private activeModel: string | null = null;
  private pendingFiles = new Set<string>();
  private editBursts = new Map<string, EditBurst>();
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("AI Footprint — Agent Tracker");
  }

  activate(context: vscode.ExtensionContext): void {
    // Check which AI agents are present
    this.refreshAgentStatus();
    // Resolve the active LLM model name (best-effort, async)
    void this.refreshModelInfo();

    // Re-check when extensions change
    this.disposables.push(
      vscode.extensions.onDidChange(() => {
        this.refreshAgentStatus();
        void this.refreshModelInfo();
      }),
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

    this.outputChannel.appendLine("AI agent tracker activated");
  }

  /**
   * Resolve the active Copilot model name via the VS Code language model API.
   * Available in VS Code 1.90+ when the Copilot Chat extension is active.
   */
  private async refreshModelInfo(): Promise<void> {
    try {
      // vscode.lm is the Language Model API (VS Code 1.90+)
      const lm = (vscode as unknown as { lm?: { selectChatModels: (opts: { vendor: string }) => Promise<Array<{ id: string; name: string }>> } }).lm;
      if (!lm?.selectChatModels) return;

      const models = await lm.selectChatModels({ vendor: "copilot" });
      if (models.length > 0) {
        this.activeModel = models[0].id ?? models[0].name ?? null;
        if (this.activeModel) {
          this.outputChannel.appendLine(`Active Copilot model: ${this.activeModel}`);
          // Persist to .ai-footprint/config.json so the git hook can read it
          // at commit time (this file is never cleared between commits).
          const workspaceRoot = this.getWorkspaceRoot();
          if (workspaceRoot) {
            this.persistModelConfig(this.activeModel, workspaceRoot);
          }
        }
      }
    } catch {
      // API not available in this VS Code version — not an error
    }
  }

  private refreshAgentStatus(): void {
    const previousAgent = this.activeAgent;
    this.activeAgent = null;

    // 1. Check for Cursor editor (fork of VS Code — sets TERM_PROGRAM or appName)
    if (
      process.env.TERM_PROGRAM?.toLowerCase().includes("cursor") ||
      process.env.CURSOR_TRACE_ID ||
      process.env.CURSOR_CHANNEL
    ) {
      this.activeAgent = "cursor";
    }

    // 2. Check for Claude Code shell integration
    if (!this.activeAgent && (process.env.CLAUDE_CODE || process.env.CLAUDE_CODE_ENTRY)) {
      this.activeAgent = "claude-code";
    }

    // 3. Check installed VS Code extensions
    if (!this.activeAgent) {
      for (const { id, agent } of AI_EXTENSIONS) {
        const ext = vscode.extensions.getExtension(id);
        if (ext?.isActive) {
          this.activeAgent = agent;
          break;
        }
      }
    }

    if (this.activeAgent !== previousAgent) {
      this.outputChannel.appendLine(
        `Active AI agent: ${this.activeAgent ?? "none"}`,
      );
    }
  }

  /**
   * Detect programmatic edit bursts that indicate AI agent activity.
   * When an agent applies changes, it typically produces a rapid burst of
   * edits on a single file (faster than human typing).
   */
  private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    if (!this.activeAgent) return;
    if (e.document.uri.scheme !== "file") return;
    if (e.contentChanges.length === 0) return;

    // Undo/redo are not agent edits
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
    this.outputChannel.appendLine(`Tracked ${this.activeAgent} edit: ${relPath}`);
    this.flushMarker();
  }

  /** Manually mark the current file as an AI-agent edit. */
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
    const agent = this.activeAgent ?? "unknown agent";
    vscode.window.showInformationMessage(`Marked as ${agent} edit: ${relPath}`);
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
    let existingAgent: string | undefined;
    if (existsSync(markerPath)) {
      try {
        const data = JSON.parse(readFileSync(markerPath, "utf-8"));
        if (Array.isArray(data.files)) existing = data.files;
        existingAgent = data.agent;
      } catch {
        /* corrupted — overwrite */
      }
    }

    const merged = [...new Set([...existing, ...this.pendingFiles])];
    // Preserve previously stored model if we don't have a fresher one
    let existingModel: string | undefined;
    if (existsSync(markerPath)) {
      try {
        const data = JSON.parse(readFileSync(markerPath, "utf-8"));
        existingModel = data.model;
      } catch { /* ignore */ }
    }

    writeFileSync(
      markerPath,
      JSON.stringify(
        {
          files: merged,
          agent: this.activeAgent ?? existingAgent,
          model: this.activeModel ?? existingModel,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  /**
   * Write the active model name to `.ai-footprint/config.json`.
   * This file is persistent (never cleared after commits) so the git hook
   * can read the last known model at any point.
   */
  private persistModelConfig(model: string, workspaceRoot: string): void {
    const dir = join(workspaceRoot, MARKER_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const configPath = join(dir, "config.json");
    let existing: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try { existing = JSON.parse(readFileSync(configPath, "utf-8")); } catch { /* overwrite */ }
    }
    writeFileSync(configPath, JSON.stringify(
      { ...existing, copilotModel: model, updatedAt: new Date().toISOString() },
      null, 2,
    ));
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.outputChannel.dispose();
  }
}
