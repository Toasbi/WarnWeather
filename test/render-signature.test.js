'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const thresholds = require('../src/pkjs/status-thresholds.js');

const renderSignature = require('../src/pkjs/render-signature.js').renderSignature;
// The same predicate status-wire packWeatherLevels packs by: phone-leveled weather kinds
// (aqi, pollen, wind, gust, uv). slice(0, 4) here once mirrored the shipped
// bug of dropping UV (kind 7, after the health kinds) from the signature.
const WEATHER_KINDS = thresholds.KINDS.filter(k => !k.goal && !k.boldOnly);
const HEALTH_KINDS = thresholds.KINDS.filter(k => k.goal);  // steps, sleep, distance

test('renderSignature is empty for falsy settings and stable for equal settings', () => {
  assert.equal(renderSignature(null), '');
  assert.equal(renderSignature({ windUnits: 'mph' }), renderSignature({ windUnits: 'mph' }));
  // Sanity that the module export is really the change detector: a known member changes it.
  assert.notEqual(renderSignature({ windUnits: 'mph' }), renderSignature({ windUnits: 'kph' }));
});

// The feels-like formula swaps the provider's value for Steadman in FEELS_TREND /
// FEELS_CURRENT at bake time, so a flip must force a refetch (the force-fetch rule).
test('feelsFormula joins the signature', () => {
  assert.notEqual(renderSignature({ feelsFormula: 'provider' }),
    renderSignature({ feelsFormula: 'steadman' }));
});

// tempSlotDisplay changes the phone-side temp-slot bake (formatValue), so per the
// force-fetch rule it must be part of the signature or switching Temp/Feels like/Both
// would not show until the next scheduled fetch.
test('tempSlotDisplay changes the render signature (forces a rebake)', () => {
  const base = renderSignature({});
  assert.notEqual(renderSignature({ tempSlotDisplay: 'feels' }), base);
  assert.notEqual(renderSignature({ tempSlotDisplay: 'both' }),
    renderSignature({ tempSlotDisplay: 'feels' }));
});

// uvSlotDisplay is the UV slot's twin of the rule above: the phone bakes the
// current / day-max / both text, so switching it must force a rebake too.
test('uvSlotDisplay changes the render signature (forces a rebake)', () => {
  const base = renderSignature({});
  assert.notEqual(renderSignature({ uvSlotDisplay: 'max' }), base);
  assert.notEqual(renderSignature({ uvSlotDisplay: 'both' }),
    renderSignature({ uvSlotDisplay: 'max' }));
});

// The two-value slots' presentation (status-pair.js) is baked into the temp/UV slot
// text the same way, so each of its nine keys must force the rebake as well.
test('the temp pair separator, its custom text, the spacing and the order change the render signature', () => {
  const base = renderSignature({});
  assert.notEqual(renderSignature({ tempSlotSeparator: 'brackets' }), base);
  assert.notEqual(renderSignature({ tempSlotSeparator: 'brackets' }),
    renderSignature({ tempSlotSeparator: 'dot' }));
  // The spacing toggle alone: '12|10' and '12 | 10' are different slot text.
  assert.notEqual(renderSignature({ tempSlotSeparatorSpaced: true }), base);
  assert.notEqual(renderSignature({ tempSlotSeparatorSpaced: true }),
    renderSignature({ tempSlotSeparatorSpaced: false }));
  // The custom text alone: editing it re-bakes while the separator stays 'custom'.
  assert.notEqual(renderSignature({ tempSlotSeparator: 'custom', tempSlotSeparatorCustom: '-' }),
    renderSignature({ tempSlotSeparator: 'custom', tempSlotSeparatorCustom: '~' }));
  assert.notEqual(renderSignature({ tempSlotOrder: 'feels' }), base);
  assert.notEqual(renderSignature({ tempSlotOrder: 'feels' }),
    renderSignature({ tempSlotOrder: 'actual' }));
});

test('the UV pair separator, its custom text, the spacing, the order and the next-day mark change the render signature', () => {
  const base = renderSignature({});
  assert.notEqual(renderSignature({ uvSlotSeparator: 'dot' }), base);
  assert.notEqual(renderSignature({ uvSlotSeparatorSpaced: true }), base);
  assert.notEqual(renderSignature({ uvSlotSeparatorSpaced: true }),
    renderSignature({ uvSlotSeparatorSpaced: false }));
  assert.notEqual(renderSignature({ uvSlotSeparator: 'bar' }),
    renderSignature({ uvSlotSeparator: 'dot' }));
  assert.notEqual(renderSignature({ uvSlotSeparator: 'custom', uvSlotSeparatorCustom: '-' }),
    renderSignature({ uvSlotSeparator: 'custom', uvSlotSeparatorCustom: '~' }));
  assert.notEqual(renderSignature({ uvSlotOrder: 'max' }), base);
  assert.notEqual(renderSignature({ uvSlotOrder: 'max' }), renderSignature({ uvSlotOrder: 'now' }));
  assert.notEqual(renderSignature({ uvSlotNextDayMark: 'star' }), base);
  assert.notEqual(renderSignature({ uvSlotNextDayMark: 'star' }),
    renderSignature({ uvSlotNextDayMark: 'gt' }));
});

test('the nine pair keys are independent of each other', () => {
  // Each must occupy its own position: the temp slot's separator may not read as the
  // UV slot's (they bake different slots), nor a separator as its own custom text.
  const keys = ['tempSlotSeparator', 'tempSlotSeparatorCustom', 'tempSlotSeparatorSpaced',
    'tempSlotOrder', 'uvSlotSeparator', 'uvSlotSeparatorCustom', 'uvSlotSeparatorSpaced',
    'uvSlotOrder', 'uvSlotNextDayMark'];
  const seen = keys.map((key) => renderSignature({ [key]: 'x' }));
  seen.forEach((sig, i) => seen.slice(i + 1).forEach((other, j) =>
    assert.notEqual(sig, other, keys[i] + ' and ' + keys[i + 1 + j] + ' share a signature slot')));
});

// The wind/gust direction arrows are baked phone-side into the slot text (a trailing
// sentinel byte appended in status-lines.js), so per the force-fetch rule both toggles
// must be part of the signature — otherwise the arrow appears only after the next
// scheduled fetch.
test('the wind-direction toggles change the render signature', () => {
  assert.notEqual(renderSignature({ windSlotDirection: false }),
    renderSignature({ windSlotDirection: true }));
  assert.notEqual(renderSignature({ gustSlotDirection: false }),
    renderSignature({ gustSlotDirection: true }));
  // The two are independent: flipping one must not read as flipping the other.
  assert.notEqual(renderSignature({ windSlotDirection: true }),
    renderSignature({ gustSlotDirection: true }));
});

// The six per-kind "Show unit" toggles decide whether the phone bakes the unit into the
// slot text at all, so the same force-fetch rule applies: without them in the signature
// a flip sits invisible until the next scheduled fetch. All six, not just the ones that
// ship off — a user turning kph OFF has exactly the same right to see it now.
const UNIT_KEYS = ['windSlotUnit', 'gustSlotUnit', 'pressureSlotUnit',
  'countdownSlotUnit', 'tempSlotUnit', 'dewSlotUnit'];

test('every Show unit toggle changes the render signature (forces a rebake)', () => {
  UNIT_KEYS.forEach((key) => {
    assert.notEqual(renderSignature({ [key]: false }), renderSignature({ [key]: true }),
      key + ' must be part of the render signature');
  });
});

test('the Show unit toggles are independent of each other', () => {
  // Each key must occupy its own position: flipping one may not read as flipping any
  // other (a single shared slot would make wind's unit hide the countdown's).
  const seen = UNIT_KEYS.map((key) => renderSignature({ [key]: true }));
  seen.forEach((sig, i) => seen.slice(i + 1).forEach((other, j) =>
    assert.notEqual(sig, other,
      UNIT_KEYS[i] + ' and ' + UNIT_KEYS[i + 1 + j] + ' share a signature slot')));
});

// The countdown slot's day count is baked phone-side from '<slot>Countdown' (the Clay
// message never carries the date), so a date-only edit must force the rebake or the
// watch keeps the old count until the next scheduled fetch. Signed only while the slot
// shows the countdown: the page hydrates every slot's date to today, so signing the
// unused ones would buy a needless fetch on the first save that writes them.
const SLOT_KEYS = require('../src/pkjs/status-line-catalog.js').allSlotKeys();

test('a countdown slot\'s target date changes the render signature', () => {
  assert.equal(SLOT_KEYS.length, 12);
  SLOT_KEYS.forEach((key) => {
    assert.notEqual(
      renderSignature({ [key]: 'countdown', [key + 'Countdown']: '2026-12-25' }),
      renderSignature({ [key]: 'countdown', [key + 'Countdown']: '2027-06-01' }),
      key + 'Countdown must be signed while ' + key + ' shows the countdown');
  });
});

test('the target date of a slot NOT showing the countdown stays out of the signature', () => {
  SLOT_KEYS.forEach((key) => {
    assert.equal(
      renderSignature({ [key]: 'temp', [key + 'Countdown']: '2026-12-25' }),
      renderSignature({ [key]: 'temp' }),
      key + 'Countdown is inert while ' + key + ' shows something else');
  });
});

test('each countdown date keeps its own signature slot', () => {
  // A fixed position per slot: one slot's date may never read as another's, nor as a
  // slot selection.
  const seen = SLOT_KEYS.map((key) =>
    renderSignature({ [key]: 'countdown', [key + 'Countdown']: '2026-12-25' }));
  seen.forEach((sig, i) => seen.slice(i + 1).forEach((other, j) =>
    assert.notEqual(sig, other, SLOT_KEYS[i] + ' and ' + SLOT_KEYS[i + 1 + j] + ' collide')));
  const a = SLOT_KEYS[0];
  const b = SLOT_KEYS[1];
  assert.notEqual(
    renderSignature({ [a]: 'countdown', [a + 'Countdown']: 'x', [b]: 'temp' }),
    renderSignature({ [a]: 'countdown', [b]: 'x' }),
    'a date may not shift into the next slot selection');
});

// The night pause decides whether fetching happens at all (and which IS_SLEEPING glyph
// the forced fetch pushes), so every key that moves the window has to force the refetch.
// That is exactly the three keys sleep-window.js reads, no more: the Nighttime card's
// other two features pause nothing, and signing a resolved window instead of the raw
// keys would make an edit that happens to land on the same hours invisible.
const SLEEP_KEYS = ['sleepNightEnabled', 'sleepStartHour', 'sleepEndHour'];

test('every sleep-window key changes the render signature (forces a refetch)', () => {
  const base = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' };
  const changed = { sleepNightEnabled: false, sleepStartHour: '1', sleepEndHour: '8' };
  SLEEP_KEYS.forEach((key) => {
    assert.notEqual(renderSignature({ ...base, [key]: changed[key] }), renderSignature(base),
      key + ' must be part of the render signature');
  });
});

test('fourthLine is part of the render signature (it changes what the phone bakes and fetches)', () => {
  assert.notEqual(renderSignature({ fourthLine: 'uv' }), renderSignature({ fourthLine: 'off' }),
    'a Third-metric change must force a refetch');
});

test('the sleep-window keys each occupy their own signature slot', () => {
  // Without distinct positions, editing the start hour could read as editing the end.
  const seen = SLEEP_KEYS.map((key) => renderSignature({ [key]: 'X' }));
  seen.forEach((sig, i) => seen.slice(i + 1).forEach((other, j) =>
    assert.notEqual(sig, other,
      SLEEP_KEYS[i] + ' and ' + SLEEP_KEYS[i + 1 + j] + ' share a signature slot')));
});

// The signature's job is to force a REFETCH, so a setting that reaches the watch by
// another route must stay out of it or every edit buys a needless provider call.
// The retired shared-window keys are in this list too: a reader that quietly started
// signing one again would resurrect a key the schema no longer has.
test('settings that need no refetch stay OUT of the render signature', () => {
  const base = renderSignature({ sleepNightEnabled: true, sleepStartHour: '0',
    sleepEndHour: '7' });
  [// retired with the shared Night hours window
    { sleepNightMode: 'custom' }, { sleepNightStartHour: '22' },
    { sleepNightEndHour: '6' }, { backlightDimMode: 'custom' },
    // live, but Clay-delivered (the LED tuple) or phone-local (the theme flip)
    { backlightDim: false }, { backlightDimStartHour: '22' },
    { backlightDimEndHour: '6' }, { backlightDimColor: '1,2,3' },
    { themeAuto: true }, { themeAutoMode: 'manual' }, { themeNight: 'light' },
    { themeAutoStartHour: '20' }, { themeAutoEndHour: '7' },
    // the theme and the area fill: every colour they move (line colours, the fill
    // flag, threshold auto-colours) rides the Clay message
    { theme: 'light' }, { theme: 'bw' }, { secondaryLineFill: true },
    { secondaryLineFill: false },
    // live, but Clay-delivered: the per-line marker styles ride
    // CLAY_LINE_STYLE_UINT8 bytes [11..13], never the weather bake
    { secondaryLineStyle: 'bold' }, { thirdLineStyle: 'x' }, { fourthLineStyle: 'dots' }
  ].forEach((over) => {
    assert.equal(renderSignature({ sleepNightEnabled: true, sleepStartHour: '0',
      sleepEndHour: '7', ...over }), base,
    JSON.stringify(over) + ' must not force a refetch');
  });
});

// The premise behind keeping the theme and the area fill out: the weather bake reads
// neither. Should a bake ever start reading one again, this goes red and the key has
// to rejoin the signature (the force-fetch rule above).
test('the weather bake is identical across themes and the area-fill toggle', () => {
  const fs = require('fs');
  const path = require('path');
  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const origLog = console.log;
  console.log = () => {};
  try {
    const fixtureWeather = require('../src/pkjs/fixture-weather.js');
    const defaults = require('../src/pkjs/settings').getDefaults();
    let compared = 0;
    ['berlin.json', 'windy.json', 'graph-colors.json'].forEach((name) => {
      const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8'));
      ['basalt', 'aplite', 'emery'].forEach((platform) => {
        ['precip_prob', 'wind', 'uv'].forEach((secondaryLine) => {
          let ref = null;
          ['dark', 'light', 'bw', 'bw-light'].forEach((theme) => {
            [true, false].forEach((secondaryLineFill) => {
              const s = Object.assign({}, defaults, fx.claySettings || {}, {
                secondaryLine, theme, secondaryLineFill,
                // Weather thresholds on, with auto colours: the one bake-time reader of
                // settings.theme (status-thresholds' resolveAutoColor) is exercised.
                threshWindWarn: '5', threshWindDanger: '10', threshUvWarn: '1', threshUvDanger: '2'
              });
              const out = fixtureWeather.getFixtureWeatherPayload(
                JSON.parse(JSON.stringify(fx)), s, { platform });
              const ser = JSON.stringify(out, Object.keys(out).sort());
              compared++;
              if (ref === null) { ref = ser; }
              assert.equal(ser, ref, [name, platform, secondaryLine, theme, secondaryLineFill].join(' '));
            });
          });
        });
      });
    });
    assert.ok(compared >= 200, 'the sweep ran');
  } finally {
    console.log = origLog;
  }
});

// The weather kinds are evaluated phone-side at weather-bake time, so enabling one
// only reaches the watch through a refetch. Without these keys in the signature,
// shouldForceFetch stays false for a threshold-only edit and the user sees nothing until
// the next scheduled fetch (fetchIntervalMin, 15 min default — or after the night pause).
// The pair is signed as the phone RESOLVES it (status-thresholds resolvedPair: the
// stored pair when it is ordered, else the kind's seed), because that is what the bake
// reads — so only a change in the numbers the bake sees forces a refetch.
test('setting a WEATHER-kind pair changes the render signature (forces a refetch)', () => {
  WEATHER_KINDS.forEach(kind => {
    const warnKey = 'thresh' + kind.key + 'Warn';
    const dangerKey = 'thresh' + kind.key + 'Danger';
    // 101/151 is no kind's seed (AQI's US seed is 100/150 — a stored pair equal to the
    // seed rightly reads the same as a blank one, since the bake sees the same numbers).
    const before = renderSignature({});
    const stored = renderSignature({ [warnKey]: '101', [dangerKey]: '151' });
    assert.notEqual(stored, before, kind.key + ': a stored ordered pair must join the signature');
    // And an edit of an already-set value counts too (raising warn re-bakes the levels).
    assert.notEqual(stored, renderSignature({ [warnKey]: '121', [dangerKey]: '151' }),
      warnKey + ' must react to a changed value, not merely to being present');
    assert.notEqual(stored, renderSignature({ [warnKey]: '101', [dangerKey]: '181' }),
      dangerKey + ' must react to a changed value, not merely to being present');
    // A half pair resolves to the seed, exactly as the bake reads it — no refetch.
    assert.equal(renderSignature({ [warnKey]: '101' }), before,
      kind.key + ': a half pair reads as the seed, like an absent pair');
  });
});

// A pair stored equal to the seed (dragged onto it, or pinned by a page before 1.24.0)
// bakes the same numbers as a blank one — so the 1.24.0 migration that blanks such a
// pair (migrations/seed-pairs.js) must not force a refetch either.
test('storing the seed pair over a blank one leaves the signature unchanged', () => {
  WEATHER_KINDS.forEach(kind => {
    const seed = thresholds.seedPair(kind.key, {});
    const pinned = {
      ['thresh' + kind.key + 'Warn']: String(seed.warn),
      ['thresh' + kind.key + 'Danger']: String(seed.danger),
      ['thresh' + kind.key + 'On']: true
    };
    assert.equal(renderSignature(pinned), renderSignature({}),
      kind.key + ': the seed pinned as strings reads the same as a blank pair');
  });
});

// The highlight toggle is split from the levels: every weather kind's level is packed
// whatever thresh<Kind>On says, and the toggle only flips the blob[0] enable bit on the
// Clay message (immediate on close). So flipping it must NOT drop the weather caches —
// while editing the pair it guards still must (the levels and the day-max hold read it).
test('flipping a weather-kind highlight toggle does NOT change the signature; Warn/Danger still do', () => {
  const pair = (kind) => ({ ['thresh' + kind.key + 'Warn']: '5',
    ['thresh' + kind.key + 'Danger']: '10' });
  thresholds.KINDS.filter(k => !k.boldOnly).forEach(kind => {
    const key = 'thresh' + kind.key + 'On';
    const base = pair(kind);
    const off = renderSignature(Object.assign({ [key]: false }, base));
    assert.equal(renderSignature(Object.assign({ [key]: true }, base)), off,
      key + ' rides the Clay blob only — it must not force a weather refetch');
    assert.equal(renderSignature(base), off, key + ' absent reads the same as false');
  });
  WEATHER_KINDS.forEach(kind => {
    const on = { ['thresh' + kind.key + 'On']: true };
    assert.notEqual(renderSignature(Object.assign({}, on, pair(kind))),
      renderSignature(Object.assign({}, on, pair(kind), { ['thresh' + kind.key + 'Warn']: '6' })),
      kind.key + ': a warn edit still re-bakes');
    assert.notEqual(renderSignature(Object.assign({}, on, pair(kind))),
      renderSignature(Object.assign({}, on, pair(kind), { ['thresh' + kind.key + 'Danger']: '11' })),
      kind.key + ': a danger edit still re-bakes');
  });
});

// Health thresholds are evaluated WATCH-side against the Clay-delivered blob, and the
// threshold colors are applied by the watch on its next paint: both are already immediate
// when the config closes, so dropping the weather caches for them would be pure waste.
test('health thresholds and threshold colors do NOT change the render signature', () => {
  const base = renderSignature({});
  HEALTH_KINDS.forEach(kind => {
    ['Warn', 'Danger'].forEach(which => {
      const key = 'thresh' + kind.key + which;
      assert.equal(renderSignature({ [key]: '5000' }), base,
        key + ' is watch-side evaluated — it must not force a weather refetch');
    });
  });
  thresholds.KINDS.forEach(kind => {
    ['WarnColor', 'DangerColor'].forEach(which => {
      const key = 'thresh' + kind.key + which;
      assert.equal(renderSignature({ [key]: 0x00FF00 }), base,
        key + ' rides the Clay message — it must not force a weather refetch');
    });
  });
});

// A TOP stripe changes the weather bake, not only the Clay style bytes: under one the
// joint temperature band of a drawn feels/dew curve loses its top pad
// (forecast-series.js topStripeDrawn -> padJointTempAxisBand), which re-bakes
// TEMP_TREND_UINT8 and the curve's bytes. So it joins the signature — as ONE derived
// flag, not the raw ...LineStyle keys, so a style edit that bakes nothing forces no fetch.
// (A stripe's own level bytes join on their own, the next test; each case here starts
// from a bottom stripe, which has them already, so only the top pad is in play.)
test('a top stripe joins the signature only while it squeezes a feels/dew curve', () => {
  const withStyle = (base, over) => renderSignature(Object.assign({}, base, over));
  const feels = { secondaryLine: 'feels', thirdLine: 'uv', thirdLineStyle: 'stripeBottom', barSource: 'off' };
  assert.notEqual(withStyle(feels, {}), withStyle(feels, { thirdLineStyle: 'stripeTop' }),
    'uv bottom -> top stripe re-bakes the temperature band');
  const dew = { secondaryLine: 'precip_prob', fourthLine: 'dew', fifthLine: 'cloud',
    fifthLineStyle: 'stripeBottom' };
  assert.notEqual(withStyle(dew, {}), withStyle(dew, { fifthLineStyle: 'stripeTop' }),
    'a cloud top stripe over a dew curve on another line');
  // A switch between strokes and marks bakes nothing.
  const marks = Object.assign({}, feels, { thirdLineStyle: 'dots' });
  ['line', 'bold', 'x'].forEach((style) => {
    assert.equal(withStyle(marks, {}), withStyle(marks, { thirdLineStyle: style }), style);
  });
  // A stored stripe on a metric that cannot be one draws as a line (line-style.js
  // lineStyleValue), and a line that is off or repeats another draws nothing.
  assert.equal(withStyle(feels, {}), withStyle(feels, { secondaryLineStyle: 'stripeTop' }), 'feels stripe');
  assert.equal(withStyle(feels, { fifthLine: 'pressure' }),
    withStyle(feels, { fifthLine: 'pressure', fifthLineStyle: 'stripeTop' }), 'pressure stripe');
  assert.equal(withStyle(feels, { fifthLine: 'off' }),
    withStyle(feels, { fifthLine: 'off', fifthLineStyle: 'stripeTop' }), 'line off');
  assert.equal(withStyle(feels, { fifthLine: 'uv' }),
    withStyle(feels, { fifthLine: 'uv', fifthLineStyle: 'stripeTop' }), 'repeats the uv line');
  // Without a temperature-axis curve there is no band to pad.
  const rain = { secondaryLine: 'precip_prob', thirdLine: 'uv', thirdLineStyle: 'stripeBottom' };
  assert.equal(withStyle(rain, {}), withStyle(rain, { thirdLineStyle: 'stripeTop' }), 'no feels/dew drawn');
});

// A line drawn as a stripe bakes level bytes on its metric's own scale
// (forecast-series.js stripeBytes, stripe-levels.js) where a curve, dots or marks bake
// its exact values, so moving a line onto or off a stripe re-bakes it. It joins as the
// metrics drawn as stripes, never the raw ...LineStyle keys: the edge a stripe sits on,
// a switch between strokes and marks, or a stored stripe that draws none bakes nothing.
test('a line moved onto or off a stripe joins the signature, by its metric', () => {
  const sig = (over) => renderSignature(Object.assign({ secondaryLine: 'precip_prob',
    secondaryLineStyle: 'line', thirdLine: 'uv', thirdLineStyle: 'dots', barSource: 'off' }, over));
  ['stripeTop', 'stripeBottom'].forEach((st) => {
    assert.notEqual(sig({}), sig({ thirdLineStyle: st }), 'uv dots -> ' + st);
    assert.notEqual(sig({}), sig({ secondaryLineStyle: st }), 'rain chance line -> ' + st);
    assert.notEqual(sig({ fifthLine: 'cloud', fifthLineStyle: 'x' }),
      sig({ fifthLine: 'cloud', fifthLineStyle: st }), 'cloud x marks on the Fourth metric line -> ' + st);
  });
  assert.equal(sig({ thirdLineStyle: 'stripeTop' }), sig({ thirdLineStyle: 'stripeBottom' }),
    'the edge bakes nothing without a feels/dew curve');
  ['line', 'bold', 'x'].forEach((st) => assert.equal(sig({}), sig({ thirdLineStyle: st }), st));
  // A stored stripe on a metric that cannot be one, on a line that is off, or on one
  // repeating another line's metric draws no stripe.
  assert.equal(sig({ fifthLine: 'pressure' }), sig({ fifthLine: 'pressure', fifthLineStyle: 'stripeTop' }),
    'pressure stripe');
  assert.equal(sig({ fifthLine: 'off' }), sig({ fifthLine: 'off', fifthLineStyle: 'stripeTop' }), 'line off');
  assert.equal(sig({ fifthLine: 'uv' }), sig({ fifthLine: 'uv', fifthLineStyle: 'stripeTop' }),
    'repeats the uv line');
  // The same stripe on another metric re-bakes too (each line's metric is signed anyway).
  assert.notEqual(sig({ thirdLineStyle: 'stripeTop' }), sig({ thirdLine: 'wind', thirdLineStyle: 'stripeTop' }));
});

// The metric alerts change the bake (the ALERT_ENTRIES_UINT8 tuple) AND the fetch set (a
// placed alert fetches its metric and day peaks), so placing one — or, while placed, its
// Look — must force a refetch. Which side or bar holds it does not: that rides the Clay
// blob (the On demand cells), as does the rain look (byte 34).
const { NOTHING_PLACED, placeOn, placedOnly } = require('./helpers/on-demand.js');

test('placing an alert and, while placed, its Look change the render signature', () => {
  const base = renderSignature(NOTHING_PLACED);
  thresholds.ALERT_KINDS.forEach((a) => {
    const on = renderSignature(placedOnly([a.code]));
    assert.notEqual(on, base, a.code + ': placing it must force a refetch');
    assert.notEqual(renderSignature(placedOnly([a.code], { ['alert' + a.key + 'Display']: 'value' })),
      on, 'alert' + a.key + 'Display must force a refetch while the alert is placed');
    // Unplaced, the Look bakes nothing: no refetch for it (nor for the page hydrating it).
    assert.equal(renderSignature(placedOnly([], { ['alert' + a.key + 'Display']: 'value' })), base,
      'alert' + a.key + 'Display is inert while the alert is not placed');
    assert.equal(renderSignature(placedOnly([], { ['alert' + a.key + 'Display']: 'icon' })), base,
      'the hydrated defaults sign like absent keys');
  });
});

// The signature rests on the placed UNION (every bar and side, read as a watch that draws
// On demand): moving an item between sides or bars, or unticking it on one of two sides
// that both carry it, signs nothing new; adding or removing it from the union does.
test('moving an alert between sides or bars leaves the signature alone; changing the union changes it', () => {
  const OD = require('../src/pkjs/on-demand.js');
  const top = renderSignature(placedOnly(['uv', 'wind']));
  assert.equal(renderSignature(placeOn(Object.assign({}, NOTHING_PLACED), 'top', 'left', 'uv,wind')), top,
    'the other side of the same bar');
  assert.equal(renderSignature(placeOn(placedOnly(['wind']), 'forecast', 'right', 'uv')), top, 'another bar');
  const both = placeOn(placedOnly(['uv', 'wind']), 'forecast', 'left', 'uv');
  assert.equal(renderSignature(both), top, 'on two bars');
  assert.equal(renderSignature(Object.assign({}, both, { statusForecastOnDemandLeftItems: '' })), top,
    'unticking it on one of two sides that both carry it');
  assert.notEqual(renderSignature(placedOnly(['uv'])), top, 'dropping wind from the union');
  assert.notEqual(renderSignature(placedOnly([])), top, 'unticking them on the only side that carries them');
  // The system items, the rain alert and the Battery item never sign.
  const base = renderSignature(NOTHING_PLACED);
  [placedOnly(['battery', 'bt', 'qt', 'snooze', 'rain']), Object.assign({}, NOTHING_PLACED,
    { batteryLowLevel: '20', batteryLowDisplay: 'value', btIcons: 'both', vibe: true, rainAlertDisplay: 'icon' })]
    .forEach((st) => assert.equal(renderSignature(st), base, JSON.stringify(st)));
  // An absent side key reads its default, so the page hydrating the defaults signs like
  // a blob without them.
  const defaults = Object.assign({}, OD.DEFAULTS);
  assert.equal(renderSignature(defaults), renderSignature({}));
});

// The alert segment signs the bake's own list (enabledAlerts): each placed alert's
// code and how it reads. Over every combination of the five placements (none, the Watch
// Status Bar's right, the forecast bar's left) and Looks, two settings sign alike
// exactly when the bake reads them alike: placed or not, and the Look while placed.
test('the alert segment tells apart exactly the placed alerts and their Looks', () => {
  const PLACE = [null, ['top', 'right'], ['forecast', 'left']];
  const LOOK = [undefined, 'icon', 'value'];
  const toSig = new Map();
  const toBaked = new Map();
  const walk = (k, s, baked) => {
    if (k === thresholds.ALERT_KINDS.length) {
      const b = baked.join('|');
      const sig = renderSignature(s);
      if (toSig.has(b)) { assert.equal(toSig.get(b), sig, 'one bake state, one signature'); }
      if (toBaked.has(sig)) { assert.equal(toBaked.get(sig), b, 'one signature, one bake state'); }
      toSig.set(b, sig);
      toBaked.set(sig, b);
      return;
    }
    const a = thresholds.ALERT_KINDS[k];
    PLACE.forEach((place) => LOOK.forEach((look) => {
      const next = Object.assign({}, s);
      if (place) {
        const key = 'status' + (place[0] === 'top' ? 'Top' : 'Forecast') + 'OnDemand'
          + (place[1] === 'left' ? 'Left' : 'Right');
        next[key] = 'on';
        next[key + 'Items'] = next[key + 'Items'] ? next[key + 'Items'] + ',' + a.code : a.code;
      }
      if (look !== undefined) { next['alert' + a.key + 'Display'] = look; }
      walk(k + 1, next, baked.concat([(place ? 'on' : '') + '/' + (place && look === 'value' ? 'value' : '')]));
    }));
  };
  walk(0, Object.assign({}, NOTHING_PLACED), []);
  // Three states per kind (not placed, placed, placed with the value): 3^5.
  assert.equal(toSig.size, Math.pow(3, thresholds.ALERT_KINDS.length));
});

// An alert's Days (whether tomorrow may raise it) and its tomorrow mark (the code a
// tomorrow entry carries) change the baked bytes, so they sign — but only as the
// bake reads them: Days while the alert is placed, the mark while it also looks ahead.
test('each alert\'s Days and tomorrow mark change the signature exactly where the bake reads them', () => {
  const base = renderSignature(NOTHING_PLACED);
  thresholds.ALERT_KINDS.forEach((a) => {
    const key = 'alert' + a.key;
    const days = key + 'Days';
    const mark = key + 'NextDayMark';
    const sig = (over) => renderSignature(placedOnly([a.code], over));
    assert.notEqual(sig({ [days]: 'today' }), sig({}), days + ' today must force a refetch');
    assert.equal(sig({ [days]: 'tomorrow' }), sig({}), days + ': the hydrated default signs like absent');
    assert.notEqual(sig({ [mark]: 'gt' }), sig({}), mark + ' must force a refetch while looking ahead');
    assert.equal(sig({ [mark]: 'raquo' }), sig({}), mark + ': the hydrated default signs like absent');
    assert.notEqual(sig({ [mark]: 'gt' }), sig({ [mark]: 'star' }), mark + ': each mark its own');
    assert.equal(sig({ [days]: 'today', [mark]: 'gt' }), sig({ [days]: 'today' }),
      mark + ' is inert while the alert looks at today only');
    assert.equal(sig({ [days]: 'bogus', [mark]: 'bogus' }), sig({}), 'unknown values read as the defaults');
    assert.equal(renderSignature(placedOnly([], { [days]: 'today', [mark]: 'gt' })), base,
      days + ' and ' + mark + ' are inert while the alert is not placed');
  });
});

// Per kind, over every combination of its placement, Look, Days and mark: two settings
// sign alike exactly when the bake reads them alike.
test('the alert segment signs each kind\'s Days and mark exactly as the bake reads them', () => {
  thresholds.ALERT_KINDS.forEach((a) => {
    const key = 'alert' + a.key;
    const baked = (placed, s) => {
      const ahead = placed && s[key + 'Days'] !== 'today';
      const mark = thresholds.ALERT_NEXT_DAY_MARKS.indexOf(s[key + 'NextDayMark']) !== -1
        ? s[key + 'NextDayMark'] : 'raquo';
      return [placed, placed && s[key + 'Display'] === 'value', ahead, ahead ? mark : ''].join('/');
    };
    const toSig = new Map();
    const toBaked = new Map();
    [false, true].forEach((placed) => [undefined, 'icon', 'value'].forEach((look) =>
      [undefined, 'today', 'tomorrow', 'x'].forEach((days) =>
        [undefined, 'raquo', 'gt', 'none', 'x'].forEach((mark) => {
          const s = placedOnly(placed ? [a.code] : []);
          if (look !== undefined) { s[key + 'Display'] = look; }
          if (days !== undefined) { s[key + 'Days'] = days; }
          if (mark !== undefined) { s[key + 'NextDayMark'] = mark; }
          const b = baked(placed, s);
          const sig = renderSignature(s);
          if (toSig.has(b)) { assert.equal(toSig.get(b), sig, a.code + ': one bake state, one signature'); }
          if (toBaked.has(sig)) { assert.equal(toBaked.get(sig), b, a.code + ': one signature, one bake state'); }
          toSig.set(b, sig);
          toBaked.set(sig, b);
        }))));
    // not placed; placed today (icon/value); placed looking ahead (icon/value) x 3 marks.
    assert.equal(toSig.size, 1 + 2 + 2 * 3, a.code);
  });
});

test('the alerts each occupy their own signature slot', () => {
  const seen = new Set();
  thresholds.ALERT_KINDS.forEach((a) => {
    seen.add(renderSignature(placedOnly([a.code])));
    seen.add(renderSignature(placedOnly([a.code], { ['alert' + a.key + 'Display']: 'value' })));
  });
  assert.equal(seen.size, thresholds.ALERT_KINDS.length * 2);
});

test('the rain alert look stays OUT of the render signature (it rides Clay)', () => {
  const base = renderSignature({});
  ['text', 'icon', 'minutes'].forEach((v) => {
    assert.equal(renderSignature({ rainAlertDisplay: v }), base, v);
  });
});

test('the rain alert\'s placement stays OUT of the render signature (Clay)', () => {
  const base = renderSignature({});
  assert.equal(renderSignature({ statusTopOnDemandLeftItems: 'bt,qt,snooze' }), base,
    'Rain unticked only moves its Clay cell');
  assert.equal(renderSignature({ statusTopOnDemandLeftItems: 'bt,qt,snooze',
    statusTopOnDemandRightItems: 'battery,rain,gust,uv,aqi,wind' }), base, 'nor does Rain on the other side');
  assert.equal(renderSignature({ statusForecastOnDemandRightItems: 'rain,bt' }), base, 'nor on another bar');
});
