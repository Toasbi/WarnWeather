'use strict';
// test/status-pair.test.js — the two-value slots' presentation (src/pkjs/status-pair.js):
// Temperature 'both' (actual / feels-like) and UV 'both' (now / the peak ahead), plus the
// UV next-day mark in 'max' mode. Node-only (ES6 allowed here; the module is ES5).
const test = require('node:test');
const assert = require('node:assert/strict');

const pair = require('../src/pkjs/status-pair.js');
const catalog = require('../src/pkjs/status-line-catalog.js');
const thresholds = require('../src/pkjs/status-thresholds.js');
const utf8 = require('../src/pkjs/utf8.js');
const wireUnits = require('../src/pkjs/wire-units.js');

const EDGE = catalog.CAPS.EDGE_TEXT_MAX;   // 8
const MID = catalog.CAPS.MID_TEXT_MAX;     // 19
const RAQUO = '»';
const MIDDOT = '·';

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const uvNow = (now, peak) => ({ now, peak, nextDay: false });
const uvTomorrow = (now, peak) => ({ now, peak, nextDay: true });

// --- the contract the settings page builds its pickers from -------------------

test('the preset tables hold exactly the contract values', () => {
  assert.deepEqual(Object.keys(pair.SEPARATORS).sort(),
    ['bar', 'brackets', 'dot', 'slash', 'spaced'],
    "'custom' is the sixth separator value and deliberately not a table row");
  assert.deepEqual(Object.keys(pair.NEXT_DAY_MARKS).sort(),
    ['gt', 'none', 'plus', 'raquo', 'star']);
  assert.equal(pair.UV_NEXT_DAY, RAQUO, 'the default mark is still the »');
  assert.equal(pair.NEXT_DAY_MARKS.raquo.pre, pair.UV_NEXT_DAY);
  assert.equal(pair.CUSTOM_MAX_CHARS, 2);
});

// --- THE upgrade guarantee: absent keys bake today's text, byte for byte -------

test('absent settings reproduce the pre-feature text byte for byte', () => {
  for (const settings of [{}, null, undefined, {
    tempSlotSeparator: undefined, tempSlotOrder: undefined, tempSlotSeparatorCustom: undefined,
    uvSlotSeparator: undefined, uvSlotOrder: undefined, uvSlotSeparatorCustom: undefined,
    uvSlotNextDayMark: undefined
  }, {
    tempSlotSeparator: null, tempSlotOrder: null, uvSlotSeparator: null,
    uvSlotOrder: null, uvSlotNextDayMark: null
  }]) {
    for (const cap of [EDGE, MID, undefined]) {
      const what = JSON.stringify(settings) + ' cap ' + cap;
      assert.equal(pair.formatTempPair('12', '10', settings, cap), '12/10', what);
      assert.equal(pair.formatTempPair('-12', '-10', settings, cap), '-12/-10', what);
      assert.equal(pair.formatUv(uvNow(3, 7), settings, cap), '3/7', what);
      assert.equal(pair.formatUv(uvTomorrow(5, 6), settings, cap), '5/' + RAQUO + '6', what);
      assert.equal(pair.formatUv(uvTomorrow(null, 6), settings, cap), RAQUO + '6', what);
      assert.equal(pair.formatUv(uvNow(null, 7), settings, cap), '7', what);
      assert.equal(pair.formatUv(uvNow(3, null), settings, cap), '3', what);
    }
  }
  // The exact bytes, not merely an equal-looking string: » is U+00BB, C2 BB in UTF-8.
  assert.deepEqual(utf8.encode(pair.formatUv(uvTomorrow(5, 6), {}, EDGE)),
    [0x35, 0x2F, 0xC2, 0xBB, 0x36]);
  assert.deepEqual(utf8.encode(pair.formatTempPair('-12', '-10', {}, EDGE)),
    [0x2D, 0x31, 0x32, 0x2F, 0x2D, 0x31, 0x30]);
});

// The UV text before this module, verbatim: the pieces joined by '/', a tomorrow's
// peak prefixed with ». Swept against every reading uvShown can produce, so the
// default is pinned to the code it replaces rather than to a handful of examples.
function legacyUv(uv) {
  const parts = [];
  if (uv.now !== null) { parts.push(String(uv.now)); }
  if (uv.peak !== null) { parts.push((uv.nextDay ? RAQUO : '') + uv.peak); }
  return parts.join('/');
}

test('absent settings match the pre-feature UV bake across every reading uvShown gives', () => {
  const peaks = [null, 0, 25, 60, 71, 95, 110, 120, 149];
  for (const mode of [undefined, 'current', 'max', 'both']) {
    for (let head = 0; head <= 150; head += 5) {
      for (const today of peaks) {
        for (const next of peaks) {
          const uv = wireUnits.uvShown([head], [today, next], mode);
          assert.equal(pair.formatUv(uv, {}, EDGE), legacyUv(uv),
            `${mode} ${head} [${today}, ${next}]`);
        }
      }
    }
  }
});

// --- every separator x order ---------------------------------------------------

const TEMP_CASES = [
  // [separator, custom, actual first, feels first]
  ['slash', undefined, '12/10', '10/12'],
  ['spaced', undefined, '12 / 10', '10 / 12'],
  ['brackets', undefined, '12 (10)', '10 (12)'],
  ['dot', undefined, '12' + MIDDOT + '10', '10' + MIDDOT + '12'],
  ['bar', undefined, '12|10', '10|12'],
  ['custom', ', ', '12, 10', '10, 12'],
  ['custom', '~', '12~10', '10~12']
];

test('temp: every separator in both orders', () => {
  for (const [sep, custom, actualFirst, feelsFirst] of TEMP_CASES) {
    for (const cap of [EDGE, MID]) {
      const base = { tempSlotSeparator: sep, tempSlotSeparatorCustom: custom };
      assert.equal(pair.formatTempPair('12', '10', base, cap), actualFirst,
        sep + ': absent order is actual first');
      assert.equal(pair.formatTempPair('12', '10',
        Object.assign({ tempSlotOrder: 'actual' }, base), cap), actualFirst, sep);
      assert.equal(pair.formatTempPair('12', '10',
        Object.assign({ tempSlotOrder: 'feels' }, base), cap), feelsFirst, sep);
    }
  }
});

const UV_CASES = [
  // [separator, custom, now first, max first] for now 3, today's peak 7
  ['slash', undefined, '3/7', '7/3'],
  ['spaced', undefined, '3 / 7', '7 / 3'],
  ['brackets', undefined, '3 (7)', '7 (3)'],
  ['dot', undefined, '3' + MIDDOT + '7', '7' + MIDDOT + '3'],
  ['bar', undefined, '3|7', '7|3'],
  ['custom', ', ', '3, 7', '7, 3'],
  ['custom', '~', '3~7', '7~3']
];

test('uv: every separator in both orders', () => {
  for (const [sep, custom, nowFirst, maxFirst] of UV_CASES) {
    for (const cap of [EDGE, MID]) {
      const base = { uvSlotSeparator: sep, uvSlotSeparatorCustom: custom };
      assert.equal(pair.formatUv(uvNow(3, 7), base, cap), nowFirst,
        sep + ': absent order is now first');
      assert.equal(pair.formatUv(uvNow(3, 7),
        Object.assign({ uvSlotOrder: 'now' }, base), cap), nowFirst, sep);
      assert.equal(pair.formatUv(uvNow(3, 7),
        Object.assign({ uvSlotOrder: 'max' }, base), cap), maxFirst, sep);
    }
  }
});

test('the two kinds read their own keys, never each other\'s', () => {
  const tempStyled = { tempSlotSeparator: 'brackets', tempSlotOrder: 'feels' };
  assert.equal(pair.formatUv(uvNow(3, 7), tempStyled, MID), '3/7');
  const uvStyled = { uvSlotSeparator: 'brackets', uvSlotOrder: 'max',
    uvSlotSeparatorCustom: 'x' };
  assert.equal(pair.formatTempPair('12', '10', uvStyled, MID), '12/10');
});

test('the custom text is read only while the separator is custom', () => {
  assert.equal(pair.formatTempPair('12', '10',
    { tempSlotSeparator: 'spaced', tempSlotSeparatorCustom: 'x' }, MID), '12 / 10');
  assert.equal(pair.formatTempPair('12', '10',
    { tempSlotSeparatorCustom: 'x' }, MID), '12/10', 'absent separator = slash');
});

// --- the UV next-day mark ------------------------------------------------------

const MARKS = [
  // [mark, marked peak 6]
  [undefined, RAQUO + '6'],
  ['raquo', RAQUO + '6'],
  ['gt', '>6'],
  ['plus', '+6'],
  ['star', '6*'],
  ['none', '6']
];

test('every next-day mark, alone in max mode and paired in both', () => {
  for (const [mark, marked] of MARKS) {
    const s = { uvSlotNextDayMark: mark };
    assert.equal(pair.formatUv(uvTomorrow(null, 6), s, EDGE), marked, 'max: ' + mark);
    assert.equal(pair.formatUv(uvTomorrow(5, 6), s, EDGE), '5/' + marked, 'both: ' + mark);
    assert.equal(pair.formatUv(uvTomorrow(5, 6),
      Object.assign({ uvSlotOrder: 'max' }, s), EDGE), marked + '/5', 'both, max first: ' + mark);
    assert.equal(pair.formatUv(uvTomorrow(5, 6),
      Object.assign({ uvSlotSeparator: 'spaced' }, s), MID), '5 / ' + marked,
      'the mark rides with the peak whatever the separator: ' + mark);
  }
});

test('today\'s peak is never marked, whatever the mark setting', () => {
  for (const [mark] of MARKS) {
    const s = { uvSlotNextDayMark: mark };
    assert.equal(pair.formatUv(uvNow(null, 7), s, EDGE), '7', mark);
    assert.equal(pair.formatUv(uvNow(3, 7), s, EDGE), '3/7', mark);
  }
});

test('markNextDay: an unknown or inherited-looking value is the default »', () => {
  for (const bogus of ['sparkle', '', 'constructor', '__proto__', 'toString', 7, {}]) {
    assert.equal(pair.markNextDay('6', bogus), RAQUO + '6', String(bogus));
  }
});

// --- the fit rule ----------------------------------------------------------------

test('fit rule: the contract\'s worst cases at the edge cap', () => {
  const t = (sep, order, cap) => pair.formatTempPair('-12', '-10',
    { tempSlotSeparator: sep, tempSlotOrder: order }, cap);
  // 9 bytes: over the 8-byte edge slot, so the plain slash of the same pair.
  assert.equal(bytes('-12 / -10'), 9);
  assert.equal(t('spaced', undefined, EDGE), '-12/-10');
  assert.equal(t('brackets', undefined, EDGE), '-12/-10');
  // The fallback keeps the user's order.
  assert.equal(t('spaced', 'feels', EDGE), '-10/-12');
  assert.equal(t('brackets', 'feels', EDGE), '-10/-12');
  // These fit: 7 bytes, and the dot exactly 8 (U+00B7 is two bytes).
  assert.equal(pair.formatTempPair('12', '10', { tempSlotSeparator: 'spaced' }, EDGE), '12 / 10');
  assert.equal(bytes('-12' + MIDDOT + '-10'), EDGE);
  assert.equal(t('dot', undefined, EDGE), '-12' + MIDDOT + '-10', 'exactly at the cap stays');
  assert.equal(t('bar', undefined, EDGE), '-12|-10');
});

test('fit rule: the middle slot has room for every preset', () => {
  const t = (sep) => pair.formatTempPair('-12', '-10', { tempSlotSeparator: sep }, MID);
  assert.equal(t('spaced'), '-12 / -10');
  assert.equal(t('brackets'), '-12 (-10)');
  assert.equal(pair.formatTempPair('-12', '-10',
    { tempSlotSeparator: 'custom', tempSlotSeparatorCustom: 'ÿÿ' }, MID),
    '-12ÿÿ-10', '10 bytes, the widest custom pair, fits 19');
});

test('fit rule: UV keeps its order and its mark when it falls back', () => {
  const worst = uvTomorrow(11, 12);   // '11/»12' is 7 bytes
  const u = (extra) => pair.formatUv(worst, extra, EDGE);
  assert.equal(u({}), '11/' + RAQUO + '12');
  assert.equal(u({ uvSlotSeparator: 'spaced' }), '11/' + RAQUO + '12', "'11 / »12' is 9 B");
  assert.equal(u({ uvSlotSeparator: 'brackets' }), '11/' + RAQUO + '12', "'11 (»12)' is 9 B");
  assert.equal(u({ uvSlotSeparator: 'spaced', uvSlotOrder: 'max' }), RAQUO + '12/11');
  assert.equal(u({ uvSlotSeparator: 'brackets', uvSlotNextDayMark: 'gt', uvSlotOrder: 'max' }),
    '>12 (11)', "'>12 (11)' is exactly 8 B and fits");
  // One-byte marks leave room the two-byte » does not.
  assert.equal(u({ uvSlotSeparator: 'spaced', uvSlotNextDayMark: 'star' }), '11 / 12*');
  assert.equal(u({ uvSlotSeparator: 'dot' }), '11' + MIDDOT + RAQUO + '12', 'exactly 8 B');
  // ...and the middle slot takes them all.
  assert.equal(pair.formatUv(worst, { uvSlotSeparator: 'brackets' }, MID),
    '11 (' + RAQUO + '12)');
});

test('fit rule: an absent cap is the narrow edge cap (withUnit\'s convention)', () => {
  assert.equal(pair.formatTempPair('-12', '-10', { tempSlotSeparator: 'spaced' }), '-12/-10');
  assert.equal(pair.joinPair('-12', '-10', 'spaced', undefined), '-12/-10');
  assert.equal(pair.joinPair('12', '10', 'spaced', undefined), '12 / 10');
});

test('fit rule: a wide custom separator falls back on the edge slot only', () => {
  const s = { tempSlotSeparator: 'custom', tempSlotSeparatorCustom: 'ÿÿ' };
  assert.equal(pair.formatTempPair('12', '10', s, EDGE), '12ÿÿ10', "'12ÿÿ10' is exactly 8 B");
  assert.equal(pair.formatTempPair('-12', '-10', s, EDGE), '-12/-10', "'-12ÿÿ-10' is 10 B");
  assert.equal(pair.formatTempPair('-12', '-10', s, MID), '-12ÿÿ-10');
});

test('no preset, order or mark ever needs the last-resort truncation on an edge slot', () => {
  // Every whole-degree pair the planet produces, both units' ranges, the widest custom
  // separator and every mark: what formatUv/formatTempPair return must already fit, and
  // must be either the styled pair or the slash form -- never a clipped number.
  const seps = ['slash', 'spaced', 'brackets', 'dot', 'bar', 'custom'];
  for (let a = -62; a <= 140; a += 1) {
    const f = String(a), g = String(a - 9);
    for (const sep of seps) {
      for (const order of ['actual', 'feels']) {
        const text = pair.formatTempPair(f, g, { tempSlotSeparator: sep, tempSlotOrder: order,
          tempSlotSeparatorCustom: 'ÿÿ' }, EDGE);
        assert.ok(bytes(text) <= EDGE, `${text} (${sep}, ${order})`);
        const first = order === 'feels' ? g : f, second = order === 'feels' ? f : g;
        // The styled pair wherever it fits, the slash form otherwise: nothing in between.
        const styled = pair.joinPair(first, second, sep, 'ÿÿ', 99);
        assert.equal(text, bytes(styled) <= EDGE ? styled : first + '/' + second,
          `${sep}, ${order}`);
      }
    }
  }
  for (let now = 0; now <= 15; now += 1) {
    for (let peak = 0; peak <= 15; peak += 1) {
      for (const sep of seps) {
        for (const order of ['now', 'max']) {
          for (const [mark] of MARKS) {
            const text = pair.formatUv(uvTomorrow(now, peak), { uvSlotSeparator: sep,
              uvSlotOrder: order, uvSlotNextDayMark: mark,
              uvSlotSeparatorCustom: 'ÿÿ' }, EDGE);
            assert.ok(bytes(text) <= EDGE, `${text} (${sep}, ${order}, ${mark})`);
          }
        }
      }
    }
  }
});

// --- sanitizeCustom ----------------------------------------------------------------

test('sanitizeCustom keeps printable ASCII and printable Latin-1 only', () => {
  assert.equal(pair.sanitizeCustom('→'), '', 'an arrow is past Latin-1');
  assert.equal(pair.sanitizeCustom('a→b'), 'ab');
  assert.equal(pair.sanitizeCustom('😀'), '', 'emoji: both surrogates dropped');
  assert.equal(pair.sanitizeCustom('a😀b'), 'ab');
  assert.equal(pair.sanitizeCustom('°»'), '°»', 'Latin-1 kept');
  assert.equal(pair.sanitizeCustom('·'), '·');
  // The range edges.
  assert.equal(pair.sanitizeCustom('\u001F ~\u007F'), ' ~');
  assert.equal(pair.sanitizeCustom(' ¡ÿĀ'), '¡ÿ');
});

test('sanitizeCustom drops control characters, C0 and C1 alike', () => {
  assert.equal(pair.sanitizeCustom('\u0000'), '', 'a NUL would end the watch\'s C string');
  assert.equal(pair.sanitizeCustom('\u0001/\u0010'), '/', 'nor may a wind-sentinel byte ride in');
  assert.equal(pair.sanitizeCustom('\t-\n'), '-');
  assert.equal(pair.sanitizeCustom('\u0085\u009F'), '');
});

test('sanitizeCustom keeps the first two survivors and never trims', () => {
  assert.equal(pair.sanitizeCustom('abcdef'), 'ab');
  assert.equal(pair.sanitizeCustom(', '), ', ', 'spaces are meaningful');
  assert.equal(pair.sanitizeCustom(' -'), ' -');
  assert.equal(pair.sanitizeCustom('  '), '  ');
  assert.equal(pair.sanitizeCustom(' - '), ' -', 'the third character is cut');
  assert.equal(pair.sanitizeCustom('→a→b→c'), 'ab',
    'filtered first, then counted');
});

test('sanitizeCustom: a non-string is empty', () => {
  for (const v of [undefined, null, 5, true, {}, ['/'], function () { return '/'; }]) {
    assert.equal(pair.sanitizeCustom(v), '', String(v));
  }
});

test('an empty custom separator renders as the slash', () => {
  for (const custom of ['', undefined, null, 42, '→', '😀', '\u0000\u0001']) {
    assert.equal(pair.formatTempPair('12', '10',
      { tempSlotSeparator: 'custom', tempSlotSeparatorCustom: custom }, MID), '12/10',
      JSON.stringify(custom));
    assert.equal(pair.formatUv(uvTomorrow(5, 6),
      { uvSlotSeparator: 'custom', uvSlotSeparatorCustom: custom }, MID), '5/' + RAQUO + '6',
      JSON.stringify(custom));
  }
  // What survives sanitizing is used as-is.
  assert.equal(pair.formatTempPair('12', '10',
    { tempSlotSeparator: 'custom', tempSlotSeparatorCustom: '→:→' }, MID), '12:10');
});

test('an unknown separator value is the slash', () => {
  for (const bogus of ['wavy', '', 'constructor', '__proto__', 'hasOwnProperty', 3, {}]) {
    assert.equal(pair.joinPair('12', '10', bogus, 'x', MID), '12/10', String(bogus));
  }
});

// --- presentation never moves a highlight ------------------------------------------

test('the UV threshold level is blind to the presentation settings', () => {
  const levels = { threshUvWarn: '6', threshUvDanger: '8' };
  const payloads = [
    { UV_TREND_UINT8: [20, 45, 70, 80], UV_DAY_PEAKS: [80, 100] },   // 2/8
    { UV_TREND_UINT8: [0], UV_DAY_PEAKS: [0, 90] },                  // 0/»9
    { UV_TREND_UINT8: [70], UV_DAY_PEAKS: [70, 50] },                // 7/»5
    { UV_TREND_UINT8: [20], UV_DAY_PEAKS: [90, 60] }                 // 2/9
  ];
  const styled = { uvSlotSeparator: 'brackets', uvSlotOrder: 'max',
    uvSlotNextDayMark: 'none', uvSlotSeparatorCustom: '!!' };
  for (const mode of ['current', 'max', 'both']) {
    for (const p of payloads) {
      const plain = Object.assign({ uvSlotDisplay: mode }, levels);
      assert.deepEqual(thresholds.packWeatherLevels(p, Object.assign({}, plain, styled)),
        thresholds.packWeatherLevels(p, plain), mode + ' ' + JSON.stringify(p));
    }
  }
});
