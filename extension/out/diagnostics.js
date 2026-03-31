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
exports.DiagnosticsManager = void 0;
const vscode = __importStar(require("vscode"));
const SEVERITY_MAP = {
    Error: vscode.DiagnosticSeverity.Error,
    Warning: vscode.DiagnosticSeverity.Warning,
    Information: vscode.DiagnosticSeverity.Information,
    Hint: vscode.DiagnosticSeverity.Hint,
};
class DiagnosticsManager {
    collection;
    constructor() {
        this.collection = vscode.languages.createDiagnosticCollection("ai-footprint");
    }
    update(uri, matches, config) {
        const severityName = config.get("diagnosticSeverity", "Information");
        const severity = SEVERITY_MAP[severityName] ?? vscode.DiagnosticSeverity.Information;
        const diagnostics = matches.map((m) => {
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
    clear() {
        this.collection.clear();
    }
    dispose() {
        this.collection.dispose();
    }
}
exports.DiagnosticsManager = DiagnosticsManager;
//# sourceMappingURL=diagnostics.js.map