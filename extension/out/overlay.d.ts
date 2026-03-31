import * as vscode from "vscode";
import type { ScanMatch } from "./types.js";
export declare class OverlayManager implements vscode.Disposable {
    private decorationType;
    private enabled;
    private matchesByUri;
    constructor();
    isEnabled(): boolean;
    toggle(): void;
    update(uri: vscode.Uri, matches: ScanMatch[]): void;
    private applyDecorations;
    dispose(): void;
}
