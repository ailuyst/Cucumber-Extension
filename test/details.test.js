const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseCucumberMessageNdjson } = require('../out/resultParser');
const { formatScenarioDetails, formatStepDetails, detailsTextToHtml } = require('../out/detailsFormatter');
const { CucumberResultRegistry } = require('../out/resultRegistry');

const fixturesDir = path.join(__dirname, 'fixtures');
const failed = parseCucumberMessageNdjson(
  fs.readFileSync(path.join(fixturesDir, 'failed.ndjson'), 'utf8'),
  { cwd: path.dirname(__dirname) }
);
const scenario = failed.scenarios[0];
const failedStep = scenario.steps[1];

const scenarioText = formatScenarioDetails(scenario);
assert.match(scenarioText, /Scenario: Pay with card/);
assert.match(scenarioText, /Status: failed/);
assert.match(scenarioText, /Payment declined/);

const stepText = formatStepDetails({ scenario, step: failedStep });
assert.match(stepText, /Step: When I pay/);
assert.match(stepText, /Status: failed/);
assert.match(stepText, /world\.pay/);
assert.match(stepText, /payment log/);
assert.ok(stepText.indexOf('Logs:') < stepText.indexOf('Error:'));

const failedStepWithLog = {
  ...failedStep,
  errorMessage: 'Expected true to be false',
  stackTrace: 'at src/steps/account.steps.ts:42:1',
  logs: ['abboba']
};
const failedStepWithLogText = formatStepDetails({ scenario, step: failedStepWithLog });
assert.match(failedStepWithLogText, /Logs:\n  abboba/);
assert.match(failedStepWithLogText, /Error: Expected true to be false/);
assert.match(failedStepWithLogText, /Stack:\n  at src\/steps\/account\.steps\.ts:42:1/);

const html = detailsTextToHtml('Unsafe <Title>', 'Error: <script>alert(1)</script>');
assert.match(html, /Unsafe &lt;Title&gt;/);
assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(html, /<script>alert/);

const registry = new CucumberResultRegistry();
assert.strictEqual(registry.hasResults(), false);
registry.set({
  itemId: 'step:file:1:2',
  kind: 'step',
  title: 'Cucumber Step Details',
  text: stepText,
  uri: failedStep.uri,
  line: failedStep.line
});
assert.strictEqual(registry.hasResults(), true);
assert.strictEqual(registry.get('step:file:1:2').text, stepText);
assert.strictEqual(registry.get('missing'), undefined);
registry.clear();
assert.strictEqual(registry.hasResults(), false);

console.log('details fixtures passed');
