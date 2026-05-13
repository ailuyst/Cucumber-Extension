export type CucumberHookType = 'BEFORE_TEST_CASE' | 'AFTER_TEST_CASE' | 'BEFORE_TEST_STEP' | 'AFTER_TEST_STEP';

export interface DiscoveredHook {
  type: CucumberHookType;
  keyword: string;
  label: string;
  tagExpression?: string;
  uri?: string;
  line?: number;
  ordinal: number;
}

export interface ScenarioHookSet {
  before: DiscoveredHook[];
  beforeStep: DiscoveredHook[];
  afterStep: DiscoveredHook[];
  after: DiscoveredHook[];
}

const hookKeywordByMethod: Record<string, { type: CucumberHookType; keyword: string }> = {
  Before: { type: 'BEFORE_TEST_CASE', keyword: 'Before ' },
  After: { type: 'AFTER_TEST_CASE', keyword: 'After ' },
  BeforeStep: { type: 'BEFORE_TEST_STEP', keyword: 'BeforeStep ' },
  AfterStep: { type: 'AFTER_TEST_STEP', keyword: 'AfterStep ' }
};

export function parseCucumberHooksFromSource(source: string, uri?: string): DiscoveredHook[] {
  const hooks: DiscoveredHook[] = [];
  const callPattern = /\b(BeforeStep|AfterStep|Before|After)\s*\(/gu;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(source))) {
    const method = match[1];
    const hookInfo = hookKeywordByMethod[method];
    const callSource = balancedCallSource(source, match.index) ?? source.slice(match.index, source.indexOf('\n', match.index) === -1 ? undefined : source.indexOf('\n', match.index));
    const tagExpression = extractTagExpression(callSource);
    const text = tagExpression ?? 'hook';
    hooks.push({
      type: hookInfo.type,
      keyword: hookInfo.keyword,
      label: `${hookInfo.keyword}${text}`.replace(/\s+/g, ' ').trim(),
      tagExpression,
      uri,
      line: lineNumberAt(source, match.index),
      ordinal: hooks.length
    });
    callPattern.lastIndex = Math.max(callPattern.lastIndex, match.index + callSource.length);
  }
  return hooks;
}

export function hooksForTags(hooks: readonly DiscoveredHook[], tags: readonly string[]): ScenarioHookSet {
  return {
    before: hooks.filter((hook) => hook.type === 'BEFORE_TEST_CASE' && hookMatchesTags(hook, tags)),
    beforeStep: hooks.filter((hook) => hook.type === 'BEFORE_TEST_STEP' && hookMatchesTags(hook, tags)),
    afterStep: hooks.filter((hook) => hook.type === 'AFTER_TEST_STEP' && hookMatchesTags(hook, tags)),
    after: hooks.filter((hook) => hook.type === 'AFTER_TEST_CASE' && hookMatchesTags(hook, tags))
  };
}

export function hookMatchesTags(hook: DiscoveredHook, tags: readonly string[]): boolean {
  if (!hook.tagExpression) {
    return true;
  }
  return evaluateSimpleTagExpression(hook.tagExpression, new Set(tags));
}

function extractTagExpression(argumentSource: string): string | undefined {
  const objectMatch = /\btags\s*:\s*(['"`])([^'"`]+)\1/u.exec(argumentSource);
  if (objectMatch) {
    return objectMatch[2].trim();
  }
  const stringMatch = /\(\s*(['"`])([^'"`]+)\1/u.exec(argumentSource);
  return stringMatch?.[2].trim();
}

function balancedCallSource(source: string, startIndex: number): string | undefined {
  const openIndex = source.indexOf('(', startIndex);
  if (openIndex === -1) {
    return undefined;
  }

  let depth = 0;
  let quote: '"' | '\'' | '`' | undefined;
  let escaped = false;
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

function evaluateSimpleTagExpression(expression: string, tags: Set<string>): boolean {
  const orParts = expression.split(/\s+or\s+/iu).map((part) => part.trim()).filter(Boolean);
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateAndExpression(part, tags));
  }
  return evaluateAndExpression(expression.trim(), tags);
}

function evaluateAndExpression(expression: string, tags: Set<string>): boolean {
  const andParts = expression.split(/\s+and\s+/iu).map((part) => part.trim()).filter(Boolean);
  if (andParts.length === 0) {
    return false;
  }
  return andParts.every((part) => {
    const notMatch = /^not\s+(@[\w-]+)/iu.exec(part);
    if (notMatch) {
      return !tags.has(notMatch[1]);
    }
    const tagMatch = /^@[\w-]+$/u.exec(part);
    return tagMatch ? tags.has(part) : false;
  });
}
