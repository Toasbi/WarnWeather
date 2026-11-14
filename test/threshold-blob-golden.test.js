// test/threshold-blob-golden.test.js — CLAY_THRESHOLDS_UINT8 over thousands of
// generated settings blobs, pinned to one digest of what the packer made of them
// BEFORE its colour, unit-scale and seed rules were folded into the contract's shared
// helpers (thresholdColor, scaleVariant). Every colour encoding a stored blob can hold
// (int, '#RRGGBB' either case, '', null, absent, garbage), every theme, look, unit and
// scale picker, the toggles and pairs are drawn at random from a FIXED seed, so the
// set is the same on every run.
//
// A mismatch is a change in the bytes the watch receives for the SAME stored settings.
// Do not re-record the digest to make it pass unless that change is deliberate (a new
// kind, a new byte) and reviewed as such.
// Re-recorded for 1.24.0's On demand bytes (48 B: byte 35 the Battery item in place of
// the per-bar placement, bytes 38-47 the cells), after checking every other byte of the
// 4000 old combos against the pre-change packer: identical. The packer's move out of
// status-thresholds.js into status-wire.js kept the digest as it was. Re-recorded when
// the sides lost their Enabled/Disabled switch (a side is on while it ticks something),
// after checking every combo against the previous packer with every switch forced on:
// identical, and no byte outside the cells (38-47) moved. Re-recorded when the default
// Rain tick moved to the Watch Status Bar's left: only the Rain cell (byte 42) moved,
// and every combo equals the previous packer fed the new default lists. Re-recorded when
// the Radar and Health bars began to exist by the screens (2.6, view-cycle.js barsShown)
// rather than by radarMode / healthMode: only the 477 blobs that store no radarMode moved,
// and only in the cells (bytes 38-47), since their compact calendar cycle seats the Radar
// bar the watch is sent; fed the old mode rule, every combo equals the previous digest.
// Re-recorded when the rain alert's "Replaces the slot" became a switch of its own, on by
// default (bit 2 of byte 34, which 3.2.0's shared option left 0 unless set): every one of
// the 4000 blobs now has that bit, and with it cleared they equal the previous digest.
// Re-recorded when the weather condition got its Bold (kind 20, bits 3-4 of byte 34): the
// generator skips its bold mode, so the sequence holds, and only the 1322 blobs with
// statusBoldAll 'all' moved, each by Always in those two bits; with them masked, every
// blob equals the previous digest.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const th = require('../src/pkjs/alerts/domain/status-thresholds.js');
const wire = require('../src/pkjs/alerts/domain/status-wire.js');
const OD = require('../src/pkjs/status-bars/domain/on-demand.js');

const COMBOS = 4000;
const GOLDEN_SHA256 = '61f9eb09057a535c3ec7c4782e578feca7f317461f58830c2029ee9e166a4d2d';

/**
 * mulberry32: a small deterministic PRNG, so the generated set never varies.
 * @param {number} seed 32-bit seed.
 * @returns {function(): number} Uniform [0, 1).
 */
function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ABSENT = {};   // pick() sentinel: leave the key out of the blob
const COLORS = [ABSENT, '', null, 0x000000, 0xFFFFFF, '#000000', '#ffffff', '#FFFFFF',
  0xFF0000, '#FF0000', '#00AAFF', 0x00AAFF, 0x55FF00, '#55ff00', '#123456', 'garbage', '12xyz'];
const PAIR_VALUES = [ABSENT, '', '0', '2', '2.5', '3', '4', '4,5', '5', '6', '6.5', '7.5', '8',
  '20', '25', '30', '40', '55', '60', '80', '90', '100', '150', '8000', '10000', 'x'];

/**
 * @param {function(): number} rnd The PRNG.
 * @param {Array} list Choices.
 * @returns {*} One of them.
 */
function pick(rnd, list) {
  return list[Math.floor(rnd() * list.length)];
}

/**
 * @param {Object} s Blob being built.
 * @param {string} key Settings key.
 * @param {*} v Value, or ABSENT to leave the key out.
 */
function put(s, key, v) {
  if (v !== ABSENT) { s[key] = v; }
}

/**
 * One generated settings blob and the env it is packed for.
 * @param {function(): number} rnd The PRNG.
 * @returns {{settings: Object, env: ?Object}}
 */
function combo(rnd) {
  const s = {};
  put(s, 'theme', pick(rnd, [ABSENT, 'dark', 'light', 'bw', 'bw-light', 'sepia']));
  put(s, 'windUnits', pick(rnd, [ABSENT, 'kph', 'mph', 'knots', 'ms']));
  put(s, 'distanceUnits', pick(rnd, [ABSENT, 'metric', 'imperial']));
  put(s, 'aqiSource', pick(rnd, [ABSENT, 'waqi', 'auto', 'openmeteo']));
  put(s, 'aqiScale', pick(rnd, [ABSENT, 'us', 'european']));
  put(s, 'statusBoldAll', pick(rnd, [ABSENT, 'all', 'perSlot']));
  put(s, 'rainAlertDisplay', pick(rnd, [ABSENT, 'text', 'icon', 'minutes', 'bogus']));
  // On demand: every bar's sides and their lists, the modes that make a bar exist, and
  // the Battery item. Each side's retired Enabled/Disabled switch is still drawn, so the
  // PRNG sequence (every other byte's draw) is the recorded one; the packer ignores it.
  OD.BLOB_BARS.forEach((b) => OD.SIDES.forEach((side) => {
    put(s, OD.itemsKey(b.bar, side).replace(/Items$/, ''), pick(rnd, [ABSENT, 'on', 'off', 'maybe']));
    put(s, OD.itemsKey(b.bar, side), pick(rnd, [ABSENT, '', 'battery', 'bt,qt,snooze', 'rain,uv,wind',
      'gust,aqi,pollen', 'wind,battery,zzz', 7]));
  }));
  put(s, 'radarMode', pick(rnd, [ABSENT, 'off', 'countdown', 'status', 'graph']));
  put(s, 'healthMode', pick(rnd, [ABSENT, 'off', 'status', 'all', 'slot']));
  put(s, 'batteryLowLevel', pick(rnd, [ABSENT, '5', '10', '15', '20', '25', '30', '0', '31', 'x', 15]));
  put(s, 'batteryLowDisplay', pick(rnd, [ABSENT, 'icon', 'value', 'bogus']));
  th.KINDS.forEach((k) => {
    // The weather condition (kind 20) came after the recording: drawing its bold mode here
    // would shift every later draw. Its cell has a test of its own below.
    if (k.code === 'condition') { return; }
    const stem = 'thresh' + k.key;
    put(s, stem + 'BoldMode', pick(rnd, [ABSENT, 'warn', 'off', 'always', 'bogus']));
    if (k.boldOnly) { return; }
    put(s, stem + 'On', pick(rnd, [ABSENT, true, false, 'true']));
    put(s, stem + 'Warn', pick(rnd, PAIR_VALUES));
    put(s, stem + 'Danger', pick(rnd, PAIR_VALUES));
    put(s, stem + 'WarnLook', pick(rnd, [ABSENT, 'none', 'outline', 'fill', 'bogus']));
    put(s, stem + 'WarnColor', pick(rnd, COLORS));
    put(s, stem + 'DangerColor', pick(rnd, COLORS));
  });
  return { settings: s, env: pick(rnd, [undefined, { color: true }, { color: false },
    { color: true, fineBattery: true }, { color: false, onDemand: false }, { color: true, radar: false, health: false }]) };
}

test('CLAY_THRESHOLDS_UINT8 is byte-identical to the recorded packer over 4000 generated blobs', () => {
  const rnd = prng(0x1D24);
  const blobs = [];
  for (let i = 0; i < COMBOS; i++) {
    const c = combo(rnd);
    const blob = wire.buildSettingsBlob(c.settings, c.env);
    assert.equal(blob.length, wire.SETTINGS_BYTES);
    blobs.push(blob);
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify(blobs)).digest('hex');
  assert.equal(digest, GOLDEN_SHA256);
});

// The weather condition's bold cell (kind 20) rides bits 3-4 of the alerts byte, beside
// the rain look and Replaces the slot, and moves nothing else.
test('the weather condition\'s bold mode packs into bits 3-4 of the alerts byte alone', () => {
  const base = { rainAlertDisplay: 'minutes' };
  const plain = wire.buildSettingsBlob(base);
  [['warn', 0], ['off', 1], ['always', 2], ['bogus', 0]].forEach(([mode, bits]) => {
    const blob = wire.buildSettingsBlob(Object.assign({ threshConditionBoldMode: mode }, base));
    assert.equal((blob[wire.ALERTS_OFFSET] >> wire.CONDITION_BOLD_SHIFT) & 3, bits, mode);
    blob.forEach((b, i) => {
      const want = i === wire.ALERTS_OFFSET ? plain[i] | (bits << wire.CONDITION_BOLD_SHIFT) : plain[i];
      assert.equal(b, want, mode + ': byte ' + i);
    });
  });
  assert.equal((plain[wire.ALERTS_OFFSET] & 3), 2, 'the rain look keeps bits 0-1');
  assert.ok(plain[wire.ALERTS_OFFSET] & wire.RAIN_REPLACE_BIT, 'Replaces the slot keeps bit 2');
  const all = wire.buildSettingsBlob(Object.assign({ statusBoldAll: 'all' }, base));
  assert.equal((all[wire.ALERTS_OFFSET] >> wire.CONDITION_BOLD_SHIFT) & 3, 2, 'Bold all reaches it too');
  assert.deepEqual(wire.boldCell(20), { byte: wire.ALERTS_OFFSET, shift: wire.CONDITION_BOLD_SHIFT });
  assert.deepEqual(wire.boldCell(19), { byte: 33, shift: 6 });
  assert.throws(() => wire.boldCell(21), /layout must change/, 'a 22nd kind has no cell');
  assert.equal(th.KINDS[20].code, 'condition', 'the condition is kind 20');
});
