import * as path from 'path';
import * as vscode from 'vscode';
import { CucumberDiscovery, CucumberExampleRow, CucumberFeature, CucumberScenario, CucumberStep } from './cucumberDiscovery';
import { DiscoveredHook } from './hookDiscovery';
import { staticHookItemId } from './runtimeHookItems';

export class CucumberTestExplorer implements vscode.Disposable {
  public readonly controller: vscode.TestController;
  private readonly refreshDebounceMs = 400;
  private readonly changeSubscription: vscode.Disposable;
  private folderMap = new Map<string, vscode.TestItem>();
  private fileMap = new Map<string, vscode.TestItem>();
  private workspaceMap = new Map<string, vscode.TestItem>();
  private refreshTimer?: NodeJS.Timeout;
  private refreshInProgress = false;
  private refreshAgain = false;

  constructor(
    private readonly discovery: CucumberDiscovery,
    private readonly logger: { appendLine(message: string): void }
  ) {
    this.controller = vscode.tests.createTestController('cucumberTestExplorer', 'Cucumber Tests');
    this.controller.refreshHandler = () => this.refresh();
    this.changeSubscription = this.discovery.onDidChange(() => this.scheduleRefresh());
  }

  public async initialize(): Promise<void> {
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this.refreshInProgress) {
      this.refreshAgain = true;
      return;
    }

    this.refreshInProgress = true;
    this.clearItems();
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      if (workspaceFolders.length === 0) {
        return;
      }

      const features = await this.discovery.discoverFeatures();
      for (const feature of features) {
        const parent = this.getOrCreateWorkspaceItem(feature.workspaceFolder);
        this.addFeature(parent.children, feature, feature.workspaceFolder.uri.fsPath);
      }
    } finally {
      this.refreshInProgress = false;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        this.scheduleRefresh();
      }
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh().catch((error) => {
        this.logger.appendLine(`Failed to refresh Cucumber tests: ${String(error)}`);
      });
    }, this.refreshDebounceMs);
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.changeSubscription.dispose();
  }

  private clearItems(): void {
    this.controller.items.forEach((item) => this.controller.items.delete(item.id));
    this.folderMap.clear();
    this.fileMap.clear();
    this.workspaceMap.clear();
  }

  private addFeature(rootCollection: vscode.TestItemCollection, feature: CucumberFeature, rootPath: string): void {
    const relativeDir = path.relative(rootPath, path.dirname(feature.uri.fsPath));
    const parent = relativeDir && relativeDir !== '.' ? this.getOrCreateFolderItem(rootCollection, feature.workspaceFolder, relativeDir) : rootCollection;

    const fileId = `file:${feature.uri.toString()}`;
    const fileItem = this.controller.createTestItem(fileId, path.basename(feature.uri.fsPath), feature.uri);
    parent.add(fileItem);
    this.fileMap.set(fileId, fileItem);

    const featureId = `feature:${feature.uri.toString()}`;
    const featureItem = this.controller.createTestItem(featureId, `Feature: ${feature.featureName}`, feature.uri);
    featureItem.canResolveChildren = true;
    fileItem.children.add(featureItem);

    for (const scenario of feature.scenarios) {
      this.addScenario(featureItem, feature.uri, scenario);
    }
  }

  private addScenario(parent: vscode.TestItem, uri: vscode.Uri, scenario: CucumberScenario): void {
    const scenarioKind = scenario.type === 'Scenario Outline' ? 'scenarioOutline' : 'scenario';
    const scenarioId = `${scenarioKind}:${uri.toString()}:${scenario.line}`;
    const scenarioItem = this.controller.createTestItem(scenarioId, `${scenario.type}: ${scenario.name}`, uri);
    scenarioItem.range = new vscode.Range(scenario.line - 1, 0, scenario.line - 1, 0);
    parent.children.add(scenarioItem);

    if (scenario.type === 'Scenario Outline' && scenario.examples.length > 0) {
      for (const example of scenario.examples) {
        this.addExampleRow(scenarioItem, uri, scenario, example);
      }
      return;
    }

    this.addStepsWithHooks(
      scenarioItem,
      uri,
      scenario.line,
      scenario.beforeHooks,
      scenario.beforeStepHooks,
      scenario.steps,
      scenario.afterStepHooks,
      scenario.afterHooks
    );
  }

  private addExampleRow(
    parent: vscode.TestItem,
    uri: vscode.Uri,
    scenario: CucumberScenario,
    example: CucumberExampleRow
  ): void {
    const item = this.controller.createTestItem(
      `exampleRow:${uri.toString()}:${scenario.line}:${example.line}`,
      this.formatExampleLabel(example),
      uri
    );
    item.range = new vscode.Range(example.line - 1, 0, example.line - 1, 0);
    parent.children.add(item);
    this.addStepsWithHooks(item, uri, example.line, example.beforeHooks, example.beforeStepHooks, example.steps, example.afterStepHooks, example.afterHooks);
  }

  private addStepsWithHooks(
    parent: vscode.TestItem,
    uri: vscode.Uri,
    ownerLine: number,
    beforeHooks: readonly DiscoveredHook[],
    beforeStepHooks: readonly DiscoveredHook[],
    steps: readonly CucumberStep[],
    afterStepHooks: readonly DiscoveredHook[],
    afterHooks: readonly DiscoveredHook[]
  ): void {
    let sortIndex = 0;
    beforeHooks.forEach((hook, index) => {
      this.setTestItemSortText(this.addHook(parent, hook, index), sortIndex++);
    });
    for (const [stepIndex, step] of steps.entries()) {
      beforeStepHooks.forEach((hook, hookIndex) => {
        this.setTestItemSortText(this.addHook(parent, hook, beforeHooks.length + stepIndex * (beforeStepHooks.length + afterStepHooks.length + 1) + hookIndex), sortIndex++);
      });
      this.setTestItemSortText(this.addStep(parent, uri, ownerLine, step), sortIndex++);
      afterStepHooks.forEach((hook, hookIndex) => {
        this.setTestItemSortText(this.addHook(parent, hook, beforeHooks.length + stepIndex * (beforeStepHooks.length + afterStepHooks.length + 1) + beforeStepHooks.length + 1 + hookIndex), sortIndex++);
      });
    }
    afterHooks.forEach((hook, index) => {
      this.setTestItemSortText(this.addHook(parent, hook, beforeHooks.length + steps.length * (beforeStepHooks.length + afterStepHooks.length + 1) + index), sortIndex++);
    });
  }

  private addHook(parent: vscode.TestItem, hook: DiscoveredHook, ordinal: number): vscode.TestItem {
    const item = this.controller.createTestItem(staticHookItemId(parent.id, { ...hook, ordinal }), hook.label, hook.uri ? vscode.Uri.file(hook.uri) : parent.uri);
    if (hook.line !== undefined) {
      item.range = new vscode.Range(hook.line - 1, 0, hook.line - 1, 0);
    } else {
      item.range = parent.range;
    }
    parent.children.add(item);
    return item;
  }

  private addStep(parent: vscode.TestItem, uri: vscode.Uri, ownerLine: number, step: CucumberStep): vscode.TestItem {
    const stepId = `step:${uri.toString()}:${ownerLine}:${step.line}`;
    const stepItem = this.controller.createTestItem(stepId, `${step.keyword} ${step.text}`, uri);
    stepItem.range = new vscode.Range(step.line - 1, 0, step.line - 1, 0);
    parent.children.add(stepItem);
    return stepItem;
  }

  private setTestItemSortText(item: vscode.TestItem, index: number): void {
    (item as vscode.TestItem & { sortText?: string }).sortText = String(index).padStart(6, '0');
  }

  private formatExampleLabel(example: CucumberExampleRow): string {
    const entries = Object.entries(example.values);
    const visible = entries.slice(0, 2).map(([key, value]) => `${key}=${this.compactValue(value)}`);
    const suffix = entries.length > visible.length ? ', ...' : '';
    return `Example #${example.index}: ${visible.join(', ')}${suffix}`;
  }

  private compactValue(value: string): string {
    if (value.length <= 24) {
      return value;
    }
    return `${value.slice(0, 21)}...`;
  }

  private getOrCreateWorkspaceItem(workspaceFolder: vscode.WorkspaceFolder): vscode.TestItem {
    const key = workspaceFolder.uri.toString();
    let item = this.workspaceMap.get(key);
    if (!item) {
      item = this.controller.createTestItem(`workspace:${key}`, workspaceFolder.name, workspaceFolder.uri);
      this.controller.items.add(item);
      this.workspaceMap.set(key, item);
    }
    return item;
  }

  private getOrCreateFolderItem(
    rootCollection: vscode.TestItemCollection,
    workspaceFolder: vscode.WorkspaceFolder,
    relativeDir: string
  ): vscode.TestItemCollection {
    const parts = relativeDir.split(path.sep).filter(Boolean);
    let currentCollection = rootCollection;
    let prefix = '';

    for (const segment of parts) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const key = `${workspaceFolder.uri.toString()}:${prefix}`;
      let existing = this.folderMap.get(key);
      if (!existing) {
        existing = this.controller.createTestItem(`folder:${workspaceFolder.uri.toString()}:${prefix}`, segment);
        currentCollection.add(existing);
        this.folderMap.set(key, existing);
      }
      currentCollection = existing.children;
    }

    return currentCollection;
  }
}
