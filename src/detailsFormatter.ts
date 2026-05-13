import * as path from 'path';
import { CucumberScenarioResult, CucumberStepResult, formatCucumberStepLabel, orderScenarioStepsForExplorer } from './resultParser';

export interface StepDetailsContext {
  scenario: CucumberScenarioResult;
  step: CucumberStepResult;
}

export interface DetailsFormatOptions {
  processOutput?: string;
}

export function formatScenarioDetails(scenario: CucumberScenarioResult, options: DetailsFormatOptions = {}): string {
  const lines: string[] = [];
  lines.push(scenario.exampleLine ? `Scenario Outline: ${scenario.name}` : `Scenario: ${scenario.name}`);
  if (scenario.uri) {
    lines.push(`Feature: ${path.basename(scenario.uri)}`);
    lines.push(`Location: ${scenario.uri}${scenario.exampleLine ?? scenario.line ? `:${scenario.exampleLine ?? scenario.line}` : ''}`);
  }
  if (scenario.exampleValues) {
    lines.push(`Example: ${formatValues(scenario.exampleValues)}`);
  }
  lines.push(`Status: ${scenario.status}`);
  if (scenario.durationMs !== undefined) {
    lines.push(`Duration: ${scenario.durationMs}ms`);
  }
  if (scenario.errorMessage) {
    lines.push('');
    lines.push(`Error: ${scenario.errorMessage}`);
  }
  if (scenario.stackTrace) {
    lines.push('Stack:');
    lines.push(indent(scenario.stackTrace, '  '));
  }
  if (scenario.logs?.length) {
    lines.push('');
    lines.push('Logs:');
    scenario.logs.forEach((log) => lines.push(indent(log, '  ')));
  }
  const stepLogs = scenario.steps.flatMap((step) =>
    (step.logs ?? []).map((log) => `${formatCucumberStepLabel(step)}\n${indent(log, '  ')}`.trimEnd())
  );
  if (stepLogs.length > 0) {
    lines.push('');
    lines.push('Step logs:');
    stepLogs.forEach((log) => lines.push(indent(log, '  ')));
  }
  appendProcessOutput(lines, options.processOutput);

  lines.push('');
  lines.push('Steps:');
  orderScenarioStepsForExplorer(scenario.steps).forEach((step) => {
    const duration = step.durationMs !== undefined ? ` (${step.durationMs}ms)` : '';
    lines.push(`  ${statusPrefix(step.status)} ${formatCucumberStepLabel(step)}${duration}`.trimEnd());
    if (step.errorMessage) {
      lines.push(`    Error: ${step.errorMessage}`);
    }
  });

  return lines.join('\n');
}

export function formatStepDetails(context: StepDetailsContext, options: DetailsFormatOptions = {}): string {
  const { scenario, step } = context;
  const lines: string[] = [];
  lines.push(`${step.kind === 'hook' ? 'Hook' : 'Step'}: ${formatCucumberStepLabel(step)}`);
  lines.push(`Status: ${step.status}`);
  if (step.durationMs !== undefined) {
    lines.push(`Duration: ${step.durationMs}ms`);
  }
  if (step.uri ?? scenario.uri) {
    lines.push(`Location: ${step.uri ?? scenario.uri}${step.line ? `:${step.line}` : ''}`);
  }
  lines.push(`Parent: ${scenario.exampleLine ? 'Scenario Outline' : 'Scenario'}: ${scenario.name}`);
  if (scenario.exampleValues) {
    lines.push(`Example: ${formatValues(scenario.exampleValues)}`);
  }
  if (step.status === 'skipped' && !step.errorMessage) {
    lines.push('Reason: Step was skipped because a previous step failed.');
  }
  if (step.logs?.length) {
    lines.push('');
    lines.push('Logs:');
    step.logs.forEach((log) => lines.push(indent(log, '  ')));
  }
  if (step.errorMessage) {
    lines.push('');
    lines.push(`Error: ${step.errorMessage}`);
  }
  if (step.stackTrace) {
    lines.push('Stack:');
    lines.push(indent(step.stackTrace, '  '));
  }
  appendProcessOutput(lines, options.processOutput);

  return lines.join('\n');
}

export function detailsTextToHtml(title: string, text: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    pre { white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
  </style>
</head>
<body>
  <pre>${escapeHtml(text)}</pre>
</body>
</html>`;
}

function statusPrefix(status: string): string {
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

function formatValues(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join(', ');
}

function appendProcessOutput(lines: string[], processOutput: string | undefined): void {
  const normalized = processOutput?.trim();
  if (!normalized) {
    return;
  }
  lines.push('');
  lines.push('Process output:');
  lines.push(indent(normalized, '  '));
}

function indent(value: string, prefix: string): string {
  return value.split(/\r?\n/).map((line) => `${prefix}${line}`).join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
