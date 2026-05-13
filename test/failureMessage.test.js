const assert = require('assert');
const { formatFailureMessage } = require('../out/failureMessage');
const { attachBestEffortStdoutLogs } = require('../out/resultLogMapper');

{
  const failedStep = {
    text: 'Then I see a failure',
    keyword: 'Then ',
    status: 'failed',
    logs: ['aboba'],
    errorMessage: 'expect(received).toBe(expected)',
    stackTrace: 'at src/steps/search.steps.ts:42:1'
  };

  const message = formatFailureMessage(failedStep);
  assert.match(message, /Logs:\n  aboba/);
  assert.match(message, /Error:\n  expect\(received\)\.toBe\(expected\)/);
  assert.ok(message.indexOf('Logs:') < message.indexOf('Error:'));
}

{
  const scenario = {
    name: 'Search',
    status: 'failed',
    steps: [
      { keyword: 'Given ', text: 'I open search', status: 'passed' },
      { keyword: 'When ', text: 'I search', status: 'passed' },
      {
        keyword: 'Then ',
        text: 'I see result',
        status: 'failed',
        errorMessage: 'Expected result',
        stackTrace: 'at src/steps/search.steps.ts:99:1'
      }
    ]
  };

  const [mappedScenario] = attachBestEffortStdoutLogs([scenario], 'Hi\nAAAA\naboba\n');
  const failedThen = mappedScenario.steps[2];
  const message = formatFailureMessage(failedThen);

  assert.deepStrictEqual(mappedScenario.steps[0].logs, ['Hi']);
  assert.deepStrictEqual(mappedScenario.steps[1].logs, ['AAAA']);
  assert.deepStrictEqual(failedThen.logs, ['aboba']);
  assert.match(message, /Logs:\n  aboba/);
  assert.doesNotMatch(message, /AAAA/);
  assert.doesNotMatch(message, /Hi/);
  assert.match(formatFailureMessage(mappedScenario), /Step logs:\n  Given I open search\n    Hi\n  When I search\n    AAAA\n  Then I see result\n    aboba/);
}

{
  const scenario = {
    name: 'Structured logs',
    status: 'failed',
    steps: [
      { keyword: 'Given ', text: 'setup', status: 'passed', logs: ['structured'] },
      { keyword: 'When ', text: 'act', status: 'passed' }
    ]
  };
  const [mappedScenario] = attachBestEffortStdoutLogs([scenario], 'fallback\nshould not append\n');
  assert.deepStrictEqual(mappedScenario.steps[0].logs, ['structured']);
  assert.strictEqual(mappedScenario.steps[1].logs, undefined);
}

console.log('failureMessage fixtures passed');
