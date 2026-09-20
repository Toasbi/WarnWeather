// test/weather-tab.test.js — the Weather tab's glue: chip row rendering,
// provider options, the graphs block's fetch orchestration (stubbed through
// the shared data module instance — no network), and the pan-snap math.
const test = require('node:test');
const assert = require('node:assert/strict');
const tab = require('../src/pkjs/settings/weather-tab.js');
const data = require('../src/pkjs/settings/weather-tab-data.js');
const model = require('../src/pkjs/settings/weather-tab-model.js');

// The glue calls Date.now() itself (ensureFetch prepares the view against
// the real clock), so the fixture anchors to the REAL current UTC day —
// with utcOffsetSec 0 the view's day start lands exactly on it, whatever
// date or timezone the suite runs in.
const DAY0 = Math.floor(Date.now() / 86400000) * 86400000;
const SEED = { graphsSeed: { lat: 52.52, lon: 13.405, name: 'Berlin' } };

/** @returns {Object} a minimal normalized dataset the charts accept */
function fixture() {
  const hourly = { time: [], temp: [], rain: [], prob: [], wind: [], gust: [], dir: [], rh: [], dew: [], pressure: [], icon: [], sunshineMin: [] };
  for (let h = 0; h <= 48; h += 1) {
    hourly.time.push(DAY0 + h * 3600000);
    hourly.temp.push(15);
    hourly.rain.push(0);
    hourly.prob.push(10);
    hourly.wind.push(10);
    hourly.gust.push(18);
    hourly.dir.push(200);
    hourly.rh.push(60);
    hourly.dew.push(8);
    hourly.pressure.push(1013);
    hourly.icon.push('clear');
  }
  return {
    hourly,
    daily: [{ date: DAY0, tmin: 10, tmax: 20, icon: 'clear', rainMm: 0, probMax: 5, sunshineH: 8 }],
    utcOffsetSec: 0
  };
}

test('graphsProviderOptions labels Auto with its resolution and gates keyed rows', () => {
  const opts = tab.graphsProviderOptions({ provider: 'dwd' });
  assert.equal(opts[0][1], 'auto');
  assert.match(opts[0][0], /Auto \(DWD/);
  assert.deepEqual(opts.slice(1).map((o) => o[1]), ['dwd', 'openmeteo']);
  const withKeys = tab.graphsProviderOptions({ provider: 'metno', owmApiKey: 'k' });
  assert.match(withKeys[0][0], /Auto \(Open-Meteo\)/, 'metno is not page-fetchable');
  assert.ok(withKeys.some((o) => o[1] === 'openweathermap'));
});

test('graphsProviderHeader labels the collapsed Provider card with the current pick', () => {
  assert.match(tab.graphsProviderHeader({ provider: 'dwd' }), /^Auto \(DWD/, 'no pick reads as Auto');
  assert.equal(tab.graphsProviderHeader({ graphsProvider: 'openmeteo' }), 'Open-Meteo');
  assert.equal(tab.graphsProviderHeader({ graphsProvider: 'tomorrowio', tomorrowioApiKey: 't' }), 'tomorrow.io');
  assert.match(tab.graphsProviderHeader({ graphsProvider: 'tomorrowio' }), /^Auto/,
    'a keyed pick whose key is gone falls back to the Auto label');
});

test('firstFreeSlot walks the three slots', () => {
  const slot = model.serializeSlot({ name: 'X', lat: 1, lon: 2 });
  assert.equal(tab.firstFreeSlot({}), 1);
  assert.equal(tab.firstFreeSlot({ savedLocation1: slot }), 2);
  assert.equal(tab.firstFreeSlot({ savedLocation1: slot, savedLocation2: slot, savedLocation3: slot }), null);
});

test('the chip row: current seed, saved slots, Add, and the no-location hint', () => {
  const slot = model.serializeSlot({ name: 'Siegen', lat: 50.9, lon: 8.0 });
  let html = tab.weatherLocationsBlock({ graphsLocation: 'current', savedLocation1: slot }, {}, SEED);
  assert.ok(html.indexOf('Berlin') !== -1, 'current chip carries the seeded city');
  assert.ok(html.indexOf('Siegen') !== -1);
  assert.ok(html.indexOf('+ Add') !== -1, 'a free slot offers Add');
  assert.ok(html.indexOf('wx-chip on') !== -1);
  assert.equal(html.indexOf('wx-chip-tools'), -1, 'no Replace/Remove while Current is active');

  html = tab.weatherLocationsBlock({ graphsLocation: '1', savedLocation1: slot }, {}, SEED);
  assert.ok(html.indexOf('wx-chip-tools') !== -1, 'the active saved slot offers Replace/Remove');

  html = tab.weatherLocationsBlock({}, {}, {});
  assert.ok(html.indexOf('disabled') !== -1, 'no seed disables the Current chip');
  assert.ok(html.indexOf('No location yet') !== -1);

  const full = {
    savedLocation1: slot, savedLocation2: slot, savedLocation3: slot
  };
  html = tab.weatherLocationsBlock(full, {}, SEED);
  assert.equal(html.indexOf('+ Add'), -1, 'three slots hide Add');
});

test('the graphs block orchestrates: loading → panels on data, error → Retry, no double fetch', () => {
  tab._resetState();
  let calls = 0;
  let respond = null;
  const realFetch = data.fetchWeather;
  data.fetchWeather = (provider, lat, lon, settings, cb) => {
    calls += 1;
    respond = cb;
  };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c', windUnits: 'kph' };
    let rendered = 0;
    tab._setCtx({ S: state, render: () => { rendered += 1; } });

    let html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.match(html, /Loading Berlin/);
    assert.equal(calls, 1);
    html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(calls, 1, 'a re-render while loading must not refetch');

    const fx = fixture();
    respond(fx, null);
    assert.equal(rendered, 1, 'data arrival asks the engine for a repaint');
    html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.ok(html.indexOf('Temperature &amp; precipitation') !== -1);
    assert.ok(html.indexOf('5-day forecast') !== -1);
    assert.ok(html.indexOf('5-day forecast') < html.indexOf('data-wxvp="strip"'),
      'the 5-day selector leads, then the shared hour strip (the app layout)');
    assert.ok(html.indexOf('data-wxvp="strip"') < html.indexOf('Temperature &amp; precipitation'));
    assert.ok(html.indexOf('data-wxchart="press"') !== -1);
    assert.ok(html.indexOf('data-action="wxShowDay"') !== -1, 'day tiles navigate the panels');
    assert.equal(calls, 1, 'a fresh render serves from module state');

    // Error path: new location key, failing fetch → Retry button, and no
    // render-driven refetch loop.
    const state2 = { graphsLocation: '1', savedLocation1: model.serializeSlot({ name: 'Oslo', lat: 59.9, lon: 10.7 }) };
    tab._setCtx({ S: state2, render: () => {} });
    html = tab.weatherGraphsBlock(state2, {}, SEED);
    assert.equal(calls, 2);
    respond(null, 'network');
    html = tab.weatherGraphsBlock(state2, {}, SEED);
    assert.match(html, /Couldn’t load weather \(network\)/);
    assert.ok(html.indexOf('wxRetryWeather') !== -1);
    tab.weatherGraphsBlock(state2, {}, SEED);
    assert.equal(calls, 2, 'an error never refetches from a render');
  } finally {
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a new location resets the viewed day to today', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(tab._panDay(), 0);
    const state2 = { graphsLocation: '1', savedLocation1: model.serializeSlot({ name: 'Oslo', lat: 59.9, lon: 10.7 }) };
    tab.weatherGraphsBlock(state2, {}, SEED);
    respond(fixture(), null);
    assert.equal(tab._panDay(), 0, 'a location switch lands on its today');
  } finally {
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('snapTargetDay: rounds to the nearest day, flicks advance one, clamps at the ends', () => {
  const vw = 400;
  assert.equal(tab.snapTargetDay(1, -100, vw, 5, 800), 1, 'a slow quarter-drag springs back');
  assert.equal(tab.snapTargetDay(1, -240, vw, 5, 800), 2, 'past halfway rounds forward');
  assert.equal(tab.snapTargetDay(1, 240, vw, 5, 800), 0, 'and backward');
  assert.equal(tab.snapTargetDay(1, -60, vw, 5, 150), 2, 'a quick flick advances one day');
  assert.equal(tab.snapTargetDay(1, 60, vw, 5, 150), 0, 'a quick flick goes back one day');
  assert.equal(tab.snapTargetDay(0, 300, vw, 5, 100), 0, 'clamped at the first day');
  assert.equal(tab.snapTargetDay(4, -300, vw, 5, 100), 4, 'clamped at the last day');
  assert.equal(tab.panPct(2, 5), -40, 'day 2 of 5 pans to -40% of the wide element');
});
