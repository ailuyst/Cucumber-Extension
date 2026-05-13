const assert = require('assert');
const { noMatchedScenariosMessage } = require('../out/runResultPolicy');

assert.strictEqual(
  noMatchedScenariosMessage(['C:\\work\\project\\features\\account.feature:11'], 'C:\\work\\project'),
  'No Cucumber scenarios matched target features/account.feature:11'
);

console.log('runResultPolicy fixtures passed');
