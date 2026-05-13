import * as fs from 'fs/promises';
import * as path from 'path';

export type CucumberStepStatus = 'passed' | 'failed' | 'skipped' | 'pending' | 'undefined' | 'unknown';
export type CucumberScenarioStatus = 'passed' | 'failed' | 'skipped' | 'unknown';

export interface CucumberStepResult {
  id?: string;
  text: string;
  keyword?: string;
  kind?: 'step' | 'hook';
  hookId?: string;
  hookType?: string;
  uri?: string;
  line?: number;
  status: CucumberStepStatus;
  durationMs?: number;
  errorMessage?: string;
  stackTrace?: string;
  logs?: string[];
}

export interface CucumberScenarioResult {
  id?: string;
  name: string;
  uri?: string;
  line?: number;
  exampleLine?: number;
  exampleValues?: Record<string, string>;
  status: CucumberScenarioStatus;
  durationMs?: number;
  steps: CucumberStepResult[];
  errorMessage?: string;
  stackTrace?: string;
  logs?: string[];
}

export interface CucumberRunResult {
  scenarios: CucumberScenarioResult[];
  stdout: string;
  stderr: string;
  reportPath?: string;
}

export interface CucumberExecutionResult {
  status: 'passed' | 'failed' | 'errored';
  message: string;
}

interface ParseOptions {
  stdout?: string;
  stderr?: string;
  reportPath?: string;
  cwd?: string;
}

interface GherkinScenarioInfo {
  id: string;
  name: string;
  uri?: string;
  line?: number;
}

interface GherkinStepInfo {
  id: string;
  keyword?: string;
  text: string;
  uri?: string;
  line?: number;
}

interface GherkinExampleRowInfo {
  id: string;
  line?: number;
  values: Record<string, string>;
}

interface AttachmentInfo {
  testCaseStartedId?: string;
  testStepId?: string;
  body?: string;
  mediaType?: string;
  contentEncoding?: string;
  fileName?: string;
  url?: string;
}

interface HookInfo {
  id: string;
  name?: string;
  tagExpression?: string;
  type?: string;
  uri?: string;
  line?: number;
}

type MessageEnvelope = Record<string, any>;

export async function parseCucumberMessageReport(
  reportPath: string,
  stdout = '',
  stderr = '',
  cwd = process.cwd()
): Promise<CucumberRunResult> {
  const content = await fs.readFile(reportPath, 'utf8');
  return parseCucumberMessageNdjson(content, { stdout, stderr, reportPath, cwd });
}

export function parseCucumberMessageNdjson(content: string, options: ParseOptions = {}): CucumberRunResult {
  const envelopes = parseEnvelopes(content);
  if (envelopes.length === 0) {
    throw new Error('Cucumber message report is empty.');
  }

  const scenarioByAstNodeId = new Map<string, GherkinScenarioInfo>();
  const stepByAstNodeId = new Map<string, GherkinStepInfo>();
  const exampleRowByAstNodeId = new Map<string, GherkinExampleRowInfo>();
  const pickleById = new Map<string, any>();
  const testCaseById = new Map<string, any>();
  const testCaseStartedToCaseId = new Map<string, string>();
  const stepFinishedByKey = new Map<string, any>();
  const stepStartedOrderByStartedId = new Map<string, string[]>();
  const stepFinishedOrderByStartedId = new Map<string, string[]>();
  const hookById = new Map<string, HookInfo>();
  const attachments: AttachmentInfo[] = [];

  for (const envelope of envelopes) {
    if (envelope.gherkinDocument) {
      indexGherkinDocument(envelope.gherkinDocument, scenarioByAstNodeId, stepByAstNodeId, exampleRowByAstNodeId, options.cwd);
    }
    if (envelope.pickle) {
      pickleById.set(envelope.pickle.id, envelope.pickle);
    }
    if (envelope.testCase) {
      testCaseById.set(envelope.testCase.id, envelope.testCase);
    }
    if (envelope.testCaseStarted) {
      testCaseStartedToCaseId.set(envelope.testCaseStarted.id, envelope.testCaseStarted.testCaseId);
    }
    if (envelope.testStepStarted) {
      const started = envelope.testStepStarted;
      addStepEventOrder(stepStartedOrderByStartedId, started.testCaseStartedId, started.testStepId);
    }
    if (envelope.testStepFinished) {
      const finished = envelope.testStepFinished;
      stepFinishedByKey.set(stepKey(finished.testCaseStartedId, finished.testStepId), finished);
      addStepEventOrder(stepFinishedOrderByStartedId, finished.testCaseStartedId, finished.testStepId);
    }
    if (envelope.hook) {
      hookById.set(envelope.hook.id, toHookInfo(envelope.hook, options.cwd));
    }
    if (envelope.attachment) {
      attachments.push(envelope.attachment);
    }
  }

  const scenarios: CucumberScenarioResult[] = [];
  for (const [testCaseStartedId, testCaseId] of testCaseStartedToCaseId) {
    const testCase = testCaseById.get(testCaseId);
    const pickle = testCase ? pickleById.get(testCase.pickleId) : undefined;
    if (!testCase || !pickle) {
      continue;
    }

    const scenarioInfo = findScenarioInfo(pickle, scenarioByAstNodeId);
    const exampleInfo = findExampleRowInfo(pickle, exampleRowByAstNodeId);
    const scenarioLogs = logsForAttachments(attachments, testCaseStartedId);
    const stepOrder = stepStartedOrderByStartedId.get(testCaseStartedId) ?? stepFinishedOrderByStartedId.get(testCaseStartedId);
    const steps = buildStepResults(testCase, pickle, testCaseStartedId, stepFinishedByKey, stepByAstNodeId, hookById, attachments, stepOrder);
    const durationMs = sumDurations(steps);
    const failedStep = steps.find((step) => step.status === 'failed');

    scenarios.push({
      id: pickle.id,
      name: scenarioInfo?.name ?? pickle.name,
      uri: scenarioInfo?.uri ?? resolveUri(pickle.uri, options.cwd),
      line: scenarioInfo?.line,
      exampleLine: exampleInfo?.line,
      exampleValues: exampleInfo?.values,
      status: scenarioStatus(steps),
      durationMs,
      steps,
      errorMessage: failedStep?.errorMessage,
      stackTrace: failedStep?.stackTrace,
      logs: scenarioLogs.length > 0 ? scenarioLogs : undefined
    });
  }

  return {
    scenarios,
    stdout: options.stdout ?? '',
    stderr: options.stderr ?? '',
    reportPath: options.reportPath
  };
}

function addStepEventOrder(map: Map<string, string[]>, testCaseStartedId: string | undefined, testStepId: string | undefined): void {
  if (!testCaseStartedId || !testStepId) {
    return;
  }
  const order = map.get(testCaseStartedId) ?? [];
  if (!order.includes(testStepId)) {
    order.push(testStepId);
    map.set(testCaseStartedId, order);
  }
}

export function formatCucumberRunResult(result: CucumberRunResult): string {
  const lines: string[] = [];
  if (result.reportPath) {
    lines.push(`Report: ${result.reportPath}`);
    lines.push('');
  }

  for (const scenario of result.scenarios) {
    const feature = scenario.uri ? path.basename(scenario.uri) : 'unknown feature';
    lines.push(`Feature: ${feature}`);
    lines.push(scenario.exampleLine ? `Scenario Outline: ${scenario.name}` : `Scenario: ${scenario.name}`);
    if (scenario.exampleLine) {
      lines.push(`Example: ${formatExampleValues(scenario.exampleValues)}${scenario.exampleLine ? ` (line ${scenario.exampleLine})` : ''}`);
    }
    lines.push(`Status: ${scenario.status}`);
    if (scenario.durationMs !== undefined) {
      lines.push(`Duration: ${scenario.durationMs}ms`);
    }
    if (scenario.uri) {
      lines.push(`Location: ${scenario.uri}${scenario.line ? `:${scenario.line}` : ''}`);
    }
    if (scenario.logs?.length) {
      lines.push('Logs:');
      scenario.logs.forEach((log) => lines.push(indent(log, '  ')));
    }
    if (scenario.errorMessage) {
      lines.push('Error:');
      lines.push(indent(scenario.errorMessage, '  '));
    }
    if (scenario.stackTrace) {
      lines.push('Stack:');
      lines.push(indent(scenario.stackTrace, '  '));
    }

    lines.push('');
    lines.push('Steps:');
    for (const step of orderScenarioStepsForExplorer(scenario.steps)) {
      const prefix = statusPrefix(step.status);
      const duration = step.durationMs !== undefined ? ` (${step.durationMs}ms)` : '';
      lines.push(`  ${prefix} ${formatCucumberStepLabel(step)}${duration}`.trimEnd());
      if (step.logs?.length) {
        lines.push('    Logs:');
        step.logs.forEach((log) => lines.push(indent(log, '      ')));
      }
      if (step.errorMessage) {
        lines.push('    Error:');
        lines.push(indent(step.errorMessage, '      '));
      }
      if (step.stackTrace) {
        lines.push('    Stack:');
        lines.push(indent(step.stackTrace, '      '));
      }
    }
    lines.push('');
  }

  if (result.scenarios.length === 0) {
    lines.push('No scenario results were found in the Cucumber message report.');
  }

  return lines.join('\n');
}

export function formatCucumberStepLabel(step: Pick<CucumberStepResult, 'keyword' | 'text'>): string {
  return `${step.keyword ?? ''}${step.text}`.replace(/\s+/g, ' ').trim();
}

export function orderScenarioStepsForExplorer(steps: readonly CucumberStepResult[]): CucumberStepResult[] {
  const beforeCaseHooks = steps.filter(isBeforeCaseHook);
  const afterCaseHooks = steps.filter(isAfterCaseHook);
  const middle = steps.filter((step) => !isBeforeCaseHook(step) && !isAfterCaseHook(step));
  return [...beforeCaseHooks, ...middle, ...afterCaseHooks];
}

export function isBeforeCaseHook(step: CucumberStepResult): boolean {
  if (step.kind !== 'hook') {
    return false;
  }
  if (step.hookType === 'BEFORE_TEST_CASE') {
    return true;
  }
  const label = formatCucumberStepLabel(step);
  return label.startsWith('Before ') && !label.startsWith('BeforeStep ');
}

export function isAfterCaseHook(step: CucumberStepResult): boolean {
  if (step.kind !== 'hook') {
    return false;
  }
  if (step.hookType === 'AFTER_TEST_CASE') {
    return true;
  }
  const label = formatCucumberStepLabel(step);
  return label.startsWith('After ') && !label.startsWith('AfterStep ');
}

export function parseCucumberResult(exitCode: number, stdout: string, stderr: string): CucumberExecutionResult {
  if (exitCode === 0) {
    return {
      status: 'passed',
      message: 'Cucumber finished successfully.'
    };
  }

  const fallback = stderr.trim().length > 0 ? stderr : stdout.trim().length > 0 ? stdout : `Cucumber exited with code ${exitCode}`;
  return {
    status: 'failed',
    message: fallback
  };
}

function parseEnvelopes(content: string): MessageEnvelope[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as MessageEnvelope;
      } catch (error) {
        throw new Error(`Invalid Cucumber message JSON on line ${index + 1}: ${String(error)}`);
      }
    });
}

function indexGherkinDocument(
  document: any,
  scenarioByAstNodeId: Map<string, GherkinScenarioInfo>,
  stepByAstNodeId: Map<string, GherkinStepInfo>,
  exampleRowByAstNodeId: Map<string, GherkinExampleRowInfo>,
  cwd?: string
): void {
  const uri = resolveUri(document.uri, cwd);
  const visitChildren = (children: any[] | undefined): void => {
    for (const child of children ?? []) {
      if (child.scenario) {
        const scenario = child.scenario;
        scenarioByAstNodeId.set(scenario.id, {
          id: scenario.id,
          name: scenario.name,
          uri,
          line: scenario.location?.line
        });
        for (const step of scenario.steps ?? []) {
          stepByAstNodeId.set(step.id, {
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
            exampleRowByAstNodeId.set(row.id, {
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

function buildStepResults(
  testCase: any,
  pickle: any,
  testCaseStartedId: string,
  stepFinishedByKey: Map<string, any>,
  stepByAstNodeId: Map<string, GherkinStepInfo>,
  hookById: Map<string, HookInfo>,
  attachments: AttachmentInfo[],
  stepOrder?: string[]
): CucumberStepResult[] {
  const pickleStepsById = new Map<string, any>((pickle.steps ?? []).map((step: any) => [step.id, step]));
  const testSteps = orderedTestSteps(testCase.testSteps ?? [], stepOrder);
  const results: CucumberStepResult[] = [];

  for (const testStep of testSteps) {
    const finished = stepFinishedByKey.get(stepKey(testCaseStartedId, testStep.id));
    const testStepResult = finished?.testStepResult;
    const error = extractError(testStepResult);
    const logs = logsForAttachments(attachments, testCaseStartedId, testStep.id);

    if (testStep.hookId) {
      const hook = hookById.get(testStep.hookId);
      const label = formatHookLabel(hook);
      results.push({
        id: testStep.id,
        kind: 'hook',
        hookId: testStep.hookId,
        hookType: hook?.type,
        keyword: label.keyword,
        text: label.text,
        uri: hook?.uri,
        line: hook?.line,
        status: normalizeStepStatus(testStepResult?.status),
        durationMs: durationToMs(testStepResult?.duration),
        errorMessage: error.message,
        stackTrace: error.stackTrace,
        logs: logs.length > 0 ? logs : undefined
      });
      continue;
    }

    if (!testStep.pickleStepId) {
      continue;
    }

    const pickleStep = pickleStepsById.get(testStep.pickleStepId);
    const stepInfo = findStepInfo(pickleStep, stepByAstNodeId);

    results.push({
      id: testStep.pickleStepId,
      kind: 'step',
      text: pickleStep?.text ?? stepInfo?.text ?? testStep.pickleStepId,
      keyword: stepInfo?.keyword,
      uri: stepInfo?.uri,
      line: stepInfo?.line,
      status: normalizeStepStatus(testStepResult?.status),
      durationMs: durationToMs(testStepResult?.duration),
      errorMessage: error.message,
      stackTrace: error.stackTrace,
      logs: logs.length > 0 ? logs : undefined
    });
  }

  return results;
}

function orderedTestSteps(testSteps: any[], stepOrder: string[] | undefined): any[] {
  if (!stepOrder || stepOrder.length === 0) {
    return testSteps;
  }

  const byId = new Map<string, any>(testSteps.map((step) => [step.id, step]));
  const ordered: any[] = [];
  const used = new Set<string>();
  for (const id of stepOrder) {
    const step = byId.get(id);
    if (step) {
      ordered.push(step);
      used.add(id);
    }
  }
  return [...ordered, ...testSteps.filter((step) => !used.has(step.id))];
}

function findScenarioInfo(pickle: any, scenarioByAstNodeId: Map<string, GherkinScenarioInfo>): GherkinScenarioInfo | undefined {
  for (const astNodeId of pickle.astNodeIds ?? []) {
    const scenario = scenarioByAstNodeId.get(astNodeId);
    if (scenario) {
      return scenario;
    }
  }
  return undefined;
}

function findExampleRowInfo(pickle: any, exampleRowByAstNodeId: Map<string, GherkinExampleRowInfo>): GherkinExampleRowInfo | undefined {
  for (const astNodeId of pickle.astNodeIds ?? []) {
    const row = exampleRowByAstNodeId.get(astNodeId);
    if (row) {
      return row;
    }
  }
  return undefined;
}

function findStepInfo(pickleStep: any, stepByAstNodeId: Map<string, GherkinStepInfo>): GherkinStepInfo | undefined {
  for (const astNodeId of pickleStep?.astNodeIds ?? []) {
    const step = stepByAstNodeId.get(astNodeId);
    if (step) {
      return step;
    }
  }
  return undefined;
}

function toHookInfo(hook: any, cwd: string | undefined): HookInfo {
  return {
    id: hook.id,
    name: hook.name,
    tagExpression: hook.tagExpression,
    type: hook.type,
    uri: resolveUri(hook.sourceReference?.uri, cwd),
    line: hook.sourceReference?.location?.line
  };
}

function formatHookLabel(hook: HookInfo | undefined): { keyword: string; text: string } {
  const keyword = hookKeyword(hook?.type);
  const suffix = hook?.name || hook?.tagExpression || 'hook';
  return {
    keyword,
    text: suffix
  };
}

function hookKeyword(type: string | undefined): string {
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

function normalizeStepStatus(status: string | undefined): CucumberStepStatus {
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

function scenarioStatus(steps: CucumberStepResult[]): CucumberScenarioStatus {
  if (steps.some((step) => step.status === 'failed' || step.status === 'undefined' || step.status === 'pending')) {
    return 'failed';
  }
  if (steps.length > 0 && steps.every((step) => step.status === 'passed')) {
    return 'passed';
  }
  if (steps.length > 0 && steps.every((step) => step.status === 'skipped')) {
    return 'skipped';
  }
  return 'unknown';
}

function durationToMs(duration: any): number | undefined {
  if (!duration) {
    return undefined;
  }

  const seconds = Number(duration.seconds ?? 0);
  const nanos = Number(duration.nanos ?? 0);
  return Math.round((seconds * 1000) + (nanos / 1_000_000));
}

function sumDurations(steps: CucumberStepResult[]): number | undefined {
  const durations = steps
    .map((step) => step.durationMs)
    .filter((duration): duration is number => duration !== undefined);
  if (durations.length === 0) {
    return undefined;
  }
  return durations.reduce((total, duration) => total + duration, 0);
}

function extractError(testStepResult: any): { message?: string; stackTrace?: string } {
  const exception = testStepResult?.exception;
  return {
    message: exception?.message ?? testStepResult?.message,
    stackTrace: exception?.stackTrace
  };
}

function logsForAttachments(attachments: AttachmentInfo[], testCaseStartedId: string, testStepId?: string): string[] {
  return attachments
    .filter((attachment) =>
      attachment.testCaseStartedId === testCaseStartedId &&
      (testStepId ? attachment.testStepId === testStepId : !attachment.testStepId)
    )
    .map(formatAttachment);
}

function formatAttachment(attachment: AttachmentInfo): string {
  if (attachment.body) {
    if (attachment.contentEncoding?.toLowerCase() === 'base64') {
      return Buffer.from(attachment.body, 'base64').toString('utf8');
    }
    return attachment.body;
  }
  if (attachment.url) {
    return attachment.url;
  }
  if (attachment.fileName) {
    return attachment.fileName;
  }
  return attachment.mediaType ? `[${attachment.mediaType} attachment]` : '[attachment]';
}

function statusPrefix(status: CucumberStepStatus): string {
  switch (status) {
    case 'passed':
      return '[PASS]';
    case 'failed':
      return '[FAIL]';
    case 'skipped':
      return '[SKIP]';
    case 'pending':
      return '[PENDING]';
    case 'undefined':
      return '[UNDEFINED]';
    default:
      return '[UNKNOWN]';
  }
}

function formatExampleValues(values: Record<string, string> | undefined): string {
  const entries = Object.entries(values ?? {});
  if (entries.length === 0) {
    return 'unknown example row';
  }
  const visible = entries.slice(0, 3).map(([key, value]) => `${key}=${value}`);
  return `${visible.join(', ')}${entries.length > visible.length ? ', ...' : ''}`;
}

function stepKey(testCaseStartedId: string, testStepId: string): string {
  return `${testCaseStartedId}:${testStepId}`;
}

function resolveUri(uri: string | undefined, cwd?: string): string | undefined {
  if (!uri) {
    return undefined;
  }
  if (path.isAbsolute(uri)) {
    return path.normalize(uri);
  }
  if (/^[a-z]+:\/\//i.test(uri)) {
    return uri;
  }
  return path.normalize(path.join(cwd ?? process.cwd(), uri));
}

function indent(value: string, prefix: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
