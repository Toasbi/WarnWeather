// test/forecast-span.test.js
// The forecast graph's time span (src/pkjs/forecast-span.js): the stored 12/24/48, the span a
// watch draws (emery only, 24 everywhere else and on an unknown watch), the inbox budget's
// span, the render signature's part, and the two lockstep pins: the C buffers
// (src/c/appendix/forecast_span.h FORECAST_MAX_ENTRIES) and the settings schema's options.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const forecastSpan = require('../src/pkjs/forecast-span.js');
const hourlyWindow = require('../src/pkjs/weather/hourly-window.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const schema = require('../src/pkjs/settings/schema.js');

const env = (p) => platform.computeEnv(p ? { platform: p } : null);
const OTHERS = ['basalt', 'chalk', 'diorite', 'flint', 'aplite'];

test('storedHours: 12, 24 or 48 as stored; 24 for absent or junk', () => {
  assert.equal(forecastSpan.storedHours({ forecastHours: '12' }), 12);
  assert.equal(forecastSpan.storedHours({ forecastHours: '24' }), 24);
  assert.equal(forecastSpan.storedHours({ forecastHours: '48' }), 48);
  assert.equal(forecastSpan.storedHours({ forecastHours: 48 }), 48, 'a number reads the same');
  assert.equal(forecastSpan.storedHours({ forecastHours: 12 }), 12);
  assert.equal(forecastSpan.storedHours({}), 24);
  assert.equal(forecastSpan.storedHours({ forecastHours: '36' }), 24);
  assert.equal(forecastSpan.storedHours({ forecastHours: 'junk' }), 24);
  assert.equal(forecastSpan.storedHours({ forecastHours: null }), 24);
  assert.equal(forecastSpan.storedHours(null), 24);
  assert.equal(forecastSpan.storedHours(undefined), 24);
});

test('hours: the stored span on emery, 24 on every other watch and an unknown one', () => {
  assert.deepEqual(['12', '24', '48', '36', undefined].map((v) =>
    forecastSpan.hours({ forecastHours: v }, env('emery'))), [12, 24, 48, 24, 24]);
  OTHERS.concat([null]).forEach((p) => {
    ['12', '24', '48'].forEach((v) => {
      assert.equal(forecastSpan.hours({ forecastHours: v }, env(p)), 24, p + ' ' + v);
    });
  });
  assert.equal(forecastSpan.hours({ forecastHours: '48' }, null), 24, 'no env at all');
  assert.equal(forecastSpan.hours(null, env('emery')), 24, 'no settings');
});

test('maxHours: 48 on emery, 24 elsewhere', () => {
  assert.equal(forecastSpan.maxHours(env('emery')), 48);
  OTHERS.concat([null]).forEach((p) => assert.equal(forecastSpan.maxHours(env(p)), 24, String(p)));
  assert.equal(forecastSpan.maxHours(null), 24);
});

test('signature: empty for the default and an absent key, the hours otherwise', () => {
  assert.equal(forecastSpan.signature({}), '');
  assert.equal(forecastSpan.signature(null), '');
  assert.equal(forecastSpan.signature({ forecastHours: '24' }), '');
  assert.equal(forecastSpan.signature({ forecastHours: 'junk' }), '');
  assert.equal(forecastSpan.signature({ forecastHours: '12' }), '12');
  assert.equal(forecastSpan.signature({ forecastHours: '48' }), '48');
});

test('lockstep: FORECAST_MAX_ENTRIES in forecast_span.h is MAX_FORECAST_HOURS on emery, 24 elsewhere', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/c/appendix/forecast_span.h'), 'utf8');
  const m = src.match(/#if defined\(PBL_PLATFORM_EMERY\)[\s\S]*?#define FORECAST_MAX_ENTRIES (\d+)\s*#else\s*#define FORECAST_MAX_ENTRIES (\d+)/);
  assert.ok(m, 'forecast_span.h keeps its emery / else FORECAST_MAX_ENTRIES arms');
  assert.equal(Number(m[1]), hourlyWindow.MAX_FORECAST_HOURS);
  assert.equal(Number(m[2]), hourlyWindow.FORECAST_HOURS);
  assert.equal(forecastSpan.DEFAULT_HOURS, hourlyWindow.FORECAST_HOURS);
  // The platform fact and the C arm name the same watch.
  const fact = fs.readFileSync(path.join(__dirname, '../src/pkjs/config-ui/lib/platform.js'), 'utf8');
  assert.match(fact, /var FORECAST_SPAN_PLATFORMS = \{ emery: true \};/);
});

test('lockstep: the schema\'s forecastHours options are CHOICES, its default 24', () => {
  let item = null;
  schema.tabs.forEach((t) => t.sections.forEach((s) => s.items.forEach((it) => {
    if (it.messageKey === 'forecastHours') { item = it; }
  })));
  assert.ok(item, 'the schema has the forecastHours row');
  assert.deepEqual(item.options.map((o) => o[1]), forecastSpan.CHOICES);
  assert.equal(item.defaultValue, String(forecastSpan.DEFAULT_HOURS));
  assert.deepEqual(Object.keys(item.hintByValue).sort(), forecastSpan.CHOICES.slice().sort());
});
