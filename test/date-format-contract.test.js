const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The three-way date-format contract, machine-checked in the repo's
// status-line-contract.test.js style:
//   1. wire bytes  — the C enums in date_format.h equal the JS code-list
//      indices in date-format.js (the value that actually rides
//      CLAY_DATE_FORMAT_UINT8);
//   2. UI promises — the sample labels the settings screen shows (schema.js
//      month options, blocks.js dateFullFormatOptions) are exactly the strings
//      the C formatter is pinned to render (parsed out of
//      test/c/date_format_test.c's expect_str pins);
//   3. order rule  — the resolver's day/month sample order agrees with
//      effectiveHolidayCountry (clay-payload.js), the derivation the wire's
//      Auto format actually uses.
// Any one-sided reorder, append, or reworded sample fails here instead of
// silently rendering a format the UI never promised.

const dateFormat = require('../src/pkjs/date-format.js');

const header = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'appendix', 'date_format.h'), 'utf8');

function cEnum(name) {
  const m = header.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, name + ' missing from date_format.h');
  return Number(m[1]);
}

test('C enum values equal the JS wire-code indices (the CLAY_DATE_FORMAT_UINT8 bytes)', () => {
  dateFormat.MONTH_FORMAT_CODES.forEach((code, i) => {
    assert.equal(cEnum('DATE_MONTH_' + code.toUpperCase()), i,
      'month code "' + code + '" must pack byte ' + i + ' on both ends');
  });
  dateFormat.FULL_FORMAT_CODES.forEach((code, i) => {
    assert.equal(cEnum('DATE_FULL_' + code.toUpperCase()), i,
      'full code "' + code + '" must pack byte ' + i + ' on both ends');
  });
  // Append-only floor: retiring a value must keep its slot, so the enum count
  // can only grow in lockstep with the lists.
  assert.equal((header.match(/DATE_MONTH_\w+\s*=/g) || []).length,
    dateFormat.MONTH_FORMAT_CODES.length, 'month enum count matches the JS list');
  assert.equal((header.match(/DATE_FULL_\w+\s*=/g) || []).length,
    dateFormat.FULL_FORMAT_CODES.length, 'full enum count matches the JS list');
});

// The C test's pinned outputs, by expect_str name — e.g. "full textyear US"
// -> "Sep 7, 2026". These are what the watch provably renders for 7 Sep 2026.
const cTest = fs.readFileSync(
  path.join(__dirname, 'c', 'date_format_test.c'), 'utf8');
const cPins = {};
for (const m of cTest.matchAll(/expect_str\("([^"]+)", buf, "([^"]+)"\)/g)) {
  cPins[m[1]] = m[2];
}

// UI side: the schema's month options and the blocks resolver's full-date
// options, loaded the way config-schema.test.js loads them.
const schema = require('../src/pkjs/settings/schema.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');

function findItem(key) {
  let found = null;
  schema.tabs.forEach((t) => t.sections.forEach((sec) => sec.items.forEach((it) => {
    if (it.messageKey === key) { found = it; }
  })));
  assert.ok(found, key + ' missing from the schema');
  return found;
}

test('the month picker labels promise exactly what the C formatter renders', () => {
  const options = findItem('dateSlotMonthFormat').options;
  dateFormat.MONTH_FORMAT_CODES.forEach((code, i) => {
    assert.equal(options[i][1], code, 'option ' + i + ' carries code ' + code);
    assert.equal(options[i][0], cPins['month ' + code],
      'label for "' + code + '" must be the pinned C output');
  });
});

test('the full-date resolver labels promise exactly what the C formatter renders, per order', () => {
  const resolver = global.PConf.optionsResolvers.get('dateFullFormatOptions');
  [{ S: { holidayCountry: 'DE' }, suffix: '' },
   { S: { holidayCountry: 'US' }, suffix: ' US' }].forEach(({ S, suffix }) => {
    const options = resolver(S);
    dateFormat.FULL_FORMAT_CODES.forEach((code, i) => {
      assert.equal(options[i][1], code, 'option ' + i + ' carries code ' + code);
      assert.equal(options[i][0], cPins['full ' + code + suffix],
        'label for "' + code + '"' + suffix + ' must be the pinned C output');
    });
  });
});

test('the resolver order agrees with effectiveHolidayCountry (the wire\'s Auto rule)', () => {
  // clay-payload's dependency chain touches localStorage; mock before requiring.
  global.localStorage = global.localStorage || {
    getItem: function () { return null; },
    setItem: function () {},
    removeItem: function () {}
  };
  const { effectiveHolidayCountry } = require('../src/pkjs/clay-payload.js');
  const resolver = global.PConf.optionsResolvers.get('dateFullFormatOptions');
  [{ holidayCountry: 'US' }, { holidayCountry: 'DE' }, { holidayCountry: 'GB' }, {}]
    .forEach((S) => {
      const monthFirst = effectiveHolidayCountry(S) === 'US';
      const textLabel = resolver(S).find((o) => o[1] === 'text')[0];
      assert.equal(textLabel, monthFirst ? 'Sep 7' : '7 Sep',
        'sample order must match the derivation the wire packs with for '
        + JSON.stringify(S));
    });
});
