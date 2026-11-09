'use strict';
// Bars 4 to 6's wire and storage contract (Pebble Time 2, 2.7.0's New status bar): four appended
// message keys, four appended persist slots, the watch's line and cell handlers behind
// PBL_PLATFORM_EMERY, and the view word's row bits read on the watch where the phone packs
// them (src/c/windows/layout.h, src/pkjs/view-cycle.js packExt). The phone's half of each:
// test/extra-bars.test.js.

const test = require('node:test');
const assert = require('node:assert');
const { readC, cDefine, cEnum } = require('./helpers/c-source.js');

global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const VC = require('../src/pkjs/view-cycle.js');
const OD = require('../src/pkjs/on-demand.js');
const catalog = require('../src/pkjs/status-line-catalog.js');

const persistC = readC('src/c/appendix/persist.c');
const appMessageC = readC('src/c/appendix/app_message.c');
const layoutH = readC('src/c/windows/layout.h');
const layoutC = readC('src/c/windows/layout.c');
const statusLineH = readC('src/c/appendix/status_line.h');
const thresholdH = readC('src/c/appendix/status_threshold.h');
const onDemandH = readC('src/c/appendix/on_demand.h');
const template = JSON.parse(readC('package.template.json'));

const LINE_KEYS = ['STATUS_LINE_5_UINT8', 'STATUS_LINE_6_UINT8', 'STATUS_LINE_7_UINT8'];

/**
 * Whether `needle` sits inside an `#if defined(PBL_PLATFORM_EMERY)` block of `src`.
 * @param {string} src C source text
 * @param {string} needle text that must occur in it
 * @returns {boolean}
 */
function emeryOnly(src, needle) {
  const at = src.indexOf(needle);
  assert.ok(at !== -1, 'missing: ' + needle);
  const guard = src.lastIndexOf('#if defined(PBL_PLATFORM_EMERY)', at);
  return guard !== -1 && src.indexOf('#endif', guard) > at;
}

test('the four keys are appended after SPARE_LINE_TREND_UINT8: the three lines, then the cells', () => {
  const keys = template.pebble.messageKeys;
  const at = keys.indexOf('SPARE_LINE_TREND_UINT8');
  assert.deepEqual(keys.slice(at + 1), LINE_KEYS.concat('CLAY_OD_EXTRA_UINT8'), 'the last keys, in order');
  keys.slice(at + 1).forEach((k) => assert.equal(keys.indexOf(k), keys.lastIndexOf(k), k + ' declared once'));
  // The phone's catalog names the same keys for the same bars.
  assert.deepEqual(catalog.EXTRA_LINES.map((l) => l.wireKey), LINE_KEYS);
});

test('PERSIST STATUS_LINE_5..7 and OD_EXTRA_CELLS are appended after SPARE_LINE_TREND (63..66)', () => {
  const m = persistC.match(/enum key \{([\s\S]*?)\n\};/);
  assert.ok(m, 'persist.c key enum missing');
  const names = m[1].replace(/\/\/[^\n]*/g, '').split(/[,\s]+/).filter((t) => /^[A-Z][A-Z0-9_]*$/.test(t));
  assert.equal(names.indexOf('SPARE_LINE_TREND'), 62);
  assert.deepEqual(names.slice(63), ['STATUS_LINE_5', 'STATUS_LINE_6', 'STATUS_LINE_7', 'OD_EXTRA_CELLS'],
    'the last slots, in order');
  // A bar 4 to 6's line id maps onto its own slot; the first four keep theirs.
  assert.match(persistC, /if \(line_id >= STATUS_LINE_BAR4\) \{ return STATUS_LINE_5 \+ \(line_id - STATUS_LINE_BAR4\); \}/);
  assert.ok(emeryOnly(persistC, 'return STATUS_LINE_5 + (line_id - STATUS_LINE_BAR4)'), 'behind PBL_PLATFORM_EMERY');
  assert.ok(emeryOnly(persistC, 'persist_get_od_extra_cells'), 'the cells\' reader is emery only');
});

test('the line ids: bars 4 to 6 follow the four, on emery alone, each received on its own key', () => {
  assert.equal(cEnum(statusLineH, 'STATUS_LINE_BAR4'), 4);
  assert.equal(cEnum(statusLineH, 'STATUS_LINE_BAR5'), 5);
  assert.equal(cEnum(statusLineH, 'STATUS_LINE_BAR6'), 6);
  assert.ok(emeryOnly(statusLineH, 'STATUS_LINE_BAR4 = 4'));
  assert.ok(emeryOnly(statusLineH, '#define STATUS_LINE_COUNT 7'), 'seven lines on emery');
  assert.match(statusLineH, /#else\s+#define STATUS_LINE_COUNT 4/, 'four elsewhere');
  ['BAR4', 'BAR5', 'BAR6'].forEach((bar, i) => {
    const line = 'case STATUS_LINE_' + bar + ': return MESSAGE_KEY_' + LINE_KEYS[i] + ';';
    assert.ok(appMessageC.indexOf(line) !== -1, line);
    assert.ok(emeryOnly(appMessageC, line), line + ' behind PBL_PLATFORM_EMERY');
  });
});

test('the cells: CLAY_OD_EXTRA_UINT8 is one byte per item, checked before the write, on emery alone', () => {
  assert.match(thresholdH, /#define THRESH_OD_EXTRA_BYTES OD_ITEM_COUNT/);
  assert.equal(cEnum(onDemandH, 'OD_ITEM_COUNT'), OD.ITEMS.length, 'one byte per On demand item');
  assert.match(thresholdH, /#define THRESH_SCRATCH_BYTES \(THRESH_SETTINGS_BYTES \+ THRESH_OD_EXTRA_BYTES\)/,
    'a status row loads them right behind the blob');
  const start = appMessageC.indexOf('static bool handle_od_extra(');
  const body = appMessageC.slice(start, appMessageC.indexOf('\n}\n', start));
  assert.match(body, /dict_find\(iterator, MESSAGE_KEY_CLAY_OD_EXTRA_UINT8\)/);
  assert.ok(body.indexOf('tuple->length != THRESH_OD_EXTRA_BYTES') < body.indexOf('persist_set_od_extra_cells'),
    'the length is checked before the write');
  assert.ok(emeryOnly(appMessageC, 'static bool handle_od_extra('), 'behind PBL_PLATFORM_EMERY');
  assert.ok(emeryOnly(appMessageC, 'handled |= handle_od_extra(iterator, &status_dirty);'));
  assert.equal(cEnum(thresholdH, 'THRESH_BAR_4'), OD.BLOB_BARS.length, 'bar 4 follows the blob\'s four');
  assert.equal(cDefine(thresholdH, 'THRESH_EXTRA_BAR_COUNT'), VC.EXTRA_BARS.length);
});

test('the view word: bars 4 to 6 ride the row fields plus ext bits 11 and 12, read where the phone packs them', () => {
  assert.equal(cEnum(layoutH, 'STATUS_SRC_BAR4'), VC.STATUS_SRC_BAR4);
  assert.equal(cEnum(layoutH, 'STATUS_SRC_BAR5'), VC.STATUS_SRC_BAR5);
  assert.equal(cEnum(layoutH, 'STATUS_SRC_BAR6'), VC.STATUS_SRC_BAR6);
  assert.ok(emeryOnly(layoutH, 'STATUS_SRC_BAR4 = 4'));
  assert.match(layoutH, /#define VIEW_EXT_UPPER_BAR_HI \(1u << 11\)/);
  assert.match(layoutH, /#define VIEW_EXT_LOWER_BAR_HI \(1u << 12\)/);
  assert.equal(VC.EXT_UPPER_BAR_HI, 1 << 11);
  assert.equal(VC.EXT_LOWER_BAR_HI, 1 << 12);
  assert.ok(emeryOnly(layoutH, '#define VIEW_EXT_UPPER_BAR_HI'));
  // The watch adds 3 to a row that is on, as unpackWire does.
  const start = layoutC.indexOf('void view_spec_apply_ext(');
  const body = layoutC.slice(start, layoutC.indexOf('\n}\n', start));
  assert.match(body, /VIEW_EXT_UPPER_BAR_HI/);
  assert.match(body, /VIEW_EXT_LOWER_BAR_HI/);
  // Each extra bar's view value and source are the phone's one table (view-cycle.js EXTRA_BARS).
  assert.deepEqual(VC.EXTRA_BARS.map((b) => [b.bar, b.src]), [['bar4', 4], ['bar5', 5], ['bar6', 6]]);
});
