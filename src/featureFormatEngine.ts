type BlockKind = 'root' | 'feature' | 'scenario' | 'examples';

interface TableBlock {
  indent: number;
  rows: string[][];
}

const featureKeywordPattern = /^(Feature|Ability|Business Need):/iu;
const ruleKeywordPattern = /^Rule:/iu;
const scenarioKeywordPattern = /^(Background|Scenario|Scenario Outline|Scenario Template):/iu;
const examplesKeywordPattern = /^(Examples|Scenarios):/iu;
const stepKeywordPattern = /^(Given|When|Then|And|But|\*)\b/iu;
const docStringPattern = /^("""|```)/u;

export interface FormatFeatureTextOptions {
  indentSize?: number;
  insertSpaces?: boolean;
}

export function formatFeatureText(text: string, options: FormatFeatureTextOptions = {}): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const endsWithEol = /\r?\n$/u.test(text);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (endsWithEol) {
    lines.pop();
  }

  const indentSize = options.indentSize ?? 2;
  const indentUnit = options.insertSpaces === false ? '\t' : ' '.repeat(indentSize);
  const formatted: string[] = [];
  let table: TableBlock | undefined;
  let block: BlockKind = 'root';
  let inDocString = false;
  let docStringIndent = 0;

  const pushTable = () => {
    if (!table) {
      return;
    }
    formatted.push(...formatTableBlock(table, indentUnit));
    table = undefined;
  };

  const pushLine = (line: string) => {
    pushTable();
    formatted.push(line);
  };

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const trimmedRight = raw.trimEnd();
    const trimmed = trimmedRight.trim();

    if (inDocString) {
      if (docStringPattern.test(trimmed)) {
        inDocString = false;
        pushLine(`${indent(indentUnit, docStringIndent)}${trimmed}`);
      } else {
        pushLine(trimmedRight);
      }
      continue;
    }

    if (trimmed.length === 0) {
      pushTable();
      formatted.push('');
      continue;
    }

    if (isTableLine(trimmed)) {
      const row = splitTableRow(trimmed);
      table = table ?? { indent: 3, rows: [] };
      table.rows.push(row);
      continue;
    }

    if (docStringPattern.test(trimmed)) {
      docStringIndent = 3;
      inDocString = true;
      pushLine(`${indent(indentUnit, docStringIndent)}${trimmed}`);
      continue;
    }

    if (/^\s*#/u.test(raw)) {
      pushLine(`${indent(indentUnit, commentIndent(block))}${trimmed}`);
      continue;
    }

    if (/^@/u.test(trimmed)) {
      pushLine(`${indent(indentUnit, tagIndent(nextSignificantLine(lines, index)))}${trimmed}`);
      continue;
    }

    if (/^#\s*language:/iu.test(trimmed) || featureKeywordPattern.test(trimmed)) {
      block = 'feature';
      pushLine(trimmed);
      continue;
    }

    if (ruleKeywordPattern.test(trimmed)) {
      block = 'feature';
      pushLine(`${indent(indentUnit, 1)}${trimmed}`);
      continue;
    }

    if (scenarioKeywordPattern.test(trimmed)) {
      block = 'scenario';
      pushLine(`${indent(indentUnit, 1)}${trimmed}`);
      continue;
    }

    if (examplesKeywordPattern.test(trimmed)) {
      block = 'examples';
      pushLine(`${indent(indentUnit, 2)}${trimmed}`);
      continue;
    }

    if (stepKeywordPattern.test(trimmed)) {
      block = block === 'examples' ? 'scenario' : block;
      pushLine(`${indent(indentUnit, 2)}${trimmed}`);
      continue;
    }

    pushLine(`${indent(indentUnit, fallbackIndent(block))}${trimmed}`);
  }

  pushTable();
  const output = formatted.join(eol);
  return endsWithEol ? `${output}${eol}` : output;
}

function formatTableBlock(table: TableBlock, indentUnit: string): string[] {
  const widths: number[] = [];
  for (const row of table.rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }

  return table.rows.map((row) => {
    const cells = row.map((cell, index) => ` ${cell.padEnd(widths[index] ?? cell.length, ' ')} `);
    return `${indent(indentUnit, table.indent)}|${cells.join('|')}|`;
  });
}

function splitTableRow(line: string): string[] {
  const body = line.replace(/^\|/u, '').replace(/\|$/u, '');
  return body.split('|').map((cell) => cell.trim());
}

function isTableLine(trimmed: string): boolean {
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function nextSignificantLine(lines: string[], index: number): string {
  for (let next = index + 1; next < lines.length; next++) {
    const trimmed = lines[next].trim();
    if (trimmed.length > 0 && !trimmed.startsWith('#')) {
      return trimmed;
    }
  }
  return '';
}

function tagIndent(nextLine: string): number {
  if (featureKeywordPattern.test(nextLine) || /^#\s*language:/iu.test(nextLine)) {
    return 0;
  }
  if (examplesKeywordPattern.test(nextLine)) {
    return 2;
  }
  return 1;
}

function commentIndent(block: BlockKind): number {
  return block === 'root' || block === 'feature' ? 0 : fallbackIndent(block);
}

function fallbackIndent(block: BlockKind): number {
  if (block === 'examples') {
    return 3;
  }
  if (block === 'scenario') {
    return 2;
  }
  if (block === 'feature') {
    return 1;
  }
  return 0;
}

function indent(unit: string, level: number): string {
  return unit.repeat(level);
}
