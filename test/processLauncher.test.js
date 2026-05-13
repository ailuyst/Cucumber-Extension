const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildChildEnv,
  buildMinimalChildEnv,
  buildNodeDiagnosticInvocation,
  buildSpawnInvocation,
  localCucumberBinPath,
  localCucumberBinRelativePath,
  PROCESS_LAUNCHER_VERSION,
  resolveNodeExecutable,
  SANITIZED_ENV_KEYS,
  quoteWindowsArg
} = require('../out/processLauncher');

assert.strictEqual(PROCESS_LAUNCHER_VERSION, '2026-05-12-fix-no-s');
assert.ok(localCucumberBinRelativePath().endsWith(path.join('node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js')));
assert.ok(localCucumberBinPath('C:\\work\\project').endsWith(path.join('node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js')));

{
  const originalExecPathDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath');
  const originalEnv = { ...process.env };
  const cwd = path.join(__dirname, 'tmp-launcher');
  const localBin = path.join(cwd, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js');
  fs.mkdirSync(path.dirname(localBin), { recursive: true });
  fs.writeFileSync(localBin, '#!/usr/bin/env node\n', 'utf8');

  try {
    process.env = { ...originalEnv, PATH: 'C:\\Program Files\\nodejs;C:\\Windows\\System32' };
    delete process.env.npm_node_execpath;
    Object.defineProperty(process, 'execPath', {
      value: 'C:\\Users\\Alex\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      configurable: true
    });

    const invocation = buildSpawnInvocation({
      executable: 'npx',
      args: ['cucumber-js', '--config', '.cucumber-runner/cucumber.targeted.cjs', 'features/account.feature:11'],
      cwd
    }, 'win32', { nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe' });

    assert.strictEqual(invocation.mode, 'local-cucumber-node');
    assert.notStrictEqual(invocation.executable, process.execPath);
    assert.doesNotMatch(invocation.executable, /Code\.exe$/i);
    assert.strictEqual(invocation.executable, 'C:\\Program Files\\nodejs\\node.exe');
    assert.ok(invocation.localCucumberBin.endsWith(path.join('node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js')));
    assert.ok(invocation.args[0].endsWith(path.join('node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js')));
    assert.ok(invocation.args.includes('--config'));
    assert.ok(invocation.args.includes('.cucumber-runner/cucumber.targeted.cjs'));
    assert.ok(invocation.args.includes('features/account.feature:11'));
    assert.strictEqual(invocation.options.shell, false);
    assert.strictEqual(invocation.options.windowsHide, true);
    assert.strictEqual(invocation.options.env.PATH, process.env.PATH);
  } finally {
    if (originalExecPathDescriptor) {
      Object.defineProperty(process, 'execPath', originalExecPathDescriptor);
    }
    process.env = originalEnv;
  }
}

{
  const resolved = resolveNodeExecutable({
    platform: 'win32',
    env: {},
    whereOutput: [
      'C:\\Users\\Alex\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files\\nodejs\\node.exe'
    ].join('\r\n'),
    exists: (candidate) =>
      candidate === 'C:\\Users\\Alex\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe' ||
      candidate === 'C:\\Program Files\\nodejs\\node.exe'
  });

  assert.strictEqual(resolved, 'C:\\Program Files\\nodejs\\node.exe');
  assert.ok(path.isAbsolute(resolved));
  assert.doesNotMatch(resolved, /Code\.exe|Microsoft VS Code/i);
}

{
  const resolved = resolveNodeExecutable({
    platform: 'win32',
    env: { npm_node_execpath: 'C:\\Program Files\\nodejs\\node.exe' },
    whereOutput: '',
    exists: (candidate) => candidate === 'C:\\Program Files\\nodejs\\node.exe'
  });

  assert.strictEqual(resolved, 'C:\\Program Files\\nodejs\\node.exe');
}

{
  const diagnostic = buildNodeDiagnosticInvocation('C:\\Users\\Alex\\project', 'win32', {
    nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe'
  });

  assert.strictEqual(diagnostic.mode, 'node-diagnostic');
  assert.strictEqual(diagnostic.executable, 'C:\\Program Files\\nodejs\\node.exe');
  assert.deepStrictEqual(diagnostic.args.slice(0, 1), ['-e']);
  assert.match(diagnostic.args[1], /require\.resolve\("@cucumber\/cucumber"\)/);
  assert.match(diagnostic.args[1], /require\.resolve\("ts-node\/register"\)/);
  assert.strictEqual(diagnostic.options.shell, false);
}

{
  const invocation = buildSpawnInvocation({
    executable: 'npx',
    args: ['cucumber-js', '--config', '.cucumber-runner/cucumber.targeted.cjs', 'features/search.feature:2'],
    cwd: 'C:\\Users\\Alex\\project'
  }, 'win32');

  assert.strictEqual(invocation.mode, 'windows-cmd');
  assert.strictEqual(invocation.executable, 'cmd.exe');
  assert.deepStrictEqual(invocation.args, [
    '/d',
    '/c',
    'npx cucumber-js --config .cucumber-runner/cucumber.targeted.cjs features/search.feature:2'
  ]);
  assert.strictEqual(
    invocation.renderedCommand,
    'npx cucumber-js --config .cucumber-runner/cucumber.targeted.cjs features/search.feature:2'
  );
  assert.doesNotMatch(invocation.renderedCommand, /\\"/);
  assert.doesNotMatch(invocation.renderedCommand, /\.cjs"/);
  assert.doesNotMatch(invocation.renderedCommand, /"features\/search\.feature:2"/);
  assert.doesNotMatch(invocation.renderedCommand, /"\.cucumber-runner\/cucumber\.targeted\.cjs"/);
  assert.strictEqual(invocation.options.shell, false);
  assert.strictEqual(invocation.options.windowsHide, true);
  assert.ok(invocation.options.env);
  for (const key of SANITIZED_ENV_KEYS) {
    assert.strictEqual(invocation.options.env[key], undefined);
  }
}

{
  const invocation = buildSpawnInvocation({
    executable: 'npx',
    args: ['cucumber-js', 'features/search feature.feature:2'],
    cwd: 'C:\\Users\\Alex\\project'
  }, 'win32');

  assert.match(invocation.renderedCommand, /"features\/search feature\.feature:2"/);
  assert.doesNotMatch(invocation.renderedCommand, /\\"/);
}

{
  const invocation = buildSpawnInvocation({
    executable: 'npx',
    args: [
      'cucumber-js',
      '--config',
      '.cucumber-runner/cucumber targeted.cjs',
      'features/my feature.feature:11'
    ],
    cwd: 'C:\\Users\\Alex\\project'
  }, 'win32');

  assert.match(invocation.renderedCommand, /--config "\.cucumber-runner\/cucumber targeted\.cjs"/);
  assert.match(invocation.renderedCommand, /"features\/my feature\.feature:11"/);
  assert.doesNotMatch(invocation.renderedCommand, /\\"/);
}

{
  const invocation = buildSpawnInvocation({
    executable: 'npx',
    args: ['cucumber-js', 'features/search.feature:2'],
    cwd: '/tmp/project'
  }, 'linux');

  assert.strictEqual(invocation.mode, 'direct');
  assert.strictEqual(invocation.executable, 'npx');
  assert.deepStrictEqual(invocation.args, ['cucumber-js', 'features/search.feature:2']);
  assert.strictEqual(invocation.options.shell, false);
}

assert.strictEqual(quoteWindowsArg('features/search.feature:2'), 'features/search.feature:2');
assert.strictEqual(quoteWindowsArg('.cucumber-runner/cucumber.targeted.cjs'), '.cucumber-runner/cucumber.targeted.cjs');
assert.strictEqual(quoteWindowsArg('--config'), '--config');
assert.strictEqual(quoteWindowsArg('cucumber-js'), 'cucumber-js');
assert.strictEqual(quoteWindowsArg('features/my feature.feature:2'), '"features/my feature.feature:2"');

{
  const env = buildMinimalChildEnv({
    PATH: 'C:\\Program Files\\nodejs',
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\Temp',
    NODE_OPTIONS: '--inspect',
    NODE_PATH: 'bad-path',
    ELECTRON_RUN_AS_NODE: '1',
    VSCODE_IPC_HOOK_CLI: 'hook',
    VSCODE_TEST_VALUE: 'bad',
    npm_config_prefix: 'bad',
    npm_node_execpath: 'bad',
    TS_NODE_PROJECT: 'bad'
  });

  assert.strictEqual(env.PATH, 'C:\\Program Files\\nodejs');
  assert.strictEqual(env.SystemRoot, 'C:\\Windows');
  assert.strictEqual(env.TEMP, 'C:\\Temp');
  assert.strictEqual(env.NODE_OPTIONS, undefined);
  assert.strictEqual(env.NODE_PATH, undefined);
  assert.strictEqual(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.strictEqual(env.VSCODE_IPC_HOOK_CLI, undefined);
  assert.strictEqual(env.VSCODE_TEST_VALUE, undefined);
  assert.strictEqual(env.npm_config_prefix, undefined);
  assert.strictEqual(env.npm_node_execpath, undefined);
  assert.strictEqual(env.TS_NODE_PROJECT, undefined);
}

{
  const original = { ...process.env };
  process.env.NODE_OPTIONS = '--inspect';
  process.env.NODE_PATH = 'bad-path';
  process.env.ELECTRON_RUN_AS_NODE = '1';
  process.env.VSCODE_INSPECTOR_OPTIONS = '{}';
  process.env.VSCODE_IPC_HOOK_CLI = 'hook';
  const env = buildChildEnv();
  for (const key of SANITIZED_ENV_KEYS) {
    assert.strictEqual(env[key], undefined);
  }
  process.env = original;
}

console.log('processLauncher fixtures passed');
