export interface StepDefinitionMatch {
  keyword: string;
  pattern: string;
  line: number;
}

const STEP_DEFINITION_PATTERN = /\b(Given|When|Then|And|But|defineStep)\s*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|\/((?:\\\/|[^/])*)\/([a-z]*))/g;

export function stripGherkinKeyword(line: string): string | undefined {
  const match = /^\s*(Given|When|Then|And|But)\s+(.+?)\s*$/.exec(line);
  return match?.[2];
}

export function findMatchingStepDefinition(source: string, stepText: string): StepDefinitionMatch | undefined {
  const definitions = parseStepDefinitions(source);
  return definitions.find((definition) => stepDefinitionMatches(definition.pattern, stepText));
}

export function parseStepDefinitions(source: string): StepDefinitionMatch[] {
  const matches: StepDefinitionMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = STEP_DEFINITION_PATTERN.exec(source))) {
    matches.push({
      keyword: match[1],
      pattern: match[2] ?? match[3] ?? match[4] ?? `/${match[5]}/${match[6] ?? ''}`,
      line: lineNumberAt(source, match.index)
    });
  }
  return matches;
}

export function stepDefinitionMatches(pattern: string, stepText: string): boolean {
  const regex = parseRegexPattern(pattern);
  if (regex) {
    return new RegExp(regex.body, regex.flags).test(stepText);
  }
  return cucumberExpressionToRegExp(pattern).test(stepText);
}

export function stepParameterRanges(pattern: string, stepText: string): Array<{ start: number; end: number }> {
  const regex = parseRegexPattern(pattern);
  if (regex) {
    return regexCaptureRanges(regex.body, regex.flags, stepText);
  }
  return cucumberExpressionParameterRanges(pattern, stepText);
}

export function cucumberExpressionToRegExp(expression: string): RegExp {
  const regex = cucumberExpressionToRegexSource(expression);
  return new RegExp(`^(?:${regex})$`);
}

function cucumberExpressionToRegexSource(expression: string): string {
  const parameterPattern = /\{([^}]+)\}/g;
  let regexSource = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = parameterPattern.exec(expression))) {
    regexSource += escapeRegExp(expression.slice(lastIndex, match.index));
    regexSource += `(?:${parameterTypePattern(match[1])})`;
    lastIndex = match.index + match[0].length;
  }
  regexSource += escapeRegExp(expression.slice(lastIndex));
  return regexSource;
}

function cucumberExpressionParameterRanges(expression: string, stepText: string): Array<{ start: number; end: number }> {
  const parameterPattern = /\{([^}]+)\}/g;
  let regexSource = '^';
  let lastIndex = 0;
  let parameterCount = 0;
  let match: RegExpExecArray | null;
  while ((match = parameterPattern.exec(expression))) {
    regexSource += escapeRegExp(expression.slice(lastIndex, match.index));
    regexSource += `(${parameterTypePattern(match[1])})`;
    parameterCount += 1;
    lastIndex = match.index + match[0].length;
  }
  if (parameterCount === 0) {
    return [];
  }
  regexSource += `${escapeRegExp(expression.slice(lastIndex))}$`;
  return captureRanges(regexSource, '', stepText);
}

function regexCaptureRanges(body: string, flags: string, stepText: string): Array<{ start: number; end: number }> {
  return captureRanges(body, flags, stepText);
}

function captureRanges(body: string, flags: string, stepText: string): Array<{ start: number; end: number }> {
  try {
    const cleanFlags = flags.replace(/[gd]/g, '');
    const regex = new RegExp(body, `${cleanFlags}d`);
    const match = regex.exec(stepText) as RegExpExecArray & { indices?: Array<[number, number] | undefined> };
    return match?.indices?.slice(1)
      .filter((range): range is [number, number] => !!range && range[0] >= 0 && range[1] >= range[0])
      .map(([start, end]) => ({ start, end })) ?? [];
  } catch {
    return [];
  }
}

function parseRegexPattern(pattern: string): { body: string; flags: string } | undefined {
  if (!pattern.startsWith('/')) {
    return undefined;
  }
  const lastSlash = pattern.lastIndexOf('/');
  if (lastSlash <= 0) {
    return undefined;
  }
  return {
    body: pattern.slice(1, lastSlash),
    flags: pattern.slice(lastSlash + 1)
  };
}

function parameterTypePattern(type: string): string {
  switch (type) {
    case 'string':
      return '"[^"]*"|\'[^\']*\'';
    case 'int':
      return '-?\\d+';
    case 'float':
      return '-?\\d+(?:\\.\\d+)?';
    case 'word':
      return '\\S+';
    default:
      return '\\S+';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}
