const assert = require('assert');
const { canonicalizeCwd, canonicalizeRunGroups } = require('../out/pathCanonicalizer');

(async () => {
  const lowerCwd = 'c:\\Users\\Alex\\project';
  const canonicalCwd = 'C:\\Users\\Alex\\project';
  const realpath = async (value) => {
    assert.strictEqual(value, lowerCwd);
    return canonicalCwd;
  };

  assert.strictEqual(await canonicalizeCwd(lowerCwd, realpath), canonicalCwd);

  const groups = await canonicalizeRunGroups([{
    cwd: lowerCwd,
    targets: ['c:\\Users\\Alex\\project\\features\\search.feature:2']
  }], realpath);

  assert.deepStrictEqual(groups, [{
    cwd: canonicalCwd,
    targets: ['c:\\Users\\Alex\\project\\features\\search.feature:2']
  }]);

  const fallback = await canonicalizeCwd(lowerCwd, async () => {
    throw new Error('realpath failed');
  });
  assert.strictEqual(fallback, lowerCwd);

  console.log('pathCanonicalizer fixtures passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
