import { execFileSync, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const PROCESS_LAUNCHER_VERSION = '2026-05-12-fix-no-s';
export type ChildEnvironmentMode = 'minimal' | 'allowlist' | 'inherit';
export const SANITIZED_ENV_KEYS = [
  'NODE_OPTIONS',
  'NODE_PATH',
  'ELECTRON_RUN_AS_NODE',
  'VSCODE_INSPECTOR_OPTIONS',
  'VSCODE_IPC_HOOK_CLI'
] as const;
const MINIMAL_ENV_KEYS = [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ComSpec',
  'PATHEXT'
] as const;
export const DEFAULT_ENV_ALLOWLIST = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'PLAYWRIGHT_BROWSERS_PATH',
  'HOME',
  'USERDOMAIN',
  'USERNAME'
] as const;
const DANGEROUS_CHILD_ENV_PATTERN = /^(?:VSCODE|npm_|npm_config_|TS_NODE_)/i;
const DIAGNOSTIC_ENV_PATTERN = /CUCUMBER|NODE|TS_NODE|^npm_|^npm_config|INIT_CWD|VSCODE|ELECTRON/i;

export interface LaunchCommand {
  executable: string;
  args: string[];
  cwd: string;
}

export interface SpawnInvocation {
  executable: string;
  args: string[];
  options: SpawnOptions;
  renderedCommand: string;
  mode: 'direct' | 'windows-cmd' | 'local-cucumber-node' | 'node-diagnostic';
  localCucumberBin?: string;
}

export interface SpawnBuildOptions {
  nodeExecutable?: string;
  environment?: ChildEnvironmentOptions;
}

export interface ChildEnvironmentOptions {
  mode?: ChildEnvironmentMode;
  allowlist?: readonly string[];
  overrides?: NodeJS.ProcessEnv;
  source?: NodeJS.ProcessEnv;
}

export const NODE_DIAGNOSTIC_SCRIPT = [
  'const filteredEnv=Object.fromEntries(Object.entries(process.env)',
  `.filter(([key])=>${DIAGNOSTIC_ENV_PATTERN}.test(key)).sort(([a],[b])=>a.localeCompare(b)));`,
  'const cacheBefore=Object.keys(require.cache).filter((key)=>key.includes("@cucumber")).sort();',
  'const cucumber=require.resolve("@cucumber/cucumber");',
  'const tsnode=require.resolve("ts-node/register");',
  'const cacheAfterResolve=Object.keys(require.cache).filter((key)=>key.includes("@cucumber")).sort();',
  'console.log(JSON.stringify({',
  'execPath:process.execPath,',
  'version:process.version,',
  'cwd:process.cwd(),',
  'argv:process.argv,',
  'cucumber,',
  'tsnode,',
  'cacheBefore,',
  'cacheAfterResolve,',
  'env:filteredEnv',
  '}, null, 2))'
].join('');

export function buildSpawnInvocation(
  command: LaunchCommand,
  platform = process.platform,
  buildOptions: SpawnBuildOptions = {}
): SpawnInvocation {
  const localCucumber = resolveLocalCucumber(command);
  if (localCucumber) {
    const executable = buildOptions.nodeExecutable ?? resolveNodeExecutable(platform);
    const args = [localCucumber.relativeBin, ...localCucumber.args];
    return {
      executable,
      args,
      options: {
        cwd: command.cwd,
        shell: false,
        windowsHide: true,
        stdio: 'pipe',
        env: buildChildEnvForMode(buildOptions.environment ?? { mode: 'minimal' })
      },
      renderedCommand: renderDirectCommand(executable, args),
      mode: 'local-cucumber-node',
      localCucumberBin: localCucumber.absoluteBin
    };
  }

  if (platform === 'win32') {
    const renderedCommand = renderWindowsCommand(command.executable, command.args);
    return {
      executable: 'cmd.exe',
      args: ['/d', '/c', renderedCommand],
      options: {
        cwd: command.cwd,
        shell: false,
        windowsHide: true,
        stdio: 'pipe',
        env: buildChildEnvForMode(buildOptions.environment ?? { mode: 'inherit' })
      },
      renderedCommand,
      mode: 'windows-cmd'
    };
  }

  return {
    executable: command.executable,
    args: command.args,
    options: {
      cwd: command.cwd,
      shell: false,
      stdio: 'pipe',
      env: buildChildEnvForMode(buildOptions.environment ?? { mode: 'inherit' })
    },
    renderedCommand: renderDirectCommand(command.executable, command.args),
    mode: 'direct'
  };
}

export function buildNodeDiagnosticInvocation(
  cwd: string,
  platform = process.platform,
  buildOptions: SpawnBuildOptions = {}
): SpawnInvocation {
  const executable = buildOptions.nodeExecutable ?? resolveNodeExecutable(platform);
  const args = ['-e', NODE_DIAGNOSTIC_SCRIPT];
  return {
    executable,
    args,
    options: {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: 'pipe',
      env: buildChildEnvForMode(buildOptions.environment ?? { mode: 'minimal' })
    },
    renderedCommand: renderDirectCommand(executable, args),
    mode: 'node-diagnostic'
  };
}

function resolveLocalCucumber(command: LaunchCommand): { absoluteBin: string; relativeBin: string; args: string[] } | undefined {
  const executableName = path.basename(command.executable).toLowerCase();
  const isNpxCucumber = executableName === 'npx' && command.args[0] === 'cucumber-js';
  const isDirectCucumber = executableName === 'cucumber-js' || executableName === 'cucumber-js.cmd';
  if (!isNpxCucumber && !isDirectCucumber) {
    return undefined;
  }

  const relativeBin = localCucumberBinRelativePath();
  const absoluteBin = localCucumberBinPath(command.cwd);
  if (!fs.existsSync(absoluteBin)) {
    return undefined;
  }

  return {
    absoluteBin,
    relativeBin,
    args: isNpxCucumber ? command.args.slice(1) : command.args
  };
}

export function localCucumberBinRelativePath(): string {
  return path.join('node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js');
}

export function localCucumberBinPath(cwd: string): string {
  return path.join(cwd, localCucumberBinRelativePath());
}

export function buildChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  sanitizeChildEnv(env);
  return env;
}

export function buildMinimalChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of MINIMAL_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const key of Object.keys(env)) {
    if (DANGEROUS_CHILD_ENV_PATTERN.test(key) || SANITIZED_ENV_KEYS.includes(key as typeof SANITIZED_ENV_KEYS[number])) {
      delete env[key];
    }
  }

  return env;
}

export function buildChildEnvForMode(options: ChildEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const source = options.source ?? process.env;
  const mode = options.mode ?? 'minimal';
  const env = mode === 'inherit'
    ? { ...source }
    : mode === 'allowlist'
      ? buildAllowlistedChildEnv(source, options.allowlist)
      : buildMinimalChildEnv(source);

  applyEnvOverrides(env, options.overrides);
  sanitizeChildEnv(env);
  return env;
}

export function buildAllowlistedChildEnv(
  source: NodeJS.ProcessEnv = process.env,
  allowlist: readonly string[] = []
): NodeJS.ProcessEnv {
  const env = buildMinimalChildEnv(source);
  const allowedKeys = [...DEFAULT_ENV_ALLOWLIST, ...allowlist];
  for (const key of allowedKeys) {
    const sourceKey = findEnvKey(source, key);
    if (sourceKey && source[sourceKey] !== undefined) {
      env[sourceKey] = source[sourceKey];
    }
  }
  return env;
}

function applyEnvOverrides(env: NodeJS.ProcessEnv, overrides: NodeJS.ProcessEnv | undefined): void {
  if (!overrides) {
    return;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || isDangerousEnvKey(key)) {
      continue;
    }
    env[key] = value;
  }
}

function sanitizeChildEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (isDangerousEnvKey(key)) {
      delete env[key];
    }
  }
}

function isDangerousEnvKey(key: string): boolean {
  return DANGEROUS_CHILD_ENV_PATTERN.test(key) || SANITIZED_ENV_KEYS.some((blocked) => blocked.toLowerCase() === key.toLowerCase());
}

function findEnvKey(source: NodeJS.ProcessEnv, requestedKey: string): string | undefined {
  if (source[requestedKey] !== undefined) {
    return requestedKey;
  }
  const requested = requestedKey.toLowerCase();
  return Object.keys(source).find((key) => key.toLowerCase() === requested);
}

export interface ResolveNodeExecutableOptions {
  platform?: NodeJS.Platform | string;
  env?: NodeJS.ProcessEnv;
  whereOutput?: string;
  exists?: (filePath: string) => boolean;
}

export function resolveNodeExecutable(options: ResolveNodeExecutableOptions | NodeJS.Platform | string = {}): string {
  const resolvedOptions = typeof options === 'string' ? { platform: options } : options;
  const platform = resolvedOptions.platform ?? process.platform;
  const env = resolvedOptions.env ?? process.env;
  const exists = resolvedOptions.exists ?? fs.existsSync;

  if (platform !== 'win32') {
    const npmNode = sanitizeExecutableCandidate(env.npm_node_execpath);
    if (npmNode && exists(npmNode)) {
      return npmNode;
    }
    return 'node';
  }

  const candidates = [
    sanitizeExecutableCandidate(env.npm_node_execpath),
    ...nodeCandidatesFromWhereOutput(resolvedOptions.whereOutput ?? whereNodeOutput())
  ].filter((candidate): candidate is string => !!candidate);

  const resolved = candidates.find((candidate) =>
    path.isAbsolute(candidate) &&
    exists(candidate) &&
    !isVsCodeExecutable(candidate)
  );

  return resolved ?? 'node.exe';
}

function whereNodeOutput(): string {
  try {
    return execFileSync('where.exe', ['node'], {
      encoding: 'utf8',
      windowsHide: true
    });
  } catch {
    return '';
  }
}

function nodeCandidatesFromWhereOutput(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => sanitizeExecutableCandidate(line))
    .filter((candidate): candidate is string => !!candidate);
}

function sanitizeExecutableCandidate(candidate: string | undefined): string | undefined {
  const trimmed = candidate?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^"+|"+$/g, '');
}

function isVsCodeExecutable(candidate: string): boolean {
  return /Microsoft VS Code|Code\.exe/i.test(candidate);
}

export function renderWindowsCommand(executable: string, args: string[]): string {
  return [executable, ...args].map((arg) => quoteWindowsArg(arg)).join(' ');
}

export function quoteWindowsArg(arg: string): string {
  if (!/[\s&()^|<>"]/u.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}

function renderDirectCommand(executable: string, args: string[]): string {
  return [executable, ...args].map((arg) => /\s/u.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg).join(' ');
}
