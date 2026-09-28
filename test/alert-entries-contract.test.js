// The Alerts row's entry tuple (ALERT_ENTRIES_UINT8): written by the phone
// (status-thresholds.js bakeAlerts via status-lines.js buildStatusLines), checked
// and persisted by the watch (app_message.c -> alert_set_bytes_ok ->
// persist_set_alert_entries), parsed by alert_set.c. These pins keep the two
// ends of that wire in lockstep, and the new persist slot appended.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const alertSetH = fs.readFileSync(path.join(root, 'src', 'c', 'appendix', 'alert_set.h'), 'utf8');
const persistC = fs.readFileSync(path.join(root, 'src', 'c', 'appendix', 'persist.c'), 'utf8');
const appMessageC = fs.readFileSync(path.join(root, 'src', 'c', 'appendix', 'app_message.c'), 'utf8');
const template = JSON.parse(fs.readFileSync(path.join(root, 'package.template.json'), 'utf8'));

/**
 * @param {string} name a numeric #define in alert_set.h
 * @returns {number}
 */
function cDefine(name) {
  const m = alertSetH.match(new RegExp('#define\\s+' + name + '\\s+(0x[0-9A-Fa-f]+|\\d+)'));
  assert.ok(m, name + ' missing from alert_set.h');
  return Number(m[1]);
}

const th = require('../src/pkjs/status-thresholds.js');

test('the entry header layout is in lockstep with alert_set.h', () => {
  assert.equal(cDefine('STATUS_ALERT_HEADER'), 0x80);
  assert.equal(cDefine('STATUS_ALERT_KIND_MASK'), 0x07);
  assert.equal(cDefine('STATUS_ALERT_DANGER'), 0x08);
  assert.equal(cDefine('STATUS_ALERT_DAY_SHIFT'), 4);
  assert.equal(cDefine('STATUS_ALERT_DAY_MASK'), 0x07);
  assert.equal(cDefine('STATUS_ALERT_LEN_MAX'), 7);
  assert.equal(th.ALERT_HEADER, cDefine('STATUS_ALERT_HEADER'));
  assert.equal(th.ALERT_DANGER, cDefine('STATUS_ALERT_DANGER'));
  assert.equal(th.ALERT_DAY_SHIFT, cDefine('STATUS_ALERT_DAY_SHIFT'));
  assert.equal(th.ALERT_LEN_MAX, cDefine('STATUS_ALERT_LEN_MAX'));
  // The four fields tile the byte without overlap: kind 0-2, danger 3, day 4-6,
  // the header bit 7.
  const fields = [cDefine('STATUS_ALERT_KIND_MASK'), cDefine('STATUS_ALERT_DANGER'),
    cDefine('STATUS_ALERT_DAY_MASK') << cDefine('STATUS_ALERT_DAY_SHIFT'),
    cDefine('STATUS_ALERT_HEADER')];
  assert.equal(fields.reduce((a, b) => a | b, 0), 0xFF);
  assert.equal(fields.reduce((a, b) => a + b, 0), 0xFF, 'no two fields share a bit');
  // Every value byte is printable ASCII, so none can pass for a header.
  assert.ok(0x7E < cDefine('STATUS_ALERT_HEADER'));
  const bytes = th.bakeAlerts({ UV_TREND_UINT8: [80] },
    { alertUv: true, alertUvDisplay: 'value' });
  assert.deepEqual(bytes, [cDefine('STATUS_ALERT_HEADER') | 7 | cDefine('STATUS_ALERT_DANGER'),
    '8'.charCodeAt(0)]);
});

// A tomorrow entry carries its mark as a day code: the phone's ALERT_NEXT_DAY_MARKS
// order + 1, which the watch's STATUS_ALERT_MARK_* codes name; 0 is today's.
test('the day codes are in lockstep with alert_set.h, and name the slot\'s marks', () => {
  assert.equal(cDefine('STATUS_ALERT_DAY_TODAY'), 0);
  const cName = { raquo: 'RAQUO', gt: 'GT', plus: 'PLUS', star: 'STAR', none: 'NONE' };
  assert.deepEqual(th.ALERT_NEXT_DAY_MARKS, ['raquo', 'gt', 'plus', 'star', 'none']);
  th.ALERT_NEXT_DAY_MARKS.forEach((mark, i) => {
    assert.equal(cDefine('STATUS_ALERT_MARK_' + cName[mark]), i + 1, mark);
  });
  // Every code fits the 3-bit day field.
  assert.ok(th.ALERT_NEXT_DAY_MARKS.length <= cDefine('STATUS_ALERT_DAY_MASK'));
  // The same marks the slot's "Tomorrow's peak mark" offers (status-pair.js).
  const pair = require('../src/pkjs/status-pair.js');
  assert.deepEqual(th.ALERT_NEXT_DAY_MARKS.slice().sort(), Object.keys(pair.NEXT_DAY_MARKS).sort());
  // A tomorrow UV entry at danger, marked '>', icon only.
  const bytes = th.bakeAlerts({ UV_TREND_UINT8: [20], UV_DAY_PEAKS: [30, 90, 0] },
    { alertUv: true, alertUvNextDayMark: 'gt' });
  assert.deepEqual(bytes, [cDefine('STATUS_ALERT_HEADER') | 7 | cDefine('STATUS_ALERT_DANGER')
    | (cDefine('STATUS_ALERT_MARK_GT') << cDefine('STATUS_ALERT_DAY_SHIFT'))]);
});

test('the phone bakes the tuple under the cap the watch accepts', () => {
  assert.equal(cDefine('ALERT_ENTRIES_MAX_BYTES'), 20);
  assert.equal(th.ALERT_ENTRIES_MAX_BYTES, cDefine('ALERT_ENTRIES_MAX_BYTES'));
});

test('ALERT_ENTRIES_UINT8 is a declared message key, appended after the shipped ones', () => {
  const keys = template.pebble.messageKeys;
  assert.equal(keys[keys.length - 1], 'ALERT_ENTRIES_UINT8',
    'appended: a key inserted mid-array would shift every later key id');
  assert.equal(keys.indexOf('ALERT_ENTRIES_UINT8'), keys.lastIndexOf('ALERT_ENTRIES_UINT8'));
  assert.match(appMessageC, /MESSAGE_KEY_ALERT_ENTRIES_UINT8/);
});

test('the watch checks the tuple before persisting it, behind WW_ALERT_ROW', () => {
  const handler = appMessageC.slice(appMessageC.indexOf('static bool handle_alert_entries'));
  assert.ok(handler.length > 0, 'handle_alert_entries missing');
  const body = handler.slice(0, handler.indexOf('\n}\n'));
  assert.ok(body.indexOf('alert_set_bytes_ok') !== -1, 'validated first');
  assert.ok(body.indexOf('persist_set_alert_entries') > body.indexOf('alert_set_bytes_ok'));
  const guard = appMessageC.lastIndexOf('#if defined(WW_ALERT_ROW)',
    appMessageC.indexOf('static bool handle_alert_entries'));
  assert.ok(guard !== -1, 'the handler sits behind WW_ALERT_ROW (aplite never gets it)');
});

// The persist enum is append-only: its numbers are the on-flash slots. The new
// key must be the LAST entry, right after RADAR_LIMITED (56), i.e. slot 57.
test('PERSIST ALERT_ENTRIES is appended at the end of the key enum (57)', () => {
  const m = persistC.match(/enum key \{([\s\S]*?)\n\};/);
  assert.ok(m, 'persist.c key enum missing');
  const names = m[1]
    .replace(/\/\/[^\n]*/g, '')
    .split(/[,\s]+/)
    .filter((t) => /^[A-Z][A-Z0-9_]*$/.test(t));
  assert.equal(names[names.length - 1], 'ALERT_ENTRIES');
  assert.equal(names.indexOf('RADAR_LIMITED'), 56);
  assert.equal(names.indexOf('ALERT_ENTRIES'), 57);
});
