import * as path from 'path';
import * as vscode from 'vscode';
import {
  DEFAULT_STEP_GLOBS,
  DEFAULT_SUPPORT_GLOBS,
  normalizeGlobSettings
} from './cucumberConfig';
import { findMatchingStepDefinition, stripGherkinKeyword } from './stepDefinitionMatcher';

export class CucumberStepDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly logger: { appendLine(message: string): void }) {}

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Definition | undefined> {
    const stepText = stripGherkinKeyword(document.lineAt(position.line).text);
    if (!stepText) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }

    const config = vscode.workspace.getConfiguration('cucumberRunner', document.uri);
    const stepGlobs = normalizeGlobSettings(config.get('steps'), DEFAULT_STEP_GLOBS);
    const supportGlobs = normalizeGlobSettings(config.get('support'), DEFAULT_SUPPORT_GLOBS);
    const globs = [...stepGlobs, ...supportGlobs];
    const files = await this.findStepFiles(workspaceFolder, globs);

    for (const file of files) {
      const raw = await vscode.workspace.fs.readFile(file);
      const source = Buffer.from(raw).toString('utf8');
      const match = findMatchingStepDefinition(source, stepText);
      if (match) {
        const line = Math.max(0, match.line - 1);
        return new vscode.Location(file, new vscode.Position(line, 0));
      }
    }

    this.logger.appendLine('Step definition not found.');
    this.logger.appendLine(`Original step text: ${document.lineAt(position.line).text.trim()}`);
    this.logger.appendLine(`Normalized step text: ${stepText}`);
    this.logger.appendLine(`Step glob patterns: ${globs.join(', ')}`);
    this.logger.appendLine(`Step files scanned: ${files.length}`);
    return undefined;
  }

  private async findStepFiles(workspaceFolder: vscode.WorkspaceFolder, globs: string[]): Promise<vscode.Uri[]> {
    const exclude = '**/node_modules/**';
    const files: vscode.Uri[] = [];
    for (const glob of globs) {
      const pattern = new vscode.RelativePattern(workspaceFolder, glob.replace(/\\/g, '/'));
      files.push(...await vscode.workspace.findFiles(pattern, exclude));
    }
    return this.uniqueUris(files).sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  private uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
    return [...new Map(uris.map((uri) => [path.normalize(uri.fsPath), uri])).values()];
  }
}
