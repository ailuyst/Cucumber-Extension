const assert = require('assert');
const path = require('path');
const {
  buildCucumberCommand,
  normalizeCucumberTarget
} = require('../out/commandBuilder');

const cwd = 'C:\\work\\project';
const feature = path.join(cwd, 'features', 'search.feature');

{
  const command = buildCucumberCommand({
    command: 'npm run test',
    cwd,
    targets: [],
    format: 'stdout'
  });
  assert.strictEqual(command.executable, 'npm');
  assert.deepStrictEqual(command.args, ['run', 'test']);
}

{
  const command = buildCucumberCommand({
    command: 'npx cucumber-js',
    cwd,
    targets: [feature],
    format: 'stdout'
  });
  assert.strictEqual(command.executable, 'npx');
  assert.deepStrictEqual(command.args, ['cucumber-js', 'features/search.feature']);
}

{
  const command = buildCucumberCommand({
    command: 'npx cucumber-js',
    cwd,
    targets: [`${feature}:2`],
    format: 'stdout'
  });
  assert.deepStrictEqual(command.args, ['cucumber-js', 'features/search.feature:2']);
}

{
  const windowsTarget = 'C:\\work\\project\\features\\search.feature:2';
  const normalized = normalizeCucumberTarget(windowsTarget, 'C:\\work\\project');
  assert.strictEqual(normalized, 'features/search.feature:2');
}

{
  const command = buildCucumberCommand({
    command: 'npx cucumber-js --config cucumber.js',
    cwd,
    targets: [feature],
    format: 'message',
    reportOutputPath: 'reports/cucumber.ndjson'
  });
  assert.deepStrictEqual(command.args, [
    'cucumber-js',
    '--config',
    'cucumber.js',
    'features/search.feature',
    '--format',
    'message:reports/cucumber.ndjson'
  ]);
}

{
  const command = buildCucumberCommand({
    command: 'npx cucumber-js --config cucumber.js',
    cwd,
    targets: [`${feature}:2`],
    format: 'stdout',
    configFileOverride: 'C:\\work\\project\\.cucumber-runner\\cucumber.targeted.cjs'
  });
  assert.deepStrictEqual(command.args, [
    'cucumber-js',
    '--config',
    '.cucumber-runner/cucumber.targeted.cjs',
    'features/search.feature:2'
  ]);
  assert.strictEqual(command.args[2], '.cucumber-runner/cucumber.targeted.cjs');
  assert.strictEqual(command.args[3], 'features/search.feature:2');
  assert.strictEqual(command.args.some((arg) => arg.includes('"')), false);
}

{
  const command = buildCucumberCommand({
    command: 'npm run test',
    cwd,
    targets: [`${feature}:2`],
    format: 'stdout'
  });
  assert.deepStrictEqual(command.args, ['run', 'test', '--', 'features/search.feature:2']);
}

{
  const spacedCwd = 'C:\\work\\my project';
  const spacedFeature = 'C:\\work\\my project\\features\\search feature.feature:2';
  const command = buildCucumberCommand({
    command: 'npx cucumber-js',
    cwd: spacedCwd,
    targets: [spacedFeature],
    format: 'stdout'
  });
  assert.deepStrictEqual(command.args, ['cucumber-js', 'features/search feature.feature:2']);
  assert.match(command.displayCommand, /"features\/search feature\.feature:2"/);
}

console.log('commandBuilder fixtures passed');
