'use strict';
// test/hr-alert-contract.test.js — emery's heart-rate alert between the phone and the
// watch: CLAY_HR_ALERT_UINT8's layout (src/c/appendix/hr_alert.h, the canonical one)
// against its packer (src/pkjs/status-wire.js buildHrAlertBytes) and the phone's
// readings (on-demand.js, status-thresholds.js, the settings ranges), plus the watch
// facts the feature stands on: the message key, the persist slot, the emery-only read,
// the Heart rate item's place in OdItem past the blob's cells and its glyph slot. Read
// from the C sources through test/helpers/c-source.js.
const test = require('node:test');
const assert = require('node:assert');
const wire = require('../src/pkjs/status-wire.js');
const th = require('../src/pkjs/status-thresholds.js');
const OD = require('../src/pkjs/on-demand.js');
const { readC, cDefine, onlyUnderEmery } = require('./helpers/c-source.js');

const hrAlertH = readC('src/c/appendix/hr_alert.h');

test('the tuple layout: hr_alert.h and status-wire.js agree byte for byte', () => {
  ['HR_ALERT_BYTES', 'HR_ALERT_CELLS_OFFSET', 'HR_ALERT_LEVEL_OFFSET', 'HR_ALERT_FLAGS_OFFSET',
    'HR_ALERT_WARN_OFFSET', 'HR_ALERT_DANGER_OFFSET', 'HR_ALERT_WARN_COLOR_OFFSET',
    'HR_ALERT_DANGER_COLOR_OFFSET', 'HR_ALERT_VALUE_BIT', 'HR_ALERT_HIGHLIGHT_BIT',
    'HR_ALERT_LOOK_SHIFT'].forEach((name) => {
    assert.strictEqual(wire[name], cDefine(hrAlertH, name), name);
  });
  assert.strictEqual(cDefine(hrAlertH, 'HR_ALERT_BYTES'), 7);
  assert.deepEqual(['CELLS', 'LEVEL', 'FLAGS', 'WARN', 'DANGER', 'WARN_COLOR', 'DANGER_COLOR']
    .map((f) => cDefine(hrAlertH, 'HR_ALERT_' + f + '_OFFSET')), [0, 1, 2, 3, 4, 5, 6],
    'one byte each, in order');
  assert.strictEqual(cDefine(hrAlertH, 'HR_ALERT_VALUE_BIT'), 0x01);
  assert.strictEqual(cDefine(hrAlertH, 'HR_ALERT_HIGHLIGHT_BIT'), 0x02);
  assert.strictEqual(cDefine(hrAlertH, 'HR_ALERT_LOOK_SHIFT'), 2);
  assert.strictEqual(wire.buildHrAlertBytes({}, { platform: 'emery', health: true, hr: true }).length,
    cDefine(hrAlertH, 'HR_ALERT_BYTES'));
});

test('the levels: the phone\'s ranges fall inside the watch\'s, and the defaults agree', () => {
  const bpmMin = cDefine(hrAlertH, 'HR_ALERT_BPM_MIN');
  const bpmMax = cDefine(hrAlertH, 'HR_ALERT_BPM_MAX');
  assert.deepEqual([bpmMin, bpmMax], [30, 250]);
  assert.strictEqual(cDefine(hrAlertH, 'HR_ALERT_LEVEL_DEFAULT'), OD.HR_LEVEL_DEFAULT,
    'the item level\'s default');
  assert.ok(OD.HR_LEVEL_MIN >= bpmMin && OD.HR_LEVEL_MAX <= bpmMax,
    'every level the Alert level slider stores is one the watch takes as is');
  // The slot's Warn · danger track (blocks.js THRESHOLD_RANGES.Hr: 40..220) sits inside
  // the bytes the watch reads, and above the floor below which it reads no highlight.
  require('../src/pkjs/config-ui/lib/schema-walk.js');
  require('../src/pkjs/config-ui/lib/color.js');
  require('../src/pkjs/config-ui/lib/show-when.js');
  require('../src/pkjs/config-ui/lib/engine.js');
  const B = require('../src/pkjs/settings/blocks.js');
  const cfg = B.thresholdRangeCfg({}, { platform: 'emery', thresholds: true, color: true }, { keyStem: 'Hr' });
  assert.ok(cfg.min >= bpmMin, 'the warn floor ' + cfg.min + ' is a level the watch highlights');
  assert.ok(cfg.max <= 255, 'one byte');
  const hl = th.kindConfig({}, th.HR_KIND, true);
  assert.ok(hl.warn >= bpmMin && hl.danger >= hl.warn, 'the seed pair is sane on the watch');
});

test('the warn look bits carry ThreshWarnLook values', () => {
  const header = readC('src/c/appendix/status_threshold.h');
  const cEnum = (name) => Number(header.match(new RegExp(name + '\\s*=\\s*(\\d+)'))[1]);
  assert.strictEqual(th.WARN_LOOKS.none, cEnum('THRESH_WARN_LOOK_NONE'));
  assert.strictEqual(th.WARN_LOOKS.outline, cEnum('THRESH_WARN_LOOK_OUTLINE'));
  assert.strictEqual(th.WARN_LOOKS.fill, cEnum('THRESH_WARN_LOOK_FILL'));
  const EMERY = { platform: 'emery', health: true, hr: true, color: true };
  Object.keys(th.WARN_LOOKS).forEach((look) => {
    const b = wire.buildHrAlertBytes({ threshHrWarnLook: look }, EMERY);
    assert.strictEqual((b[wire.HR_ALERT_FLAGS_OFFSET] >> wire.HR_ALERT_LOOK_SHIFT) & 3, th.WARN_LOOKS[look], look);
    assert.strictEqual(b[wire.HR_ALERT_FLAGS_OFFSET] >> 4, 0, look + ': bits 4-7 written 0');
  });
});

test('the persist slot: HR_ALERT_SETTINGS is 59, appended right after RADAR_NOTICE', () => {
  const persist = readC('src/c/appendix/persist.c');
  assert.match(persist, /RADAR_NOTICE,\s*\/\/ 58\b[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*HR_ALERT_SETTINGS,\s*\/\/ 59\b/,
    'HR_ALERT_SETTINGS (59) directly follows RADAR_NOTICE (58), comments only between them');
  assert.match(persist, /write_data_if_changed\(HR_ALERT_SETTINGS, bytes, HR_ALERT_BYTES\)/,
    'the slot stores the tuple\'s first HR_ALERT_BYTES verbatim, written only on a change');
});

test('the message key: CLAY_HR_ALERT_UINT8 is appended after ALERT_ENTRIES_UINT8', () => {
  const keys = require('../package.template.json').pebble.messageKeys;
  const at = keys.indexOf('CLAY_HR_ALERT_UINT8');
  assert.notStrictEqual(at, -1, 'CLAY_HR_ALERT_UINT8 is declared');
  assert.strictEqual(keys[at - 1], 'ALERT_ENTRIES_UINT8', 'appended right after the alert entries');
  assert.strictEqual(keys.indexOf('CLAY_HR_ALERT_UINT8', at + 1), -1, 'declared once');
});

test('app_message.c reads the tuple on emery alone', () => {
  const src = readC('src/c/appendix/app_message.c');
  assert.ok(onlyUnderEmery(src, 'MESSAGE_KEY_CLAY_HR_ALERT_UINT8') >= 1, 'the key is read');
  assert.ok(onlyUnderEmery(src, 'handle_hr_alert(') >= 3, 'its handler: declared, called and defined');
});

test('on_demand.h: OD_HR follows Wind on emery, past the blob\'s cells', () => {
  const h = readC('src/c/appendix/on_demand.h');
  assert.match(h, /#if defined\(PBL_PLATFORM_EMERY\)[\s\S]*?OD_HR = 10,\s*\n\s*OD_ITEM_COUNT = 11,[\s\S]*?#else[\s\S]*?OD_ITEM_COUNT = 10,/);
  assert.match(h, /#define OD_BLOB_ITEM_COUNT \(OD_WIND \+ 1\)/);
  assert.strictEqual(OD.ITEMS.length, 11);
  assert.strictEqual(OD.BLOB_ITEM_COUNT, 10);
  assert.strictEqual(OD.ITEMS[10].code, 'hr');
  assert.strictEqual(wire.buildSettingsBlob({}, { platform: 'emery' }).length, wire.SETTINGS_BYTES);
  assert.strictEqual(wire.SETTINGS_BYTES, wire.ON_DEMAND_OFFSET + OD.BLOB_ITEM_COUNT);
});

test('status_on_demand.c keeps a glyph slot for the heart on emery', () => {
  const src = readC('src/c/layers/status_on_demand.c');
  assert.match(src, /#if defined\(PBL_PLATFORM_EMERY\)\s*\n#define GLYPH_SLOTS 9\b[^\n]*\n#else\s*\n#define GLYPH_SLOTS 8\b/);
});
