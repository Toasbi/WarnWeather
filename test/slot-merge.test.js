'use strict';
// A weather alert merged into the status slot on its side (the owner, 2026-10-01):
// where a bar's left or right slot shows the metric of an alert ticked on that side
// of the bar (UV index, Wind speed, Wind gusts, Air quality, Pollen), the phone bakes
// the slot's text as both values once (status-pair.js mergeAlert, status-lines.js
// mergedAlert) and the watch draws the slot at the alert's level, its item only where
// the slot hides (src/c/appendix/alert_set.c alert_set_merge, test/c/alert_set_test.c
// and test/c/on_demand_merge_test.c). The middle slot and the far side never merge,
// Wind speed never takes a gust alert, and a watch the entries do not ride to (aplite)
// bakes exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');

// The bake asks phone-battery.js for the phone's charge, out of localStorage: install
// the mock before the modules load (AGENTS.md).
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};

const pair = require('../src/pkjs/status-pair.js');
const statusLines = require('../src/pkjs/status-lines.js');
const catalog = require('../src/pkjs/status-line-catalog.js');
const wire = require('../src/pkjs/status-wire.js');
const { renderSignature } = require('../src/pkjs/render-signature.js');
const { NOTHING_PLACED, placeOn } = require('./helpers/on-demand.js');

// --- the text: status-pair.js mergeAlert -------------------------------------------

const today = (text) => ({ text, nextDay: false });
const tomorrow = (text, mark) => ({ text, nextDay: true, mark });
const NOW = (n) => ({ now: n, peak: null, nextDay: false });
const MAX = (p, nextDay) => ({ now: null, peak: p, nextDay: Boolean(nextDay) });
const BOTH = (n, p, nextDay) => ({ now: n, peak: p, nextDay: Boolean(nextDay) });

test('the owner\'s table: the slot shows the union of both values, each once', () => {
  const rows = [
    ['Now "3" + alert 8', NOW(3), today('8'), '3/8'],
    ['Now "3" + icon-only alert', NOW(3), today(''), null],
    ['Day max 8 + alert 8', MAX(8), today('8'), null],
    ['Both "3/8" + alert 8', BOTH(3, 8), today('8'), null],
    ['Day max 4 + tomorrow\'s alert »9', MAX(4), tomorrow('9'), '4/»9'],
    ['Both "5/»9" + alert »9', BOTH(5, 9, true), tomorrow('9'), null],
    // Three values would not fit the pair: the slot's current reading and the alert's.
    ['Both "3/4" + tomorrow\'s alert »9', BOTH(3, 4), tomorrow('9'), '3/»9'],
    // Today's value first: a Day max slot already on tomorrow's peak beside today's alert.
    ['Day max »9 + alert 5', MAX(9, true), today('5'), '5/»9'],
    ['Now "3" + tomorrow\'s alert »9', NOW(3), tomorrow('9'), '3/»9'],
    // The same number on another day is another value.
    ['Now "8" + tomorrow\'s alert »8', NOW(8), tomorrow('8'), '8/»8'],
  ];
  rows.forEach(([what, shown, alert, want]) => {
    assert.equal(pair.mergeAlert('uv', shown, alert, {}, 8), want, what);
  });
});

test('the merged pair takes the slot\'s own Order, separator, spacing and mark', () => {
  assert.equal(pair.mergeAlert('uv', NOW(3), today('8'), { uvSlotOrder: 'max' }, 8), '8/3');
  assert.equal(pair.mergeAlert('uv', MAX(4), tomorrow('9'), { uvSlotOrder: 'max' }, 8), '»9/4');
  assert.equal(pair.mergeAlert('uv', NOW(3), today('8'), { uvSlotSeparator: 'dot' }, 8), '3·8');
  assert.equal(pair.mergeAlert('uv', NOW(3), today('8'), { uvSlotSeparatorSpaced: true }, 8),
    '3 / 8');
  assert.equal(pair.mergeAlert('gust', NOW(30), today('62'),
    { gustSlotSeparator: 'brackets' }, 8), '30(62)');
  // The mark is the caller's (packLine: the slot's own where it has one).
  assert.equal(pair.mergeAlert('uv', MAX(4), tomorrow('9', 'star'), {}, 8), '4/9*');
  assert.equal(pair.mergeAlert('uv', MAX(4), tomorrow('9', 'none'), {}, 8), '4/9');
});

test('with no reading of its own, or no room for the pair, the slot shows the alert\'s value', () => {
  assert.equal(pair.mergeAlert('uv', null, today('8'), {}, 8), '8');
  assert.equal(pair.mergeAlert('uv', null, tomorrow('9'), {}, 8), '»9');
  assert.equal(pair.mergeAlert('uv', null, today(''), {}, 8), null, 'icon-only: nothing to add');
  // '152/»178' is 9 bytes of an edge slot's 8.
  assert.equal(pair.mergeAlert('gust', NOW(152), tomorrow('178'), {}, 8), '»178');
  assert.equal(pair.mergeAlert('gust', NOW(152), tomorrow('178'), {}, 19), '152/»178', 'the middle cap');
  // Pollen's bands pair with the slash, today's first: '1-2/»2-3' is 9 bytes.
  assert.equal(pair.mergeAlert('pollen', NOW('1'), tomorrow('3', 'raquo'), {}, 8), '1/»3');
  assert.equal(pair.mergeAlert('pollen', NOW('1-2'), tomorrow('2-3', 'raquo'), {}, 8), '»2-3');
  assert.equal(pair.mergeAlert('pollen', NOW('2-3'), today('2-3'), {}, 8), null);
});

// --- the bake: status-lines.js -------------------------------------------------------

const BASALT = { platform: 'basalt' };
const APLITE = { platform: 'aplite' };

// Decode one packed line into its three slots' texts (the wind arrow's trailing
// control byte kept as a code point).
function texts(bytes) {
  const out = [];
  let off = 0;
  for (let i = 0; i < 3; i++) {
    const len = bytes[off + 2];
    out.push(Buffer.from(bytes.slice(off + 3, off + 3 + len)).toString('latin1'));
    off += 3 + len;
  }
  return out;
}

// The Watch Status Bar's slots after a bake.
function topTexts(payload, settings, watch) {
  const p = Object.assign({}, payload);
  statusLines.buildStatusLines(p, settings, watch || BASALT);
  const line = catalog.LINES.filter((l) => l.id === 'top')[0];
  return { slots: texts(p[line.wireKey]).map(utf8), entries: p.ALERT_ENTRIES_UINT8 };
}

function utf8(latin1) { return Buffer.from(latin1, 'latin1').toString('utf8'); }

// UV now 3, today's peak 8 (warn at the seed 6), tomorrow's 6.
const UV = { UV_TREND_UINT8: [30], UV_DAY_PEAKS: [80, 60, 0] };

function topSettings(left, mid, right, extra) {
  return Object.assign({ statusTopLeft: left, statusTopMid: mid, statusTopRight: right,
    temperatureUnits: 'c', windUnits: 'kph' }, extra || {});
}

test('the bake merges the alert into the slot on its side: left and right', () => {
  const right = placeOn(Object.assign({}, NOTHING_PLACED), 'top', 'right', 'uv');
  assert.deepEqual(topTexts(UV, topSettings('empty', 'empty', 'uv',
    Object.assign({ alertUvDisplay: 'value' }, right))).slots, ['', '', '3/8']);
  const left = placeOn(Object.assign({}, NOTHING_PLACED), 'top', 'left', 'uv');
  assert.deepEqual(topTexts(UV, topSettings('uv', 'empty', 'empty',
    Object.assign({ alertUvDisplay: 'value' }, left))).slots, ['3/8', '', '']);
  // The Icon look adds no value: the slot keeps its own text (the watch still draws it
  // at the alert's level).
  assert.deepEqual(topTexts(UV, topSettings('empty', 'empty', 'uv', right)).slots,
    ['', '', '3']);
  // Day max already shows the 8.
  assert.deepEqual(topTexts(UV, topSettings('empty', 'empty', 'uv',
    Object.assign({ alertUvDisplay: 'value', uvSlotDisplay: 'max' }, right))).slots,
    ['', '', '8']);
  // The entries ride unchanged: the watch decides the merge from them.
  const plain = topTexts(UV, topSettings('empty', 'empty', 'empty',
    Object.assign({ alertUvDisplay: 'value' }, right)));
  const merged = topTexts(UV, topSettings('empty', 'empty', 'uv',
    Object.assign({ alertUvDisplay: 'value' }, right)));
  assert.deepEqual(merged.entries, plain.entries);
  assert.equal(merged.entries.length, 2, 'the UV entry with its value');
});

test('tomorrow\'s alert merges with the slot\'s own mark', () => {
  // Nothing left today reaches warn; tomorrow's 9 does.
  const p = { UV_TREND_UINT8: [30], UV_DAY_PEAKS: [40, 90, 0] };
  const S = placeOn(Object.assign({}, NOTHING_PLACED), 'top', 'right', 'uv');
  Object.assign(S, { alertUvDisplay: 'value', uvSlotDisplay: 'max' });
  assert.deepEqual(topTexts(p, topSettings('empty', 'empty', 'uv', S)).slots, ['', '', '4/»9']);
  S.uvSlotNextDayMark = 'star';
  S.alertUvNextDayMark = 'gt';
  assert.deepEqual(topTexts(p, topSettings('empty', 'empty', 'uv', S)).slots, ['', '', '4/9*']);
  S.uvSlotDisplay = 'both';
  assert.deepEqual(topTexts(p, topSettings('empty', 'empty', 'uv', S)).slots, ['', '', '3/9*'],
    'Both "3/4" + tomorrow\'s 9: the current reading and the alert\'s');
});

test('the middle slot, the far side and Wind speed beside a gust alert never merge', () => {
  const right = placeOn(Object.assign({ alertUvDisplay: 'value', alertGustDisplay: 'value' },
    NOTHING_PLACED), 'top', 'right', 'uv,gust');
  // The middle shows UV, the alert sits right: the middle keeps its own text.
  assert.deepEqual(topTexts(UV, topSettings('empty', 'uv', 'empty', right)).slots, ['', '3', '']);
  // The left slot shows UV, the alert sits right: no merge.
  assert.deepEqual(topTexts(UV, topSettings('uv', 'empty', 'empty', right)).slots, ['3', '', '']);
  // Wind speed is not the gusts' metric.
  const wind = Object.assign({}, UV, { WIND_TREND_UINT8: [20], WIND_DAY_PEAKS: [30, 20, 0],
    GUST_TREND_UINT8: [40], GUST_DAY_PEAKS: [90, 50, 0] });
  const out = topTexts(wind, topSettings('empty', 'empty', 'wind', right));
  assert.deepEqual(out.slots, ['', '', '20kph']);
  assert.ok(out.entries.length > 0, 'guard: the gust alert is active');
  // ... while the gust slot beside it merges.
  assert.deepEqual(topTexts(wind, topSettings('empty', 'empty', 'gust', right)).slots,
    ['', '', '40/90kph']);
});

test('a watch the entries do not ride to bakes its slots exactly as before', () => {
  const right = placeOn(Object.assign({ alertUvDisplay: 'value' }, NOTHING_PLACED),
    'top', 'right', 'uv');
  const out = topTexts(UV, topSettings('empty', 'empty', 'uv', right), APLITE);
  assert.deepEqual(out.slots, ['', '', '3']);
  assert.equal(out.entries, undefined);
});

// Random sweep: on a watch the entries ride to, every slot that is not an edge slot
// showing the metric of an alert on its side bakes byte for byte what it bakes with no
// alert at all; on aplite every slot does.
test('slots without such a pair bake byte for byte as with no alert at all', () => {
  const OD = require('../src/pkjs/on-demand.js');
  const platform = require('../src/pkjs/config-ui/lib/platform.js');
  const codes = ['empty', 'temp', 'uv', 'wind', 'gust', 'aqi', 'pollen', 'city', 'dew', 'pressure'];
  const alerts = ['gust', 'uv', 'aqi', 'pollen', 'wind'];
  let seed = 7;
  const rnd = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
  let merged = 0;
  for (let trial = 0; trial < 1500; trial++) {
    const S = Object.assign({ temperatureUnits: 'c', windUnits: rnd(2) ? 'kph' : 'mph',
      radarMode: 'status', healthMode: 'all' }, NOTHING_PLACED);
    catalog.LINES.forEach((line) => {
      line.slots.forEach((key) => { S[key] = codes[rnd(codes.length)]; });
    });
    alerts.forEach((code) => {
      const key = code === 'uv' ? 'Uv' : code.charAt(0).toUpperCase() + code.slice(1);
      if (rnd(2)) { S['alert' + key + 'Display'] = 'value'; }
      if (rnd(2)) { S[code + 'SlotDisplay'] = ['current', 'max', 'both'][rnd(3)]; }
      if (rnd(3)) {
        // Half the time onto a side whose edge slot shows the alert's metric.
        const line = catalog.LINES[rnd(catalog.LINES.length)];
        let side = OD.SIDES[rnd(2)];
        if (rnd(2) && S[line.slots[0]] === code) { side = 'left'; }
        if (rnd(2) && S[line.slots[2]] === code) { side = 'right'; }
        const k = OD.itemsKey(line.id, side);
        S[k] = OD.canonical((S[k] ? S[k].split(',') : []).concat([code]));
      }
    });
    const payload = {
      CURRENT_TEMP: 60, CITY: 'Berlin',
      UV_TREND_UINT8: [rnd(110)], UV_DAY_PEAKS: [rnd(110), rnd(110), rnd(2) ? 0 : rnd(110)],
      WIND_TREND_UINT8: [rnd(80)], WIND_DAY_PEAKS: [rnd(90), rnd(90), 0],
      GUST_TREND_UINT8: [rnd(120)], GUST_DAY_PEAKS: [rnd(140), rnd(140), 0],
      AQI_TREND: [rnd(150)], AQI_DAY_PEAKS: [rnd(160), rnd(160), 0],
      POLLEN_TODAY: ['0', '1', '1-2', '2-3', '3'][rnd(5)], POLLEN_TOMORROW: ['1', '2', '3'][rnd(3)]
    };
    [BASALT, APLITE].forEach((watch) => {
      const env = platform.computeEnv(watch);
      env.phoneBattery = false;
      const baked = env.thresholds ? wire.bakedAlerts(payload, S) : null;
      catalog.LINES.forEach((line) => {
        const withAlerts = texts(statusLines.packLine(line, payload, S, env, baked));
        const without = texts(statusLines.packLine(line, payload, S, env, null));
        for (let s = 0; s < 3; s++) {
          const code = S[line.slots[s]];
          const paired = Boolean(baked) && s !== 1 && baked.some((a) => a.code === code)
            && OD.sideOf(S, line.id, code, env) === (s ? 'right' : 'left');
          if (!paired) {
            assert.equal(withAlerts[s], without[s], JSON.stringify({ trial, line: line.id, s }));
          } else if (withAlerts[s] !== without[s]) {
            merged++;
          }
        }
      });
    });
  }
  assert.ok(merged > 100, 'the sweep merges slots too: ' + merged);
});

// --- the render signature ------------------------------------------------------------

test('moving an alert onto or off the side whose slot shows its metric forces a re-bake', () => {
  const base = Object.assign({ statusTopRight: 'uv' }, NOTHING_PLACED);
  const off = renderSignature(placeOn(Object.assign({}, base), 'top', 'left', 'uv'));
  const on = renderSignature(placeOn(Object.assign({}, base), 'top', 'right', 'uv'));
  assert.notEqual(on, off, 'onto the right side, where the right slot shows UV');
  // Elsewhere it moves without a re-bake, as before.
  assert.equal(renderSignature(placeOn(Object.assign({}, base), 'forecast', 'left', 'uv')), off,
    'another bar whose slots do not show UV');
  // The middle slot never merges.
  const mid = Object.assign({ statusTopMid: 'uv' }, NOTHING_PLACED);
  assert.equal(renderSignature(placeOn(Object.assign({}, mid), 'top', 'right', 'uv')),
    renderSignature(placeOn(Object.assign({}, mid), 'top', 'left', 'uv')));
});
