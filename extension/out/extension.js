"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const scanner_js_1 = require("./scanner.js");
const overlay_js_1 = require("./overlay.js");
const diagnostics_js_1 = require("./diagnostics.js");
const statusBar_js_1 = require("./statusBar.js");
const reportPanel_js_1 = require("./reportPanel.js");
let scanner;
let overlay;
let diagnostics;
let statusBar;
function activate(context) {
    scanner = new scanner_js_1.Scanner();
    overlay = new overlay_js_1.OverlayManager();
    diagnostics = new diagnostics_js_1.DiagnosticsManager();
    statusBar = new statusBar_js_1.StatusBarManager();
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand("aiFootprint.scanWorkspace", async () => {
        await scanWorkspace();
    }), vscode.commands.registerCommand("aiFootprint.scanCurrentFile", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("No active file to scan.");
            return;
        }
        await scanDocument(editor.document);
    }), vscode.commands.registerCommand("aiFootprint.toggleOverlay", () => {
        overlay.toggle();
        const state = overlay.isEnabled() ? "enabled" : "disabled";
        vscode.window.showInformationMessage(`AI Footprint overlay ${state}.`);
    }), vscode.commands.registerCommand("aiFootprint.showReport", async () => {
        await reportPanel_js_1.ReportPanel.show(context.extensionUri, scanner);
    }));
    // Scan on save
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
        const config = vscode.workspace.getConfiguration("aiFootprint");
        if (config.get("enableOnSave", true)) {
            await scanDocument(doc);
        }
    }));
    // Scan on active editor change
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (editor) {
            await scanDocument(editor.document);
        }
    }));
    // Scan on workspace open
    if (vscode.window.activeTextEditor) {
        scanDocument(vscode.window.activeTextEditor.document);
    }
    // Register CodeLens provider
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: "file" }, new AiFootprintCodeLensProvider()));
    // Cleanup
    context.subscriptions.push(overlay, diagnostics, statusBar);
    statusBar.show();
}
async function scanDocument(document) {
    if (document.uri.scheme !== "file")
        return;
    const config = vscode.workspace.getConfiguration("aiFootprint");
    const threshold = config.get("fuzzyThreshold", 0.6);
    const matches = await scanner.scanDocument(document, { fuzzyThreshold: threshold });
    diagnostics.update(document.uri, matches, config);
    overlay.update(document.uri, matches);
    statusBar.update(matches.length);
}
async function scanWorkspace() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        vscode.window.showWarningMessage("No workspace folder open.");
        return;
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "AI Footprint: Scanning workspace…",
        cancellable: true,
    }, async (progress, token) => {
        let totalMatches = 0;
        let filesScanned = 0;
        for (const folder of folders) {
            if (token.isCancellationRequested)
                break;
            const report = await scanner.scanWorkspace(folder.uri.fsPath);
            totalMatches += report.matches.length;
            filesScanned += report.filesAnalyzed;
        }
        statusBar.update(totalMatches);
        vscode.window.showInformationMessage(`AI Footprint: Scanned ${filesScanned} files, found ${totalMatches} match(es).`);
    });
}
class AiFootprintCodeLensProvider {
    async provideCodeLenses(document) {
        const config = vscode.workspace.getConfiguration("aiFootprint");
        if (!config.get("overlayEnabled", true))
            return [];
        const threshold = config.get("fuzzyThreshold", 0.6);
        const matches = await scanner.scanDocument(document, { fuzzyThreshold: threshold });
        const lenses = [];
        for (const match of matches) {
            const line = Math.max(0, match.line - 1);
            const range = new vscode.Range(line, 0, line, 0);
            const label = match.snippet
                ? `🤖 AI: ${match.snippet.model ?? match.snippet.source} (${Math.round((match.similarity ?? 1) * 100)}% match)`
                : `🤖 AI pattern: ${match.pattern}`;
            lenses.push(new vscode.CodeLens(range, {
                title: label,
                command: "aiFootprint.scanCurrentFile",
                tooltip: `Confidence: ${match.confidence} | Type: ${match.matchType ?? "unknown"}`,
            }));
        }
        return lenses;
    }
}
function deactivate() {
    // Cleanup handled by disposables
}
//# sourceMappingURL=extension.js.map