import * as vscode from 'vscode';
import * as path from 'path';
import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser
} from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { DEFAULT_FEATURE_GLOBS, DEFAULT_STEP_GLOBS, DEFAULT_SUPPORT_GLOBS, normalizeGlobSettings } from './cucumberConfig';
import { resolveExampleBodyLine } from './exampleRows';
import { DiscoveredHook, hooksForTags, parseCucumberHooksFromSource } from './hookDiscovery';

export interface CucumberStep {
  keyword: string;
  text: string;
  line: number;
}

export interface CucumberExampleRow {
  id: string;
  index: number;
  line: number;
  values: Record<string, string>;
  steps: CucumberStep[];
  tags: string[];
  beforeHooks: DiscoveredHook[];
  beforeStepHooks: DiscoveredHook[];
  afterStepHooks: DiscoveredHook[];
  afterHooks: DiscoveredHook[];
}

export interface CucumberScenario {
  id: string;
  name: string;
  type: 'Scenario' | 'Scenario Outline';
  line: number;
  steps: CucumberStep[];
  examples: CucumberExampleRow[];
  tags: string[];
  beforeHooks: DiscoveredHook[];
  beforeStepHooks: DiscoveredHook[];
  afterStepHooks: DiscoveredHook[];
  afterHooks: DiscoveredHook[];
}

export interface CucumberFeature {
  uri: vscode.Uri;
  featureName: string;
  filePath: string;
  workspaceFolder: vscode.WorkspaceFolder;
  scenarios: CucumberScenario[];
}

export class CucumberDiscovery implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly logger: { appendLine(message: string): void }) {
    this.refreshWatcher();
    this.disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('cucumberRunner.featuresPath') ||
        event.affectsConfiguration('cucumberRunner.features') ||
        event.affectsConfiguration('cucumberRunner.enableAutoDiscovery')
      ) {
        this.refreshWatcher();
        this.changeEmitter.fire();
      }
    }));
  }

  public async discoverFeatures(): Promise<CucumberFeature[]> {
    const featureGlobs = this.getFeatureGlobs();
    const exclude = '**/node_modules/**';
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const allFeatures: CucumberFeature[] = [];

    for (const workspaceFolder of workspaceFolders) {
      const files = await this.findFeatureFiles(workspaceFolder, featureGlobs, exclude);
      const hooks = await this.discoverHooks(workspaceFolder);
      this.logger.appendLine(`Feature discovery in ${workspaceFolder.uri.fsPath}: ${files.length} files found.`);
      const definitions = await Promise.all(files.map((uri) => this.parseFeature(uri, workspaceFolder, hooks)));
      allFeatures.push(...definitions.filter((item): item is CucumberFeature => !!item));
    }

    return allFeatures;
  }

  public async findScenarioAt(uri: vscode.Uri, lineNumber: number): Promise<CucumberScenario | undefined> {
    const feature = await this.parseFeature(uri);
    if (!feature) {
      return undefined;
    }
    return feature.scenarios
      .slice()
      .reverse()
      .find((scenario) => scenario.line <= lineNumber);
  }

  public async findFeatureByUri(uri: vscode.Uri): Promise<CucumberFeature | undefined> {
    return this.parseFeature(uri);
  }

  private refreshWatcher(): void {
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers = [];

    if (!this.getConfig('enableAutoDiscovery', true)) {
      return;
    }

    const featureGlobs = this.getFeatureGlobs();
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      return;
    }

    for (const workspaceFolder of workspaceFolders) {
      for (const glob of featureGlobs) {
        const pattern = new vscode.RelativePattern(workspaceFolder, glob);
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidCreate(() => this.changeEmitter.fire());
        watcher.onDidChange(() => this.changeEmitter.fire());
        watcher.onDidDelete(() => this.changeEmitter.fire());
        this.watchers.push(watcher);
      }
    }
  }

  private getConfig<T>(setting: string, defaultValue: T): T {
    const config = vscode.workspace.getConfiguration('cucumberRunner');
    const value = config.get<T>(setting);
    return value === undefined ? defaultValue : value;
  }

  private async parseFeature(
    uri: vscode.Uri,
    workspaceFolder = this.getWorkspaceFolder(uri),
    hooks: readonly DiscoveredHook[] = []
  ): Promise<CucumberFeature | undefined> {
    if (!workspaceFolder) {
      return undefined;
    }
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const source = Buffer.from(raw).toString('utf8');
      return this.parseWithGherkin(uri, source, workspaceFolder, hooks);
    } catch (error) {
      this.logger.appendLine(`Failed to parse feature ${uri.fsPath}: ${String(error)}`);
      return undefined;
    }
  }

  private getFeatureGlobs(): string[] {
    const config = vscode.workspace.getConfiguration('cucumberRunner');
    const configuredFeatures = config.get<unknown>('features');
    if (configuredFeatures !== undefined) {
      return normalizeGlobSettings(configuredFeatures, DEFAULT_FEATURE_GLOBS).map((glob) => glob.replace(/\\/g, '/'));
    }

    const legacyFeaturesPath = config.get<string>('featuresPath');
    if (legacyFeaturesPath && legacyFeaturesPath.trim().length > 0) {
      return [`${legacyFeaturesPath.replace(/\\/g, '/').replace(/\/+$/, '')}/**/*.feature`];
    }

    return DEFAULT_FEATURE_GLOBS;
  }

  private async findFeatureFiles(
    workspaceFolder: vscode.WorkspaceFolder,
    globs: string[],
    exclude: string
  ): Promise<vscode.Uri[]> {
    const files: vscode.Uri[] = [];
    for (const glob of globs) {
      const pattern = new vscode.RelativePattern(workspaceFolder, glob);
      files.push(...await vscode.workspace.findFiles(pattern, exclude));
    }
    return [...new Map(files.map((uri) => [path.normalize(uri.fsPath), uri])).values()]
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  private parseWithGherkin(
    uri: vscode.Uri,
    source: string,
    workspaceFolder: vscode.WorkspaceFolder,
    hooks: readonly DiscoveredHook[]
  ): CucumberFeature {
    try {
      const builder = new AstBuilder(IdGenerator.uuid());
      const matcher = new GherkinClassicTokenMatcher();
      const parser = new Parser(builder, matcher);
      const document = parser.parse(source);
      const feature = document.feature;
      const featureTags = this.tagsFrom(feature?.tags);
      const scenarios: CucumberScenario[] = [];

      for (const child of feature?.children ?? []) {
        if (child.scenario) {
          scenarios.push(this.toScenario(uri, child.scenario, featureTags, hooks));
        }
        if (child.rule) {
          for (const ruleChild of child.rule.children ?? []) {
            if (ruleChild.scenario) {
              scenarios.push(this.toScenario(uri, ruleChild.scenario, featureTags, hooks));
            }
          }
        }
      }

      return {
        uri,
        featureName: feature?.name || path.basename(uri.fsPath),
        filePath: path.relative(workspaceFolder.uri.fsPath, uri.fsPath),
        workspaceFolder,
        scenarios
      };
    } catch (error) {
      this.logger.appendLine(`Official Gherkin parser failed for ${uri.fsPath}; using fallback parser. ${String(error)}`);
      return this.parseWithFallback(uri, source, workspaceFolder, hooks);
    }
  }

  private toScenario(uri: vscode.Uri, scenario: {
    id: string;
    name: string;
    keyword: string;
    location?: { line?: number };
    steps: ReadonlyArray<{ keyword: string; text: string; location?: { line?: number } }>;
    examples?: ReadonlyArray<{
      tags?: ReadonlyArray<{ name: string }>;
      tableHeader?: { location?: { line?: number }; cells: ReadonlyArray<{ value: string }> };
      tableBody: ReadonlyArray<{
        id: string;
        location?: { line?: number };
        cells: ReadonlyArray<{ value: string }>;
      }>;
    }>;
    tags?: ReadonlyArray<{ name: string }>;
  }, featureTags: string[], hooks: readonly DiscoveredHook[]): CucumberScenario {
    const line = scenario.location?.line ?? 1;
    const tags = [...featureTags, ...this.tagsFrom(scenario.tags)];
    const hookSet = hooksForTags(hooks, tags);
    const steps = scenario.steps.map((step) => ({
      keyword: step.keyword.trim(),
      text: step.text,
      line: step.location?.line ?? line
    }));
    return {
      id: scenario.id || `${uri.toString()}:${line}`,
      name: scenario.name || scenario.keyword,
      type: scenario.keyword.toLowerCase().includes('outline') ? 'Scenario Outline' : 'Scenario',
      line,
      steps,
      examples: this.toExampleRows(scenario.examples ?? [], steps, tags, hooks),
      tags,
      beforeHooks: hookSet.before,
      beforeStepHooks: hookSet.beforeStep,
      afterStepHooks: hookSet.afterStep,
      afterHooks: hookSet.after
    };
  }

  private toExampleRows(
    examples: ReadonlyArray<{
      tags?: ReadonlyArray<{ name: string }>;
      tableHeader?: { location?: { line?: number }; cells: ReadonlyArray<{ value: string }> };
      tableBody: ReadonlyArray<{
        id: string;
        location?: { line?: number };
        cells: ReadonlyArray<{ value: string }>;
      }>;
    }>,
    steps: CucumberStep[],
    scenarioTags: string[],
    hooks: readonly DiscoveredHook[]
  ): CucumberExampleRow[] {
    const rows: CucumberExampleRow[] = [];
    for (const block of examples) {
      const headers = block.tableHeader?.cells.map((cell) => cell.value) ?? [];
      const headerLine = block.tableHeader?.location?.line;
      const rowTags = [...scenarioTags, ...this.tagsFrom(block.tags)];
      const hookSet = hooksForTags(hooks, rowTags);
      for (const [rowIndex, row] of (block.tableBody ?? []).entries()) {
        const values = new Map<string, string>();
        row.cells.forEach((cell, index) => {
          values.set(headers[index] ?? `column${index + 1}`, cell.value);
        });
        const rowLine = resolveExampleBodyLine(row.location?.line, headerLine, rowIndex);
        rows.push({
          id: row.id,
          index: rows.length + 1,
          line: rowLine,
          values: Object.fromEntries(values),
          steps: steps.map((step) => ({
            ...step,
            text: this.interpolateOutlineStep(step.text, values)
          })),
          tags: rowTags,
          beforeHooks: hookSet.before,
          beforeStepHooks: hookSet.beforeStep,
          afterStepHooks: hookSet.afterStep,
          afterHooks: hookSet.after
        });
      }
    }
    return rows;
  }

  private interpolateOutlineStep(text: string, values: Map<string, string>): string {
    return text.replace(/<([^>]+)>/g, (match, key: string) => values.get(key) ?? match);
  }

  private parseWithFallback(
    uri: vscode.Uri,
    source: string,
    workspaceFolder: vscode.WorkspaceFolder,
    hooks: readonly DiscoveredHook[]
  ): CucumberFeature {
    const lines = source.split(/\r?\n/);
      const scenarios: CucumberScenario[] = [];
      let featureName = path.basename(uri.fsPath);
      let currentScenario: CucumberScenario | undefined;
      let currentExampleHeaders: string[] | undefined;
      let pendingTags: string[] = [];
      let featureTags: string[] = [];

      for (let index = 0; index < lines.length; index++) {
        const rawLine = lines[index];
        const line = rawLine.trim();
        const lineNo = index + 1;

        const featureMatch = /^Feature:\s*(.+)$/i.exec(line);
        if (featureMatch) {
          featureName = featureMatch[1].trim();
          featureTags = pendingTags;
          pendingTags = [];
          continue;
        }

        if (line.startsWith('@')) {
          pendingTags.push(...line.split(/\s+/).filter((part) => part.startsWith('@')));
          continue;
        }

        const scenarioMatch = /^(Scenario(?: Outline)?):\s*(.+)$/i.exec(line);
        if (scenarioMatch) {
          const tags = [...featureTags, ...pendingTags];
          const hookSet = hooksForTags(hooks, tags);
          currentScenario = {
            id: `${uri.toString()}:${lineNo}`,
            name: scenarioMatch[2].trim(),
            type: scenarioMatch[1].trim() === 'Scenario Outline' ? 'Scenario Outline' : 'Scenario',
            line: lineNo,
            steps: [],
            examples: [],
            tags,
            beforeHooks: hookSet.before,
            beforeStepHooks: hookSet.beforeStep,
            afterStepHooks: hookSet.afterStep,
            afterHooks: hookSet.after
          };
          scenarios.push(currentScenario);
          currentExampleHeaders = undefined;
          pendingTags = [];
          continue;
        }

        const stepMatch = /^(Given|When|Then|And|But)\s+(.+)$/i.exec(line);
        if (stepMatch && currentScenario) {
          currentScenario.steps.push({
            keyword: stepMatch[1],
            text: stepMatch[2],
            line: lineNo
          });
        }

        if (/^Examples:/i.test(line) && currentScenario) {
          currentExampleHeaders = undefined;
          continue;
        }

        if (line.startsWith('|') && currentScenario?.type === 'Scenario Outline') {
          const cells = line
            .split('|')
            .map((cell) => cell.trim())
            .filter((cell) => cell.length > 0);
          if (!currentExampleHeaders) {
            currentExampleHeaders = cells;
            continue;
          }

          const values = new Map<string, string>();
          cells.forEach((cell, cellIndex) => {
            values.set(currentExampleHeaders?.[cellIndex] ?? `column${cellIndex + 1}`, cell);
          });
          currentScenario.examples.push({
            id: `${uri.toString()}:${lineNo}`,
            index: currentScenario.examples.length + 1,
            line: lineNo,
            values: Object.fromEntries(values),
            steps: currentScenario.steps.map((step) => ({
              ...step,
              text: this.interpolateOutlineStep(step.text, values)
            })),
            tags: currentScenario.tags,
            beforeHooks: currentScenario.beforeHooks,
            beforeStepHooks: currentScenario.beforeStepHooks,
            afterStepHooks: currentScenario.afterStepHooks,
            afterHooks: currentScenario.afterHooks
          });
        }
      }

      return {
        uri,
        featureName,
        filePath: path.relative(workspaceFolder.uri.fsPath, uri.fsPath),
        workspaceFolder,
        scenarios
      };
  }

  private getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
  }

  private tagsFrom(tags: ReadonlyArray<{ name: string }> | undefined): string[] {
    return (tags ?? []).map((tag) => tag.name).filter(Boolean);
  }

  private async discoverHooks(workspaceFolder: vscode.WorkspaceFolder): Promise<DiscoveredHook[]> {
    const config = vscode.workspace.getConfiguration('cucumberRunner');
    const globs = [
      ...normalizeGlobSettings(config.get('support'), DEFAULT_SUPPORT_GLOBS),
      ...normalizeGlobSettings(config.get('steps'), DEFAULT_STEP_GLOBS)
    ];
    const files: vscode.Uri[] = [];
    for (const glob of globs) {
      files.push(...await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, glob.replace(/\\/g, '/')), '**/node_modules/**'));
    }

    const uniqueFiles = [...new Map(files.map((file) => [path.normalize(file.fsPath), file])).values()];
    const hooks: DiscoveredHook[] = [];
    for (const file of uniqueFiles) {
      try {
        const raw = await vscode.workspace.fs.readFile(file);
        hooks.push(...parseCucumberHooksFromSource(Buffer.from(raw).toString('utf8'), file.fsPath));
      } catch (error) {
        this.logger.appendLine(`Failed to parse Cucumber hooks ${file.fsPath}: ${String(error)}`);
      }
    }
    return hooks.map((hook, ordinal) => ({ ...hook, ordinal }));
  }

  public dispose(): void {
    this.watchers.forEach((watcher) => watcher.dispose());
    this.changeEmitter.dispose();
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
