import { CucumberScenarioResult } from './resultParser';
import { extractLikelyUserStdoutLines, groupStdoutLinesForStepMapping } from './stdoutLogExtractor';

export function attachBestEffortStdoutLogs(
  scenarios: CucumberScenarioResult[],
  stdout: string | undefined
): CucumberScenarioResult[] {
  if (hasStructuredLogs(scenarios)) {
    return scenarios;
  }

  const stdoutLines = groupStdoutLinesForStepMapping(extractLikelyUserStdoutLines(stdout));
  if (stdoutLines.length === 0) {
    return scenarios;
  }

  let lineIndex = 0;
  return scenarios.map((scenario) => ({
    ...scenario,
    steps: scenario.steps.map((step) => {
      if (step.status === 'skipped' || lineIndex >= stdoutLines.length) {
        return step;
      }
      const logs = [...(step.logs ?? []), stdoutLines[lineIndex]];
      lineIndex += 1;
      return { ...step, logs };
    })
  }));
}

function hasStructuredLogs(scenarios: CucumberScenarioResult[]): boolean {
  return scenarios.some((scenario) =>
    (scenario.logs?.length ?? 0) > 0 ||
    scenario.steps.some((step) => (step.logs?.length ?? 0) > 0)
  );
}
