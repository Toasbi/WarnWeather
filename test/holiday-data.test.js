// test/holiday-data.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { COUNTRY_OPTIONS, REGION_OPTIONS } = require('../src/pkjs/settings/holiday-data.js');

test('country options: None first, Germany second, Sweden present, no duplicate values', () => {
  assert.deepEqual(COUNTRY_OPTIONS[0], ['None', 'none']);
  assert.deepEqual(COUNTRY_OPTIONS[1], ['Germany', 'DE']);
  const values = COUNTRY_OPTIONS.map((o) => o[1]);
  ['US', 'DE', 'SE', 'GB', 'CH', 'ES', 'AT'].forEach((cc) =>
    assert.ok(values.indexOf(cc) >= 0, cc + ' missing from country list'));
  assert.equal(new Set(values).size, values.length, 'duplicate country value');
  assert.equal(COUNTRY_OPTIONS.length, 152, 'expected None + 151 Nager countries');
});

test('region maps: only the six region-varying countries', () => {
  assert.deepEqual(Object.keys(REGION_OPTIONS).sort(),
    ['AT', 'AU', 'BA', 'BQ', 'BR', 'CA', 'CH', 'CL', 'DE', 'ES', 'GB', 'IT', 'NZ', 'PT', 'US']);
});

test('region maps: whole-country first, ISO-3166-2 members, expected counts', () => {
  const counts = { DE: 16, AT: 9, CH: 26, ES: 19, GB: 4, US: 51,
    AU: 8, CA: 13, NZ: 16, PT: 2, BA: 2, BQ: 3, IT: 1, BR: 1, CL: 1 };
  Object.keys(counts).forEach((cc) => {
    const opts = REGION_OPTIONS[cc];
    assert.ok(opts, cc + ' missing');
    assert.deepEqual(opts[0], ['Whole country', 'all'], cc + ' first option');
    assert.equal(opts.length, counts[cc] + 1, cc + ' member count');
    const vals = opts.slice(1).map((o) => o[1]);
    assert.equal(new Set(vals).size, vals.length, cc + ' duplicate region value');
    vals.forEach((v) => assert.ok(v.indexOf(cc + '-') === 0, cc + ' bad region code ' + v));
  });
});
