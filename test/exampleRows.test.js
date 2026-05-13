const assert = require('assert');
const { resolveExampleBodyLine } = require('../out/exampleRows');

assert.strictEqual(resolveExampleBodyLine(12, 11, 0), 12);
assert.strictEqual(resolveExampleBodyLine(13, 11, 1), 13);
assert.strictEqual(resolveExampleBodyLine(14, 11, 2), 14);
assert.strictEqual(resolveExampleBodyLine(11, 11, 0), 12);
assert.strictEqual(resolveExampleBodyLine(undefined, 11, 2), 14);

console.log('exampleRows fixtures passed');
