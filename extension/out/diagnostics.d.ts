import * as vscode from "vscode";
import type { ScanMatch } from "./types.js";
export declare class DiagnosticsManager implements vscode.Disposable {
    private collection;
    constructor();
    update(uri: vscode.Uri, matches: ScanMatch[], config: vscode.WorkspaceConfiguration): void;
    clear(): void;
    dispose(): void;
}
