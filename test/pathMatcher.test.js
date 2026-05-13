const assert = require('assert');
const { cucumberUriMatchesItemPath } = require('../out/pathMatcher');

assert.strictEqual(
  cucumberUriMatchesItemPath(
    'C:\\Users\\Alex\\project\\features\\account.feature',
    'features/account.feature',
    'win32'
  ),
  true
);

assert.strictEqual(
  cucumberUriMatchesItemPath(
    'C:\\Users\\Alex\\project\\features\\account.feature',
    'FEATURES/ACCOUNT.FEATURE',
    'win32'
  ),
  true
);

assert.strictEqual(
  cucumberUriMatchesItemPath(
    'C:\\Users\\Alex\\project\\features\\account.feature',
    'C:\\Users\\Alex\\project\\features\\account.feature',
    'win32'
  ),
  true
);

assert.strictEqual(
  cucumberUriMatchesItemPath(
    'C:\\Users\\Alex\\project\\features\\account.feature',
    'features/search.feature',
    'win32'
  ),
  false
);

assert.strictEqual(
  cucumberUriMatchesItemPath(
    '/home/alex/project/features/account.feature',
    'features/account.feature',
    'linux'
  ),
  true
);

console.log('pathMatcher fixtures passed');
