const assert = require('assert');
const {
  DEFAULT_CONFIG_FILE,
  DEFAULT_FEATURE_GLOBS,
  DEFAULT_STEP_GLOBS,
  DEFAULT_SUPPORT_GLOBS,
  DEFAULT_COMMAND
} = require('../out/cucumberConfig');
const packageJson = require('../package.json');

assert.strictEqual(DEFAULT_CONFIG_FILE, 'cucumber.js');
assert.deepStrictEqual(DEFAULT_FEATURE_GLOBS, ['features/**/*.feature']);
assert.deepStrictEqual(DEFAULT_STEP_GLOBS, ['src/steps/**/*.ts']);
assert.deepStrictEqual(DEFAULT_SUPPORT_GLOBS, ['src/support/**/*.ts']);
assert.strictEqual(DEFAULT_COMMAND, 'npx cucumber-js');
assert.notDeepStrictEqual(DEFAULT_STEP_GLOBS, ['features/step-definitions/**/*.ts']);
assert.notDeepStrictEqual(DEFAULT_STEP_GLOBS, ['features/step_definitions/**/*.ts']);
assert.strictEqual(
  packageJson.contributes.configuration.properties['cucumberRunner.debugDiagnostics'].default,
  false
);
assert.strictEqual(
  packageJson.contributes.configuration.properties['cucumberRunner.diagnosticsVerbose'].default,
  false
);

console.log('config fixtures passed');
