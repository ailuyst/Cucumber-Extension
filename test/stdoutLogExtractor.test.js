const assert = require('assert');
const {
  extractLikelyUserStdoutLines,
  groupStdoutLinesForStepMapping
} = require('../out/stdoutLogExtractor');

const input = [
  'Hi',
  '',
  '',
  '----------------------------------------',
  '========================================',
  'AAAAAAAAAAAAA',
  '1 scenario (1 passed)',
  '4 steps (4 passed)',
  '0m03.175s (executing steps: 0m00.296s)',
  ''
].join('\n');

assert.deepStrictEqual(extractLikelyUserStdoutLines(input), [
  'Hi',
  '',
  '',
  '----------------------------------------',
  '========================================',
  'AAAAAAAAAAAAA'
]);

assert.deepStrictEqual(extractLikelyUserStdoutLines('.FUSPA\nUUU\nWarnings:\nActual user line'), [
  'Actual user line'
]);

assert.deepStrictEqual(groupStdoutLinesForStepMapping(['Hi', '', '', 'AAAA']), [
  'Hi\n\n',
  'AAAA'
]);

assert.deepStrictEqual(extractLikelyUserStdoutLines([
  'Debugger listening on ws://127.0.0.1:12345/abc',
  'For help, see: https://nodejs.org/en/docs/inspector',
  'Debugger attached.',
  'Hi',
  'Waiting for the debugger to disconnect...',
  'AAAA'
].join('\n')), [
  'Hi',
  'AAAA'
]);

console.log('stdoutLogExtractor fixtures passed');
