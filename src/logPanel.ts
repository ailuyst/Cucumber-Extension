import * as vscode from 'vscode';

export class LogPanel {
  public readonly outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Cucumber Runner');
  }

  public appendLine(value: string): void {
    this.outputChannel.appendLine(value);
  }

  public append(value: string): void {
    this.outputChannel.append(value);
  }

  public clear(): void {
    this.outputChannel.clear();
  }

  public show(preserveFocus = false): void {
    this.outputChannel.show(!preserveFocus);
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}
