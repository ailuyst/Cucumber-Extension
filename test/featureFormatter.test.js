const assert = require('assert');
const { formatFeatureText } = require('../out/featureFormatEngine');

{
  const input = [
    '@featureTag',
    ' Feature:   Account API',
    '',
    ' @smoke @api',
    'Scenario Outline:  create related records',
    'Given  I have account <account>',
    ' Then first opportunity exists',
    'Examples:',
    '| account | opportunity| status |',
    '| A|Big deal|Open|',
    '| Long Account | Renewal| Closed Won |',
    ''
  ].join('\n');

  const expected = [
    '@featureTag',
    'Feature:   Account API',
    '',
    '  @smoke @api',
    '  Scenario Outline:  create related records',
    '    Given  I have account <account>',
    '    Then first opportunity exists',
    '    Examples:',
    '      | account      | opportunity | status     |',
    '      | A            | Big deal    | Open       |',
    '      | Long Account | Renewal     | Closed Won |',
    ''
  ].join('\n');

  assert.strictEqual(formatFeatureText(input), expected);
}

{
  const input = [
    'Feature: Hooks',
    '# feature comment',
    'Scenario: doc string and table',
    'When I send payload',
    '"""json',
    '  {',
    '    "name": "ACME"',
    '  }',
    '"""',
    'Then response contains',
    '|field|value|',
    '|name|ACME|'
  ].join('\n');

  const expected = [
    'Feature: Hooks',
    '# feature comment',
    '  Scenario: doc string and table',
    '    When I send payload',
    '      """json',
    '  {',
    '    "name": "ACME"',
    '  }',
    '      """',
    '    Then response contains',
    '      | field | value |',
    '      | name  | ACME  |'
  ].join('\n');

  assert.strictEqual(formatFeatureText(input), expected);
}

{
  const input = [
    'Feature: Tabs',
    'Scenario: tab indent',
    'Given a compact formatter'
  ].join('\n');

  const expected = [
    'Feature: Tabs',
    '\tScenario: tab indent',
    '\t\tGiven a compact formatter'
  ].join('\n');

  assert.strictEqual(formatFeatureText(input, { insertSpaces: false }), expected);
}

console.log('featureFormatter fixtures passed');
