const assert = require('assert');
const {
  findMatchingStepDefinition,
  parseStepDefinitions,
  stripGherkinKeyword,
  stepDefinitionMatches,
  stepParameterRanges
} = require('../out/stepDefinitionMatcher');

assert.strictEqual(stripGherkinKeyword('When I assign the account role "admin"'), 'I assign the account role "admin"');
assert.strictEqual(stripGherkinKeyword('  Given I have 12 accounts'), 'I have 12 accounts');

assert.strictEqual(
  stepDefinitionMatches('I assign the account role {string}', 'I assign the account role "admin"'),
  true
);
assert.strictEqual(
  stepDefinitionMatches(
    'TextField {string} has {string} text',
    'TextField "JustJoinIt Page>Offer Section>Localization" has "180 - 210" text'
  ),
  true
);
assert.strictEqual(
  stepDefinitionMatches('I have {int} accounts', 'I have 12 accounts'),
  true
);
assert.strictEqual(
  stepDefinitionMatches('/^I search for (.*)$/', 'I search for savings'),
  true
);

const source = `
import { Given, When, Then } from '@cucumber/cucumber';

Given('I have {int} accounts', async function () {});
When('I assign the account role {string}', async function () {});
Then(/^I search for (.*)$/, () => {});
`;

assert.strictEqual(findMatchingStepDefinition(source, 'I have 12 accounts').keyword, 'Given');
assert.strictEqual(findMatchingStepDefinition(source, 'I assign the account role "admin"').keyword, 'When');
assert.strictEqual(findMatchingStepDefinition(source, 'I search for savings').keyword, 'Then');
assert.strictEqual(findMatchingStepDefinition(source, 'I do not exist'), undefined);
assert.strictEqual(
  findMatchingStepDefinition(
    "Then('TextField {string} has {string} text', async function () {});",
    'TextField "JustJoinIt Page>Offer Section>Localization" has "180 - 210" text'
  ).keyword,
  'Then'
);
assert.deepStrictEqual(stepParameterRanges('I have {int} accounts', 'I have 12 accounts'), [{ start: 7, end: 9 }]);
assert.deepStrictEqual(stepParameterRanges('I assign the account role {string}', 'I assign the account role "admin"'), [{ start: 26, end: 33 }]);
assert.deepStrictEqual(stepParameterRanges('/^I create (First|Second) (ACCOUNT|CONTACT) exists with data$/', 'I create Second ACCOUNT exists with data'), [
  { start: 9, end: 15 },
  { start: 16, end: 23 }
]);
assert.strictEqual(parseStepDefinitions('defineStep("I use {word}", () => {})')[0].keyword, 'defineStep');

console.log('stepDefinitionMatcher fixtures passed');
