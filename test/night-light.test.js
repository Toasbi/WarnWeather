// test/night-light.test.js — the Dim backlight tuple (CLAY_NIGHT_LIGHT_UINT8):
// [r, g, b, startHour, endHour]. Three 0-255 LED channels and the window they glow
// in, with the app's established window conventions (sleep-window.js): end hour
// exclusive, wrapping past midnight, start === end meaning never.
const test = require('node:test');
const assert = require('node:assert/strict');

const nightLight = require('../src/pkjs/night-light.js');
const sleepWindow = require('../src/pkjs/sleep-window.js');
// The settings page's own "r,g,b" reader — the parser night-light.js hand-keeps a
// copy of, pinned to it by the parity test at the bottom of this file.
const rangeControl = require('../src/pkjs/config-ui/lib/range-control.js');

const { buildNightLightBytes, parseDimColor, resolveDimWindow, isDimEnabled } = nightLight;

// Shared Night hours 0..7, the dim window's own hours 22..6 — deliberately different
// windows, and neither is a subset of the other, so reading the wrong pair shows up at
// both ends (06 and 22/23). The same fixture shape test/sleep-window.test.js uses.
function S(over) {
  return Object.assign({
    backlightDim: true,
    sleepStartHour: '0', sleepEndHour: '7',
    backlightDimStartHour: '22', backlightDimEndHour: '6',
    backlightDimColor: '96,0,0'
  }, over || {});
}

// --- the tuple's shape ------------------------------------------------------

test('the tuple is exactly five bytes, each an integer in range', () => {
  [S(), S({ backlightDim: false }), S({ backlightDimColor: 'nonsense' }),
    {}, undefined].forEach((settings) => {
    const bytes = buildNightLightBytes(settings);
    assert.ok(Array.isArray(bytes));
    assert.equal(bytes.length, 5, 'CLAY_NIGHT_LIGHT_UINT8 is a 5-byte tuple');
    assert.equal(bytes.length, nightLight.NIGHT_LIGHT_BYTES);
    bytes.forEach((b, i) => {
      assert.ok(Number.isInteger(b), 'byte ' + i + ' is an integer: ' + b);
      assert.ok(b >= 0 && b <= (i < 3 ? 255 : 23), 'byte ' + i + ' in range: ' + b);
    });
  });
});

test('an absent settings blob still packs a usable tuple (the schema defaults)', () => {
  // The toggle ships ON, so a blob that predates it must not read as off.
  assert.deepEqual(buildNightLightBytes({}), [96, 0, 0, 0, 7]);
  assert.deepEqual(buildNightLightBytes(undefined), [96, 0, 0, 0, 7]);
  assert.equal(isDimEnabled({}), true);
  assert.equal(isDimEnabled({ backlightDim: undefined }), true);
  assert.equal(isDimEnabled({ backlightDim: null }), true);
  assert.equal(isDimEnabled({ backlightDim: true }), true);
  assert.equal(isDimEnabled({ backlightDim: false }), false);
});

// --- colour: parse, clamp, fall back ----------------------------------------

test('the colour is read as three channels from the stored "r,g,b" string', () => {
  assert.deepEqual(parseDimColor({ backlightDimColor: '96,0,0' }), { r: 96, g: 0, b: 0 });
  assert.deepEqual(parseDimColor({ backlightDimColor: '255,128,7' }), { r: 255, g: 128, b: 7 });
  assert.deepEqual(parseDimColor({ backlightDimColor: ' 12 , 34 ,56 ' }), { r: 12, g: 34, b: 56 });
  assert.deepEqual(buildNightLightBytes(S({ backlightDimColor: '10,20,30' })).slice(0, 3),
    [10, 20, 30]);
});

test('an out-of-range channel is clamped to 0-255, not rejected', () => {
  // 0-255 is fixed by the LED driver, so 300 is a bruised value and not a stale one.
  assert.deepEqual(parseDimColor({ backlightDimColor: '300,-5,20' }), { r: 255, g: 0, b: 20 });
  assert.deepEqual(parseDimColor({ backlightDimColor: '999,999,999' }), { r: 255, g: 255, b: 255 });
});

test('garbage falls back to the schema default 96,0,0 rather than sending nonsense', () => {
  [undefined, null, '', 'nope', '#FF0000', '96 0 0', '12,34', '1,2,3,4', '1,2,x',
    '1.5,2,3', {}, [], 42, true].forEach((value) => {
    assert.deepEqual(parseDimColor({ backlightDimColor: value }), { r: 96, g: 0, b: 0 },
      'unparseable value must fall back: ' + JSON.stringify(value));
  });
  assert.deepEqual(parseDimColor({}), { r: 96, g: 0, b: 0 }, 'key absent entirely');
});

test('black is a legitimate pick, not a fallback', () => {
  // The fallback is 96,0,0 precisely so a bruised value cannot masquerade as this.
  assert.deepEqual(parseDimColor({ backlightDimColor: '0,0,0' }), { r: 0, g: 0, b: 0 });
});

// --- the window: which pair, and the conventions it follows -----------------

test("mode 'custom' takes the feature's own hours", () => {
  assert.deepEqual(resolveDimWindow(S({ backlightDimMode: 'custom' })), { start: 22, end: 6 });
  assert.deepEqual(buildNightLightBytes(S({ backlightDimMode: 'custom' })), [96, 0, 0, 22, 6]);
});

test("mode 'night', an absent mode and an unknown mode all follow the shared Night hours", () => {
  // Following the card's shared window is the default, so a blob with no
  // backlightDimMode stored at all must read the shared pair, not the custom one.
  [{ backlightDimMode: 'night' }, {}, { backlightDimMode: undefined },
    { backlightDimMode: 'wat' }].forEach((over) => {
    assert.deepEqual(resolveDimWindow(S(over)), { start: 0, end: 7 },
      'mode ' + JSON.stringify(over) + ' must follow Night hours');
  });
  assert.deepEqual(buildNightLightBytes(S({ backlightDimMode: 'night' })), [96, 0, 0, 0, 7]);
});

test('a window that wraps past midnight rides the wire as-is (the watch unwraps it)', () => {
  // 22..6 wraps; the end hour is EXCLUSIVE, so 6 is already day.
  assert.deepEqual(buildNightLightBytes(S({ backlightDimMode: 'custom' })), [96, 0, 0, 22, 6]);
  assert.deepEqual(buildNightLightBytes(S({ backlightDimMode: 'custom',
    backlightDimStartHour: '23', backlightDimEndHour: '0' })), [96, 0, 0, 23, 0]);
});

test('a non-wrapping window rides the wire as-is', () => {
  assert.deepEqual(buildNightLightBytes(S({ backlightDimMode: 'custom',
    backlightDimStartHour: '1', backlightDimEndHour: '5' })), [96, 0, 0, 1, 5]);
  assert.deepEqual(buildNightLightBytes(S({ sleepStartHour: '9', sleepEndHour: '17' })),
    [96, 0, 0, 9, 17]);
});

test('unparseable hours fall back to 0..7 — the schema defaults of the keys being read', () => {
  // NOT sleep-window.js's 22/7: those are the battery saver's historical fallback,
  // kept for its upgrading installs. Both pairs read here default to '0'/'7'.
  assert.deepEqual(resolveDimWindow(S({ sleepStartHour: 'x', sleepEndHour: '99' })),
    { start: 0, end: 7 });
  assert.deepEqual(resolveDimWindow(S({ backlightDimMode: 'custom',
    backlightDimStartHour: undefined, backlightDimEndHour: '-1' })), { start: 0, end: 7 });
  assert.deepEqual(resolveDimWindow(S({ backlightDimMode: 'custom',
    backlightDimStartHour: '24', backlightDimEndHour: 'nope' })), { start: 0, end: 7 });
  // ...and the saver's own fallbacks are untouched by that choice.
  assert.deepEqual(sleepWindow.resolveSleepWindow({ sleepStartHour: 'x', sleepEndHour: '99' }),
    { start: 22, end: 7 });
});

test('a user-configured zero-length window is left alone (it already means never)', () => {
  assert.deepEqual(buildNightLightBytes(S({ backlightDimMode: 'custom',
    backlightDimStartHour: '5', backlightDimEndHour: '5' })), [96, 0, 0, 5, 5]);
});

// --- the OFF sentinel -------------------------------------------------------

test('the switch OFF sends the zeroed tuple — start === end, this repo\'s "never"', () => {
  assert.deepEqual(buildNightLightBytes(S({ backlightDim: false })), [0, 0, 0, 0, 0]);
  const off = buildNightLightBytes(S({ backlightDim: false }));
  assert.equal(off[3], off[4], 'start === end is what tells the watch "never"');
});

test('OFF zeroes the colour too, so editing it while off cannot dirty the Clay message', () => {
  // The whole Clay payload is ONE change-detector category (outbox.sendClay), so a
  // byte that moves buys a Bluetooth send. While the feature is off, none of the five
  // settings may move a byte.
  const base = buildNightLightBytes(S({ backlightDim: false }));
  [{ backlightDimColor: '1,2,3' }, { backlightDimMode: 'custom' },
    { backlightDimStartHour: '3' }, { backlightDimEndHour: '4' },
    { sleepStartHour: '9' }].forEach((over) => {
    assert.deepEqual(buildNightLightBytes(S(Object.assign({ backlightDim: false }, over))),
      base, 'OFF must be inert for ' + JSON.stringify(over));
  });
});

test('the OFF tuple is a fresh array each call (a mutating caller cannot poison it)', () => {
  const first = buildNightLightBytes({ backlightDim: false });
  first[0] = 255;
  assert.deepEqual(buildNightLightBytes({ backlightDim: false }), [0, 0, 0, 0, 0]);
});

// --- every key actually moves the tuple (the change detector's input) --------

test('each of the five Dim backlight keys moves the tuple', () => {
  // Base is custom mode with hours and a colour that differ from the shared pair and
  // the default, so a single key edit is visible in the bytes either way.
  function custom(over) {
    return S(Object.assign({ backlightDimMode: 'custom', backlightDimColor: '10,20,30' },
      over || {}));
  }
  const edits = {
    backlightDim: false,               // -> the OFF tuple
    backlightDimMode: 'night',         // -> the shared Night hours instead
    backlightDimStartHour: '21',
    backlightDimEndHour: '5',
    backlightDimColor: '11,20,30'
  };
  const packed = JSON.stringify(buildNightLightBytes(custom()));
  Object.keys(edits).forEach((key) => {
    const over = {};
    over[key] = edits[key];
    assert.notEqual(JSON.stringify(buildNightLightBytes(custom(over))), packed,
      key + ' must move CLAY_NIGHT_LIGHT_UINT8');
  });
});

test('the shared Night hours move the tuple while the feature follows them', () => {
  const following = JSON.stringify(buildNightLightBytes(S({ backlightDimMode: 'night' })));
  assert.notEqual(JSON.stringify(buildNightLightBytes(
    S({ backlightDimMode: 'night', sleepStartHour: '21' }))), following);
  // ...and do NOT move it once the feature has hours of its own.
  const own = JSON.stringify(buildNightLightBytes(S({ backlightDimMode: 'custom' })));
  assert.equal(JSON.stringify(buildNightLightBytes(
    S({ backlightDimMode: 'custom', sleepStartHour: '21' }))), own);
});

// --- mirror parity ----------------------------------------------------------

// The colour parser is a hand-kept copy of the settings page's (range-control.js's
// parseRgbStrict/parseRgb, which the sliders and the card's swatch read the same
// string with) — the page bundle is a flat concatenation the watch runtime does not
// load. Pin the two together over the whole input matrix: a change to one that isn't
// made to the other fails here rather than shipping a backlight that glows a different
// colour from the swatch the user picked.
test('the colour parser matches the settings page exactly (mirror parity)', () => {
  const ITEM = { type: 'rgb', messageKey: 'backlightDimColor', defaultValue: '96,0,0' };
  const VALUES = [undefined, null, '', '0,0,0', '96,0,0', '255,255,255', '1,2,3',
    ' 12 , 34 ,56 ', '300,-5,20', '-1,0,0', '256,256,256', '999,999,999',
    'nope', '#FF0000', '12,34', '1,2,3,4', '1,2,x', '1.5,2,3', '96 0 0', ',,',
    '0, 0, 0', 42, true, {}, [], '-0,-0,-0', '-0,5,-0'];
  // Compared as COLOURS, which is what the mirror is for. The one licensed
  // difference is the SIGN OF A ZERO: '-0' parses to a negative zero, which
  // range-control.js keeps (it feeds a slider and a CSS swatch, where it renders as
  // "0") and night-light.js deliberately normalises away (its output is a byte
  // array bound for the wire — see clampChannel). -0 and 0 are the same colour, so
  // this normalisation is the point of the exception rather than a hole in it.
  const sameColour = (a, b) => ['r', 'g', 'b'].every((k) => a[k] === b[k]);
  VALUES.forEach((value) => {
    const mine = parseDimColor({ backlightDimColor: value });
    const page = rangeControl.parseRgb(value, ITEM);
    assert.ok(sameColour(mine, page),
      'mirror drifted for ' + JSON.stringify(value) + ': ' +
      JSON.stringify(mine) + ' vs ' + JSON.stringify(page));
    // ...and the packer's own output never carries a signed zero, whatever the page
    // hands it — a negative zero is not a byte.
    ['r', 'g', 'b'].forEach((k) => {
      assert.equal(Object.is(mine[k], -0), false,
        'signed zero reached the wire for ' + JSON.stringify(value));
    });
  });
});

// The hour parse is not a copy at all — night-light.js requires sleep-window.js's
// parseHour, the one home of the rule. This pins that it stays that way: the tuple's
// hour bytes must be exactly what the shared parser answers for the same input.
test('the hour bytes are sleep-window.js\'s parse, with this feature\'s own fallbacks', () => {
  const HOURS = ['0', '5', '7', '22', '23', 'x', '99', '-1', undefined, null, 12, ' 8 '];
  HOURS.forEach((a) => HOURS.forEach((b) => {
    const bytes = buildNightLightBytes(S({ backlightDimMode: 'custom',
      backlightDimStartHour: a, backlightDimEndHour: b }));
    assert.equal(bytes[3], sleepWindow.parseHour(a, 0), 'start drifted for ' + a);
    assert.equal(bytes[4], sleepWindow.parseHour(b, 7), 'end drifted for ' + b);
  }));
});

// --- the watch's half of the contract, executed -----------------------------
// Everything above pins the phone side against itself. These pin it against the
// WATCH, which is the half nobody can compile here: src/c/appendix/persist.h owns
// the C layout, and its night_light_wire_ok() is what decides whether a tuple may
// overwrite the last good one on flash. A disagreement between the two sides is
// invisible until it reaches an emery watch — the tuple is simply dropped and the
// LED keeps whatever it had — so read the C constants straight out of the header
// rather than restating them, and run the watch's rule over what the packer emits.
const fs = require('node:fs');
const path = require('node:path');

/**
 * Read the C side's wire constants out of persist.h.
 *
 * @returns {{bytes: number, hourMax: number}} NIGHT_LIGHT_BYTES / _HOUR_MAX.
 */
function watchWireContract() {
  const src = fs.readFileSync(
    path.join(__dirname, '../src/c/appendix/persist.h'), 'utf8');
  const bytes = src.match(/#define\s+NIGHT_LIGHT_BYTES\s+(\d+)/);
  const hourMax = src.match(/#define\s+NIGHT_LIGHT_HOUR_MAX\s+(\d+)/);
  assert.ok(bytes, 'persist.h must define NIGHT_LIGHT_BYTES');
  assert.ok(hourMax, 'persist.h must define NIGHT_LIGHT_HOUR_MAX');
  return { bytes: Number(bytes[1]), hourMax: Number(hourMax[1]) };
}

/**
 * A transcription of night_light_wire_ok() (persist.h) — the whole of the watch's
 * acceptance rule: a MINIMUM length, and both HOUR bytes in range. The colour bytes
 * never gate acceptance; all 256 values are legal in each channel.
 *
 * @param {*} tuple Candidate tuple.
 * @param {{bytes: number, hourMax: number}} c The C side's constants.
 * @returns {boolean} True when the watch would persist it as-is.
 */
function watchAccepts(tuple, c) {
  if (!Array.isArray(tuple) || tuple.length < c.bytes) { return false; }
  return tuple[3] <= c.hourMax && tuple[4] <= c.hourMax;
}

test('the packer emits exactly the byte count the watch requires', () => {
  const c = watchWireContract();
  assert.equal(nightLight.NIGHT_LIGHT_BYTES, c.bytes,
    'night-light.js and persist.h disagree on the tuple length');
  assert.equal(buildNightLightBytes(S()).length, c.bytes);
  assert.equal(buildNightLightBytes({ backlightDim: false }).length, c.bytes);
});

test('the watch accepts every tuple this packer can emit', () => {
  const c = watchWireContract();
  const COLOURS = ['96,0,0', '0,0,0', '255,255,255', '300,-5,20', 'nonsense',
    '#FF0000', undefined];
  ['night', 'custom'].forEach((mode) => {
    for (let start = 0; start < 24; start++) {
      for (let end = 0; end < 24; end++) {
        const over = mode === 'custom'
          ? { backlightDimMode: 'custom',
            backlightDimStartHour: String(start), backlightDimEndHour: String(end) }
          : { backlightDimMode: 'night',
            sleepStartHour: String(start), sleepEndHour: String(end) };
        const tuple = buildNightLightBytes(S(over));
        assert.ok(watchAccepts(tuple, c),
          'the watch would DROP ' + JSON.stringify(tuple) + ' for ' + JSON.stringify(over));
      }
    }
  });
  COLOURS.forEach((backlightDimColor) => {
    assert.ok(watchAccepts(buildNightLightBytes(S({ backlightDimColor })), c),
      'the watch would drop the tuple for colour ' + JSON.stringify(backlightDimColor));
  });
  // Including the OFF tuple: rejecting it would make the feature un-turn-off-able.
  assert.ok(watchAccepts(buildNightLightBytes(S({ backlightDim: false })), c));
});

test('the hours sit at [3] and [4] — where the watch validates them', () => {
  // The one property that makes the ORDER executable rather than a comment on both
  // sides. Pick a colour whose every channel is above the hour ceiling, so the
  // watch's own rule is a decisive test of where the window sits: pack the tuple
  // window-first and it stops being accepted at all.
  const c = watchWireContract();
  const tuple = buildNightLightBytes(S({ backlightDimColor: '96,200,255' }));
  assert.deepEqual(tuple.slice(0, 3), [96, 200, 255]);
  tuple.slice(0, 3).forEach((channel) => {
    assert.ok(channel > c.hourMax, 'the fixture colour must exceed the hour ceiling');
  });
  assert.ok(watchAccepts(tuple, c), 'the packer\'s own order must be accepted');

  // [startHour, endHour, r, g, b] — the plausible drift, and the one that would
  // strand an emery watch on its last good tuple with no visible symptom.
  assert.equal(watchAccepts([tuple[3], tuple[4], tuple[0], tuple[1], tuple[2]], c), false,
    'a window-first tuple must be rejected — that is what pins the order');
  // Any single colour channel landing in an hour slot is caught the same way.
  assert.equal(watchAccepts([tuple[0], tuple[1], tuple[3], tuple[2], tuple[4]], c), false);
  assert.equal(watchAccepts([tuple[0], tuple[1], tuple[2], tuple[3], tuple[0]], c), false);
});
