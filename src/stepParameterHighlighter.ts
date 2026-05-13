import * as path from 'path';
import * as vscode from 'vscode';
import { DEFAULT_STEP_GLOBS, DEFAULT_SUPPORT_GLOBS, normalizeGlobSettings } from './cucumberConfig';
import { parseStepDefinitions, StepDefinitionMatch, stepDefinitionMatches, stepParameterRanges } from './stepDefinitionMatcher';

export class StepParameterHighlighter implements vscode.Disposable {
  private readonly decorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline',
    fontWeight: '600',
    color: new vscode.ThemeColor('textLink.foreground')
  });
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly definitionCache = new Map<string, Promise<StepDefinitionMatch[]>>();

  constructor(private readonly logger: { appendLine(message: string): void }) {
    this.disposables.push(
      this.decorationType,
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.scheduleEditor(editor);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((document) => this.scheduleDocument(document)),
      vscode.workspace.onDidChangeTextDocument((event) => this.scheduleDocument(event.document)),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.definitionCache.clear();
        this.scheduleDocument(document);
        this.updateVisibleFeatureEditors();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('cucumberRunner.highlightStepParameters') ||
          event.affectsConfiguration('cucumberRunner.steps') ||
          event.affectsConfiguration('cucumberRunner.support')) {
          this.definitionCache.clear();
          this.updateVisibleFeatureEditors();
        }
      })
    );
    this.updateVisibleFeatureEditors();
  }

  public dispose(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private scheduleDocument(document: vscode.TextDocument): void {
    vscode.window.visibleTextEditors
      .filter((editor) => editor.document === document)
      .forEach((editor) => this.scheduleEditor(editor));
  }

  private scheduleEditor(editor: vscode.TextEditor): void {
    if (!this.isFeatureDocument(editor.document)) {
      return;
    }
    const key = editor.document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      this.updateEditor(editor).catch((error) => {
        this.logger.appendLine(`Failed to highlight Cucumber step parameters: ${String(error)}`);
      });
    }, 300));
  }

  private updateVisibleFeatureEditors(): void {
    vscode.window.visibleTextEditors.forEach((editor) => this.scheduleEditor(editor));
  }

  private async updateEditor(editor: vscode.TextEditor): Promise<void> {
    const enabled = vscode.workspace.getConfiguration('cucumberRunner', editor.document.uri).get<boolean>('highlightStepParameters', true);
    if (!enabled) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const definitions = await this.stepDefinitions(workspaceFolder);
    const ranges: vscode.Range[] = [];
    for (let lineIndex = 0; lineIndex < editor.document.lineCount; lineIndex++) {
      const line = editor.document.lineAt(lineIndex).text;
      const step = this.parseFeatureStepLine(line);
      if (!step) {
        continue;
      }
      const definition = definitions.find((candidate) => stepDefinitionMatches(candidate.pattern, step.text));
      if (!definition) {
        continue;
      }
      for (const range of stepParameterRanges(definition.pattern, step.text)) {
        ranges.push(new vscode.Range(
          new vscode.Position(lineIndex, step.textOffset + range.start),
          new vscode.Position(lineIndex, step.textOffset + range.end)
        ));
      }
    }
    editor.setDecorations(this.decorationType, ranges);
  }

  private async stepDefinitions(workspaceFolder: vscode.WorkspaceFolder): Promise<StepDefinitionMatch[]> {
    const key = workspaceFolder.uri.toString();
    const cached = this.definitionCache.get(key);
    if (cached) {
      return cached;
    }
    const promise = this.loadStepDefinitions(workspaceFolder);
    this.definitionCache.set(key, promise);
    return promise;
  }

  private async loadStepDefinitions(workspaceFolder: vscode.WorkspaceFolder): Promise<StepDefinitionMatch[]> {
    const config = vscode.workspace.getConfiguration('cucumberRunner', workspaceFolder.uri);
    const globs = [
      ...normalizeGlobSettings(config.get('steps'), DEFAULT_STEP_GLOBS),
      ...normalizeGlobSettings(config.get('support'), DEFAULT_SUPPORT_GLOBS)
    ];
    const files = await this.findStepFiles(workspaceFolder, globs);
    const definitions: StepDefinitionMatch[] = [];
    for (const file of files) {
      const raw = await vscode.workspace.fs.readFile(file);
      definitions.push(...parseStepDefinitions(Buffer.from(raw).toString('utf8')));
    }
    return definitions;
  }

  private async findStepFiles(workspaceFolder: vscode.WorkspaceFolder, globs: string[]): Promise<vscode.Uri[]> {
    const files: vscode.Uri[] = [];
    for (const glob of globs) {
      files.push(...await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, glob.replace(/\\/g, '/')), '**/node_modules/**'));
    }
    return [...new Map(files.map((uri) => [path.normalize(uri.fsPath), uri])).values()]
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  private parseFeatureStepLine(line: string): { text: string; textOffset: number } | undefined {
    const match = /^(\s*)(Given|When|Then|And|But|\*)\b(\s+)(.+?)\s*$/u.exec(line);
    if (!match) {
      return undefined;
    }
    return {
      text: match[4],
      textOffset: match[1].length + match[2].length + match[3].length
    };
  }

  private isFeatureDocument(document: vscode.TextDocument): boolean {
    return document.uri.scheme === 'file' && document.fileName.toLowerCase().endsWith('.feature');
  }
}
