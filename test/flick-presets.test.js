// test/flick-presets.test.js
// The Layout preset compiles (preset x healthMode x radarMode) to CLAY_VIEW_0/1/2
// packed ViewSpec uint16s via view-cycle.js. Packed-value format & values: see
// view-cycle.test.js. Values below are the 10-bit positional encoding (statusUpper/
// statusLower), computed from the current view-cycle.js MATRIX — not hand-picked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };

const { buildClayPayload, VIEW_RESET_DOUBLE_FLICK } = require('../src/pkjs/clay-payload.js');

function views(settings) {
  const p = buildClayPayload(settings, null, new Date(0));
  return [p.CLAY_VIEW_0, p.CLAY_VIEW_1, p.CLAY_VIEW_2];
}

test('compactCal default (off/no-radar) → [CAL2·FC upper, off, off]', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactCal', radarMode: 'off' }), [0x244, 0, 0]);
});

test('compactCal all + radar → packed 3-stop cycle', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'graph' }),
    [0x244, 0x11C, 0x128]);   // CAL2 default (2-row), big graph + radar-chart flicks
});

test('compactDense status → health-dense default, single flick', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactDense', healthMode: 'status', radarMode: 'off' }),
    [0x24D, 0, 0]);   // CAL2·FC, statusUpper=HEALTH, statusLower=FORECAST
});

test('fullCal status + radar', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'fullCal', healthMode: 'status', radarMode: 'graph' }),
    [0x344, 0x24D, 0x26E]);   // radar flick = CAL2·RDR dense (health upper, radar lower) —
                              // same 2-row tier as the health flick, never back to 3 rows
});

test('compactDense off + radar graph → dense default AND dense radar flick', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactDense', healthMode: 'off', radarMode: 'graph' }),
    [0x249, 0x269, 0]);   // flick keeps the dense pair: radar upper, forecast lower, chart body
});

test('legacy layoutPreset migrates (classic → compactCal)', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'classic', radarMode: 'graph' }), [0x244, 0x268, 0]);
});

test('legacy pre-preset topViewMode=none → noCal', () => {
  assert.deepStrictEqual(views({ topViewMode: 'none', radarMode: 'off' }), [0x104, 0, 0]);
});

test('viewResetMin maps straight through', () => {
  const p = buildClayPayload({ layoutPreset: 'compactCal', viewResetMin: '5' }, null, new Date(0));
  assert.strictEqual(p.CLAY_VIEW_RESET_MIN, 5);
});

// Double flick rides bit 8 of CLAY_VIEW_RESET_MIN's int (clay-payload.js packViewReset):
// no tuple of its own, so the Clay message keeps its size (test/inbox-size.test.js).
function payload(settings, platform) {
  const watchInfo = platform ? { platform: platform } : null;
  return buildClayPayload(Object.assign({ layoutPreset: 'compactCal' }, settings), watchInfo, new Date(0));
}
function resetWord(settings, platform) {
  return payload(settings, platform).CLAY_VIEW_RESET_MIN;
}

test('doubleFlick rides bit 8 of CLAY_VIEW_RESET_MIN; the minutes keep the low byte', () => {
  ['0', '1', '2', '5', '10'].forEach(function (m) {
    const off = resetWord({ viewResetMin: m, doubleFlick: false }, 'basalt');
    const on = resetWord({ viewResetMin: m, doubleFlick: true }, 'basalt');
    assert.strictEqual(off, Number(m), m + ': off leaves the wire value unchanged');
    // The low byte, all a pre-flag watch's uint8 cast reads, stays the minutes.
    assert.strictEqual(on, Number(m) | 0x100, m + ': on sets bit 8');
  });
  // An upgrade (key absent until seedDefaults backfills it) sends exactly what OFF sends,
  // so the outbox's change detector has nothing to resend; a toggle changes the payload.
  const json = function (extra) {
    return JSON.stringify(payload(Object.assign({ viewResetMin: '2' }, extra), 'basalt'));
  };
  assert.strictEqual(json({}), json({ doubleFlick: false }), 'absent and off are the same payload');
  assert.notStrictEqual(json({ doubleFlick: true }), json({ doubleFlick: false }), 'a toggle changes the payload');
});

test('the double-flick bit is masked for a known aplite, kept for an unknown platform', () => {
  const s = { viewResetMin: '5', doubleFlick: true };
  assert.strictEqual(resetWord(s, 'aplite'), 5, 'aplite has no flick: bare minutes');
  assert.strictEqual(resetWord(s, null), 0x105, 'an unknown platform is treated as capable');
  const aplite = function (flag) {
    return JSON.stringify(payload({ viewResetMin: '5', doubleFlick: flag }, 'aplite'));
  };
  assert.strictEqual(aplite(true), aplite(false), 'aplite\'s payload never changes with the switch');
});

test('a junk viewResetMin can never set the double-flick bit', () => {
  [['-1', 255], ['300', 44], ['abc', 0]].forEach(function (c) {
    const w = resetWord({ viewResetMin: c[0], doubleFlick: false }, 'basalt');
    assert.strictEqual(w, c[1], c[0] + ' -> the low byte the watch\'s uint8 cast always read');
    assert.strictEqual(w & 0x100, 0, c[0] + ' leaves bit 8 clear');
  });
});

test('the double-flick bit is one number on both sides of the wire', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'src', 'c', 'appendix', 'config_wire.h'), 'utf8');
  const m = /#define\s+VIEW_RESET_DOUBLE_FLICK\s+(0x[0-9A-Fa-f]+)/.exec(h);
  assert.ok(m, 'config_wire.h defines VIEW_RESET_DOUBLE_FLICK');
  assert.strictEqual(Number(m[1]), VIEW_RESET_DOUBLE_FLICK);
  assert.strictEqual(VIEW_RESET_DOUBLE_FLICK, 0x100, 'above the minutes byte, below the int16 read\'s sign bit');
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'c', 'appendix', 'config_wire.c'), 'utf8');
  assert.match(c, /view_double_flick\s*=\s*\(\s*clay_view_reset_tuple->value->int16\s*&\s*VIEW_RESET_DOUBLE_FLICK\s*\)\s*!=\s*0/,
    'config_wire.c decodes the flag with the shared constant');
  assert.ok(c.indexOf('(uint8_t) clay_view_reset_tuple->value->int16') >= 0,
    'the minutes stay a uint8 cast, which drops the flag bit');
});

test('no CLAY_DUAL_STATUS key is emitted', () => {
  const p = buildClayPayload({ layoutPreset: 'compactDense', healthMode: 'status' }, null, new Date(0));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(p, 'CLAY_DUAL_STATUS'), false);
});

// radarMode='status' keeps the schema.js-documented behavior ("Adds the Radar Status Bar
// while retaining the forecast graph"): unlike 'graph', the radar flick's chart body
// (BODY_RADAR) demotes to a plain forecast body (BODY_FC) — its RADAR status row is
// unchanged. There is no BODY_RADAR_STATUS enum anymore; the distinction is now purely
// positional (see view-cycle.js's demoteRadarBody).
test('compactCal all + radar status → radar flick keeps the forecast body with a RADAR status row (no chart)', () => {
  assert.deepStrictEqual(
    views({ layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'status' }),
    [0x244, 0x11C, 0x108]);   // last stop: NONE·FC (not NONE·RDR), statusUpper=RADAR
});
