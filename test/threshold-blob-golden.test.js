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
// status-thresholds.js into status-wire.js kept the digest as it was.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const th = require('../src/pkjs/status-thresholds.js');
const wire = require('../src/pkjs/status-wire.js');
const OD = require('../src/pkjs/on-demand.js');

const COMBOS = 4000;
const GOLDEN_SHA256 = '5cbc009b45dffb2f5f001bb345b4a29c003fb4f2c71e53086133a12dc227a227';

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
  // the Battery item.
  OD.BARS.forEach((b) => OD.SIDES.forEach((side) => {
    put(s, OD.sideKey(b.bar, side), pick(rnd, [ABSENT, 'on', 'off', 'maybe']));
    put(s, OD.itemsKey(b.bar, side), pick(rnd, [ABSENT, '', 'battery', 'bt,qt,snooze', 'rain,uv,wind',
      'gust,aqi,pollen', 'wind,battery,zzz', 7]));
  }));
  put(s, 'radarMode', pick(rnd, [ABSENT, 'off', 'countdown', 'status', 'graph']));
  put(s, 'healthMode', pick(rnd, [ABSENT, 'off', 'status', 'all', 'slot']));
  put(s, 'batteryLowLevel', pick(rnd, [ABSENT, '5', '10', '15', '20', '25', '30', '0', '31', 'x', 15]));
  put(s, 'batteryLowDisplay', pick(rnd, [ABSENT, 'icon', 'value', 'bogus']));
  th.KINDS.forEach((k) => {
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
