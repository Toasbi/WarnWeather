// test/weather-tab-model.test.js — the Weather tab's pure logic: saved-location
// slots, tab-local provider resolution, unit conversion, icon normalization,
// and client-side daily aggregation.
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/pkjs/settings/weather-tab-model.js');

test('slot parse/serialize round-trips and rejects garbage', () => {
  const raw = model.serializeSlot({ name: 'Siegen', lat: 50.87, lon: 8.02, country: 'DE' });
  assert.deepEqual(model.parseSlot(raw), { name: 'Siegen', lat: 50.87, lon: 8.02, country: 'DE' });
  assert.equal(model.parseSlot(''), null);
  assert.equal(model.parseSlot(undefined), null);
  assert.equal(model.parseSlot('not json'), null);
  assert.equal(model.parseSlot('{"name":"","lat":1,"lon":2}'), null, 'empty name');
  assert.equal(model.parseSlot('{"name":"X","lat":91,"lon":0}'), null, 'lat out of range');
  assert.equal(model.parseSlot('{"name":"X","lat":"abc","lon":0}'), null, 'non-numeric lat');
});

test('availableProviders gates keyed providers on their key', () => {
  const ids = (s) => model.availableProviders(s).map((p) => p.id);
  assert.deepEqual(ids({}), ['dwd', 'openmeteo'], 'keyless providers only');
  assert.deepEqual(ids({ owmApiKey: 'k' }), ['dwd', 'openmeteo', 'openweathermap']);
  assert.deepEqual(ids({ owmApiKey: 'k', tomorrowioApiKey: 't' }),
    ['dwd', 'openmeteo', 'openweathermap', 'tomorrowio']);
});

test('resolveGraphsProvider: auto follows the watch provider when fetchable, else Open-Meteo', () => {
  assert.equal(model.resolveGraphsProvider({ provider: 'dwd' }), 'dwd');
  assert.equal(model.resolveGraphsProvider({ provider: 'metno' }), 'openmeteo',
    'Met.no is not page-fetchable (TOS User-Agent header is browser-forbidden)');
  assert.equal(model.resolveGraphsProvider({ provider: 'wunderground' }), 'openmeteo',
    'the WU key never enters the settings blob');
  assert.equal(model.resolveGraphsProvider({ provider: 'openweathermap' }), 'openmeteo',
    'keyed watch provider without a key falls back');
  assert.equal(model.resolveGraphsProvider({ provider: 'openweathermap', owmApiKey: 'k' }), 'openweathermap');
  assert.equal(model.resolveGraphsProvider({ graphsProvider: 'dwd', provider: 'openmeteo' }), 'dwd',
    'an explicit pick wins');
  assert.equal(model.resolveGraphsProvider({ graphsProvider: 'tomorrowio' }), 'openmeteo',
    'an explicit pick whose key is gone falls back to auto');
});

test('activeLocation precedence: picked slot, then seed, then any slot, then null', () => {
  const slot1 = model.serializeSlot({ name: 'Siegen', lat: 50.9, lon: 8.0 });
  const seed = { lat: 52.5, lon: 13.4, name: 'Berlin' };
  const picked = model.activeLocation({ graphsLocation: '1', savedLocation1: slot1 }, seed);
  assert.equal(picked.name, 'Siegen');
  assert.equal(picked.key, '1');
  const current = model.activeLocation({ graphsLocation: 'current', savedLocation1: slot1 }, seed);
  assert.equal(current.name, 'Berlin');
  assert.equal(current.key, 'current');
  const emptyPick = model.activeLocation({ graphsLocation: '2', savedLocation1: slot1 }, seed);
  assert.equal(emptyPick.key, 'current', 'an empty picked slot falls back to current');
  const noSeed = model.activeLocation({ graphsLocation: 'current', savedLocation2: slot1 }, null);
  assert.equal(noSeed.name, 'Siegen', 'without a phone fix, any saved slot beats nothing');
  assert.equal(model.activeLocation({}, null), null);
});

test('unit conversion honors the watch settings', () => {
  assert.equal(model.displayTemp(20, { temperatureUnits: 'c' }), 20);
  assert.equal(model.displayTemp(20, { temperatureUnits: 'f' }), 68);
  assert.equal(model.tempUnitLabel({ temperatureUnits: 'f' }), '°F');
  assert.equal(Math.round(model.displayWind(100, { windUnits: 'mph' })), 62);
  assert.equal(Math.round(model.displayWind(100, { windUnits: 'knots' })), 54);
  assert.equal(model.displayWind(100, { windUnits: 'kph' }), 100);
  assert.equal(model.windUnitLabel({ windUnits: 'knots' }), 'kn');
});

test('humidityFromDewPoint: Magnus ratio, saturated at the dew point, null without both inputs', () => {
  assert.equal(model.humidityFromDewPoint(12, 12), 100, 'air at its dew point is saturated');
  // e_sat(10) / e_sat(20) with feels-like.js's constants (17.27, 237.7): 52.6 %.
  assert.equal(Math.round(model.humidityFromDewPoint(20, 10) * 10) / 10, 52.6);
  assert.equal(Math.round(model.humidityFromDewPoint(-5, -10) * 10) / 10, 67.9, 'below freezing too');
  assert.equal(model.humidityFromDewPoint(10, 11), 100, 'a dew point above the air (rounding in the feed) caps at 100');
  assert.equal(model.humidityFromDewPoint(null, 8), null);
  assert.equal(model.humidityFromDewPoint(15, null), null);
  assert.equal(model.humidityFromDewPoint(15, undefined), null);
  assert.equal(model.humidityFromDewPoint(NaN, 8), null);
  assert.equal(model.humidityFromDewPoint(20, NaN), null);
});

test('dewPointFromHumidity inverts humidityFromDewPoint', () => {
  // 17 °C at 58 %, computed independently: 8.67 °C.
  assert.equal(Math.round(model.dewPointFromHumidity(17, 58) * 100) / 100, 8.67);
  assert.ok(Math.abs(model.dewPointFromHumidity(12, 100) - 12) < 1e-9, 'saturated air is at its dew point');
  assert.ok(Math.abs(model.dewPointFromHumidity(12, 104) - 12) < 1e-9, 'a humidity above 100 (rounding in the feed) caps there');
  for (const [t, td] of [[20, 10], [-5, -10], [30, 25]]) {
    const back = model.dewPointFromHumidity(t, model.humidityFromDewPoint(t, td));
    assert.ok(Math.abs(back - td) < 1e-9, 'round trip at ' + t + '/' + td);
  }
  assert.equal(model.dewPointFromHumidity(15, 0), null, 'bone-dry air has no dew point');
  assert.equal(model.dewPointFromHumidity(15, -3), null);
  assert.equal(model.dewPointFromHumidity(null, 50), null);
  assert.equal(model.dewPointFromHumidity(15, null), null);
  assert.equal(model.dewPointFromHumidity(15, NaN), null);
});

test('icon normalization: WMO, Brightsky, OWM, tomorrow.io spot checks', () => {
  assert.equal(model.wmoIcon(0), 'clear');
  assert.equal(model.wmoIcon(2), 'partly');
  assert.equal(model.wmoIcon(3), 'cloudy');
  assert.equal(model.wmoIcon(48), 'fog');
  assert.equal(model.wmoIcon(55), 'drizzle');
  assert.equal(model.wmoIcon(66), 'sleet');
  assert.equal(model.wmoIcon(75), 'snow');
  assert.equal(model.wmoIcon(81), 'showers');
  assert.equal(model.wmoIcon(96), 'thunder');
  assert.equal(model.brightskyIcon('partly-cloudy-night'), 'partly');
  assert.equal(model.brightskyIcon('thunderstorm'), 'thunder');
  assert.equal(model.owmIcon(800), 'clear');
  assert.equal(model.owmIcon(802), 'partly');
  assert.equal(model.owmIcon(521), 'showers');
  assert.equal(model.owmIcon(613), 'sleet');
  assert.equal(model.tomorrowIcon(1000), 'clear');
  assert.equal(model.tomorrowIcon(4200), 'rain');
  assert.equal(model.tomorrowIcon(8000), 'thunder');
  // Every mapped id is in the drawable vocabulary.
  [0, 1, 3, 45, 51, 56, 61, 66, 71, 80, 85, 95].forEach((c) => {
    assert.ok(model.ICONS.indexOf(model.wmoIcon(c)) !== -1, 'wmo ' + c);
  });
});

test('pickDailyIcon prefers the most severe daytime condition', () => {
  const icons = [];
  for (let h = 0; h < 24; h += 1) { icons[h] = 'clear'; }
  icons[14] = 'rain';
  icons[3] = 'thunder'; // nighttime severity is ignored while daytime has data
  assert.equal(model.pickDailyIcon(icons), 'rain');
  assert.equal(model.pickDailyIcon([]), null);
});

test('aggregateDaily folds hourly data into local-day tiles and stops at the horizon', () => {
  const dayStart = new Date(2026, 8, 20, 0, 0, 0).getTime();
  const hourly = { time: [], temp: [], rain: [], prob: [], icon: [], sunshineMin: [] };
  for (let h = 0; h < 36; h += 1) { // today + half of tomorrow
    hourly.time.push(dayStart + h * 3600000);
    hourly.temp.push(10 + (h % 24));
    hourly.rain.push(h === 15 ? 2.5 : 0);
    hourly.prob.push(h === 15 ? 80 : 10);
    hourly.icon.push(h === 15 ? 'rain' : 'partly');
    hourly.sunshineMin.push(h >= 8 && h < 18 ? 30 : 0);
  }
  const noonToday = dayStart + 12 * 3600000;
  const days = model.aggregateDaily(hourly, noonToday, 5);
  assert.equal(days.length, 2, 'day 3 has no data — aggregation stops');
  assert.equal(days[0].tmin, 10);
  assert.equal(days[0].tmax, 33);
  assert.equal(days[0].rainMm, 2.5);
  assert.equal(days[0].probMax, 80);
  assert.equal(days[0].icon, 'rain');
  assert.equal(days[0].sunshineH, 5);
  assert.equal(days[1].icon, 'partly');
});

test('the rain tier port matches rain-tier.js value-for-value (the watch scale)', () => {
  // The tab's right-hand precipitation axis IS the watchface's rain scale;
  // this lockstep sweep keeps the two implementations from drifting apart.
  const rainTier = require('../src/pkjs/weather/rain-tier.js');
  for (let tenths = 0; tenths <= 300; tenths += 1) {
    assert.equal(model.rainTierPermille(tenths), rainTier.rainPermille(tenths), 'tenths=' + tenths);
  }
  assert.equal(model.rainPermilleFromMm(0.25), rainTier.rainPermille(3), 'mm rounds to wire tenths');
  assert.equal(model.RAIN_TIER_TOP_PCT.length, 6);
  assert.equal(model.RAIN_TIER_LABELS.length, 5);
});

test('buildHourlyGrid: pass-through, interpolation across a 3 h tail, and gap nulls', () => {
  const start = Date.UTC(2026, 8, 20);
  const hourly = {
    time: [], temp: [], rain: [], prob: [], wind: [], gust: [],
    dir: [], rh: [], dew: [], pressure: [], icon: []
  };
  // 6 hourly samples, then a jump to two 3-hourly samples (the OWM shape).
  const stamps = [0, 1, 2, 3, 4, 5, 9, 12].map((h) => start + h * 3600000);
  stamps.forEach((t, i) => {
    hourly.time.push(t);
    hourly.temp.push(10 + i);
    hourly.rain.push(i === 6 ? 3 : 0);
    hourly.prob.push(50);
    hourly.wind.push(20);
    hourly.gust.push(null);
    hourly.dir.push(180);
    hourly.rh.push(60);
    hourly.dew.push(5);
    hourly.pressure.push(1010);
    hourly.icon.push('rain');
  });
  const grid = model.buildHourlyGrid(hourly, start, 24);
  assert.equal(grid.time.length, 24);
  assert.equal(grid.temp[3], 13, 'exact hours pass through');
  // Hour 7 sits between the samples at +5 h (15°) and +9 h (16°): 15.5°.
  assert.equal(grid.temp[7], 15.5, 'continuous series interpolate across the coarse tail');
  assert.equal(grid.rain[8], 3, 'stepped series take the nearest sample within 90 min');
  assert.equal(grid.rain[7], null, 'mid-gap hour: both samples sit 2 h away → null, never a guess');
  assert.equal(grid.icon[10], 'rain', 'the +9 h sample is 60 min away — held');
  assert.equal(grid.icon[16], null, 'nothing within 90 min → null');
  assert.equal(grid.temp[20], null, 'hours past the data stay null');
  assert.equal(grid.gust[2], null, 'a null sample stays null, not 0');
});
