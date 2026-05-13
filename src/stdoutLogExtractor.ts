const CUCUMBER_SERVICE_LINE_PATTERNS = [
  /^[.FUSPA]+$/u,
  /^\d+\s+scenarios?\s+\(/iu,
  /^\d+\s+steps?\s+\(/iu,
  /^\d+m.*\(executing steps:/iu,
  /^Failures?:$/iu,
  /^Warnings?:$/iu,
  /^Debugger attached\.$/iu,
  /^Waiting for the debugger to disconnect\.\.\.$/iu,
  /^Debugger listening on /iu,
  /^For help, see: /iu
];

export function extractLikelyUserStdoutLines(stdout: string | undefined): string[] {
  if (!stdout) {
    return [];
  }

  const lines = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const filtered = lines.filter((line) => !isCucumberServiceLine(line.trim()));
  return trimOuterBlankLines(filtered);
}

export function groupStdoutLinesForStepMapping(lines: string[]): string[] {
  const groups: string[] = [];
  for (const line of lines) {
    if (line === '' && groups.length > 0) {
      groups[groups.length - 1] = `${groups[groups.length - 1]}\n`;
      continue;
    }
    groups.push(line);
  }
  return groups;
}

function isCucumberServiceLine(line: string): boolean {
  if (/^A+$/u.test(line)) {
    return false;
  }
  return CUCUMBER_SERVICE_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') {
    start += 1;
  }
  while (end > start && lines[end - 1] === '') {
    end -= 1;
  }
  return lines.slice(start, end);
}
