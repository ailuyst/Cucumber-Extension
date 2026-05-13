import { CucumberScenarioResult, CucumberStepResult } from './resultParser';

export function formatFailureMessage(result: CucumberScenarioResult | CucumberStepResult): string {
  const lines: string[] = [];
  if (result.logs?.length) {
    lines.push('Logs:');
    result.logs.forEach((log) => lines.push(indentForMessage(log, '  ')));
  }

  if (isScenarioResult(result)) {
    const stepLogs = result.steps.flatMap((step) =>
      (step.logs ?? []).map((log) => ({
        stepName: `${step.keyword ?? ''}${step.text}`.trim(),
        log
      }))
    );
    if (stepLogs.length > 0) {
      if (lines.length > 0) {
        lines.push('');
      }
      lines.push('Step logs:');
      stepLogs.forEach(({ stepName, log }) => {
        lines.push(`  ${stepName}`);
        lines.push(indentForMessage(log, '    '));
      });
    }
  }

  if (result.errorMessage) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Error:');
    lines.push(indentForMessage(result.errorMessage, '  '));
  }
  if (result.stackTrace) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Stack:');
    lines.push(indentForMessage(result.stackTrace, '  '));
  }

  return lines.join('\n') || 'Cucumber test failed.';
}

function isScenarioResult(result: CucumberScenarioResult | CucumberStepResult): result is CucumberScenarioResult {
  return Array.isArray((result as CucumberScenarioResult).steps);
}

function indentForMessage(value: string, prefix: string): string {
  return value.split(/\r?\n/).map((line) => `${prefix}${line}`).join('\n');
}
