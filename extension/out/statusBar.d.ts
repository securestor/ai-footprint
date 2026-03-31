import * as vscode from "vscode";
export declare class StatusBarManager implements vscode.Disposable {
    private item;
    constructor();
    show(): void;
    update(matchCount: number): void;
    dispose(): void;
}
