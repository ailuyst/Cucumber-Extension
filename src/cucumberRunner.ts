import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { CucumberDiscovery } from './cucumberDiscovery';
import { LogPanel } from './logPanel';
import { CucumberDetailsPanel } from './detailsPanel';
import { formatScenarioDetails, formatStepDetails } from './detailsFormatter';
import { CucumberResultRegistry } from './resultRegistry';
import { buildCucumberArgs, buildCucumberCommand, splitCommand } from './commandBuilder';
import {
  buildNodeDiagnosticInvocation,
  buildSpawnInvocation,
  localCucumberBinPath,
  PROCESS_LAUNCHER_VERSION,
  SANITIZED_ENV_KEYS
} from './processLauncher';
import { noMatchedScenariosMessage } from './runResultPolicy';
import {
  DEFAULT_CONFIG_FILE,
  DEFAULT_FEATURE_GLOBS,
  DEFAULT_STEP_GLOBS,
  DEFAULT_SUPPORT_GLOBS,
  normalizeGlobSettings
} from './cucumberConfig';
import { canonicalizeRunGroups } from './pathCanonicalizer';
import { cucumberUriMatchesItemPath } from './pathMatcher';
import { formatFailureMessage } from './failureMessage';
import { attachBestEffortStdoutLogs } from './resultLogMapper';
import { isStaticHookItemId, orderedRuntimeChildren, runtimeHookItemId } from './runtimeHookItems';
import {
  CucumberRunResult,
  CucumberScenarioResult,
  CucumberStepResult,
  formatCucumberStepLabel,
  formatCucumberRunResult,
  orderScenarioStepsForExplorer,
  parseCucumberMessageReport,
  parseCucumberResult
} from './resultParser';

interface StepItemIndex {
  byLine: Map<number, vscode.TestItem[]>;
  byText: Map<string, vscode.TestItem[]>;
  ordered: vscode.TestItem[];
}

interface ResultItemIndex {
  scenarioByUriLine: Map<string, vscode.TestItem[]>;
  scenarioByUriName: Map<string, vscode.TestItem[]>;
  scenarioCandidates: vscode.TestItem[];
  exampleRowByParentLine: Map<string, Map<number, vscode.TestItem>>;
  stepsByParent: Map<string, StepItemIndex>;
}

interface LiveMessageReportMonitor {
  terminalItemIds: Set<string>;
  stop(): Promise<void>;
}

interface LiveGherkinScenarioInfo {
  id: string;
  name: string;
  uri?: string;
  line?: number;
}

interface LiveGherkinStepInfo {
  id: string;
  keyword?: string;
  text: string;
  uri?: string;
  line?: number;
}

interface LiveExampleRowInfo {
  id: string;
  line?: number;
  values: Record<string, string>;
}

interface LiveHookInfo {
  id: string;
  name?: string;
  tagExpression?: string;
  type?: string;
  uri?: string;
  line?: number;
}

interface LiveMessageState {
  scenarioByAstNodeId: Map<string, LiveGherkinScenarioInfo>;
  stepByAstNodeId: Map<string, LiveGherkinStepInfo>;
  exampleRowByAstNodeId: Map<string, LiveExampleRowInfo>;
  pickleById: Map<string, any>;
  testCaseById: Map<string, any>;
  testCaseStartedToCaseId: Map<string, string>;
  hookById: Map<string, LiveHookInfo>;
  attachments: any[];
  itemIndex: ResultItemIndex;
  terminalItemIds: Set<string>;
  startedParentIds: Set<string>;
  startedLeafIds: Set<string>;
  parentByStartedId: Map<string, vscode.TestItem>;
  usedStepItemsByParent: Map<string, Set<string>>;
  ordinaryStepIndexByStartedId: Map<string, number>;
  hookOrdinalCountsByStartedId: Map<string, Map<string, number>>;
  stepItemByStartedStep: Map<string, vscode.TestItem>;
}

export class CucumberRunner {
  private static readonly resultReportFormat = 'message';
  private static readonly defaultResultReportPath = '.cucumber-runner/cucumber-report.ndjson';
  private static readonly generatedDirName = '.cucumber-runner';
  private static readonly consoleCaptureFileName = 'console-capture.cjs';
  private lastRunReportPath?: string;
  private lastRunDetails = 'No Cucumber run has completed yet.';
  private readonly resultRegistry = new CucumberResultRegistry();

  constructor(
    private readonly discovery: CucumberDiscovery,
    private readonly logPanel: LogPanel,
    private readonly detailsPanel: CucumberDetailsPanel,
    private readonly controller: vscode.TestController
  ) {}

  public async runAll(): Promise<void> {
    const items = this.collectTopLevelItems();
    await this.runTargets([], 'Run all Cucumber tests', items);
  }

  public async runCurrentFeature(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a feature file to run the current feature.');
      return;
    }

    const uri = editor.document.uri;
    const feature = await this.discovery.findFeatureByUri(uri);
    if (!feature) {
      vscode.window.showErrorMessage('Unable to resolve current feature.');
      return;
    }

    const item = this.findTestItem((candidate) =>
      candidate.id.startsWith('feature:') && candidate.uri?.fsPath === uri.fsPath
    );
    await this.runTargets([uri.fsPath], `Run feature ${path.basename(uri.fsPath)}`, item ? [item] : []);
  }

  public async runCurrentScenario(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a feature file to run the current scenario.');
      return;
    }

    const uri = editor.document.uri;
    const position = editor.selection.active.line + 1;
    const scenario = await this.discovery.findScenarioAt(uri, position);
    if (!scenario) {
      vscode.window.showErrorMessage('No scenario found at the current cursor position.');
      return;
    }

    const item = this.findTestItem((candidate) =>
      (candidate.id.startsWith('scenario:') || candidate.id.startsWith('scenarioOutline:')) &&
      candidate.uri?.fsPath === uri.fsPath &&
      candidate.range?.start.line === scenario.line - 1
    );
    await this.runTargets([`${uri.fsPath}:${scenario.line}`], `Run scenario ${scenario.name}`, item ? [item] : []);
  }

  public async runRequest(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    const isRunAll = !request.include || request.include.length === 0;
    const items = isRunAll ? this.collectTopLevelItems() : request.include ?? [];
    const run = this.controller.createTestRun(request);
    items.forEach((item) => run.enqueued(item));

    const targets = isRunAll ? [] : this.collectTargets(items);
    if (targets.length === 0 && !isRunAll) {
      run.end();
      return;
    }

    await this.runTargets(targets, 'Run selected Cucumber tests', items, run, token);
  }

  public async debugRequest(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    const isRunAll = !request.include || request.include.length === 0;
    const items = isRunAll ? this.collectTopLevelItems() : request.include ?? [];
    const run = this.controller.createTestRun(request, 'Debug selected Cucumber tests');
    items.forEach((item) => run.enqueued(item));

    const targets = isRunAll ? [] : this.collectTargets(items);
    if (targets.length === 0 && !isRunAll) {
      run.end();
      return;
    }

    await this.debugTargets(targets, items, run, token);
  }

  public async openReport(): Promise<void> {
    if (!this.lastRunReportPath) {
      vscode.window.showInformationMessage('No report generated yet.');
      return;
    }

    const document = await vscode.workspace.openTextDocument(this.lastRunReportPath);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  public showLastRunDetails(): void {
    this.logPanel.clear();
    this.logPanel.appendLine(this.lastRunDetails);
    this.logPanel.show();
  }

  public async showItemDetails(item?: vscode.TestItem): Promise<void> {
    const details = await this.resolveItemDetails(item);
    this.detailsPanel.show(details.title, details.text);
  }

  public async copyItemDetails(item?: vscode.TestItem): Promise<void> {
    const details = await this.resolveItemDetails(item);
    await vscode.env.clipboard.writeText(details.text);
    vscode.window.showInformationMessage('Cucumber details copied to clipboard.');
  }

  public async revealItemSource(item?: vscode.TestItem): Promise<void> {
    const resolved = item ?? this.findActiveEditorItem();
    const details = this.resultRegistry.get(resolved?.id);
    const uri = resolved?.uri ?? (details?.uri ? vscode.Uri.file(details.uri) : undefined);
    const line = resolved?.range?.start.line ?? (details?.line ? details.line - 1 : undefined);

    if (!uri) {
      vscode.window.showInformationMessage('No source location is available for this Cucumber item.');
      return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    if (line !== undefined) {
      const position = new vscode.Position(Math.max(0, line), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  }

  private async runTargets(
    targets: string[],
    label: string,
    items: readonly vscode.TestItem[] = [],
    run?: vscode.TestRun,
    token?: vscode.CancellationToken
  ): Promise<void> {
    const selected = items;
    const actualRun = run ?? this.controller.createTestRun({ include: selected } as vscode.TestRunRequest, label);
    const runItems = this.flattenItems(selected);
    runItems.forEach((item) => {
      actualRun.enqueued(item);
      if (!this.isExecutionLeafItem(item)) {
        actualRun.started(item);
      }
    });

    const config = vscode.workspace.getConfiguration('cucumberRunner');
    const workspaceRoot = this.workspaceRootForItems(selected) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const configuredCwd = config.get<string>('cwd');
    const command = config.get<string>('command', 'npx cucumber-js');
    const format = CucumberRunner.resultReportFormat;
    const reportOutputPath = config.get<string>('reportOutputPath', CucumberRunner.defaultResultReportPath) || CucumberRunner.defaultResultReportPath;
    const timeoutMs = config.get<number>('timeoutMs', 120000);
    const groups = await canonicalizeRunGroups(this.groupTargetsByCwd([...new Set(targets)], configuredCwd, workspaceRoot));
    this.resultRegistry.clear();

    this.logPanel.clear();
    this.logPanel.show();

    try {
      for (const group of groups) {
        const cancelled = await this.executeCucumberGroup({
          command,
          targets: group.targets,
          cwd: group.cwd,
          format,
          reportOutputPath,
          timeoutMs,
          actualRun,
          runItems,
          token
        });
        if (cancelled) {
          break;
        }
      }
    } catch (error) {
      const message = `Cucumber run failed inside the extension: ${String(error)}`;
      this.logPanel.appendLine(message);
      const testMessage = new vscode.TestMessage(message);
      runItems.forEach((item) => actualRun.errored(item, testMessage));
    } finally {
      this.logPanel.appendLine('TestRun end called.');
      actualRun.end();
    }
  }

  private async debugTargets(
    targets: string[],
    items: readonly vscode.TestItem[] = [],
    run: vscode.TestRun,
    token?: vscode.CancellationToken
  ): Promise<void> {
    const runItems = this.flattenItems(items);
    runItems.forEach((item) => {
      run.enqueued(item);
      if (!this.isExecutionLeafItem(item)) {
        run.started(item);
      }
    });

    const config = vscode.workspace.getConfiguration('cucumberRunner');
    const workspaceRoot = this.workspaceRootForItems(items) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const configuredCwd = config.get<string>('cwd');
    const command = config.get<string>('command', 'npx cucumber-js');
    const [executable, ...configuredArgs] = splitCommand(command);
    const reportOutputPath = config.get<string>('reportOutputPath', CucumberRunner.defaultResultReportPath) || CucumberRunner.defaultResultReportPath;
    const groups = await canonicalizeRunGroups(this.groupTargetsByCwd([...new Set(targets)], configuredCwd, workspaceRoot));
    this.resultRegistry.clear();

    this.logPanel.clear();
    this.logPanel.show();

    for (const group of groups) {
      if (token?.isCancellationRequested) {
        runItems.forEach((item) => run.skipped(item));
        break;
      }

      const cancelled = await this.debugCucumberGroup({
        executable,
        configuredArgs,
        targets: group.targets,
        cwd: group.cwd,
        reportOutputPath,
        actualRun: run,
        runItems,
        token
      });
      if (cancelled) {
        break;
      }
    }

    run.end();
  }

  private async executeCucumberGroup(options: {
    command: string;
    targets: string[];
    cwd: string;
    format: string;
    reportOutputPath: string;
    timeoutMs: number;
    actualRun: vscode.TestRun;
    runItems: readonly vscode.TestItem[];
    token?: vscode.CancellationToken;
  }): Promise<boolean> {
    const groupRunItems = this.filterRunItemsForTargets(options.runItems, options.targets);
    await this.logWorkspaceDiagnostics(options.cwd, groupRunItems);
    const configOverride = await this.createGeneratedConfigIfNeeded(options.cwd, options.targets);
    if (options.format === 'message' && options.reportOutputPath) {
      this.lastRunReportPath = path.isAbsolute(options.reportOutputPath)
        ? options.reportOutputPath
        : path.join(options.cwd, options.reportOutputPath);
    } else if (options.format === 'json' && options.reportOutputPath) {
      this.lastRunReportPath = path.isAbsolute(options.reportOutputPath)
        ? options.reportOutputPath
        : path.join(options.cwd, options.reportOutputPath);
    }

    if (options.format === 'message' && this.lastRunReportPath) {
      this.logPanel.appendLine(`Report path: ${this.lastRunReportPath}`);
      await fs.unlink(this.lastRunReportPath).catch(() => undefined);
      await this.ensureReportDirectory(this.lastRunReportPath);
    }

    const builtCommand = buildCucumberCommand({
      command: options.command,
      cwd: options.cwd,
      targets: options.targets,
      format: options.format,
      reportOutputPath: options.reportOutputPath,
      configFileOverride: configOverride
    });
    this.logRunCommand(options.cwd, builtCommand.executable, builtCommand.args, builtCommand.displayCommand, options.targets, groupRunItems);
    const validationError = await this.validateSpawnOptions(options.cwd, builtCommand.executable, builtCommand.args, configOverride);
    if (validationError) {
      this.logPanel.appendLine(validationError);
      const testMessage = new vscode.TestMessage(validationError);
      groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
      return false;
    }

    try {
      await fs.access(options.cwd);
    } catch (error) {
      const message = `Unable to access Cucumber working directory ${options.cwd}: ${String(error)}`;
      this.logPanel.appendLine(message);
      const testMessage = new vscode.TestMessage(message);
      groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
      return false;
    }

    const invocation = buildSpawnInvocation({
      executable: builtCommand.executable,
      args: builtCommand.args,
      cwd: options.cwd
    });
    const diagnosticsVerbose = this.diagnosticsVerbose();
    if (diagnosticsVerbose) {
      this.logSpawnOptions(builtCommand.executable, builtCommand.args, options.cwd, invocation);
    }
    await this.runNodeDiagnosticIfNeeded(invocation, options.cwd, diagnosticsVerbose);
    const liveMonitor = this.lastRunReportPath
      ? this.startMessageReportStreaming(this.lastRunReportPath, options.cwd, options.actualRun, groupRunItems)
      : undefined;

    return new Promise<boolean>((resolve) => {
      const child = spawn(invocation.executable, invocation.args, invocation.options);

      let settled = false;
      let cancelled = false;
      let timedOut = false;
      let stdout = '';
      let stderr = '';
      let forceResolveTimer: NodeJS.Timeout | undefined;
      const finish = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutTimer);
        if (forceResolveTimer) {
          clearTimeout(forceResolveTimer);
        }
        cancellation?.dispose();
        resolve(value);
      };
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        const message = `Cucumber run timed out after ${options.timeoutMs} ms`;
        this.logPanel.appendLine(message);
        const testMessage = new vscode.TestMessage(message);
        groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
        child.kill();
        forceResolveTimer = setTimeout(() => finish(false), 2000);
      }, options.timeoutMs);
      const cancellation = options.token?.onCancellationRequested(() => {
        cancelled = true;
        this.logPanel.appendLine('Cucumber run was cancelled.');
        child.kill();
      });

      if (diagnosticsVerbose) {
        this.logPanel.appendLine(`Process started: ${child.pid ? 'yes' : 'unknown'}`);
        this.logPanel.appendLine(`Process pid: ${child.pid ?? '<unknown>'}`);
      }

      child.stdout?.on('data', (chunk) => {
        const message = chunk.toString();
        stdout += message;
        this.logPanel.append(message);
        options.actualRun.appendOutput(message);
      });

      child.stderr?.on('data', (chunk) => {
        const message = chunk.toString();
        stderr += message;
        this.logPanel.append(message);
        options.actualRun.appendOutput(message);
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        const message = this.cucumberCliNotFoundMessage(error);
        this.logPanel.appendLine(message);
        const testMessage = new vscode.TestMessage(message);
        groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
        void liveMonitor?.stop().finally(() => finish(false));
        if (!liveMonitor) {
          finish(false);
        }
      });

      child.on('close', (exitCode, signal) => {
        void (liveMonitor?.stop() ?? Promise.resolve()).then(() => this.handleProcessClose({
          exitCode,
          signal,
          timedOut,
          cancelled,
          stdout,
          stderr,
          format: options.format,
          cwd: options.cwd,
          actualRun: options.actualRun,
          groupRunItems,
          targets: options.targets,
          liveTerminalItemIds: liveMonitor?.terminalItemIds
        })).then((wasCancelled) => finish(wasCancelled), (error) => {
          const message = `Cucumber close handler failed: ${String(error)}`;
          this.logPanel.appendLine(message);
          const testMessage = new vscode.TestMessage(message);
          groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
          finish(false);
        });
      });
    });
  }

  private async runNodeDiagnosticIfNeeded(
    invocation: ReturnType<typeof buildSpawnInvocation>,
    cwd: string,
    diagnosticsVerbose: boolean
  ): Promise<void> {
    if (!diagnosticsVerbose || invocation.mode !== 'local-cucumber-node') {
      return;
    }

    const diagnostic = buildNodeDiagnosticInvocation(cwd, process.platform, { nodeExecutable: invocation.executable });
    this.logPanel.appendLine('--- node diagnostic ---');
    this.logPanel.appendLine(`Diagnostic spawn executable: ${diagnostic.executable}`);
    this.logPanel.appendLine(`Diagnostic spawn args: ${JSON.stringify(diagnostic.args)}`);

    await new Promise<void>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (stdout.trim()) {
          this.logPanel.appendLine('Diagnostic stdout:');
          this.logPanel.appendLine(stdout.trim());
        }
        if (stderr.trim()) {
          this.logPanel.appendLine('Diagnostic stderr:');
          this.logPanel.appendLine(stderr.trim());
        }
        resolve();
      };
      let timeout: NodeJS.Timeout;
      const child = spawn(diagnostic.executable, diagnostic.args, diagnostic.options);
      timeout = setTimeout(() => {
        this.logPanel.appendLine('Node diagnostic timed out after 10000 ms.');
        child.kill();
        finish();
      }, 10000);

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        this.logPanel.appendLine(`Node diagnostic failed: ${String(error)}`);
        finish();
      });
      child.on('close', (code, signal) => {
        this.logPanel.appendLine(`Node diagnostic close code: ${code}`);
        this.logPanel.appendLine(`Node diagnostic close signal: ${signal ?? '<none>'}`);
        finish();
      });
    });
  }

  private startMessageReportStreaming(
    reportPath: string,
    cwd: string,
    run: vscode.TestRun,
    runItems: readonly vscode.TestItem[]
  ): LiveMessageReportMonitor {
    const state: LiveMessageState = {
      scenarioByAstNodeId: new Map(),
      stepByAstNodeId: new Map(),
      exampleRowByAstNodeId: new Map(),
      pickleById: new Map(),
      testCaseById: new Map(),
      testCaseStartedToCaseId: new Map(),
      hookById: new Map(),
      attachments: [],
      itemIndex: this.buildResultItemIndex(),
      terminalItemIds: new Set(),
      startedParentIds: new Set(),
      startedLeafIds: new Set(),
      parentByStartedId: new Map(),
      usedStepItemsByParent: new Map(),
      ordinaryStepIndexByStartedId: new Map(),
      hookOrdinalCountsByStartedId: new Map(),
      stepItemByStartedStep: new Map()
    };
    let processedOffset = 0;
    let pendingLine = '';
    let disposed = false;
    let timer: NodeJS.Timeout | undefined;

    const processAvailableLines = async () => {
      const content = await fs.readFile(reportPath, 'utf8');
      if (content.length < processedOffset) {
        processedOffset = 0;
        pendingLine = '';
      }
      const chunk = content.slice(processedOffset);
      processedOffset = content.length;
      if (!chunk) {
        return;
      }
      const combined = pendingLine + chunk;
      const lines = combined.split(/\r?\n/);
      pendingLine = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          this.handleLiveEnvelope(JSON.parse(line), cwd, run, state);
        } catch {
          // Ignore transient malformed lines. Final batch parsing reports durable parse failures.
        }
      }
    };

    const tick = async () => {
      if (disposed) {
        return;
      }
      try {
        await processAvailableLines();
      } catch {
        // The message report may not exist yet. Final batch parse remains the fallback.
      } finally {
        if (!disposed) {
          timer = setTimeout(tick, 200);
        }
      }
    };

    timer = setTimeout(tick, 100);
    return {
      terminalItemIds: state.terminalItemIds,
      stop: async () => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        try {
          await processAvailableLines();
          if (pendingLine.trim()) {
            this.handleLiveEnvelope(JSON.parse(pendingLine), cwd, run, state);
            pendingLine = '';
          }
        } catch {
          // Final batch parse remains the durable fallback.
        }
        disposed = true;
        runItems.forEach((item) => {
          if (this.isExecutionLeafItem(item) && !state.terminalItemIds.has(item.id) && state.startedLeafIds.has(item.id)) {
            run.skipped(item);
            state.terminalItemIds.add(item.id);
          }
        });
      }
    };
  }

  private handleLiveEnvelope(envelope: any, cwd: string, run: vscode.TestRun, state: LiveMessageState): void {
    if (envelope.gherkinDocument) {
      this.indexLiveGherkinDocument(envelope.gherkinDocument, cwd, state);
    }
    if (envelope.pickle) {
      state.pickleById.set(envelope.pickle.id, envelope.pickle);
    }
    if (envelope.testCase) {
      state.testCaseById.set(envelope.testCase.id, envelope.testCase);
    }
    if (envelope.hook) {
      state.hookById.set(envelope.hook.id, this.toLiveHookInfo(envelope.hook, cwd));
    }
    if (envelope.attachment) {
      state.attachments.push(envelope.attachment);
    }
    if (envelope.testCaseStarted) {
      state.testCaseStartedToCaseId.set(envelope.testCaseStarted.id, envelope.testCaseStarted.testCaseId);
      const parent = this.liveParentForStarted(envelope.testCaseStarted.id, cwd, state);
      if (parent) {
        state.parentByStartedId.set(envelope.testCaseStarted.id, parent);
        this.startLiveParentOnly(run, parent, state);
      }
    }
    if (envelope.testStepStarted) {
      this.handleLiveTestStepStarted(envelope.testStepStarted, cwd, run, state);
    }
    if (envelope.testStepFinished) {
      this.handleLiveTestStepFinished(envelope.testStepFinished, cwd, run, state);
    }
  }

  private handleLiveTestStepStarted(started: any, cwd: string, run: vscode.TestRun, state: LiveMessageState): void {
    const parent = state.parentByStartedId.get(started.testCaseStartedId) ?? this.liveParentForStarted(started.testCaseStartedId, cwd, state);
    if (!parent) {
      return;
    }
    state.parentByStartedId.set(started.testCaseStartedId, parent);
    this.startLiveParent(run, parent, state);
    const stepItem = this.liveStepItemForTestStep(started.testCaseStartedId, started.testStepId, cwd, parent, state);
    if (stepItem && !state.terminalItemIds.has(stepItem.id) && !state.startedLeafIds.has(stepItem.id)) {
      run.started(stepItem);
      state.startedLeafIds.add(stepItem.id);
    }
  }

  private handleLiveTestStepFinished(finished: any, cwd: string, run: vscode.TestRun, state: LiveMessageState): void {
    const parent = state.parentByStartedId.get(finished.testCaseStartedId) ?? this.liveParentForStarted(finished.testCaseStartedId, cwd, state);
    if (!parent) {
      return;
    }
    state.parentByStartedId.set(finished.testCaseStartedId, parent);
    this.startLiveParent(run, parent, state);
    const stepItem = state.stepItemByStartedStep.get(this.liveStepKey(finished.testCaseStartedId, finished.testStepId)) ??
      this.liveStepItemForTestStep(finished.testCaseStartedId, finished.testStepId, cwd, parent, state);
    const step = this.liveStepResultForTestStep(finished.testCaseStartedId, finished.testStepId, cwd, state, finished.testStepResult);
    if (!stepItem || !step || state.terminalItemIds.has(stepItem.id)) {
      return;
    }
    this.applyStepStatus(run, stepItem, step, new Map(), !state.startedLeafIds.has(stepItem.id));
    state.startedLeafIds.add(stepItem.id);
    state.terminalItemIds.add(stepItem.id);
  }

  private indexLiveGherkinDocument(document: any, cwd: string, state: LiveMessageState): void {
    const uri = this.liveResolveUri(document.uri, cwd);
    const visitChildren = (children: any[] | undefined) => {
      for (const child of children ?? []) {
        if (child.scenario) {
          const scenario = child.scenario;
          state.scenarioByAstNodeId.set(scenario.id, {
            id: scenario.id,
            name: scenario.name,
            uri,
            line: scenario.location?.line
          });
          for (const step of scenario.steps ?? []) {
            state.stepByAstNodeId.set(step.id, {
              id: step.id,
              keyword: step.keyword,
              text: step.text,
              uri,
              line: step.location?.line
            });
          }
          for (const examples of scenario.examples ?? []) {
            const headers = examples.tableHeader?.cells?.map((cell: any) => cell.value) ?? [];
            for (const row of examples.tableBody ?? []) {
              const values: Record<string, string> = {};
              row.cells?.forEach((cell: any, index: number) => {
                values[headers[index] ?? `column${index + 1}`] = cell.value;
              });
              state.exampleRowByAstNodeId.set(row.id, {
                id: row.id,
                line: row.location?.line,
                values
              });
            }
          }
        }
        if (child.rule) {
          visitChildren(child.rule.children);
        }
      }
    };
    visitChildren(document.feature?.children);
  }

  private liveParentForStarted(testCaseStartedId: string, cwd: string, state: LiveMessageState): vscode.TestItem | undefined {
    const scenario = this.liveScenarioForStarted(testCaseStartedId, cwd, state);
    if (!scenario) {
      return undefined;
    }
    const scenarioItem = this.findScenarioItemInIndex(state.itemIndex, scenario);
    if (!scenarioItem) {
      return undefined;
    }
    return scenario.exampleLine
      ? this.findExampleRowItemInIndex(state.itemIndex, scenarioItem, scenario) ?? scenarioItem
      : scenarioItem;
  }

  private liveScenarioForStarted(testCaseStartedId: string, cwd: string, state: LiveMessageState): CucumberScenarioResult | undefined {
    const testCaseId = state.testCaseStartedToCaseId.get(testCaseStartedId);
    const testCase = testCaseId ? state.testCaseById.get(testCaseId) : undefined;
    const pickle = testCase ? state.pickleById.get(testCase.pickleId) : undefined;
    if (!testCase || !pickle) {
      return undefined;
    }
    const scenarioInfo = this.liveScenarioInfoForPickle(pickle, state);
    const exampleInfo = this.liveExampleInfoForPickle(pickle, state);
    return {
      id: pickle.id,
      name: scenarioInfo?.name ?? pickle.name,
      uri: scenarioInfo?.uri ?? this.liveResolveUri(pickle.uri, cwd),
      line: scenarioInfo?.line,
      exampleLine: exampleInfo?.line,
      exampleValues: exampleInfo?.values,
      status: 'unknown',
      steps: []
    };
  }

  private liveStepItemForTestStep(
    testCaseStartedId: string,
    testStepId: string,
    cwd: string,
    parent: vscode.TestItem,
    state: LiveMessageState
  ): vscode.TestItem | undefined {
    const key = this.liveStepKey(testCaseStartedId, testStepId);
    const cached = state.stepItemByStartedStep.get(key);
    if (cached) {
      return cached;
    }
    const step = this.liveStepResultForTestStep(testCaseStartedId, testStepId, cwd, state);
    const scenario = this.liveScenarioForStarted(testCaseStartedId, cwd, state);
    if (!step || !scenario) {
      return undefined;
    }

    const item = step.kind === 'hook'
      ? this.findOrCreateHookItem(
        parent,
        step,
        this.liveHookExecutionIndex(testCaseStartedId, step, state),
        this.liveHookOrdinal(testCaseStartedId, step, state)
      )
      : this.findStepItemInIndex(
        state.itemIndex,
        parent,
        step,
        scenario,
        this.liveOrdinaryStepIndex(testCaseStartedId, state),
        this.liveUsedStepItems(parent, state)
      );
    if (item) {
      state.stepItemByStartedStep.set(key, item);
      this.liveUsedStepItems(parent, state).add(item.id);
    }
    return item;
  }

  private liveStepResultForTestStep(
    testCaseStartedId: string,
    testStepId: string,
    cwd: string,
    state: LiveMessageState,
    testStepResult?: any
  ): CucumberStepResult | undefined {
    const testCaseId = state.testCaseStartedToCaseId.get(testCaseStartedId);
    const testCase = testCaseId ? state.testCaseById.get(testCaseId) : undefined;
    const pickle = testCase ? state.pickleById.get(testCase.pickleId) : undefined;
    const testStep = testCase?.testSteps?.find((candidate: any) => candidate.id === testStepId);
    if (!testCase || !pickle || !testStep) {
      return undefined;
    }
    const logs = this.liveLogsForAttachments(state.attachments, testCaseStartedId, testStepId);
    const error = this.liveExtractError(testStepResult);

    if (testStep.hookId) {
      const hook = state.hookById.get(testStep.hookId);
      const label = this.liveHookLabel(hook);
      return {
        id: testStep.id,
        kind: 'hook',
        hookId: testStep.hookId,
        hookType: hook?.type,
        keyword: label.keyword,
        text: label.text,
        uri: hook?.uri,
        line: hook?.line,
        status: this.liveNormalizeStepStatus(testStepResult?.status),
        durationMs: this.liveDurationToMs(testStepResult?.duration),
        errorMessage: error.message,
        stackTrace: error.stackTrace,
        logs: logs.length > 0 ? logs : undefined
      };
    }

    const pickleStep = (pickle.steps ?? []).find((step: any) => step.id === testStep.pickleStepId);
    const stepInfo = this.liveStepInfoForPickleStep(pickleStep, state);
    return {
      id: testStep.pickleStepId,
      kind: 'step',
      text: pickleStep?.text ?? stepInfo?.text ?? testStep.pickleStepId,
      keyword: stepInfo?.keyword,
      uri: stepInfo?.uri,
      line: stepInfo?.line,
      status: this.liveNormalizeStepStatus(testStepResult?.status),
      durationMs: this.liveDurationToMs(testStepResult?.duration),
      errorMessage: error.message,
      stackTrace: error.stackTrace,
      logs: logs.length > 0 ? logs : undefined
    };
  }

  private startLiveParent(run: vscode.TestRun, parent: vscode.TestItem, state: LiveMessageState): void {
    this.startLiveParentOnly(run, parent, state);
    for (const child of this.childItems(parent)) {
      if (this.isExecutionLeafItem(child) && !state.terminalItemIds.has(child.id) && !state.startedLeafIds.has(child.id)) {
        run.started(child);
        state.startedLeafIds.add(child.id);
      }
    }
  }

  private startLiveParentOnly(run: vscode.TestRun, parent: vscode.TestItem, state: LiveMessageState): void {
    if (!state.startedParentIds.has(parent.id)) {
      run.started(parent);
      state.startedParentIds.add(parent.id);
    }
  }

  private liveUsedStepItems(parent: vscode.TestItem, state: LiveMessageState): Set<string> {
    const used = state.usedStepItemsByParent.get(parent.id) ?? new Set<string>();
    state.usedStepItemsByParent.set(parent.id, used);
    return used;
  }

  private liveOrdinaryStepIndex(testCaseStartedId: string, state: LiveMessageState): number {
    const current = state.ordinaryStepIndexByStartedId.get(testCaseStartedId) ?? 0;
    state.ordinaryStepIndexByStartedId.set(testCaseStartedId, current + 1);
    return current;
  }

  private liveHookOrdinal(testCaseStartedId: string, step: CucumberStepResult, state: LiveMessageState): number {
    const counts = state.hookOrdinalCountsByStartedId.get(testCaseStartedId) ?? new Map<string, number>();
    state.hookOrdinalCountsByStartedId.set(testCaseStartedId, counts);
    const key = `${step.hookType ?? ''}:${formatCucumberStepLabel(step)}`;
    const current = counts.get(key) ?? 0;
    counts.set(key, current + 1);
    return current;
  }

  private liveHookExecutionIndex(testCaseStartedId: string, step: CucumberStepResult, state: LiveMessageState): number {
    const testCaseId = state.testCaseStartedToCaseId.get(testCaseStartedId);
    const testCase = testCaseId ? state.testCaseById.get(testCaseId) : undefined;
    return Math.max(0, testCase?.testSteps?.findIndex((candidate: any) => candidate.id === step.id) ?? 0);
  }

  private liveStepKey(testCaseStartedId: string, testStepId: string): string {
    return `${testCaseStartedId}:${testStepId}`;
  }

  private liveScenarioInfoForPickle(pickle: any, state: LiveMessageState): LiveGherkinScenarioInfo | undefined {
    for (const astNodeId of pickle.astNodeIds ?? []) {
      const scenario = state.scenarioByAstNodeId.get(astNodeId);
      if (scenario) {
        return scenario;
      }
    }
    return undefined;
  }

  private liveExampleInfoForPickle(pickle: any, state: LiveMessageState): LiveExampleRowInfo | undefined {
    for (const astNodeId of pickle.astNodeIds ?? []) {
      const row = state.exampleRowByAstNodeId.get(astNodeId);
      if (row) {
        return row;
      }
    }
    return undefined;
  }

  private liveStepInfoForPickleStep(pickleStep: any, state: LiveMessageState): LiveGherkinStepInfo | undefined {
    for (const astNodeId of pickleStep?.astNodeIds ?? []) {
      const step = state.stepByAstNodeId.get(astNodeId);
      if (step) {
        return step;
      }
    }
    return undefined;
  }

  private toLiveHookInfo(hook: any, cwd: string): LiveHookInfo {
    return {
      id: hook.id,
      name: hook.name,
      tagExpression: hook.tagExpression,
      type: hook.type,
      uri: this.liveResolveUri(hook.sourceReference?.uri, cwd),
      line: hook.sourceReference?.location?.line
    };
  }

  private liveHookLabel(hook: LiveHookInfo | undefined): { keyword: string; text: string } {
    const keyword = this.liveHookKeyword(hook?.type);
    return {
      keyword,
      text: hook?.name || hook?.tagExpression || 'hook'
    };
  }

  private liveHookKeyword(type: string | undefined): string {
    switch (type) {
      case 'BEFORE_TEST_CASE':
        return 'Before ';
      case 'AFTER_TEST_CASE':
        return 'After ';
      case 'BEFORE_TEST_STEP':
        return 'BeforeStep ';
      case 'AFTER_TEST_STEP':
        return 'AfterStep ';
      case 'BEFORE_TEST_RUN':
        return 'BeforeAll ';
      case 'AFTER_TEST_RUN':
        return 'AfterAll ';
      default:
        return 'Hook ';
    }
  }

  private liveNormalizeStepStatus(status: string | undefined): CucumberStepResult['status'] {
    switch ((status ?? '').toLowerCase()) {
      case 'passed':
        return 'passed';
      case 'failed':
      case 'ambiguous':
        return 'failed';
      case 'skipped':
        return 'skipped';
      case 'pending':
        return 'pending';
      case 'undefined':
        return 'undefined';
      default:
        return 'unknown';
    }
  }

  private liveDurationToMs(duration: any): number | undefined {
    if (!duration) {
      return undefined;
    }
    const seconds = Number(duration.seconds ?? 0);
    const nanos = Number(duration.nanos ?? 0);
    return Math.round(seconds * 1000 + nanos / 1_000_000);
  }

  private liveExtractError(testStepResult: any): { message?: string; stackTrace?: string } {
    const exception = testStepResult?.exception;
    return {
      message: exception?.message ?? testStepResult?.message,
      stackTrace: exception?.stackTrace
    };
  }

  private liveLogsForAttachments(attachments: any[], testCaseStartedId: string, testStepId: string): string[] {
    return attachments
      .filter((attachment) => attachment.testCaseStartedId === testCaseStartedId && attachment.testStepId === testStepId)
      .map((attachment) => this.liveAttachmentText(attachment))
      .filter((value): value is string => !!value);
  }

  private liveAttachmentText(attachment: any): string | undefined {
    if (!attachment.body) {
      return undefined;
    }
    if (attachment.contentEncoding === 'BASE64') {
      return Buffer.from(attachment.body, 'base64').toString('utf8');
    }
    return attachment.body;
  }

  private liveResolveUri(uri: string | undefined, cwd: string): string | undefined {
    if (!uri) {
      return undefined;
    }
    return path.isAbsolute(uri) ? path.normalize(uri) : path.normalize(path.join(cwd, uri));
  }

  private async handleProcessClose(options: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    cancelled: boolean;
    stdout: string;
    stderr: string;
    format: string;
    cwd: string;
    actualRun: vscode.TestRun;
    groupRunItems: vscode.TestItem[];
    targets: string[];
    liveTerminalItemIds?: Set<string>;
  }): Promise<boolean> {
    if (this.diagnosticsVerbose() || options.exitCode !== 0 || options.signal) {
      this.logPanel.appendLine(`Process close code: ${options.exitCode}`);
      this.logPanel.appendLine(`Process close signal: ${options.signal ?? '<none>'}`);
    }

    if (options.timedOut) {
      return false;
    }

    if (options.cancelled) {
      options.groupRunItems.forEach((item) => options.actualRun.skipped(item));
      return true;
    }

    const cliNotFound = this.cucumberCliNotFoundFromOutput(options.stdout, options.stderr);
    if (cliNotFound) {
      this.lastRunDetails = cliNotFound;
      const testMessage = new vscode.TestMessage(cliNotFound);
      options.groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
      this.logPanel.appendLine(cliNotFound);
      return false;
    }

    const structured = await this.tryParseStructuredResult(options.format, options.stdout, options.stderr, options.cwd);
    if (structured.result) {
      const resultWithLogs = this.resultWithBestEffortStdoutLogs(structured.result, options.stdout);
      this.lastRunDetails = formatCucumberRunResult(resultWithLogs);
      this.logPanel.appendLine('');
      this.logPanel.appendLine(this.lastRunDetails);
      this.applyStructuredResults(options.actualRun, options.groupRunItems, resultWithLogs, {
        stdout: options.stdout,
        stderr: options.stderr
      }, {
        terminalItemIds: options.liveTerminalItemIds
      });
    } else if ((structured.empty || structured.error) && options.targets.length > 0) {
      const message = structured.error ?? noMatchedScenariosMessage(options.targets, options.cwd);
      this.lastRunDetails = message;
      this.logPanel.appendLine(message);
      const testMessage = new vscode.TestMessage(message);
      options.groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
    } else if ((structured.empty || structured.error) && options.exitCode === 0) {
      const message = structured.error ?? 'Cucumber message report did not contain scenario results.';
      this.lastRunDetails = message;
      this.logPanel.appendLine(message);
      const testMessage = new vscode.TestMessage(message);
      options.groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
    } else {
      const result = parseCucumberResult(options.exitCode ?? 1, options.stdout, options.stderr);
      const message = this.withExecutionHints(result.message, options.stdout, options.stderr);
      const testMessage = new vscode.TestMessage(message);
      this.lastRunDetails = message;
      const markPassed = result.status === 'passed';
      options.groupRunItems.forEach((item) => {
        if (markPassed) {
          options.actualRun.passed(item);
        } else {
          options.actualRun.failed(item, testMessage);
        }
      });
    }
    if (options.exitCode !== 0) {
      this.logPanel.appendLine(`Cucumber exited with code ${options.exitCode}.`);
      const hint = this.undefinedStepsHint(options.stdout, options.stderr);
      if (hint) {
        this.logPanel.appendLine(hint);
      }
      const playwrightHint = this.playwrightHint(options.stdout, options.stderr);
      if (playwrightHint) {
        this.logPanel.appendLine(playwrightHint);
      }
    }
    return false;
  }

  private async debugCucumberGroup(options: {
    executable: string;
    configuredArgs: string[];
    targets: string[];
    cwd: string;
    reportOutputPath: string;
    actualRun: vscode.TestRun;
    runItems: readonly vscode.TestItem[];
    token?: vscode.CancellationToken;
  }): Promise<boolean> {
    const groupRunItems = this.filterRunItemsForTargets(options.runItems, options.targets);
    await this.logWorkspaceDiagnostics(options.cwd, groupRunItems);
    const configOverride = await this.createGeneratedConfigIfNeeded(options.cwd, options.targets);
    const reportPath = path.isAbsolute(options.reportOutputPath)
      ? options.reportOutputPath
      : path.join(options.cwd, options.reportOutputPath);
    this.lastRunReportPath = reportPath;
    this.logPanel.appendLine(`Report path: ${reportPath}`);

    try {
      await fs.access(options.cwd);
    } catch (error) {
      const message = `Unable to access Cucumber working directory ${options.cwd}: ${String(error)}`;
      this.logPanel.appendLine(message);
      const testMessage = new vscode.TestMessage(message);
      groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
      return false;
    }

    await fs.unlink(reportPath).catch(() => undefined);
    await this.ensureReportDirectory(reportPath);

    const resolved = await this.resolveCucumberDebugProgram(options.cwd, options.executable, options.configuredArgs);
    if (!resolved) {
      const message = [
        'Unable to start Cucumber debug session.',
        'Debug requires a project-local @cucumber/cucumber installation or a command like "npx cucumber-js --config cucumber.cjs".',
        `Current command: ${[options.executable, ...options.configuredArgs].join(' ')}`
      ].join('\n');
      this.logPanel.appendLine(message);
      vscode.window.showErrorMessage('Unable to start Cucumber debug session. Check Cucumber Runner output for details.');
      const testMessage = new vscode.TestMessage(message);
      groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
      return false;
    }

    const cucumberArgs = buildCucumberArgs({
      executable: 'cucumber-js',
      configuredArgs: resolved.args,
      cwd: options.cwd,
      targets: options.targets,
      format: 'message',
      reportOutputPath: options.reportOutputPath,
      configFileOverride: configOverride
    });
    const sessionName = `Debug Cucumber ${Date.now()}`;
    const debugConfig: vscode.DebugConfiguration = {
      type: 'node',
      request: 'launch',
      name: sessionName,
      runtimeExecutable: 'node',
      program: resolved.program,
      args: cucumberArgs,
      cwd: options.cwd,
      console: 'internalConsole',
      internalConsoleOptions: 'openOnSessionStart',
      outputCapture: 'std',
      stopOnEntry: false,
      sourceMaps: true,
      smartStep: true,
      skipFiles: [
        '<node_internals>/**',
        this.debugGlob(options.cwd, 'node_modules', '**'),
        this.debugGlob(options.cwd, '.cucumber-runner', '**')
      ]
    };

    this.logPanel.appendLine(`Debugging in ${options.cwd}: node ${[resolved.program, ...cucumberArgs].join(' ')}`);
    this.logPanel.appendLine('Debug stdout/stderr is captured from the VS Code debug session. Structured results are read from the Cucumber message report.');
    const liveMonitor = this.startMessageReportStreaming(reportPath, options.cwd, options.actualRun, groupRunItems);

    const debugDiagnostics = this.diagnosticsVerbose();
    let debugStdout = '';
    let debugStderr = '';
    const ignoredDebugOutputCategories = new Set<string>();
    const debugOutputCategoryCounts = new Map<string, number>();
    const debugOutputSamples: string[] = [];
    let debugOutputEventCount = 0;
    let debugTrackerCreateCalled = false;
    let debugTrackerMatchedSession = false;
    const debugOutputTracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker: (session) => {
        debugTrackerCreateCalled = true;
        if (debugDiagnostics) {
          this.logPanel.appendLine(
            `Debug tracker saw session: name=${session.name}, type=${session.type}, configType=${String(session.configuration.type)}`
          );
        }
        if (session.name !== sessionName) {
          return undefined;
        }
        debugTrackerMatchedSession = true;

        return {
          onDidSendMessage: (message: unknown) => {
            const output = this.debugOutputFromMessage(message);
            if (!output) {
              return;
            }
            debugOutputEventCount += 1;
            const category = output.category ?? '<undefined>';
            debugOutputCategoryCounts.set(category, (debugOutputCategoryCounts.get(category) ?? 0) + 1);
            if (debugOutputSamples.length < 3) {
              debugOutputSamples.push(`${category}: ${this.truncateForLog(output.text.replace(/\r?\n/g, '\\n'))}`);
            }
            if (output.category === 'stderr') {
              debugStderr += output.text;
            } else if (output.category === 'stdout' || output.category === undefined) {
              debugStdout += output.text;
            } else if (!ignoredDebugOutputCategories.has(output.category)) {
              ignoredDebugOutputCategories.add(output.category);
              if (debugDiagnostics) {
                this.logPanel.appendLine(`Ignored debug output category: ${output.category}`);
              }
            }
          }
        };
      }
    });

    const debugStarted = await this.startAndWaitForDebugSession(debugConfig, options.cwd, options.token, debugDiagnostics).finally(() => {
      debugOutputTracker.dispose();
    });
    if (debugDiagnostics) {
      this.logDebugOutputDiagnostics({
        debugStdout,
        debugStderr,
        categoryCounts: debugOutputCategoryCounts,
        samples: debugOutputSamples,
        eventCount: debugOutputEventCount,
        trackerCreateCalled: debugTrackerCreateCalled,
        trackerMatchedSession: debugTrackerMatchedSession
      });
    }
    if (!debugStarted.started) {
      await liveMonitor.stop();
      const message = debugStarted.error ?? 'VS Code did not start the Cucumber debug session.';
      this.logPanel.appendLine(message);
      vscode.window.showErrorMessage(message);
      const testMessage = new vscode.TestMessage(message);
      groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
      return false;
    }

    if (debugStarted.cancelled) {
      await liveMonitor.stop();
      groupRunItems.forEach((item) => options.actualRun.skipped(item));
      return true;
    }

    await liveMonitor.stop();
    const structured = await this.tryParseStructuredResult('message', debugStdout, debugStderr, options.cwd);
    if (structured.result) {
      const resultWithLogs = this.resultWithBestEffortStdoutLogs(structured.result, debugStdout);
      this.lastRunDetails = formatCucumberRunResult(resultWithLogs);
      this.logPanel.appendLine('');
      this.logPanel.appendLine(this.lastRunDetails);
      this.applyStructuredResults(options.actualRun, groupRunItems, resultWithLogs, {
        stdout: debugStdout,
        stderr: debugStderr
      }, {
        terminalItemIds: liveMonitor.terminalItemIds
      });
    } else if ((structured.empty || structured.error) && options.targets.length > 0) {
      const message = structured.error ?? noMatchedScenariosMessage(options.targets, options.cwd);
      this.logPanel.appendLine(message);
      const testMessage = new vscode.TestMessage(message);
      groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
    } else {
      const message = 'Cucumber debug session completed, but no structured message report was available. Check the integrated terminal output.';
      this.logPanel.appendLine(message);
      const testMessage = new vscode.TestMessage(message);
      groupRunItems.forEach((item) => options.actualRun.errored(item, testMessage));
    }

    return false;
  }

  private logDebugOutputDiagnostics(options: {
    debugStdout: string;
    debugStderr: string;
    categoryCounts: Map<string, number>;
    samples: string[];
    eventCount: number;
    trackerCreateCalled: boolean;
    trackerMatchedSession: boolean;
  }): void {
    this.logPanel.appendLine('--- debug output diagnostics ---');
    this.logPanel.appendLine(`Debug tracker create called: ${options.trackerCreateCalled}`);
    this.logPanel.appendLine(`Debug tracker matched session: ${options.trackerMatchedSession}`);
    this.logPanel.appendLine(`DAP output events seen: ${options.eventCount}`);
    this.logPanel.appendLine(`debugStdout length: ${options.debugStdout.length}`);
    this.logPanel.appendLine(`debugStderr length: ${options.debugStderr.length}`);
    const categories = [...options.categoryCounts.entries()]
      .map(([category, count]) => `${category}=${count}`)
      .join(', ');
    this.logPanel.appendLine(`DAP output categories: ${categories || '<none>'}`);
    if (options.samples.length > 0) {
      this.logPanel.appendLine('DAP output samples:');
      options.samples.forEach((sample) => this.logPanel.appendLine(`  ${sample}`));
    }
  }

  private debugOutputFromMessage(message: unknown): { category?: string; text: string } | undefined {
    if (!message || typeof message !== 'object') {
      return undefined;
    }
    const candidate = message as {
      type?: unknown;
      event?: unknown;
      body?: { category?: unknown; output?: unknown };
    };
    if (candidate.type !== 'event' || candidate.event !== 'output' || typeof candidate.body?.output !== 'string') {
      return undefined;
    }
    return {
      category: typeof candidate.body.category === 'string' ? candidate.body.category : undefined,
      text: candidate.body.output
    };
  }

  private debugGlob(...parts: string[]): string {
    return path.join(...parts).replace(/\\/g, '/');
  }

  private async startAndWaitForDebugSession(
    config: vscode.DebugConfiguration,
    cwd: string,
    token?: vscode.CancellationToken,
    debugDiagnostics = false
  ): Promise<{ started: boolean; cancelled: boolean; error?: string }> {
    return new Promise((resolve) => {
      let resolved = false;
      let session: vscode.DebugSession | undefined;
      const disposables: vscode.Disposable[] = [];
      const finish = (result: { started: boolean; cancelled: boolean; error?: string }) => {
        if (resolved) {
          return;
        }
        resolved = true;
        disposables.forEach((disposable) => disposable.dispose());
        resolve(result);
      };

      disposables.push(vscode.debug.onDidStartDebugSession((startedSession) => {
        if (debugDiagnostics) {
          this.logPanel.appendLine(
            `Debug session started: name=${startedSession.name}, type=${startedSession.type}, configType=${String(startedSession.configuration.type)}`
          );
        }
        if (startedSession.name === config.name) {
          session = startedSession;
        }
      }));

      disposables.push(vscode.debug.onDidTerminateDebugSession((terminatedSession) => {
        if (session && terminatedSession.id === session.id) {
          finish({ started: true, cancelled: false });
        }
      }));

      disposables.push(token?.onCancellationRequested(() => {
        if (session) {
          vscode.debug.stopDebugging(session).then(
            () => finish({ started: true, cancelled: true }),
            (error) => finish({ started: true, cancelled: true, error: String(error) })
          );
        } else {
          finish({ started: false, cancelled: true });
        }
      }) ?? new vscode.Disposable(() => undefined));

      vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd)), config).then(
        (started) => {
          if (!started) {
            finish({ started: false, cancelled: false });
          }
        },
        (error) => finish({ started: false, cancelled: false, error: `Unable to start Cucumber debug session: ${String(error)}` })
      );
    });
  }

  private async resolveCucumberDebugProgram(
    cwd: string,
    executable: string,
    configuredArgs: string[]
  ): Promise<{ program: string; args: string[] } | undefined> {
    const localProgram = localCucumberBinPath(cwd);
    const hasLocalProgram = await this.pathExists(localProgram);
    const executableName = path.basename(executable).toLowerCase();

    if (executableName === 'npx' && configuredArgs[0] === 'cucumber-js' && hasLocalProgram) {
      return { program: localProgram, args: configuredArgs.slice(1) };
    }

    if ((executableName === 'cucumber-js' || executableName === 'cucumber-js.cmd') && hasLocalProgram) {
      return { program: localProgram, args: configuredArgs };
    }

    if (executableName === 'node' && configuredArgs.length > 0) {
      const program = path.isAbsolute(configuredArgs[0]) ? configuredArgs[0] : path.join(cwd, configuredArgs[0]);
      if (await this.pathExists(program)) {
        return { program, args: configuredArgs.slice(1) };
      }
    }

    return hasLocalProgram ? { program: localProgram, args: configuredArgs } : undefined;
  }

  private async ensureReportDirectory(reportPath: string): Promise<void> {
    await fs.mkdir(path.dirname(reportPath), { recursive: true }).catch(() => undefined);
  }

  private async createGeneratedConfigIfNeeded(cwd: string, targets: readonly string[]): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('cucumberRunner');
    const configFile = config.get<string>('configFile', DEFAULT_CONFIG_FILE);
    const sourceConfigPath = path.join(cwd, configFile);
    if (!await this.pathExists(sourceConfigPath)) {
      return undefined;
    }

    const generatedDir = path.join(cwd, CucumberRunner.generatedDirName);
    const generatedConfigPath = path.join(generatedDir, 'cucumber.targeted.cjs');
    const consoleCapturePath = path.join(generatedDir, CucumberRunner.consoleCaptureFileName);
    await fs.mkdir(generatedDir, { recursive: true });
    await fs.writeFile(consoleCapturePath, this.consoleCaptureSource(), 'utf8');
    const escapedSource = JSON.stringify(sourceConfigPath);
    const escapedCapture = JSON.stringify(consoleCapturePath);
    const stripPaths = targets.length > 0;
    const contents = [
      `const base = require(${escapedSource});`,
      `const consoleCapture = ${escapedCapture};`,
      '',
      'function prepareProfile(profile) {',
      '  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {',
      '    return profile;',
      '  }',
      '  const next = { ...profile };',
      stripPaths ? '  delete next.paths;' : '',
      '  const existingRequire = Array.isArray(next.require) ? next.require : next.require ? [next.require] : [];',
      '  next.require = [consoleCapture, ...existingRequire.filter((entry) => entry !== consoleCapture)];',
      '  return next;',
      '}',
      '',
      'if (base && typeof base === "object" && !Array.isArray(base)) {',
      '  module.exports = Object.fromEntries(',
      '    Object.entries(base).map(([name, profile]) => [name, prepareProfile(profile)])',
      '  );',
      '} else {',
      '  module.exports = base;',
      '}',
      ''
    ].join('\n');
    await fs.writeFile(generatedConfigPath, contents, 'utf8');
    this.logPanel.appendLine(`Generated Cucumber runner config: ${generatedConfigPath}`);
    return generatedConfigPath;
  }

  private consoleCaptureSource(): string {
    return String.raw`
const cucumber = require('@cucumber/cucumber');
const methods = ['Given', 'When', 'Then', 'And', 'But', 'defineStep', 'Before', 'After', 'BeforeStep', 'AfterStep'];
const originals = new Map();
const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'];

function formatArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

function captureConsole(buffer) {
  const previous = {};
  for (const method of consoleMethods) {
    previous[method] = console[method];
    console[method] = (...args) => {
      const line = args.map(formatArg).join(' ');
      buffer.push(method === 'warn' ? '[warn] ' + line : method === 'error' ? '[stderr] ' + line : line);
      previous[method].apply(console, args);
    };
  }
  return () => {
    for (const method of consoleMethods) {
      console[method] = previous[method];
    }
  };
}

function attachLogs(world, buffer) {
  if (!buffer.length || !world || typeof world.attach !== 'function') return;
  return world.attach(buffer.join('\n'), 'text/plain');
}

async function flushAndRestore(world, buffer, restore) {
  try {
    await attachLogs(world, buffer);
  } catch {
    // Do not let attachment failures mask the user's original step/hook result.
  } finally {
    restore();
  }
}

async function flushRestoreAndReject(world, buffer, restore, error) {
  await flushAndRestore(world, buffer, restore);
  throw error;
}

function wrapCode(code) {
  if (typeof code !== 'function' || code.__cucumberRunnerConsoleCapture) return code;
  const wrapped = function (...args) {
    const buffer = [];
    const restore = captureConsole(buffer);
    const done = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    if (done) {
      const originalDone = done;
      args[args.length - 1] = (...doneArgs) => {
        flushAndRestore(this, buffer, restore).finally(() => {
          originalDone(...doneArgs);
        }).catch(() => undefined);
      };
      try {
        return code.apply(this, args);
      } catch (error) {
        const attachResult = attachLogs(this, buffer);
        if (attachResult && typeof attachResult.then === 'function') {
          attachResult.finally(restore).catch(() => undefined);
        } else {
          restore();
        }
        throw error;
      }
    }
    try {
      const result = code.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.finally(() => flushAndRestore(this, buffer, restore));
      }
      const attachResult = flushAndRestore(this, buffer, restore);
      if (attachResult && typeof attachResult.then === 'function') {
        return attachResult.then(() => result);
      }
      return result;
    } catch (error) {
      return flushRestoreAndReject(this, buffer, restore, error);
    }
  };
  Object.defineProperty(wrapped, '__cucumberRunnerConsoleCapture', { value: true });
  try {
    Object.defineProperty(wrapped, 'length', { value: code.length });
  } catch {
    // Some JS runtimes may not allow redefining function length. Cucumber still receives the wrapped code.
  }
  return wrapped;
}

function wrapRegistration(original) {
  return function (...args) {
    for (let index = args.length - 1; index >= 0; index--) {
      if (typeof args[index] === 'function') {
        args[index] = wrapCode(args[index]);
        break;
      }
    }
    return original.apply(this, args);
  };
}

for (const method of methods) {
  if (typeof cucumber[method] === 'function' && !originals.has(method)) {
    originals.set(method, cucumber[method]);
    cucumber[method] = wrapRegistration(cucumber[method]);
  }
}
`;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private collectTargets(items: readonly vscode.TestItem[]): string[] {
    const targets: string[] = [];
    items.forEach((item) => {
      if (item.id.startsWith('scenario:')) {
        const range = item.range;
        const pathTarget = item.uri?.fsPath ?? '';
        targets.push(range ? `${pathTarget}:${range.start.line + 1}` : pathTarget);
      } else if (item.id.startsWith('scenarioOutline:')) {
        const range = item.range;
        const pathTarget = item.uri?.fsPath ?? '';
        // Cucumber.js treats the Scenario Outline line as the whole outline, so this runs all example rows in one process.
        targets.push(range ? `${pathTarget}:${range.start.line + 1}` : pathTarget);
      } else if (item.id.startsWith('exampleRow:')) {
        const range = item.range;
        const pathTarget = item.uri?.fsPath ?? '';
        targets.push(range ? `${pathTarget}:${range.start.line + 1}` : pathTarget);
      } else if (item.id.startsWith('step:')) {
        const parts = item.id.split(':');
        const scenarioLine = parts[parts.length - 2];
        if (item.uri && scenarioLine) {
          targets.push(`${item.uri.fsPath}:${scenarioLine}`);
        }
      } else if (item.id.startsWith('feature:') || item.id.startsWith('file:')) {
        if (item.uri) {
          targets.push(item.uri.fsPath);
        }
      } else {
        item.children.forEach((child) => {
          targets.push(...this.collectTargets([child]));
        });
      }
    });
    return [...new Set(targets.filter((value) => value.length > 0))];
  }

  private collectTopLevelItems(): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];
    this.controller.items.forEach((item) => items.push(item));
    return items;
  }

  private flattenItems(items: readonly vscode.TestItem[]): vscode.TestItem[] {
    const flattened: vscode.TestItem[] = [];
    items.forEach((item) => {
      flattened.push(item);
      item.children.forEach((child) => {
        flattened.push(...this.flattenItems([child]));
      });
    });
    return flattened;
  }

  private resolveWorkspacePath(value: string | undefined, workspaceRoot: string): string {
    if (!value || value === '${workspaceFolder}') {
      return workspaceRoot;
    }

    const expanded = value.replace(/\$\{workspaceFolder\}/g, workspaceRoot);
    return path.isAbsolute(expanded) ? expanded : path.join(workspaceRoot, expanded);
  }

  private groupTargetsByCwd(
    targets: string[],
    configuredCwd: string | undefined,
    fallbackWorkspaceRoot: string
  ): Array<{ cwd: string; targets: string[] }> {
    const hasExplicitCwd = !!configuredCwd && configuredCwd !== '${workspaceFolder}';
    if (hasExplicitCwd) {
      return [{
        cwd: this.resolveWorkspacePath(configuredCwd, fallbackWorkspaceRoot),
        targets
      }];
    }

    if (targets.length === 0) {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        return [{ cwd: fallbackWorkspaceRoot, targets: [] }];
      }
      return folders.map((folder) => ({ cwd: folder.uri.fsPath, targets: [] }));
    }

    const groups = new Map<string, string[]>();
    for (const target of targets) {
      const targetPath = this.targetPath(target);
      const workspaceFolder = targetPath ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetPath)) : undefined;
      const cwd = workspaceFolder?.uri.fsPath ?? fallbackWorkspaceRoot;
      const groupTargets = groups.get(cwd) ?? [];
      groupTargets.push(target);
      groups.set(cwd, groupTargets);
    }

    return [...groups.entries()].map(([cwd, groupTargets]) => ({ cwd, targets: groupTargets }));
  }

  private workspaceRootForItems(items: readonly vscode.TestItem[]): string | undefined {
    for (const item of this.flattenItems(items)) {
      if (item.uri) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(item.uri);
        if (workspaceFolder) {
          return workspaceFolder.uri.fsPath;
        }
      }
    }
    return undefined;
  }

  private targetPath(target: string): string | undefined {
    const lineMatch = /^(.*):\d+$/.exec(target);
    return lineMatch?.[1] ?? target;
  }

  private filterRunItemsForTargets(runItems: readonly vscode.TestItem[], targets: readonly string[]): vscode.TestItem[] {
    if (targets.length === 0) {
      return [...runItems];
    }
    const targetSet = new Set(targets);
    return runItems.filter((item) => this.collectTargets([item]).some((target) => targetSet.has(target)));
  }

  private async tryParseStructuredResult(
    format: string,
    stdout: string,
    stderr: string,
    cwd: string
  ): Promise<{ result?: CucumberRunResult; empty: boolean; error?: string }> {
    if (format !== 'message' || !this.lastRunReportPath) {
      return { empty: false };
    }

    try {
      const result = await parseCucumberMessageReport(this.lastRunReportPath, stdout, stderr, cwd);
      if (result.scenarios.length === 0) {
        this.logPanel.appendLine('Warning: Cucumber message report did not contain scenario results.');
        return { empty: true };
      }
      return { result, empty: false };
    } catch (error) {
      const message = `Unable to parse Cucumber message report: ${String(error)}`;
      this.logPanel.appendLine(`Warning: ${message}`);
      return { empty: false, error: message };
    }
  }

  private applyStructuredResults(
    run: vscode.TestRun,
    runItems: readonly vscode.TestItem[],
    result: CucumberRunResult,
    processOutput?: { stdout: string; stderr: string },
    options: { terminalItemIds?: Set<string> } = {}
  ): void {
    const itemStatuses = new Map<string, CucumberScenarioResult['status'] | CucumberStepResult['status']>();
    const outlineStatuses = new Map<string, { item: vscode.TestItem; statuses: Array<CucumberScenarioResult['status']> }>();
    const fullProcessOutput = processOutput ? this.processOutputForTestResults(processOutput.stdout, processOutput.stderr) : undefined;
    const scenarios = result.scenarios;
    const itemIndex = this.buildResultItemIndex();

    for (const scenario of scenarios) {
      const scenarioItem = this.findScenarioItemInIndex(itemIndex, scenario);
      const exampleRowItem = scenarioItem && scenario.exampleLine
        ? this.findExampleRowItemInIndex(itemIndex, scenarioItem, scenario)
        : undefined;
      if (scenarioItem) {
        const targetItem = exampleRowItem ?? scenarioItem;
        this.applyScenarioStatus(run, targetItem, scenario, itemStatuses);
        this.appendScenarioOutput(run, targetItem, scenario);
        this.registerScenarioDetails(targetItem, scenario.exampleLine ? 'exampleRow' : 'scenario', scenario);
        if (scenario.exampleLine && scenarioItem.id.startsWith('scenarioOutline:')) {
          const current = outlineStatuses.get(scenarioItem.id) ?? {
            item: scenarioItem,
            statuses: []
          };
          current.statuses.push(scenario.status);
          outlineStatuses.set(scenarioItem.id, current);
        }
      }

      const usedStepItems = new Set<string>();
      const orderedStepItems: vscode.TestItem[] = [];
      const stepParent = scenarioItem ? exampleRowItem ?? scenarioItem : undefined;
      const originalStepIndexes = new Map<CucumberStepResult, number>();
      scenario.steps.forEach((step, index) => originalStepIndexes.set(step, index));
      const orderedForExplorer = orderScenarioStepsForExplorer(scenario.steps);
      const hookOrdinals = this.hookOrdinalsByDisplayClass(orderedForExplorer);
      let ordinaryStepIndex = 0;
      for (const step of orderedForExplorer) {
        const originalIndex = originalStepIndexes.get(step) ?? 0;
        let stepItem: vscode.TestItem | undefined;
        if (stepParent) {
          if (step.kind === 'hook') {
            stepItem = this.findOrCreateHookItem(stepParent, step, originalIndex, hookOrdinals.get(step) ?? 0);
          } else {
            stepItem = this.findStepItemInIndex(itemIndex, stepParent, step, scenario, ordinaryStepIndex, usedStepItems);
            ordinaryStepIndex += 1;
          }
        }
        if (stepItem) {
          usedStepItems.add(stepItem.id);
          orderedStepItems.push(stepItem);
          this.applyStepStatus(run, stepItem, step, itemStatuses, !options.terminalItemIds?.has(stepItem.id));
          this.appendStepOutput(run, stepItem, scenario, step);
          this.registerStepDetails(stepItem, scenario, step);
        }
      }
      if (stepParent && orderedStepItems.length > 0) {
        this.reorderRuntimeStepItems(stepParent, orderedStepItems);
      }
    }

    outlineStatuses.forEach(({ item, statuses }) => {
      const status = this.aggregateStatuses(statuses);
      if (status === 'failed') {
        run.failed(item, new vscode.TestMessage('One or more Scenario Outline examples failed.'));
      } else if (status === 'passed') {
        run.passed(item);
      } else {
        run.skipped(item);
      }
      itemStatuses.set(item.id, status);
      if (fullProcessOutput) {
        this.appendPlainOutput(run, item, `Process output:\n${fullProcessOutput}`);
      }
    });

    for (const item of runItems) {
      if (
        itemStatuses.has(item.id) ||
        item.id.startsWith('scenario:') ||
        item.id.startsWith('scenarioOutline:') ||
        item.id.startsWith('exampleRow:') ||
        item.id.startsWith('step:') ||
        item.id.startsWith('hookStatic:') ||
        item.id.startsWith('hook:')
      ) {
        continue;
      }
      const aggregate = this.aggregateItemStatusFromChildren(item, itemStatuses);
      if (!aggregate) {
        continue;
      }
      if (aggregate === 'failed') {
        run.failed(item, new vscode.TestMessage('One or more Cucumber scenarios failed.'));
      } else if (aggregate === 'passed') {
        run.passed(item);
      } else {
        run.skipped(item);
      }
      itemStatuses.set(item.id, aggregate);
      if (fullProcessOutput) {
        this.appendPlainOutput(run, item, `Process output:\n${fullProcessOutput}`);
      }
    }
  }

  private aggregateItemStatusFromChildren(
    item: vscode.TestItem,
    itemStatuses: Map<string, CucumberScenarioResult['status'] | CucumberStepResult['status']>
  ): 'passed' | 'failed' | 'skipped' | undefined {
    const own = itemStatuses.get(item.id);
    if (own) {
      return this.normalizeAggregateStatus(own);
    }

    const childStatuses: Array<'passed' | 'failed' | 'skipped'> = [];
    item.children.forEach((child) => {
      const status = this.aggregateItemStatusFromChildren(child, itemStatuses);
      if (status) {
        childStatuses.push(status);
      }
    });

    if (childStatuses.length === 0) {
      return undefined;
    }
    if (childStatuses.some((status) => status === 'failed')) {
      return 'failed';
    }
    if (childStatuses.some((status) => status === 'passed')) {
      return 'passed';
    }
    return 'skipped';
  }

  private normalizeAggregateStatus(status: CucumberScenarioResult['status'] | CucumberStepResult['status']): 'passed' | 'failed' | 'skipped' {
    if (status === 'failed' || status === 'pending' || status === 'undefined') {
      return 'failed';
    }
    if (status === 'passed') {
      return 'passed';
    }
    return 'skipped';
  }

  private applyScenarioStatus(
    run: vscode.TestRun,
    item: vscode.TestItem,
    scenario: CucumberScenarioResult,
    itemStatuses: Map<string, CucumberScenarioResult['status'] | CucumberStepResult['status']>
  ): void {
    const duration = scenario.durationMs;
    if (scenario.status === 'passed') {
      run.passed(item, duration);
    } else if (scenario.status === 'skipped') {
      run.skipped(item);
    } else if (scenario.status === 'failed') {
      run.failed(item, new vscode.TestMessage(this.failureMessage(scenario)), duration);
    } else {
      run.errored(item, new vscode.TestMessage('Cucumber scenario status is unknown.'), duration);
    }
    itemStatuses.set(item.id, scenario.status);
  }

  private applyStepStatus(
    run: vscode.TestRun,
    item: vscode.TestItem,
    step: CucumberStepResult,
    itemStatuses: Map<string, CucumberScenarioResult['status'] | CucumberStepResult['status']>,
    startItem = true
  ): void {
    const duration = step.durationMs;
    if (startItem) {
      run.started(item);
    }
    if (step.status === 'passed') {
      run.passed(item, duration);
    } else if (step.status === 'skipped') {
      run.skipped(item);
    } else if (step.status === 'failed' || step.status === 'pending' || step.status === 'undefined') {
      run.failed(item, new vscode.TestMessage(this.failureMessage(step)), duration);
    } else {
      run.errored(item, new vscode.TestMessage('Cucumber step status is unknown.'), duration);
    }
    itemStatuses.set(item.id, step.status);
  }

  private isExecutionLeafItem(item: vscode.TestItem): boolean {
    return item.id.startsWith('step:') || item.id.startsWith('hookStatic:') || item.id.startsWith('hook:');
  }

  private appendScenarioOutput(
    run: vscode.TestRun,
    item: vscode.TestItem,
    scenario: CucumberScenarioResult
  ): void {
    this.appendPlainOutput(run, item, formatScenarioDetails(scenario));
  }

  private appendStepOutput(
    run: vscode.TestRun,
    item: vscode.TestItem,
    scenario: CucumberScenarioResult,
    step: CucumberStepResult
  ): void {
    this.appendPlainOutput(run, item, formatStepDetails({ scenario, step }));
  }

  private appendPlainOutput(run: vscode.TestRun, item: vscode.TestItem, text: string): void {
    run.appendOutput(this.toTestRunOutput(text), this.locationForItem(item), item);
  }

  private toTestRunOutput(text: string): string {
    return `${text.replace(/\r?\n/g, '\r\n')}\r\n`;
  }

  private processOutputForTestResults(stdout: string, stderr: string): string | undefined {
    const sections: string[] = [];
    if (stdout.trim()) {
      sections.push(`stdout:\n${stdout.trimEnd()}`);
    }
    if (stderr.trim()) {
      sections.push(`stderr:\n${stderr.trimEnd()}`);
    }
    return sections.length > 0 ? sections.join('\n\n') : undefined;
  }

  private resultWithBestEffortStdoutLogs(result: CucumberRunResult, stdout: string): CucumberRunResult {
    return {
      ...result,
      scenarios: attachBestEffortStdoutLogs(result.scenarios, stdout)
    };
  }

  private locationForItem(item: vscode.TestItem): vscode.Location | undefined {
    if (!item.uri || !item.range) {
      return undefined;
    }
    return new vscode.Location(item.uri, item.range);
  }

  private aggregateStatuses(statuses: Array<CucumberScenarioResult['status'] | CucumberStepResult['status']>): 'passed' | 'failed' | 'skipped' {
    if (statuses.some((status) => status === 'failed' || status === 'pending' || status === 'undefined')) {
      return 'failed';
    }
    if (statuses.length > 0 && statuses.every((status) => status === 'passed')) {
      return 'passed';
    }
    return 'skipped';
  }

  private failureMessage(result: CucumberScenarioResult | CucumberStepResult): string {
    return formatFailureMessage(result);
  }

  private buildResultItemIndex(): ResultItemIndex {
    const index: ResultItemIndex = {
      scenarioByUriLine: new Map(),
      scenarioByUriName: new Map(),
      scenarioCandidates: [],
      exampleRowByParentLine: new Map(),
      stepsByParent: new Map()
    };

    const visit = (collection: vscode.TestItemCollection, parent?: vscode.TestItem) => {
      collection.forEach((item) => {
        if (item.id.startsWith('scenario:') || item.id.startsWith('scenarioOutline:')) {
          index.scenarioCandidates.push(item);
          const line = item.range?.start.line;
          if (item.uri && line !== undefined) {
            for (const uriKey of this.itemUriLookupKeys(item.uri.fsPath)) {
              this.addIndexedItem(index.scenarioByUriLine, `${uriKey}:${line + 1}`, item);
              this.addIndexedItem(index.scenarioByUriName, `${uriKey}:${this.normalizeScenarioName(item.label)}`, item);
            }
          }
        }

        if (item.id.startsWith('exampleRow:')) {
          const parentId = parent?.id;
          const line = item.range?.start.line;
          if (parentId && line !== undefined) {
            const byLine = index.exampleRowByParentLine.get(parentId) ?? new Map<number, vscode.TestItem>();
            byLine.set(line + 1, item);
            index.exampleRowByParentLine.set(parentId, byLine);
          }
        }

        if (item.id.startsWith('step:')) {
          const parentId = parent?.id;
          const line = item.range?.start.line;
          if (parentId) {
            const stepIndex = index.stepsByParent.get(parentId) ?? {
              byLine: new Map<number, vscode.TestItem[]>(),
              byText: new Map<string, vscode.TestItem[]>(),
              ordered: []
            };
            stepIndex.ordered.push(item);
            if (line !== undefined) {
              this.addIndexedItem(stepIndex.byLine, line + 1, item);
            }
            this.addIndexedItem(stepIndex.byText, this.normalizeStepText(item.label), item);
            index.stepsByParent.set(parentId, stepIndex);
          }
        }

        visit(item.children, item);
      });
    };

    visit(this.controller.items);
    return index;
  }

  private findScenarioItemInIndex(index: ResultItemIndex, result: CucumberScenarioResult): vscode.TestItem | undefined {
    if (result.uri && result.line) {
      const lineMatch = this.firstIndexedItem(index.scenarioByUriLine, `${this.resultUriLookupKey(result.uri)}:${result.line}`);
      if (lineMatch) {
        return lineMatch;
      }
    }

    if (result.uri) {
      const nameMatch = this.firstIndexedItem(index.scenarioByUriName, `${this.resultUriLookupKey(result.uri)}:${this.normalizeScenarioName(result.name)}`);
      if (nameMatch) {
        return nameMatch;
      }
    }

    const found = index.scenarioCandidates.find((item) => {
      const sameFile = result.uri ? cucumberUriMatchesItemPath(item.uri?.fsPath, result.uri) : true;
      const sameLine = result.line ? item.range?.start.line === result.line - 1 : true;
      const sameName = item.label.includes(result.name);
      return sameFile && (sameLine || sameName);
    });
    if (!found) {
      this.logPanel.appendLine(
        `No TestItem matched scenario result: uri=${result.uri ?? '<unknown>'}, line=${result.line ?? '<unknown>'}, name=${result.name}`
      );
    }
    return found;
  }

  private findExampleRowItemInIndex(
    index: ResultItemIndex,
    parent: vscode.TestItem,
    result: CucumberScenarioResult
  ): vscode.TestItem | undefined {
    if (!result.exampleLine) {
      return undefined;
    }
    return index.exampleRowByParentLine.get(parent.id)?.get(result.exampleLine);
  }

  private findStepItemInIndex(
    index: ResultItemIndex,
    parent: vscode.TestItem,
    result: CucumberStepResult,
    scenario: CucumberScenarioResult,
    stepIndex: number,
    usedStepItems: Set<string>
  ): vscode.TestItem | undefined {
    const parentSteps = index.stepsByParent.get(parent.id);
    if (!parentSteps) {
      return undefined;
    }

    const lineMatch = result.line ? this.firstUnused(parentSteps.byLine.get(result.line), usedStepItems) : undefined;
    if (lineMatch) {
      return lineMatch;
    }

    const resultText = this.normalizeStepText(result.text);
    const exactTextMatch = this.firstUnused(parentSteps.byText.get(resultText), usedStepItems);
    if (exactTextMatch) {
      return exactTextMatch;
    }

    const textMatch = parentSteps.ordered.find((item) => {
      if (usedStepItems.has(item.id)) {
        return false;
      }
      const label = this.normalizeStepText(item.label);
      const interpolated = this.normalizeStepText(this.interpolateStepText(item.label, scenario.exampleValues));
      return label === resultText || interpolated === resultText || label.includes(resultText) || interpolated.includes(resultText);
    });
    if (textMatch) {
      return textMatch;
    }

    const orderedMatch = parentSteps.ordered[stepIndex];
    return orderedMatch && !usedStepItems.has(orderedMatch.id)
      ? orderedMatch
      : parentSteps.ordered.find((item) => !usedStepItems.has(item.id));
  }

  private findOrCreateHookItem(
    parent: vscode.TestItem,
    step: CucumberStepResult,
    runtimeExecutionIndex: number,
    staticMatchOrdinal: number
  ): vscode.TestItem {
    const staticItem = this.findStaticHookItem(parent, step, staticMatchOrdinal);
    if (staticItem) {
      return staticItem;
    }

    const hookId = runtimeHookItemId(parent.id, step, runtimeExecutionIndex);
    const existing = parent.children.get(hookId);
    if (existing) {
      return existing;
    }

    const item = this.controller.createTestItem(hookId, formatCucumberStepLabel(step), parent.uri);
    item.range = parent.range;
    parent.children.add(item);
    return item;
  }

  private findStaticHookItem(parent: vscode.TestItem, step: CucumberStepResult, hookOrdinal: number): vscode.TestItem | undefined {
    const candidates = this.childItems(parent).filter((item) => isStaticHookItemId(parent.id, item.id));
    if (candidates.length === 0) {
      return undefined;
    }

    const label = formatCucumberStepLabel(step);
    const labelMatches = candidates.filter((item) => item.label === label);
    const sourceMatches = labelMatches.filter((item) => {
      const sameUri = step.uri ? item.uri?.fsPath && path.normalize(item.uri.fsPath) === path.normalize(step.uri) : true;
      const sameLine = step.line !== undefined ? item.range?.start.line === step.line - 1 : true;
      return sameUri && sameLine;
    });
    if (sourceMatches.length > 0) {
      return sourceMatches[hookOrdinal] ?? sourceMatches[0];
    }

    const sameType = labelMatches.length > 0 ? labelMatches : candidates.filter((item) => item.label.startsWith(step.keyword?.trim() ?? ''));
    return sameType[hookOrdinal] ?? sameType[0];
  }

  private hookOrdinalsByDisplayClass(steps: readonly CucumberStepResult[]): Map<CucumberStepResult, number> {
    const ordinals = new Map<CucumberStepResult, number>();
    const counts = new Map<string, number>();
    for (const step of steps) {
      if (step.kind !== 'hook') {
        continue;
      }
      const key = `${step.hookType ?? ''}:${formatCucumberStepLabel(step)}`;
      const ordinal = counts.get(key) ?? 0;
      ordinals.set(step, ordinal);
      counts.set(key, ordinal + 1);
    }
    return ordinals;
  }

  private reorderRuntimeStepItems(parent: vscode.TestItem, orderedStepItems: vscode.TestItem[]): void {
    const existing = this.childItems(parent);
    const ordered = orderedRuntimeChildren(parent.id, orderedStepItems, existing);
    if (ordered.length === 0) {
      return;
    }
    this.applyRuntimeSortText(ordered);
    parent.children.replace(ordered);
  }

  private applyRuntimeSortText(items: vscode.TestItem[]): void {
    items.forEach((item, index) => {
      (item as vscode.TestItem & { sortText?: string }).sortText = String(index).padStart(6, '0');
    });
  }

  private childItems(parent: vscode.TestItem): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];
    parent.children.forEach((item) => items.push(item));
    return items;
  }

  private addIndexedItem<K extends string | number>(map: Map<K, vscode.TestItem[]>, key: K, item: vscode.TestItem): void {
    const items = map.get(key) ?? [];
    items.push(item);
    map.set(key, items);
  }

  private firstIndexedItem(map: Map<string, vscode.TestItem[]>, key: string): vscode.TestItem | undefined {
    return map.get(key)?.[0];
  }

  private firstUnused(items: vscode.TestItem[] | undefined, used: Set<string>): vscode.TestItem | undefined {
    return items?.find((item) => !used.has(item.id));
  }

  private itemUriLookupKeys(fsPath: string): string[] {
    const normalized = this.normalizeComparablePath(fsPath);
    const parts = normalized.split('/').filter(Boolean);
    const keys = new Set<string>([normalized]);
    for (let index = 0; index < parts.length; index++) {
      keys.add(parts.slice(index).join('/'));
    }
    return [...keys];
  }

  private resultUriLookupKey(uri: string): string {
    return this.normalizeComparablePath(uri);
  }

  private normalizeComparablePath(value: string): string {
    const normalized = value
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  private normalizeScenarioName(value: string): string {
    return value.replace(/^(Scenario(?: Outline)?|Feature):\s*/iu, '').trim().toLowerCase();
  }

  private normalizeStepText(value: string): string {
    return value
      .replace(/^\s*(Given|When|Then|And|But|\*)\s+/iu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLowerCase();
  }

  private interpolateStepText(value: string, values: Record<string, string> | undefined): string {
    if (!values) {
      return value;
    }
    return Object.entries(values).reduce(
      (text, [key, replacement]) => text.replace(new RegExp(`<${this.escapeRegExp(key)}>`, 'g'), replacement),
      value
    );
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private registerScenarioDetails(
    item: vscode.TestItem,
    kind: 'scenario' | 'exampleRow',
    scenario: CucumberScenarioResult
  ): void {
    this.resultRegistry.set({
      itemId: item.id,
      kind,
      title: kind === 'exampleRow' ? 'Cucumber Example Details' : 'Cucumber Scenario Details',
      text: formatScenarioDetails(scenario),
      uri: scenario.uri,
      line: scenario.exampleLine ?? scenario.line
    });
  }

  private registerStepDetails(item: vscode.TestItem, scenario: CucumberScenarioResult, step: CucumberStepResult): void {
    this.resultRegistry.set({
      itemId: item.id,
      kind: 'step',
      title: step.kind === 'hook' ? 'Cucumber Hook Details' : 'Cucumber Step Details',
      text: formatStepDetails({ scenario, step }),
      uri: step.uri ?? scenario.uri,
      line: step.line
    });
  }

  private async resolveItemDetails(item?: vscode.TestItem): Promise<{ title: string; text: string }> {
    const resolved = item ?? this.findActiveEditorItem();
    if (!this.resultRegistry.hasResults()) {
      return {
        title: 'Cucumber Test Details',
        text: 'No Cucumber run results available yet.'
      };
    }

    const details = this.resultRegistry.get(resolved?.id);
    if (details) {
      return details;
    }

    return {
      title: 'Cucumber Test Details',
      text: 'No result found for this item in the last run.\n\nRun this test to collect Cucumber details.'
    };
  }

  private findActiveEditorItem(): vscode.TestItem | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return undefined;
    }

    const activePath = path.normalize(editor.document.uri.fsPath);
    const activeLine = editor.selection.active.line;
    return this.findTestItem((item) => {
      if (!item.uri || path.normalize(item.uri.fsPath) !== activePath || !item.range) {
        return false;
      }
      return item.range.start.line <= activeLine && item.range.end.line >= activeLine;
    }) ?? this.findNearestItem(activePath, activeLine);
  }

  private findNearestItem(activePath: string, activeLine: number): vscode.TestItem | undefined {
    let nearest: vscode.TestItem | undefined;
    this.findTestItem((item) => {
      if (!item.uri || path.normalize(item.uri.fsPath) !== activePath || !item.range) {
        return false;
      }
      if (item.range.start.line <= activeLine && (!nearest || item.range.start.line > (nearest.range?.start.line ?? -1))) {
        nearest = item;
      }
      return false;
    });
    return nearest;
  }

  private findTestItem(predicate: (item: vscode.TestItem) => boolean): vscode.TestItem | undefined {
    const visit = (collection: vscode.TestItemCollection): vscode.TestItem | undefined => {
      let found: vscode.TestItem | undefined;
      collection.forEach((item) => {
        if (found) {
          return;
        }
        if (predicate(item)) {
          found = item;
          return;
        }
        found = visit(item.children);
      });
      return found;
    };

    return visit(this.controller.items);
  }

  private cucumberCliNotFoundMessage(error: Error): string {
    const details = String(error);
    return `Cucumber CLI not found. Run npm install or install @cucumber/cucumber.\n\n${details}`;
  }

  private cucumberCliNotFoundFromOutput(stdout: string, stderr: string): string | undefined {
    const output = `${stdout}\n${stderr}`;
    if (
      /cucumber-js.*(not recognized|not found)/i.test(output) ||
      /(not recognized|not found).*cucumber-js/i.test(output) ||
      /Cannot find module ['"]@cucumber\/cucumber/i.test(output)
    ) {
      return 'Cucumber CLI not found. Run npm install or install @cucumber/cucumber.';
    }
    return undefined;
  }

  private withExecutionHints(message: string, stdout: string, stderr: string): string {
    const hints = [
      this.undefinedStepsHint(stdout, stderr),
      this.playwrightHint(stdout, stderr)
    ].filter(Boolean);
    return hints.length > 0 ? `${message}\n\n${hints.join('\n')}` : message;
  }

  private undefinedStepsHint(stdout: string, stderr: string): string | undefined {
    const output = `${stdout}\n${stderr}`;
    if (/(^|\n)U+\b/.test(output) || /undefined step/i.test(output) || /Undefined\./i.test(output)) {
      return 'Step definitions were not found. Check cucumberRunner.steps/support settings, cucumber.js require paths, ts-node/register, and cwd.';
    }
    return undefined;
  }

  private playwrightHint(stdout: string, stderr: string): string | undefined {
    const output = `${stdout}\n${stderr}`;
    if (/playwright/i.test(output) && /(browser|executable|install|chromium|firefox|webkit)/i.test(output)) {
      return 'Playwright failed during test execution. Check browser installation with npx playwright install.';
    }
    return undefined;
  }

  private logRunCommand(
    cwd: string,
    executable: string,
    args: string[],
    displayCommand: string,
    targets: readonly string[],
    items: readonly vscode.TestItem[]
  ): void {
    this.logPanel.appendLine(`Running in: ${cwd}`);
    this.logPanel.appendLine(`Executable: ${executable}`);
    this.logPanel.appendLine(`Args: ${args.join(' ')}`);
    this.logPanel.appendLine(`Command: ${displayCommand}`);
    this.logPanel.appendLine(`Targets: ${targets.length > 0 ? targets.join(', ') : '<all>'}`);
    const labels = items.map((item) => item.label).filter(Boolean);
    this.logPanel.appendLine(`Target test item: ${labels.length > 0 ? labels.join(', ') : '<all>'}`);
    this.logPanel.appendLine('--- stdout/stderr ---');
  }

  private logSpawnOptions(
    rawExecutable: string,
    rawArgs: string[],
    cwd: string,
    invocation: ReturnType<typeof buildSpawnInvocation>
  ): void {
    this.logPanel.appendLine('--- spawn options ---');
    this.logPanel.appendLine(`PROCESS_LAUNCHER_VERSION=${PROCESS_LAUNCHER_VERSION}`);
    this.logPanel.appendLine(`Raw executable: ${rawExecutable}`);
    this.logPanel.appendLine(`Raw args JSON: ${JSON.stringify(rawArgs)}`);
    if (invocation.mode === 'windows-cmd') {
      this.logPanel.appendLine('Windows command mode: cmd.exe');
      this.logPanel.appendLine(`Command string: ${invocation.renderedCommand}`);
    }
    if (invocation.mode === 'local-cucumber-node') {
      this.logPanel.appendLine('Resolved Cucumber launcher: local-cucumber-node');
      this.logPanel.appendLine(`Local Cucumber bin: ${invocation.localCucumberBin ?? '<unknown>'}`);
    }
    this.logPanel.appendLine(`Spawn executable: ${invocation.executable}`);
    this.logPanel.appendLine(`Spawn args: ${JSON.stringify(invocation.args)}`);
    this.logPanel.appendLine(`cwd: ${cwd}`);
    this.logPanel.appendLine(`shell: ${String(invocation.options.shell)}`);
    this.logPanel.appendLine(`windowsHide: ${String(invocation.options.windowsHide ?? false)}`);
    this.logEnvSanitization(invocation.options.env);
  }

  private logEnvSanitization(childEnv: NodeJS.ProcessEnv | undefined): void {
    this.logPanel.appendLine('--- env sanitize ---');
    for (const key of SANITIZED_ENV_KEYS) {
      this.logPanel.appendLine(`${key} before: ${this.envValueForLog(process.env[key])}`);
      this.logPanel.appendLine(`${key} after: ${this.envValueForLog(childEnv?.[key])}`);
    }
    this.logPanel.appendLine(`PATH before: ${this.envValueForLog(process.env.PATH ?? process.env.Path)}`);
    this.logPanel.appendLine(`PATH after: ${this.envValueForLog(childEnv?.PATH ?? childEnv?.Path)}`);
  }

  private diagnosticsVerbose(): boolean {
    const config = vscode.workspace.getConfiguration('cucumberRunner');
    return config.get<boolean>('diagnosticsVerbose', false) || config.get<boolean>('debugDiagnostics', false);
  }

  private envValueForLog(value: string | undefined): string {
    if (value === undefined) {
      return '<unset>';
    }
    return this.truncateForLog(value);
  }

  private truncateForLog(value: string): string {
    if (value.length > 500) {
      return `${value.slice(0, 500)}...`;
    }
    return value;
  }

  private async validateSpawnOptions(
    cwd: string,
    executable: string,
    args: readonly unknown[],
    configOverride?: string
  ): Promise<string | undefined> {
    if (!executable || executable.trim().length === 0) {
      return 'Invalid Cucumber command: executable is empty.';
    }
    if (!path.isAbsolute(cwd)) {
      return `Invalid Cucumber working directory: cwd must be absolute. Received ${cwd}`;
    }
    if (!await this.pathExists(cwd)) {
      return `Invalid Cucumber working directory: ${cwd} does not exist.`;
    }
    const invalidArg = args.find((arg) => typeof arg !== 'string' || arg.length === 0);
    if (invalidArg !== undefined) {
      return `Invalid Cucumber command arguments: args must be non-empty strings. Received ${JSON.stringify(args)}`;
    }
    if (configOverride && !await this.pathExists(configOverride)) {
      return `Generated targeted Cucumber config does not exist: ${configOverride}`;
    }
    return undefined;
  }

  private async logWorkspaceDiagnostics(cwd: string, items: readonly vscode.TestItem[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('cucumberRunner');
    const configFile = config.get<string>('configFile', DEFAULT_CONFIG_FILE);
    const features = normalizeGlobSettings(config.get('features'), DEFAULT_FEATURE_GLOBS);
    const steps = normalizeGlobSettings(config.get('steps'), DEFAULT_STEP_GLOBS);
    const support = normalizeGlobSettings(config.get('support'), DEFAULT_SUPPORT_GLOBS);
    const configPath = path.join(cwd, configFile);
    const configFound = await this.pathExists(configPath);
    const featureCount = await this.countWorkspaceFiles(cwd, features);
    const stepCount = await this.countWorkspaceFiles(cwd, [...steps, ...support]);
    const labels = items.map((item) => item.label).filter(Boolean);

    this.logPanel.appendLine(`Workspace root: ${cwd}`);
    this.logPanel.appendLine(`Cucumber config: ${configFile} ${configFound ? 'found' : 'not found'}`);
    this.logPanel.appendLine(`Features glob patterns: ${features.join(', ')}`);
    this.logPanel.appendLine(`Steps glob patterns: ${steps.join(', ')}`);
    this.logPanel.appendLine(`Support glob patterns: ${support.join(', ')}`);
    this.logPanel.appendLine(`Feature files found: ${featureCount}`);
    this.logPanel.appendLine(`Step files found: ${stepCount}`);
    this.logPanel.appendLine(`Selected test item: ${labels.length > 0 ? labels.join(', ') : '<all>'}`);
  }

  private async countWorkspaceFiles(cwd: string, globs: string[]): Promise<number> {
    const files: vscode.Uri[] = [];
    for (const glob of globs) {
      const pattern = new vscode.RelativePattern(cwd, glob.replace(/\\/g, '/'));
      files.push(...await vscode.workspace.findFiles(pattern, '**/node_modules/**'));
    }
    return new Set(files.map((file) => path.normalize(file.fsPath))).size;
  }
}
