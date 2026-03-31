import * as vscode from "vscode";

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "aiFootprint.showReport";
    this.item.tooltip = "AI Footprint — click for report";
    this.update(0);
  }

  show(): void {
    this.item.show();
  }

  update(matchCount: number): void {
    if (matchCount === 0) {
      this.item.text = "$(check) AI Footprint";
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = `$(robot) AI: ${matchCount}`;
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
