import * as vscode from "vscode";
import type { Scanner } from "./scanner.js";
export declare class ReportPanel {
    private static panel;
    static show(extensionUri: vscode.Uri, scanner: Scanner): Promise<void>;
}
