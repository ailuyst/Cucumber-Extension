import * as vscode from 'vscode';
import { formatFeatureText } from './featureFormatEngine';

export class GherkinDocumentFormatter implements vscode.DocumentFormattingEditProvider {
  public provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions
  ): vscode.TextEdit[] {
    const original = document.getText();
    const formatted = formatFeatureText(original, {
      indentSize: options.tabSize || 2,
      insertSpaces: options.insertSpaces
    });
    if (formatted === original) {
      return [];
    }

    const range = new vscode.Range(document.positionAt(0), document.positionAt(original.length));
    return [vscode.TextEdit.replace(range, formatted)];
  }
}
