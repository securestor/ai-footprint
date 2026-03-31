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
exports.OverlayManager = void 0;
const vscode = __importStar(require("vscode"));
class OverlayManager {
    decorationType;
    enabled = true;
    matchesByUri = new Map();
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
    isEnabled() {
        return this.enabled;
    }
    toggle() {
        this.enabled = !this.enabled;
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            if (this.enabled) {
                this.applyDecorations(editor);
            }
            else {
                editor.setDecorations(this.decorationType, []);
            }
        }
    }
    update(uri, matches) {
        this.matchesByUri.set(uri.toString(), matches);
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.toString() === uri.toString() && this.enabled) {
            this.applyDecorations(editor);
        }
    }
    applyDecorations(editor) {
        const matches = this.matchesByUri.get(editor.document.uri.toString());
        if (!matches || matches.length === 0) {
            editor.setDecorations(this.decorationType, []);
            return;
        }
        const decorations = matches.map((m) => {
            const line = Math.max(0, m.line - 1);
            const range = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length);
            const label = m.snippet
                ? `AI: ${m.snippet.model ?? m.snippet.source}${m.similarity != null ? ` (${Math.round(m.similarity * 100)}%)` : ""}`
                : `AI pattern: ${m.pattern}`;
            return {
                range,
                hoverMessage: new vscode.MarkdownString(`**AI Footprint** — ${m.confidence} confidence\n\n` +
                    `Type: \`${m.matchType ?? "unknown"}\`\n\n` +
                    (m.snippet ? `Source: ${m.snippet.source}\nModel: ${m.snippet.model ?? "unknown"}\nTool: ${m.snippet.tool ?? "unknown"}` : `Pattern: \`${m.pattern}\``) +
                    (m.similarity != null ? `\n\nSimilarity: ${Math.round(m.similarity * 100)}%` : "")),
                renderOptions: {
                    after: {
                        contentText: `  ← ${label}`,
                    },
                },
            };
        });
        editor.setDecorations(this.decorationType, decorations);
    }
    dispose() {
        this.decorationType.dispose();
    }
}
exports.OverlayManager = OverlayManager;
//# sourceMappingURL=overlay.js.map