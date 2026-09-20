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

test('refreshWeather refetches the same key manually, keeping the charts and the viewed day', () => {
  tab._resetState();
  let calls = 0;
  let respond = null;
  const realFetch = data.fetchWeather;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { calls += 1; respond = cb; };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(calls, 1);
    assert.equal(tab.refreshWeather(), true, 'idle → a refetch is due');
    let html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(calls, 2, 'the manual refresh refetches the same key');
    assert.ok(html.indexOf('Temperature &amp; precipitation') !== -1,
      'the previous charts stay up (dimmed) while updating');
    assert.ok(html.indexOf('updating') !== -1);
    assert.equal(tab.refreshWeather(), false, 'no stacked refetch while one is loading');
    assert.equal(tab._panDay(), 0, 'the viewed day survives a refresh');
    respond(fixture(), null);
    html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(calls, 2);
    assert.ok(html.indexOf('wxRefreshWeather') !== -1, 'the footer offers the manual Refresh');
  } finally {
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a manual refresh with Current active re-reads the phone GPS and follows it', () => {
  tab._resetState();
  const fetchCalls = [];
  let respond = null;
  let gpsCb = null;
  let revArgs = null;
  let revCb = null;
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  const realRev = data.reverseGeocode;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { fetchCalls.push([lat, lon]); respond = cb; };
  data.getGpsFix = (cb) => { gpsCb = cb; };
  data.reverseGeocode = (lat, lon, cb) => { revArgs = [lat, lon]; revCb = cb; };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, USERDATA: SEED, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(fetchCalls.length, 1);

    assert.equal(tab.refreshWeather(), true);
    assert.ok(gpsCb, 'the Current pick asks the device for a fresh fix');
    assert.equal(fetchCalls.length, 1, 'the refetch waits for the fix');
    let html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.ok(html.indexOf('updating') !== -1, 'the wait paints as a dimmed update');
    assert.equal(fetchCalls.length, 1, 'a render during the GPS wait must not fetch');

    gpsCb({ lat: 53.55, lon: 9.99 }, null);   // ~255 km away
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(fetchCalls.length, 2);
    assert.deepEqual(fetchCalls[1], [53.55, 9.99], 'the refetch runs at the fresh fix');
    html = tab.weatherLocationsBlock(state, {}, SEED);
    assert.ok(html.indexOf('Current location') !== -1, 'a far move drops the stale city name');
    assert.equal(html.indexOf('Berlin'), -1);
    assert.deepEqual(revArgs, [53.55, 9.99], 'and asks the reverse geocoder for the new one');
    revCb('Hamburg', null);
    html = tab.weatherLocationsBlock(state, {}, SEED);
    assert.ok(html.indexOf('Hamburg') !== -1, 'the reverse geocode relabels the Current chip');
    respond(fixture(), null);
    assert.equal(tab._panDay(), 0, 'a moved location lands on its today');
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
    data.reverseGeocode = realRev;
    tab._resetState();
  }
});

test('GPS jitter keeps the city name; a failed fix degrades to a plain refresh', () => {
  tab._resetState();
  const fetchCalls = [];
  let respond = null;
  let gpsCb = null;
  let revCalled = false;
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  const realRev = data.reverseGeocode;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { fetchCalls.push([lat, lon]); respond = cb; };
  data.getGpsFix = (cb) => { gpsCb = cb; };
  data.reverseGeocode = () => { revCalled = true; };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, USERDATA: SEED, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);

    tab.refreshWeather();
    gpsCb({ lat: 52.5206, lon: 13.4041 }, null);   // metres of drift
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.deepEqual(fetchCalls[1], [52.52, 13.405],
      'jitter never adopts coordinates — the fetch key stays stable, so the viewed day survives');
    assert.equal(tab._gpsSeed(), null, 'no seed override for a same-place fix');
    assert.equal(revCalled, false, 'no reverse geocode for a same-place fix');
    respond(fixture(), null);

    gpsCb = null;
    tab.refreshWeather();
    assert.ok(gpsCb, 'each refresh asks for a fix again');
    gpsCb(null, 'denied');
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(fetchCalls.length, 3, 'a failed fix still refreshes');
    assert.deepEqual(fetchCalls[2], [52.52, 13.405], 'at the previous coordinates');
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
    data.reverseGeocode = realRev;
    tab._resetState();
  }
});

test('a pending city lookup survives a jitter refresh, and a failed one is retried', () => {
  tab._resetState();
  let respond = null;
  let gpsCb = null;
  const revCbs = [];
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  const realRev = data.reverseGeocode;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  data.getGpsFix = (cb) => { gpsCb = cb; };
  data.reverseGeocode = (lat, lon, cb) => { revCbs.push(cb); };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, USERDATA: SEED, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);

    // Far move: one lookup starts; the weather refetch completes first.
    tab.refreshWeather();
    gpsCb({ lat: 53.55, lon: 9.99 }, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(revCbs.length, 1);

    // A same-place refresh while the lookup is still in flight must neither
    // duplicate it nor orphan it: the answer still labels the chip.
    tab.refreshWeather();
    gpsCb({ lat: 53.5504, lon: 9.9903 }, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(revCbs.length, 1, 'no duplicate lookup while one is pending');
    revCbs[0]('Hamburg', null);
    assert.equal(tab._gpsSeed().name, 'Hamburg', 'the pending answer still lands');

    // Failure path: another far move whose lookup dies — the next
    // same-place refresh retries instead of stranding the placeholder.
    tab.refreshWeather();
    gpsCb({ lat: 48.14, lon: 11.58 }, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(revCbs.length, 2);
    revCbs[1](null, 'network');
    assert.equal(tab._gpsSeed().name, 'Current location');
    tab.refreshWeather();
    gpsCb({ lat: 48.1402, lon: 11.5803 }, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(revCbs.length, 3, 'the placeholder name is retried on the next refresh');
    revCbs[2]('Munich', null);
    assert.equal(tab._gpsSeed().name, 'Munich');
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
    data.reverseGeocode = realRev;
    tab._resetState();
  }
});

test('moveKm wraps the antimeridian: Fiji-side jitter is not a far move', () => {
  tab._resetState();
  const fetchCalls = [];
  let respond = null;
  let gpsCb = null;
  let revCalled = false;
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  const realRev = data.reverseGeocode;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { fetchCalls.push([lat, lon]); respond = cb; };
  data.getGpsFix = (cb) => { gpsCb = cb; };
  data.reverseGeocode = () => { revCalled = true; };
  try {
    const FIJI = { graphsSeed: { lat: -16.8, lon: 179.995, name: 'Taveuni' } };
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, USERDATA: FIJI, render: () => {} });
    tab.weatherGraphsBlock(state, {}, FIJI);
    respond(fixture(), null);

    tab.refreshWeather();
    gpsCb({ lat: -16.8, lon: -179.995 }, null);   // ~2 km around the date line
    tab.weatherGraphsBlock(state, {}, FIJI);
    assert.equal(tab._gpsSeed(), null, 'a date-line crossing of metres stays jitter');
    assert.equal(revCalled, false);
    assert.deepEqual(fetchCalls[1], [-16.8, 179.995]);
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
    data.reverseGeocode = realRev;
    tab._resetState();
  }
});

test('a refresh with a saved slot active never touches the GPS', () => {
  tab._resetState();
  let fetchCalls = 0;
  let respond = null;
  let gpsAsked = false;
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { fetchCalls += 1; respond = cb; };
  data.getGpsFix = () => { gpsAsked = true; };
  try {
    const state = { graphsLocation: '1', savedLocation1: model.serializeSlot({ name: 'Oslo', lat: 59.9, lon: 10.7 }) };
    tab._setCtx({ S: state, USERDATA: SEED, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(tab.refreshWeather(), true);
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(fetchCalls, 2, 'the slot refreshes normally');
    assert.equal(gpsAsked, false, 'a fixed city needs no device fix');
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
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
