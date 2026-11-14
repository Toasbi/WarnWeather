'use strict';
// The graph styles' wire and storage contract (Pebble Time 2): three appended message keys,
// three appended persist slots, the watch's handler behind PBL_PLATFORM_EMERY with its record
// check before the write, the view word's style bits read on the watch where the phone
// packs them (src/c/appendix/graph_style.h, src/pkjs/layout/domain/view-cycle.js packExt), and the spare
// row's appended key and slot (SPARE_LINE_TREND_UINT8, persist.c SPARE_LINE_TREND).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const persistC = read('src', 'c', 'appendix', 'persist.c');
const appMessageC = read('src', 'c', 'appendix', 'app_message.c');
const layoutH = read('src', 'c', 'windows', 'layout.h');
const template = JSON.parse(read('package.template.json'));

const KEYS = ['CLAY_GRAPH_STYLE_1_UINT8', 'CLAY_GRAPH_STYLE_2_UINT8', 'CLAY_GRAPH_STYLE_3_UINT8'];

test('the three style keys are appended after ALERT_ENTRIES_UINT8, in style order', () => {
  const keys = template.pebble.messageKeys;
  const at = keys.indexOf('ALERT_ENTRIES_UINT8');
  assert.deepEqual(keys.slice(at + 1, at + 4), KEYS);
  KEYS.forEach((k) => {
    assert.equal(keys.indexOf(k), keys.lastIndexOf(k), k + ' declared once');
    assert.match(appMessageC, new RegExp('MESSAGE_KEY_' + k));
  });
});

test('PERSIST GRAPH_STYLE_1..3 are appended after RADAR_NOTICE (59..61)', () => {
  const m = persistC.match(/enum key \{([\s\S]*?)\n\};/);
  assert.ok(m, 'persist.c key enum missing');
  const names = m[1].replace(/\/\/[^\n]*/g, '').split(/[,\s]+/)
    .filter((t) => /^[A-Z][A-Z0-9_]*$/.test(t));
  assert.equal(names.indexOf('RADAR_NOTICE'), 58);
  assert.deepEqual([names.indexOf('GRAPH_STYLE_1'), names.indexOf('GRAPH_STYLE_2'),
    names.indexOf('GRAPH_STYLE_3')], [59, 60, 61]);
  assert.equal(names.indexOf('SPARE_LINE_TREND'), 62, 'the spare row\'s trend after them');
  // Bars 4 to 6's slots come after it (test/status-bars/domain/extra-bars-contract.test.js).
  assert.equal(names[63], 'STATUS_LINE_5');
});

test('the spare row: its key appended after the style keys, received and stored on emery only', () => {
  const keys = template.pebble.messageKeys;
  assert.equal(keys.indexOf('SPARE_LINE_TREND_UINT8'), keys.indexOf('CLAY_GRAPH_STYLE_3_UINT8') + 1);
  // Bars 4 to 6's keys come after it (test/status-bars/domain/extra-bars-contract.test.js).
  assert.equal(keys[keys.indexOf('SPARE_LINE_TREND_UINT8') + 1], 'STATUS_LINE_5_UINT8');
  const entry = appMessageC.indexOf('{ SERIES_SPARE,  MESSAGE_KEY_SPARE_LINE_TREND_UINT8');
  assert.ok(entry !== -1, 'the trend table receives it');
  const guard = appMessageC.lastIndexOf('#if defined(PBL_PLATFORM_EMERY)', entry);
  assert.ok(guard !== -1 && appMessageC.indexOf('#endif', guard) > entry, 'behind PBL_PLATFORM_EMERY');
  ['persist_series_present', 'persist_series_trend', 'persist_series_set_trend'].forEach((fn) => {
    const start = persistC.indexOf(fn + '(SeriesId id');
    const body = persistC.slice(start, persistC.indexOf('\n}\n', start));
    assert.match(body, /case SERIES_SPARE:.*SPARE_LINE_TREND/, fn + ' stores the spare trend');
  });
});

test('the watch checks a record before persisting it, on emery only', () => {
  const start = appMessageC.indexOf('static bool handle_graph_styles');
  assert.ok(start !== -1, 'handle_graph_styles missing');
  const body = appMessageC.slice(start, appMessageC.indexOf('\n}\n', start));
  assert.ok(body.indexOf('graph_style_valid') !== -1, 'validated');
  assert.ok(body.indexOf('persist_set_graph_style') > body.indexOf('graph_style_valid'),
    'validated before the write');
  const guard = appMessageC.lastIndexOf('#if defined(PBL_PLATFORM_EMERY)', start);
  assert.ok(guard !== -1 && appMessageC.indexOf('#endif', guard) > start,
    'the handler sits behind PBL_PLATFORM_EMERY');
});

test('the watch reads the style from ext bits 9-10, where packExt puts it', () => {
  const vc = require('../../../src/pkjs/layout/domain/view-cycle.js');
  assert.match(layoutH, /\(ext >> 9\) & 3/, 'view_ext_graph_style reads bits 9-10');
  const s = Object.assign(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE), { graphStyle: 2 });
  assert.equal((vc.packExt(s) >> 9) & 3, 2);
});
