const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { hooksForTags, parseCucumberHooksFromSource } = require('../out/hookDiscovery');
const { formatCucumberRunResult, formatCucumberStepLabel, orderScenarioStepsForExplorer, parseCucumberMessageNdjson } = require('../out/resultParser');
const { attachBestEffortStdoutLogs } = require('../out/resultLogMapper');
const { isRuntimeHookItemId, orderedRuntimeChildren, runtimeHookItemId, staticHookItemId } = require('../out/runtimeHookItems');

const fixturesDir = path.join(__dirname, 'fixtures');

const passed = parseCucumberMessageNdjson(
  fs.readFileSync(path.join(fixturesDir, 'passed.ndjson'), 'utf8'),
  { cwd: path.dirname(__dirname) }
);
assert.strictEqual(passed.scenarios.length, 1);
assert.strictEqual(passed.scenarios[0].name, 'Add numbers');
assert.strictEqual(passed.scenarios[0].status, 'passed');
assert.strictEqual(passed.scenarios[0].durationMs, 30);
assert.deepStrictEqual(passed.scenarios[0].steps.map((step) => step.status), ['passed', 'passed']);

const failed = parseCucumberMessageNdjson(
  fs.readFileSync(path.join(fixturesDir, 'failed.ndjson'), 'utf8'),
  { cwd: path.dirname(__dirname) }
);
assert.strictEqual(failed.scenarios.length, 1);
assert.strictEqual(failed.scenarios[0].name, 'Pay with card');
assert.strictEqual(failed.scenarios[0].status, 'failed');
assert.strictEqual(failed.scenarios[0].steps[1].status, 'failed');
assert.strictEqual(failed.scenarios[0].steps[1].errorMessage, 'Payment declined');
assert.match(failed.scenarios[0].steps[1].stackTrace, /world\.pay/);
assert.deepStrictEqual(failed.scenarios[0].steps[1].logs, ['payment log']);

const outline = parseCucumberMessageNdjson(
  fs.readFileSync(path.join(fixturesDir, 'outline.ndjson'), 'utf8'),
  { cwd: path.dirname(__dirname) }
);
assert.strictEqual(outline.scenarios.length, 2);
assert.deepStrictEqual(outline.scenarios.map((scenario) => scenario.exampleLine), [10, 11]);
assert.deepStrictEqual(outline.scenarios.map((scenario) => scenario.status), ['passed', 'failed']);
assert.strictEqual(outline.scenarios[0].exampleValues.username, 'admin');
assert.strictEqual(outline.scenarios[0].exampleValues.password, 'valid');
assert.strictEqual(outline.scenarios[1].exampleValues.password, 'invalid');
assert.strictEqual(outline.scenarios[0].steps[1].text, 'login with "valid"');
assert.strictEqual(outline.scenarios[1].steps[2].errorMessage, 'Expected failure status');

const uppercaseFailure = parseCucumberMessageNdjson([
  JSON.stringify({
    gherkinDocument: {
      uri: 'features/account.feature',
      feature: {
        name: 'Account',
        children: [{
          scenario: {
            id: 'scenario-uppercase',
            name: 'Create account',
            location: { line: 3 },
            steps: [
              { id: 'step-uppercase-1', keyword: 'Given ', text: 'an account', location: { line: 4 } },
              { id: 'step-uppercase-2', keyword: 'When ', text: 'it fails', location: { line: 5 } },
              { id: 'step-uppercase-3', keyword: 'Then ', text: 'it is skipped', location: { line: 6 } }
            ]
          }
        }]
      }
    }
  }),
  JSON.stringify({
    pickle: {
      id: 'pickle-uppercase',
      uri: 'features/account.feature',
      name: 'Create account',
      astNodeIds: ['scenario-uppercase'],
      steps: [
        { id: 'pickle-uppercase-1', astNodeIds: ['step-uppercase-1'], text: 'an account' },
        { id: 'pickle-uppercase-2', astNodeIds: ['step-uppercase-2'], text: 'it fails' },
        { id: 'pickle-uppercase-3', astNodeIds: ['step-uppercase-3'], text: 'it is skipped' }
      ]
    }
  }),
  JSON.stringify({
    testCase: {
      id: 'case-uppercase',
      pickleId: 'pickle-uppercase',
      testSteps: [
        { id: 'test-step-uppercase-1', pickleStepId: 'pickle-uppercase-1' },
        { id: 'test-step-uppercase-2', pickleStepId: 'pickle-uppercase-2' },
        { id: 'test-step-uppercase-3', pickleStepId: 'pickle-uppercase-3' }
      ]
    }
  }),
  JSON.stringify({ testCaseStarted: { id: 'started-uppercase', testCaseId: 'case-uppercase' } }),
  JSON.stringify({
    testStepFinished: {
      testCaseStartedId: 'started-uppercase',
      testStepId: 'test-step-uppercase-1',
      testStepResult: { status: 'PASSED' }
    }
  }),
  JSON.stringify({
    testStepFinished: {
      testCaseStartedId: 'started-uppercase',
      testStepId: 'test-step-uppercase-2',
      testStepResult: {
        status: 'FAILED',
        message: 'Account failed',
        exception: {
          message: 'Account failed',
          stackTrace: 'Error: Account failed\n    at account.steps.ts:10'
        }
      }
    }
  }),
  JSON.stringify({
    testStepFinished: {
      testCaseStartedId: 'started-uppercase',
      testStepId: 'test-step-uppercase-3',
      testStepResult: { status: 'SKIPPED' }
    }
  })
].join('\n'), { cwd: path.dirname(__dirname) });

assert.strictEqual(uppercaseFailure.scenarios[0].status, 'failed');
assert.deepStrictEqual(uppercaseFailure.scenarios[0].steps.map((step) => step.status), ['passed', 'failed', 'skipped']);
assert.strictEqual(uppercaseFailure.scenarios[0].errorMessage, 'Account failed');
assert.match(uppercaseFailure.scenarios[0].stackTrace, /account\.steps\.ts/);

const resultWithLogs = {
  scenarios: attachBestEffortStdoutLogs([{
    name: 'Log mapping',
    status: 'failed',
    steps: [
      { keyword: 'Given ', text: 'setup', status: 'passed' },
      { keyword: 'When ', text: 'act', status: 'passed' },
      {
        keyword: 'Then ',
        text: 'fail',
        status: 'failed',
        errorMessage: 'Expected failure',
        stackTrace: 'at src/steps/log.steps.ts:3:1'
      }
    ]
  }], 'Hi\nAAAA\naboba\n'),
  stdout: '',
  stderr: ''
};
const summaryWithLogs = formatCucumberRunResult(resultWithLogs);
assert.match(summaryWithLogs, /\[PASS\] Given setup[\s\S]*Logs:\n      Hi/);
assert.match(summaryWithLogs, /\[PASS\] When act[\s\S]*Logs:\n      AAAA/);
assert.match(summaryWithLogs, /\[FAIL\] Then fail[\s\S]*Logs:\n      aboba[\s\S]*Error:\n      Expected failure/);
assert.ok(summaryWithLogs.indexOf('Logs:\n      aboba') < summaryWithLogs.indexOf('Error:\n      Expected failure'));

const hookResult = parseCucumberMessageNdjson([
  JSON.stringify({
    hook: {
      id: 'before-hook-1',
      tagExpression: '@account',
      type: 'BEFORE_TEST_CASE',
      sourceReference: { uri: 'src/support/hooks.ts', location: { line: 5 } }
    }
  }),
  JSON.stringify({
    hook: {
      id: 'after-hook-1',
      tagExpression: '@account',
      type: 'AFTER_TEST_CASE',
      sourceReference: { uri: 'src/support/hooks.ts', location: { line: 10 } }
    }
  }),
  JSON.stringify({
    hook: {
      id: 'before-step-hook-1',
      type: 'BEFORE_TEST_STEP',
      sourceReference: { uri: 'src/support/hooks.ts', location: { line: 15 } }
    }
  }),
  JSON.stringify({
    hook: {
      id: 'after-step-hook-1',
      type: 'AFTER_TEST_STEP',
      sourceReference: { uri: 'src/support/hooks.ts', location: { line: 20 } }
    }
  }),
  JSON.stringify({
    gherkinDocument: {
      uri: 'features/account.feature',
      feature: {
        name: 'Account',
        children: [{
          scenario: {
            id: 'scenario-hook',
            name: 'Create account',
            location: { line: 3 },
            steps: [
              { id: 'step-hook-1', keyword: 'Given ', text: 'an account', location: { line: 4 } }
            ]
          }
        }]
      }
    }
  }),
  JSON.stringify({
    pickle: {
      id: 'pickle-hook',
      uri: 'features/account.feature',
      name: 'Create account',
      astNodeIds: ['scenario-hook'],
      steps: [
        { id: 'pickle-hook-step-1', astNodeIds: ['step-hook-1'], text: 'an account' }
      ]
    }
  }),
  JSON.stringify({
    testCase: {
      id: 'case-hook',
      pickleId: 'pickle-hook',
      testSteps: [
        { id: 'test-step-hook-after', hookId: 'after-hook-1' },
        { id: 'test-step-hook-after-step', hookId: 'after-step-hook-1' },
        { id: 'test-step-hook-pickle', pickleStepId: 'pickle-hook-step-1' },
        { id: 'test-step-hook-before-step', hookId: 'before-step-hook-1' },
        { id: 'test-step-hook-before', hookId: 'before-hook-1' }
      ]
    }
  }),
  JSON.stringify({ testCaseStarted: { id: 'started-hook', testCaseId: 'case-hook' } }),
  JSON.stringify({ testStepStarted: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-before' } }),
  JSON.stringify({ testStepStarted: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-before-step' } }),
  JSON.stringify({ testStepStarted: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-pickle' } }),
  JSON.stringify({ testStepStarted: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-after-step' } }),
  JSON.stringify({ testStepStarted: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-after' } }),
  JSON.stringify({ attachment: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-before', body: 'before log', mediaType: 'text/plain' } }),
  JSON.stringify({ testStepFinished: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-before', testStepResult: { status: 'PASSED' } } }),
  JSON.stringify({ testStepFinished: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-before-step', testStepResult: { status: 'PASSED' } } }),
  JSON.stringify({ attachment: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-pickle', body: 'step log', mediaType: 'text/plain' } }),
  JSON.stringify({ testStepFinished: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-pickle', testStepResult: { status: 'PASSED' } } }),
  JSON.stringify({ testStepFinished: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-after-step', testStepResult: { status: 'PASSED' } } }),
  JSON.stringify({ attachment: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-after', body: 'after log', mediaType: 'text/plain' } }),
  JSON.stringify({ testStepFinished: { testCaseStartedId: 'started-hook', testStepId: 'test-step-hook-after', testStepResult: { status: 'PASSED' } } })
].join('\n'), { cwd: path.dirname(__dirname) });

assert.deepStrictEqual(hookResult.scenarios[0].steps.map(formatCucumberStepLabel), [
  'Before @account',
  'BeforeStep hook',
  'Given an account',
  'AfterStep hook',
  'After @account'
]);
assert.deepStrictEqual(hookResult.scenarios[0].steps.map((step) => step.kind), ['hook', 'hook', 'step', 'hook', 'hook']);
assert.strictEqual(hookResult.scenarios[0].steps[0].keyword, 'Before ');
assert.strictEqual(hookResult.scenarios[0].steps[0].text, '@account');
assert.deepStrictEqual(hookResult.scenarios[0].steps[0].logs, ['before log']);
assert.deepStrictEqual(hookResult.scenarios[0].steps[2].logs, ['step log']);
assert.strictEqual(hookResult.scenarios[0].steps[4].keyword, 'After ');
assert.deepStrictEqual(hookResult.scenarios[0].steps[4].logs, ['after log']);
const hookSummary = formatCucumberRunResult(hookResult);
assert.match(hookSummary, /\[PASS\] Before @account[\s\S]*Logs:\n      before log/);
assert.match(hookSummary, /\[PASS\] BeforeStep hook/);
assert.match(hookSummary, /\[PASS\] Given an account[\s\S]*Logs:\n      step log/);
assert.match(hookSummary, /\[PASS\] AfterStep hook/);
assert.match(hookSummary, /\[PASS\] After @account[\s\S]*Logs:\n      after log/);

assert.strictEqual(formatCucumberStepLabel({ keyword: 'Before ', text: '@account' }), 'Before @account');
assert.strictEqual(formatCucumberStepLabel({ keyword: 'Hook ', text: 'hook' }), 'Hook hook');
assert.strictEqual(
  runtimeHookItemId(
    'exampleRow:parent',
    { id: 'run-a-step-1', hookId: 'run-a-hook', hookType: 'BEFORE_TEST_STEP', keyword: 'BeforeStep ', text: 'hook', uri: 'src/support/hooks.ts', line: 5 },
    2
  ),
  runtimeHookItemId(
    'exampleRow:parent',
    { id: 'run-b-step-99', hookId: 'run-b-hook', hookType: 'BEFORE_TEST_STEP', keyword: 'BeforeStep ', text: 'hook', uri: 'src/support/hooks.ts', line: 5 },
    2
  )
);
assert.notStrictEqual(
  runtimeHookItemId('exampleRow:parent', { hookId: 'run-a-hook', hookType: 'BEFORE_TEST_STEP', keyword: 'BeforeStep ', text: 'hook' }, 2),
  runtimeHookItemId('exampleRow:parent', { hookId: 'run-b-hook', hookType: 'BEFORE_TEST_STEP', keyword: 'BeforeStep ', text: 'hook' }, 2)
);
assert.notStrictEqual(
  runtimeHookItemId('exampleRow:parent', { hookId: 'shared-hook', hookType: 'BEFORE_TEST_STEP', keyword: 'BeforeStep ', text: 'hook' }, 1),
  runtimeHookItemId('exampleRow:parent', { hookId: 'shared-hook', hookType: 'BEFORE_TEST_STEP', keyword: 'BeforeStep ', text: 'hook' }, 2)
);
assert.ok(runtimeHookItemId('exampleRow:parent', { keyword: 'Before ', text: '@account' }, 0).startsWith('hook:exampleRow:parent:'));
assert.strictEqual(isRuntimeHookItemId('exampleRow:parent', 'hook:exampleRow:parent:old-key:0'), true);
assert.strictEqual(isRuntimeHookItemId('exampleRow:other', 'hook:exampleRow:parent:old-key:0'), false);
assert.deepStrictEqual(
  orderedRuntimeChildren(
    'exampleRow:parent',
    [
      { id: 'hook:exampleRow:parent:before-account:0' },
      { id: 'hook:exampleRow:parent:before-hook:1' },
      { id: 'step:given' },
      { id: 'step:when' },
      { id: 'step:then' },
      { id: 'step:and' },
      { id: 'hook:exampleRow:parent:after-hook:6' }
    ],
    [
      { id: 'step:given' },
      { id: 'step:when' },
      { id: 'step:then' },
      { id: 'step:and' },
      { id: 'hook:exampleRow:parent:old-hook:0' },
      { id: 'hook:exampleRow:parent:before-account:0' },
      { id: 'hook:exampleRow:parent:before-hook:1' },
      { id: 'hook:exampleRow:parent:after-hook:6' }
    ]
  ).map((item) => item.id),
  [
    'hook:exampleRow:parent:before-account:0',
    'hook:exampleRow:parent:before-hook:1',
    'step:given',
    'step:when',
    'step:then',
    'step:and',
    'hook:exampleRow:parent:after-hook:6'
  ]
);
assert.deepStrictEqual(
  orderScenarioStepsForExplorer([
    { keyword: 'Given ', text: 'a test account exists', status: 'passed' },
    { keyword: 'When ', text: 'I assign a role', status: 'passed' },
    { keyword: 'Then ', text: 'the account has a role', status: 'passed' },
    { keyword: 'And ', text: 'the account is saved', status: 'passed' },
    { kind: 'hook', hookType: 'BEFORE_TEST_CASE', keyword: 'Before ', text: '@accountCreation', status: 'passed' },
    { kind: 'hook', keyword: 'Before ', text: 'hook', status: 'passed' },
    { kind: 'hook', hookType: 'AFTER_TEST_CASE', keyword: 'After ', text: 'hook', status: 'passed' }
  ]).map(formatCucumberStepLabel),
  [
    'Before @accountCreation',
    'Before hook',
    'Given a test account exists',
    'When I assign a role',
    'Then the account has a role',
    'And the account is saved',
    'After hook'
  ]
);
const discoveredHooks = parseCucumberHooksFromSource(`
Before('@accountCreation', function () {})
Before(function () {})
After(function () {})
BeforeStep({ tags: '@accountCreation' }, function () {})
AfterStep(function () {})
Before(
  { tags: '@multiLineAccount' },
  function () {}
)
`, 'src/support/hooks.ts');
assert.deepStrictEqual(discoveredHooks.map((hook) => hook.label), [
  'Before @accountCreation',
  'Before hook',
  'After hook',
  'BeforeStep @accountCreation',
  'AfterStep hook',
  'Before @multiLineAccount'
]);
const taggedHookSet = hooksForTags(discoveredHooks, ['@accountCreation']);
assert.deepStrictEqual(taggedHookSet.before.map((hook) => hook.label), ['Before @accountCreation', 'Before hook']);
assert.deepStrictEqual(taggedHookSet.beforeStep.map((hook) => hook.label), ['BeforeStep @accountCreation']);
assert.deepStrictEqual(taggedHookSet.afterStep.map((hook) => hook.label), ['AfterStep hook']);
assert.deepStrictEqual(taggedHookSet.after.map((hook) => hook.label), ['After hook']);
const untaggedHookSet = hooksForTags(discoveredHooks, []);
assert.deepStrictEqual(untaggedHookSet.before.map((hook) => hook.label), ['Before hook']);
assert.deepStrictEqual(untaggedHookSet.beforeStep.map((hook) => hook.label), []);
assert.deepStrictEqual(untaggedHookSet.afterStep.map((hook) => hook.label), ['AfterStep hook']);
assert.deepStrictEqual(hooksForTags(discoveredHooks, ['@multiLineAccount']).before.map((hook) => hook.label), ['Before hook', 'Before @multiLineAccount']);
assert.strictEqual(
  staticHookItemId('exampleRow:parent', { ...discoveredHooks[0], ordinal: 0 }),
  staticHookItemId('exampleRow:parent', { ...discoveredHooks[0], ordinal: 0 })
);

const unknownHookResult = parseCucumberMessageNdjson([
  JSON.stringify({ hook: { id: 'unknown-hook-1', type: 'SOMETHING_ELSE' } }),
  JSON.stringify({
    gherkinDocument: {
      uri: 'features/account.feature',
      feature: {
        children: [{ scenario: { id: 'scenario-unknown-hook', name: 'Unknown hook', location: { line: 3 }, steps: [] } }]
      }
    }
  }),
  JSON.stringify({ pickle: { id: 'pickle-unknown-hook', uri: 'features/account.feature', name: 'Unknown hook', astNodeIds: ['scenario-unknown-hook'], steps: [] } }),
  JSON.stringify({ testCase: { id: 'case-unknown-hook', pickleId: 'pickle-unknown-hook', testSteps: [{ id: 'test-step-unknown-hook', hookId: 'unknown-hook-1' }] } }),
  JSON.stringify({ testCaseStarted: { id: 'started-unknown-hook', testCaseId: 'case-unknown-hook' } }),
  JSON.stringify({ testStepFinished: { testCaseStartedId: 'started-unknown-hook', testStepId: 'test-step-unknown-hook', testStepResult: { status: 'PASSED' } } })
].join('\n'), { cwd: path.dirname(__dirname) });
assert.strictEqual(formatCucumberStepLabel(unknownHookResult.scenarios[0].steps[0]), 'Hook hook');
assert.doesNotMatch(formatCucumberRunResult(unknownHookResult), /Hookhook/);

console.log('resultParser fixtures passed');
