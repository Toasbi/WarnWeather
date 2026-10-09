// test/forecast-span.test.js
// The forecast graph's time span (src/pkjs/forecast-span.js): the stored 12/24/48 ('48' is the
// long span's token, labelled "58 h"), the hours the phone sends a watch (14 / 24 / 65 on emery
// only, 24 everywhere else and on an unknown watch), the option telemetry reports, the inbox
// budget's span, the render signature's part, and the lockstep pins: the C buffers and class
// bound (src/c/appendix/forecast_span.h FORECAST_MAX_ENTRIES, FORECAST_SPAN_HALF_SENT) and the
// settings schema's options.
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

test('hours: the hours sent for the stored span on emery (14 / 24 / 65), 24 on every other watch and an unknown one', () => {
  assert.deepEqual(['12', '24', '48', '36', undefined].map((v) =>
    forecastSpan.hours({ forecastHours: v }, env('emery'))), [14, 24, 65, 24, 24]);
  assert.equal(forecastSpan.hours({ forecastHours: '12' }, env('emery')), forecastSpan.HALF_SENT_HOURS);
  assert.equal(forecastSpan.hours({ forecastHours: '48' }, env('emery')), hourlyWindow.MAX_FORECAST_HOURS);
  OTHERS.concat([null]).forEach((p) => {
    ['12', '24', '48'].forEach((v) => {
      assert.equal(forecastSpan.hours({ forecastHours: v }, env(p)), 24, p + ' ' + v);
    });
  });
  assert.equal(forecastSpan.hours({ forecastHours: '48' }, null), 24, 'no env at all');
  assert.equal(forecastSpan.hours(null, env('emery')), 24, 'no settings');
});

test('option: the stored option on emery (12 / 24 / 48, categorical), 24 on every other watch and an unknown one', () => {
  assert.deepEqual(['12', '24', '48', '36', undefined].map((v) =>
    forecastSpan.option({ forecastHours: v }, env('emery'))), [12, 24, 48, 24, 24]);
  OTHERS.concat([null]).forEach((p) => {
    ['12', '24', '48'].forEach((v) => {
      assert.equal(forecastSpan.option({ forecastHours: v }, env(p)), 24, p + ' ' + v);
    });
  });
  assert.equal(forecastSpan.option({ forecastHours: '48' }, null), 24, 'no env at all');
});

test('maxHours: 65 on emery, 24 elsewhere', () => {
  assert.equal(forecastSpan.maxHours(env('emery')), 65);
  OTHERS.concat([null]).forEach((p) => assert.equal(forecastSpan.maxHours(env(p)), 24, String(p)));
  assert.equal(forecastSpan.maxHours(null), 24);
});

test('signature: empty for the default and an absent key, the stored option otherwise (\'48\', not 65)', () => {
  assert.equal(forecastSpan.signature({}), '');
  assert.equal(forecastSpan.signature(null), '');
  assert.equal(forecastSpan.signature({ forecastHours: '24' }), '');
  assert.equal(forecastSpan.signature({ forecastHours: 'junk' }), '');
  assert.equal(forecastSpan.signature({ forecastHours: '12' }), '12');
  assert.equal(forecastSpan.signature({ forecastHours: '48' }), '48');
});

test('lockstep: FORECAST_MAX_ENTRIES in forecast_span.h is MAX_FORECAST_HOURS on emery, 24 elsewhere', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/c/appendix/forecast_span.h'), 'utf8');
  const m = src.match(/#if defined\(PBL_PLATFORM_EMERY\)[\s\S]*?#define FORECAST_MAX_ENTRIES (\d+)[\s\S]*?#else\s*#define FORECAST_MAX_ENTRIES (\d+)/);
  assert.ok(m, 'forecast_span.h keeps its emery / else FORECAST_MAX_ENTRIES arms');
  assert.equal(Number(m[1]), hourlyWindow.MAX_FORECAST_HOURS);
  assert.equal(Number(m[2]), hourlyWindow.FORECAST_HOURS);
  assert.equal(forecastSpan.DEFAULT_HOURS, hourlyWindow.FORECAST_HOURS);
  // 65 = ceil(190 / 3) + 1: the widest plot (190 px, B's collapsed strip at GOTHIC_14 hour
  // labels) at the 3 px pitch floor, plus the hour whose vertex lies past the right edge.
  assert.equal(hourlyWindow.MAX_FORECAST_HOURS, 65);
  assert.equal(hourlyWindow.MAX_FORECAST_HOURS, Math.ceil(190 / 3) + 1);
  // The 12 h class's bound is the hours the 12 h option sends.
  const half = src.match(/#define FORECAST_SPAN_HALF_SENT\s+(\d+)/);
  assert.ok(half, 'forecast_span.h defines FORECAST_SPAN_HALF_SENT');
  assert.equal(Number(half[1]), forecastSpan.HALF_SENT_HOURS);
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
  // The long span is labelled by the hours the default emery layout shows; its token stays '48'.
  assert.deepEqual(item.options, [['12 h', '12'], ['24 h', '24'], ['58 h', '48']]);
  assert.match(item.hintByValue['48'], /^About 58 hours/);
});

test('the "58 h" label is the default emery layout\'s whole hours at the 3 px pitch', () => {
  // The default graph_left is 24: the G24 two-digit hi/lo labels plus the health graph's "0.x"
  // step-mark claim on the shared label strip (22 px + 2), so the plot is 198 - 24 = 174 px
  // wide. A change to the default fonts or the strip moves this (forecast_span.h, bottom_view.c).
  const DEFAULT_GRAPH_LEFT = 24;
  const PITCH = 3;
  assert.equal(Math.floor((198 - DEFAULT_GRAPH_LEFT) / PITCH), 58, 'whole hours');
  assert.equal(Math.ceil((198 - DEFAULT_GRAPH_LEFT) / PITCH), 58);
  assert.ok(hourlyWindow.MAX_FORECAST_HOURS * PITCH >= 198 - DEFAULT_GRAPH_LEFT, 'a full feed reaches the edge');
});
