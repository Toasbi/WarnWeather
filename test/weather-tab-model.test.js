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

test('hourlyWindow slices around now', () => {
  const now = 1000 * 3600 * 1000;
  const times = [];
  for (let h = -24; h <= 96; h += 1) { times.push(now + h * 3600000); }
  const win = model.hourlyWindow(times, now, 6, 48);
  assert.equal(times[win.start], now - 6 * 3600000);
  assert.equal(times[win.end - 1], now + 48 * 3600000);
});
