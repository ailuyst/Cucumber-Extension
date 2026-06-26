import * as vscode from 'vscode';
import { CucumberDiscovery } from './cucumberDiscovery';
import { CucumberTestExplorer } from './testExplorer';
import { CucumberRunner } from './cucumberRunner';
import { LogPanel } from './logPanel';
import { CucumberDetailsPanel } from './detailsPanel';
import { CucumberStepDefinitionProvider } from './stepDefinitionProvider';
import { StepParameterHighlighter } from './stepParameterHighlighter';
import { GherkinDocumentFormatter } from './featureFormatter';

export interface CucumberRunnerTestApi {
  controller: vscode.TestController;
  refreshTests(): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): CucumberRunnerTestApi {
  const logPanel = new LogPanel();
  const detailsPanel = new CucumberDetailsPanel();
  const discovery = new CucumberDiscovery(logPanel);
  const explorer = new CucumberTestExplorer(discovery, logPanel);
  const runner = new CucumberRunner(discovery, logPanel, detailsPanel, explorer.controller);
  const stepDefinitionProvider = new CucumberStepDefinitionProvider(logPanel);
  const stepParameterHighlighter = new StepParameterHighlighter(logPanel);
  const formatter = new GherkinDocumentFormatter();

  explorer.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => {
    runner.runRequest(request, token);
  }, true);
  explorer.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => {
    runner.debugRequest(request, token);
  }, true);

  context.subscriptions.push(
    explorer.controller,
    explorer,
    discovery,
    logPanel,
    detailsPanel,
    stepParameterHighlighter,
    vscode.languages.registerDocumentFormattingEditProvider({ scheme: 'file', language: 'gherkin' }, formatter),
    vscode.languages.registerDefinitionProvider({ scheme: 'file', pattern: '**/*.feature' }, stepDefinitionProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cucumberRunner.refreshTests', () => explorer.refresh()),
    vscode.commands.registerCommand('cucumberRunner.runAll', () => runner.runAll()),
    vscode.commands.registerCommand('cucumberRunner.runCurrentFeature', () => runner.runCurrentFeature()),
    vscode.commands.registerCommand('cucumberRunner.runCurrentScenario', () => runner.runCurrentScenario()),
    vscode.commands.registerCommand('cucumberRunner.showLastRunDetails', () => runner.showLastRunDetails()),
    vscode.commands.registerCommand('cucumberRunner.showItemDetails', (item?: vscode.TestItem) => runner.showItemDetails(item)),
    vscode.commands.registerCommand('cucumberRunner.copyItemDetails', (item?: vscode.TestItem) => runner.copyItemDetails(item)),
    vscode.commands.registerCommand('cucumberRunner.revealItemSource', (item?: vscode.TestItem) => runner.revealItemSource(item)),
    vscode.commands.registerCommand('cucumberRunner.openReport', () => runner.openReport())
  );

  explorer.initialize().catch((error) => {
    logPanel.appendLine(`Failed to initialize Cucumber explorer: ${String(error)}`);
  });

  return {
    controller: explorer.controller,
    refreshTests: () => explorer.refresh()
  };
}

export function deactivate(): void {
  // Cleanup is handled by disposable subscriptions.
}
