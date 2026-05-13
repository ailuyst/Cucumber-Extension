import * as path from 'path';

export type CucumberReportFormat = 'message' | 'json' | 'stdout' | string;

export interface BuildCucumberCommandOptions {
  command: string;
  cwd: string;
  targets: string[];
  format: CucumberReportFormat;
  reportOutputPath?: string;
  configFileOverride?: string;
}

export interface BuildCucumberArgsOptions {
  executable: string;
  configuredArgs: string[];
  cwd: string;
  targets: string[];
  format: CucumberReportFormat;
  reportOutputPath?: string;
  configFileOverride?: string;
}

export interface BuiltCucumberCommand {
  executable: string;
  args: string[];
  displayCommand: string;
}

export function buildCucumberCommand(options: BuildCucumberCommandOptions): BuiltCucumberCommand {
  const [executable, ...configuredArgs] = splitCommand(options.command);
  const args = buildCucumberArgs({
    executable,
    configuredArgs,
    cwd: options.cwd,
    targets: options.targets,
    format: options.format,
    reportOutputPath: options.reportOutputPath,
    configFileOverride: options.configFileOverride
  });

  return {
    executable,
    args,
    displayCommand: formatCommandForLog(executable, args)
  };
}

export function buildCucumberArgs(options: BuildCucumberArgsOptions): string[] {
  const configuredArgs = options.configFileOverride
    ? removeConfigArgs(options.configuredArgs)
    : options.configuredArgs;
  const targetArgs = options.targets.map((target) => normalizeCucumberTarget(target, options.cwd));
  const formatterArgs = buildFormatterArgs(options.format, options.reportOutputPath);
  const configArgs = options.configFileOverride ? ['--config', normalizeCucumberTarget(options.configFileOverride, options.cwd)] : [];
  const needsPassthrough = isNpmCommand(options.executable, configuredArgs) &&
    (configArgs.length > 0 || targetArgs.length > 0 || formatterArgs.length > 0) &&
    !configuredArgs.includes('--');

  return [
    ...configuredArgs,
    ...(needsPassthrough ? ['--'] : []),
    ...configArgs,
    ...targetArgs,
    ...formatterArgs
  ];
}

export function splitCommand(command: string): string[] {
  const parts = command.match(/"[^"]+"|'[^']+'|\S+/g) ?? ['npx', 'cucumber-js'];
  return parts.map((part) => part.replace(/^["']|["']$/g, ''));
}

export function normalizeCucumberTarget(target: string, cwd: string): string {
  const parsed = splitTargetLine(target);
  const targetPath = parsed.path;
  const normalizedPath = path.normalize(targetPath);
  const normalizedCwd = path.normalize(cwd);
  const relativePath = path.isAbsolute(targetPath) && isInsideOrEqual(normalizedPath, normalizedCwd)
    ? path.relative(normalizedCwd, normalizedPath)
    : targetPath;
  const cucumberPath = relativePath.split(path.sep).join('/');
  return parsed.line ? `${cucumberPath}:${parsed.line}` : cucumberPath;
}

export function formatCommandForLog(executable: string, args: string[]): string {
  return [executable, ...args].map(quoteForDisplay).join(' ');
}

function buildFormatterArgs(format: CucumberReportFormat, reportOutputPath?: string): string[] {
  if (!reportOutputPath) {
    return [];
  }
  if (format === 'message') {
    return ['--format', `message:${reportOutputPath}`];
  }
  if (format === 'json') {
    return ['--format', `json:${reportOutputPath}`];
  }
  return [];
}

function splitTargetLine(target: string): { path: string; line?: number } {
  const match = /^(.*):(\d+)$/.exec(target);
  return match ? { path: match[1], line: Number(match[2]) } : { path: target };
}

function isInsideOrEqual(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isNpmCommand(executable: string, configuredArgs: string[]): boolean {
  const executableName = path.basename(executable).toLowerCase();
  return (executableName === 'npm' || executableName === 'npm.cmd') &&
    (configuredArgs[0] === 'run' || configuredArgs[0] === 'test');
}

function removeConfigArgs(args: string[]): string[] {
  const next: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--config' || arg === '-c') {
      index++;
      continue;
    }
    if (arg.startsWith('--config=')) {
      continue;
    }
    next.push(arg);
  }
  return next;
}

function quoteForDisplay(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
