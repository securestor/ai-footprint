import * as vscode from "vscode";
import type { ScanMatch, ScanReport } from "./types.js";
export interface ScanDocumentOptions {
    fuzzyThreshold?: number;
}
export declare class Scanner {
    private cache;
    scanDocument(document: vscode.TextDocument, options?: ScanDocumentOptions): Promise<ScanMatch[]>;
    scanWorkspace(rootPath: string): Promise<ScanReport>;
    clearCache(): void;
}
