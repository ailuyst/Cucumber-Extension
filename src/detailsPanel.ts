import * as vscode from 'vscode';
import { detailsTextToHtml } from './detailsFormatter';

export class CucumberDetailsPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;

  public show(title: string, text: string): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'cucumberTestDetails',
        'Cucumber Test Details',
        vscode.ViewColumn.Beside,
        {
          enableScripts: false,
          localResourceRoots: []
        }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    this.panel.title = title;
    this.panel.webview.html = detailsTextToHtml(title, text);
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  public dispose(): void {
    this.panel?.dispose();
  }
}
