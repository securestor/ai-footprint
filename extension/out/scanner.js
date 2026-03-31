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
exports.Scanner = void 0;
const vscode = __importStar(require("vscode"));
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
// ── Registry ──────────────────────────────────────────────────────────
const REGISTRY_PATH = (0, node_path_1.join)((0, node_os_1.homedir)(), ".ai-footprint", "snippets.json");
function loadSnippets() {
    if (!(0, node_fs_1.existsSync)(REGISTRY_PATH))
        return [];
    try {
        const data = JSON.parse((0, node_fs_1.readFileSync)(REGISTRY_PATH, "utf-8"));
        return data.snippets ?? [];
    }
    catch {
        return [];
    }
}
// ── Core matching (inlined to avoid cross-rootDir imports) ────────────
function normalize(code) {
    return code.split("\n").map((l) => l.trimEnd()).join("\n").replace(/\r\n/g, "\n").trim();
}
function hashSnippet(code) {
    return (0, node_crypto_1.createHash)("sha256").update(normalize(code)).digest("hex");
}
const AI_PATTERNS = [
    { pattern: /\/\/\s*generated\s+by\s+(gpt|copilot|claude|gemini|codex|ai)/i, tag: "comment-tag" },
    { pattern: /\/\*\s*@ai[- ]generated/i, tag: "jsdoc-tag" },
    { pattern: /#\s*generated\s+by\s+(gpt|copilot|claude|gemini|codex|ai)/i, tag: "hash-comment-tag" },
    { pattern: /AI-generated|ai_generated/i, tag: "marker" },
    { pattern: /copilot|GitHub Copilot/i, tag: "copilot-ref" },
];
function matchContent(filePath, content, snippets) {
    const matches = [];
    const lines = content.split("\n");
    for (const snippet of snippets) {
        const snippetLines = normalize(snippet.content).split("\n");
        const windowSize = snippetLines.length;
        for (let i = 0; i <= lines.length - windowSize; i++) {
            const window = lines.slice(i, i + windowSize).join("\n");
            if (hashSnippet(window) === snippet.hash) {
                matches.push({ file: filePath, line: i + 1, snippet, confidence: "high", similarity: 1.0, matchType: "exact" });
            }
        }
    }
    for (let i = 0; i < lines.length; i++) {
        for (const { pattern, tag } of AI_PATTERNS) {
            if (pattern.test(lines[i])) {
                matches.push({ file: filePath, line: i + 1, pattern: tag, confidence: "medium", matchType: "pattern" });
            }
        }
    }
    return matches;
}
// ── Workspace scan ────────────────────────────────────────────────────
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__", "out"]);
const CODE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rb", ".go", ".rs", ".java", ".kt",
    ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
    ".vue", ".svelte", ".astro",
]);
function extOf(name) {
    const i = name.lastIndexOf(".");
    return i === -1 ? "" : name.slice(i);
}
function collectFiles(dir) {
    const results = [];
    for (const entry of (0, node_fs_1.readdirSync)(dir, { withFileTypes: true })) {
        if (IGNORED_DIRS.has(entry.name))
            continue;
        const full = (0, node_path_1.join)(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectFiles(full));
        }
        else if (CODE_EXTENSIONS.has(extOf(entry.name))) {
            results.push(full);
        }
    }
    return results;
}
function scanDirectory(targetDir) {
    const files = collectFiles(targetDir);
    const snippets = loadSnippets();
    const allMatches = [];
    const attributedFiles = new Set();
    const suspiciousFiles = new Set();
    const modelCounts = new Map();
    for (const file of files) {
        const content = (0, node_fs_1.readFileSync)(file, "utf-8");
        const relPath = (0, node_path_1.relative)(targetDir, file);
        const matches = matchContent(relPath, content, snippets);
        for (const m of matches) {
            allMatches.push(m);
            if (m.snippet) {
                attributedFiles.add(m.file);
                if (m.snippet.model)
                    modelCounts.set(m.snippet.model, (modelCounts.get(m.snippet.model) ?? 0) + 1);
            }
            else {
                suspiciousFiles.add(m.file);
            }
        }
    }
    for (const f of attributedFiles)
        suspiciousFiles.delete(f);
    let topModel = null;
    let topCount = 0;
    for (const [model, count] of modelCounts) {
        if (count > topCount) {
            topModel = model;
            topCount = count;
        }
    }
    return { filesAnalyzed: files.length, aiAttributedFiles: attributedFiles.size, unattributedSuspicious: suspiciousFiles.size, topModel, matches: allMatches };
}
class Scanner {
    cache = new Map();
    async scanDocument(document, options = {}) {
        const uri = document.uri.toString();
        const cached = this.cache.get(uri);
        if (cached && cached.version === document.version) {
            return cached.matches;
        }
        const content = document.getText();
        const snippets = loadSnippets();
        const matches = matchContent(vscode.workspace.asRelativePath(document.uri), content, snippets);
        this.cache.set(uri, { version: document.version, matches });
        return matches;
    }
    async scanWorkspace(rootPath) {
        return scanDirectory(rootPath);
    }
    clearCache() {
        this.cache.clear();
    }
}
exports.Scanner = Scanner;
//# sourceMappingURL=scanner.js.map