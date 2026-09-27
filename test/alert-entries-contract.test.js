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

test('the entry header layout is in lockstep with alert_set.h', () => {
  assert.equal(cDefine('STATUS_ALERT_KIND_MASK'), 0x07);
  assert.equal(cDefine('STATUS_ALERT_LEVEL_SHIFT'), 3);
  assert.equal(cDefine('STATUS_ALERT_LEVEL_MASK'), 3);
  assert.equal(cDefine('STATUS_ALERT_LEN_SHIFT'), 5);
  assert.equal(cDefine('STATUS_ALERT_LEN_MAX'), 7);
  const th = require('../src/pkjs/status-thresholds.js');
  const bytes = th.bakeAlerts({ UV_TREND_UINT8: [80] },
    { alertUv: true, alertUvDisplay: 'value' }, 20);
  assert.deepEqual(bytes, [7 | (2 << cDefine('STATUS_ALERT_LEVEL_SHIFT'))
    | (1 << cDefine('STATUS_ALERT_LEN_SHIFT')), '8'.charCodeAt(0)]);
});

test('the phone bakes the tuple under the cap the watch accepts', () => {
  const statusLines = require('../src/pkjs/status-lines.js');
  assert.equal(cDefine('ALERT_ENTRIES_MAX_BYTES'), 20);
  assert.equal(statusLines.ALERT_ENTRIES_CAP, cDefine('ALERT_ENTRIES_MAX_BYTES'));
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
