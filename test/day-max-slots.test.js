// test/day-max-slots.test.js — the UV slot's day max (Now / Day max / Both) on the
// wind, gust and AQI slots: the numbers wire-units picks, the text status-lines
// bakes, the highlight status-thresholds judges, and the peaks getPayload emits.
const test = require('node:test');
const assert = require('node:assert/strict');

const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

const wireUnits = require('../src/pkjs/wire-units.js');
const statusLines = require('../src/pkjs/status-lines.js');
const catalog = require('../src/pkjs/status-line-catalog.js');
const th = require('../src/pkjs/status-thresholds.js');
const http = require('../src/pkjs/weather/http.js');
const aq = require('../src/pkjs/weather/air-quality.js');
const WeatherProvider = require('../src/pkjs/weather/provider.js');
const dayPeaks = require('../src/pkjs/weather/day-peaks.js');
const KEYS = require('../src/pkjs/storage-keys.js');

const RAQUO = '»';

// The day-max reader in (trend, peaks, mode[, windUnits]) form, per kind.
const TREND = { wind: 'WIND_TREND_UINT8', aqi: 'AQI_TREND' };
const PEAKS = { wind: 'WIND_DAY_PEAKS', aqi: 'AQI_DAY_PEAKS' };
const shownOf = (code) => (trend, peaks, mode, windUnits) => wireUnits.dayMaxShown(code,
  { [TREND[code]]: trend, [PEAKS[code]]: peaks }, { [code + 'SlotDisplay']: mode, windUnits });
const windShown = shownOf('wind');
const aqiShown = shownOf('aqi');

function settings(extra) {
  return Object.assign({ windUnits: 'kph', temperatureUnits: 'c' }, extra || {});
}

// ---- wire-units: the displayed numbers ------------------------------------

test('wind runs the UV rule on the km/h series, in the user\'s unit', () => {
  // 12 km/h now, 30 still to come today, 45 tomorrow.
  assert.deepEqual(windShown([12], [30, 45, null], 'both', 'kph'),
    { now: 12, peak: 30, nextDay: false });
  assert.deepEqual(windShown([12], [30, 45, null], 'max', 'kph'),
    { now: null, peak: 30, nextDay: false });
  // Converted BEFORE the comparison: 30 km/h = 19 mph, 45 km/h = 28 mph.
  assert.deepEqual(windShown([12], [30, 45, null], 'both', 'mph'),
    { now: 7, peak: 19, nextDay: false });
  // At the day's strongest with nothing earlier known: rolls on to tomorrow's.
  assert.deepEqual(windShown([30], [30, 45, null], 'both', 'kph'),
    { now: 30, peak: 45, nextDay: true });
  // ...but a peak still running (no earlier hour printed more) holds.
  assert.deepEqual(windShown([30], [30, 45, 22], 'both', 'kph'),
    { now: 30, peak: 30, nextDay: false });
  // Current mode and absent peaks both print the reading alone.
  assert.deepEqual(windShown([12], [30, 45, null], 'current', 'kph'),
    { now: 12, peak: null, nextDay: false });
  assert.deepEqual(windShown([12], undefined, 'max', 'kph'),
    { now: 12, peak: null, nextDay: false });
  assert.equal(windShown([], [30, 45, null], 'max', 'kph'), null);
});

test('AQI runs the same rule on the AQI forecast, and a null reading is no reading', () => {
  assert.deepEqual(aqiShown([42, 50], [58, 61, null], 'both'),
    { now: 42, peak: 58, nextDay: false });
  assert.equal(aqiShown([null], [58, 61, null], 'both'), null);
  assert.equal(aqiShown([], null, 'both'), null);
});

// ---- status-lines: the slot text -------------------------------------------

test('wind and gust slots print Now / Day max / Both, each on its own settings', () => {
  const p = { WIND_TREND_UINT8: [12], WIND_DAY_PEAKS: [30, 45, null],
    GUST_TREND_UINT8: [20], GUST_DAY_PEAKS: [52, 60, null] };
  const f = (code, extra) => statusLines.formatValue(code, p, settings(extra));
  assert.equal(f('wind'), '12kph', 'absent mode = now, as before');
  assert.equal(f('wind', { windSlotDisplay: 'max' }), '30kph');
  assert.equal(f('wind', { windSlotDisplay: 'both' }), '12/30kph', 'the unit follows the pair when it fits');
  assert.equal(f('wind', { windSlotDisplay: 'both', windSlotOrder: 'max', windSlotSeparator: 'bar' }),
    '30|12kph');
  // The gust slot reads ITS OWN keys, not the wind slot's.
  assert.equal(f('gust', { windSlotDisplay: 'both' }), '20kph');
  assert.equal(f('gust', { gustSlotDisplay: 'both' }), '20/52kph');
  // Too wide for the 8-byte edge slot with the unit: the unit goes, never a digit.
  assert.equal(statusLines.formatValue('gust',
    { GUST_TREND_UINT8: [20], GUST_DAY_PEAKS: [120, 60, null] },
    settings({ gustSlotDisplay: 'both' })), '20/120');
  // Tomorrow's peak carries the kind's own mark.
  assert.equal(statusLines.formatValue('wind', { WIND_TREND_UINT8: [30], WIND_DAY_PEAKS: [30, 45, null] },
    settings({ windSlotDisplay: 'max', windSlotUnit: false })), RAQUO + '45');
  assert.equal(statusLines.formatValue('wind', { WIND_TREND_UINT8: [30], WIND_DAY_PEAKS: [30, 45, null] },
    settings({ windSlotDisplay: 'max', windSlotUnit: false, windSlotNextDayMark: 'star' })), '45*');
});

test('the AQI day max runs on the Open-Meteo forecast and degrades to the reading on WAQI', () => {
  const forecast = { AQI_TREND: [42, 50], AQI_DAY_PEAKS: [58, 61, null] };
  assert.equal(statusLines.formatValue('aqi', forecast, settings()), '42');
  assert.equal(statusLines.formatValue('aqi', forecast, settings({ aqiSlotDisplay: 'max' })), '58');
  assert.equal(statusLines.formatValue('aqi', forecast, settings({ aqiSlotDisplay: 'both' })), '42/58');
  const waqi = { AQI_TREND: [42] };   // current reading only: no AQI_DAY_PEAKS
  ['current', 'max', 'both'].forEach((mode) => {
    assert.equal(statusLines.formatValue('aqi', waqi, settings({ aqiSlotDisplay: mode })), '42', mode);
  });
  assert.equal(statusLines.formatValue('aqi', { AQI_TREND: [] }, settings({ aqiSlotDisplay: 'max' })), '--');
});

test('the wind arrow stays in Both (its first reading is now) and leaves Day max alone', () => {
  const radar = catalog.LINES.filter((l) => l.id === 'radar')[0];
  const env = { color: true, round: false, platform: 'basalt', health: true, radar: true };
  const slot = (extra) => {
    const bytes = statusLines.packLine(radar,
      { WIND_TREND_UINT8: [12], WIND_DAY_PEAKS: [30, 45, null], WIND_DIR_TREND: [270] },
      settings(Object.assign({ statusRadarLeft: 'wind', statusRadarMid: 'empty',
        statusRadarRight: 'empty', windSlotDirection: true, windSlotUnit: false }, extra)), env);
    return bytes.slice(3, 3 + bytes[2]);
  };
  const last = (b) => b[b.length - 1];
  assert.ok(last(slot({ windSlotDisplay: 'both' })) <= 0x10, 'Both keeps the arrow');
  assert.equal(Buffer.from(slot({ windSlotDisplay: 'max' })).toString('utf8'), '30',
    'Day max: the peak alone, no arrow');
  // No peak known: Day max prints the current reading, which the arrow describes.
  const noPeak = statusLines.packLine(radar,
    { WIND_TREND_UINT8: [12], WIND_DIR_TREND: [270] },
    settings({ statusRadarLeft: 'wind', statusRadarMid: 'empty', statusRadarRight: 'empty',
      windSlotDirection: true, windSlotUnit: false, windSlotDisplay: 'max' }), env);
  assert.ok(noPeak[2] === 3 && noPeak[5] <= 0x10, 'current reading keeps its arrow');
});

// ---- status-thresholds: the highlight ---------------------------------------

test('wind, gust and AQI highlights judge the highest of today\'s numbers shown', () => {
  const p = { WIND_TREND_UINT8: [12], WIND_DAY_PEAKS: [30, 45, null],
    GUST_TREND_UINT8: [30], GUST_DAY_PEAKS: [30, 60, null],
    AQI_TREND: [42], AQI_DAY_PEAKS: [58, 61, null] };
  assert.equal(th.displayValue('wind', p, settings()), 12, 'Now mode: the reading');
  assert.equal(th.displayValue('wind', p, settings({ windSlotDisplay: 'both' })), 30);
  assert.equal(th.displayValue('wind', p, settings({ windSlotDisplay: 'both', windUnits: 'mph' })), 19);
  // "30/»60": tomorrow's peak never counts; a lone "»60" is not judged at all.
  assert.equal(th.displayValue('gust', p, settings({ gustSlotDisplay: 'both' })), 30);
  assert.equal(th.displayValue('gust', p, settings({ gustSlotDisplay: 'max' })), null);
  assert.equal(th.displayValue('aqi', p, settings({ aqiSlotDisplay: 'max' })), 58);
  assert.equal(th.displayValue('aqi', { AQI_TREND: [] }, settings()), null);
});

// ---- getPayload + the AQI feed ----------------------------------------------

const LOCAL_9AM = new Date(2026, 6, 15, 9, 0, 0).getTime() / 1000;

function provider(over) {
  const p = new WeatherProvider();
  Object.assign(p, {
    tempTrend: new Array(24).fill(50), precipTrend: new Array(24).fill(0),
    rainTrend: new Array(24).fill(0), startTime: LOCAL_9AM, currentTemp: 60,
    cityName: 'Testville', sunEvents: []
  }, over);
  return p;
}

test('getPayload emits wind and gust day peaks in whole km/h off the full series', () => {
  const wind = new Array(48).fill(5);
  wind[4] = 31.6;   // 13:00 today
  wind[27] = 44.4;  // 12:00 tomorrow — past the graph's 24 h
  const gust = wind.map((v) => v * 2);
  const out = provider({ windTrend: wind, gustTrend: gust, earlierPeaks: { wind: 12.4 } }).getPayload();
  assert.equal(out.WIND_TREND_UINT8.length, 24, 'the graph keeps its window');
  assert.deepEqual(out.WIND_DAY_PEAKS, [32, 44, 12]);
  assert.deepEqual(out.GUST_DAY_PEAKS, [63, 89, null]);
});

test('getPayload emits AQI_DAY_PEAKS only for a forecast feed, never for a WAQI reading', () => {
  const aqi = new Array(48).fill(20);
  aqi[3] = 57.6;
  aqi[30] = 71;
  const forecast = provider({ aqiTrend: aqi, aqiFeedId: 'openmeteo-aqi-european' }).getPayload();
  assert.equal(forecast.AQI_TREND.length, 24);
  assert.deepEqual(forecast.AQI_DAY_PEAKS, [58, 71, null]);
  const waqi = provider({ aqiTrend: [42], aqiFeedId: null }).getPayload();
  assert.equal('AQI_DAY_PEAKS' in waqi, false);
});

test('the Open-Meteo AQI fetch reads PEAK_HOURS and names its feed; WAQI names none', () => {
  const orig = http.request;
  const urls = [];
  const time = [];
  const european_aqi = [];
  for (let i = 0; i < 60; i += 1) { time.push(LOCAL_9AM + i * 3600); european_aqi.push(i); }
  http.request = (url, method, onSuccess) => {
    urls.push(url);
    onSuccess(JSON.stringify(url.indexOf('api.waqi.info') !== -1
      ? { status: 'ok', data: { aqi: 42 } } : { hourly: { time, european_aqi } }));
  };
  try {
    const om = { fetchAqi: true, aqiSource: 'openmeteo', aqiScale: 'european', startTime: LOCAL_9AM, aqiFeedId: null };
    aq.fetchAqiInto(om, 1, 2, () => {});
    assert.equal(om.aqiTrend.length, 49);
    assert.equal(om.aqiFeedId, 'openmeteo-aqi-european');
    assert.match(urls[0], /forecast_days=4/);
    const waqi = { fetchAqi: true, aqiSource: 'waqi', aqicnToken: 'T', startTime: LOCAL_9AM, aqiFeedId: null };
    aq.fetchAqiInto(waqi, 1, 2, () => {});
    assert.deepEqual(waqi.aqiTrend, [42]);
    assert.equal(waqi.aqiFeedId, null);
  } finally {
    http.request = orig;
  }
});

test('each day-max metric keeps its own record, keyed by its own feed', () => {
  Object.keys(store).forEach((k) => delete store[k]);
  const p = provider({ id: 'dwd', uvFeedId: 'openmeteo',
    windTrend: new Array(48).fill(10), gustTrend: new Array(48).fill(20),
    uvTrend: new Array(48).fill(3), aqiTrend: [42], aqiFeedId: null });
  const records = dayPeaks.recall(p, 49.2, 7.0).records;
  assert.deepEqual(records.map((r) => r.storageKey),
    [KEYS.UV_DAY_RECORD_KEY, KEYS.WIND_DAY_RECORD_KEY, KEYS.GUST_DAY_RECORD_KEY],
    'no AQI forecast, no AQI record');
  records.forEach((r) => dayPeaks.save(r.record, r.storageKey));
  assert.equal(JSON.parse(store[KEYS.WIND_DAY_RECORD_KEY]).id, 'dwd');
  assert.equal(JSON.parse(store[KEYS.GUST_DAY_RECORD_KEY]).v[0], 20, 'whole km/h, as the payload rounds it');
  assert.equal(JSON.parse(store[KEYS.UV_DAY_RECORD_KEY]).id, 'openmeteo', 'UV keeps its feed');
  assert.equal(store[KEYS.AQI_DAY_RECORD_KEY], undefined);
});

test('only the day-max kinds a slot shows keep a record and widen their requests', () => {
  Object.keys(store).forEach((k) => delete store[k]);
  const forecastSeries = require('../src/pkjs/forecast-series.js');
  const s = { statusForecastLeft: 'wind', statusForecastMid: 'uv', statusForecastRight: 'aqi',
    windSlotDisplay: 'both', uvSlotDisplay: 'current', aqiSlotDisplay: 'max' };
  assert.deepEqual(forecastSeries.dayPeakCodes(s), ['wind', 'aqi'],
    'uv in Now mode and gust in no slot keep none');
  const p = provider({ id: 'dwd', windTrend: new Array(48).fill(10),
    gustTrend: new Array(48).fill(20), uvTrend: new Array(48).fill(3), dayPeakCodes: ['wind'] });
  assert.deepEqual(dayPeaks.recall(p, 49.2, 7.0).records.map((r) => r.storageKey), [KEYS.WIND_DAY_RECORD_KEY]);
  assert.match(aq.buildAqiUrl(1, 2, 'us', false), /forecast_days=2/);
  assert.match(aq.buildAqiUrl(1, 2, 'us', true), /forecast_days=4/);
});

test('a day-max pair that cannot fit the slot prints the current reading, never a cut-off peak', () => {
  // '152/»178' is 9 bytes: the 8-byte edge slot would cut it to '152/»17'.
  const aqi = { AQI_TREND: [152], AQI_DAY_PEAKS: [152, 178, null] };
  assert.equal(statusLines.formatValue('aqi', aqi, settings({ aqiSlotDisplay: 'both' })), '152');
  assert.equal(statusLines.formatValue('aqi', aqi, settings({ aqiSlotDisplay: 'both' }),
    'statusForecastMid', catalog.CAPS.MID_TEXT_MAX), '152/»178', 'the roomy mid slot keeps it');
  const gust = { GUST_TREND_UINT8: [105], GUST_DAY_PEAKS: [105, 120, null] };
  assert.equal(statusLines.formatValue('gust', gust, settings({ gustSlotDisplay: 'both' })), '105kph');
  // Every day-max text on an edge slot fits it whole.
  [9, 99, 105, 499].forEach((now) => [10, 120, 500].forEach((peak) => ['max', 'both'].forEach((mode) => {
    const text = statusLines.formatValue('aqi', { AQI_TREND: [now], AQI_DAY_PEAKS: [now, peak, null] },
      settings({ aqiSlotDisplay: mode }));
    assert.ok(Buffer.byteLength(text) <= catalog.CAPS.EDGE_TEXT_MAX, text);
  })));
});

test('the wind day record judges a dip in the user\'s unit, not in km/h', () => {
  Object.keys(store).forEach((k) => delete store[k]);
  const H = 3600;
  const start = new Date(2026, 6, 15, 12, 0, 0).getTime() / 1000;
  // Calm until 08:00, 09:00 40 km/h, 10:00 31, 11:00 30 (31 and 30 both print 19 mph);
  // now 12:00 31, the rest of the day's max.
  const midnight = start - 12 * H;
  dayPeaks.save(dayPeaks.merge(null, { id: 'dwd', lat: 49.2, lon: 7.0, scale: 1 },
    new Array(9).fill(5).concat([40, 31, 30]), midnight, midnight), KEYS.WIND_DAY_RECORD_KEY);
  const run = (windUnits) => {
    const p = provider({ id: 'dwd', startTime: start, windUnits, dayPeakCodes: ['wind'],
      windTrend: [31, 31, 20].concat(new Array(21).fill(10)) });
    return dayPeaks.recall(p, 49.2, 7.0).earlier.wind;
  };
  assert.equal(run('kph'), 0, 'in km/h 11:00\'s 30 < 31 is a dip: the 40 is another peak\'s');
  assert.equal(run('mph'), 40, 'in mph 30 and 31 both print 19: no dip, the 40 counts');
});

test('an hour a fetch did not source keeps the value an earlier fetch stored', () => {
  const src = { id: 'openmeteo', lat: 1, lon: 2 };
  const t0 = new Date(2026, 6, 15, 9, 0, 0).getTime() / 1000;
  const first = dayPeaks.merge(null, src, [5, 6, 7], t0, t0);
  const failed = dayPeaks.merge(first, src, [null, null], t0 + 3600, t0 + 3600);
  assert.deepEqual(failed.v, [50, 60, 70].slice(0, 1).concat([60, 70]));
});

test('wind and gust records keep to a few km; UV keeps its regional radius', () => {
  Object.keys(store).forEach((k) => delete store[k]);
  const p = provider({ id: 'dwd', windTrend: new Array(48).fill(10), uvTrend: new Array(48).fill(3),
    dayPeakCodes: ['uv', 'wind'] });
  dayPeaks.recall(p, 49.2, 7.0).records.forEach((r) => dayPeaks.save(r.record, r.storageKey));
  const q = provider({ id: 'dwd', startTime: LOCAL_9AM + 3600,
    windTrend: new Array(48).fill(10), uvTrend: new Array(48).fill(3), dayPeakCodes: ['uv', 'wind'] });
  const records = dayPeaks.recall(q, 49.5, 7.0).records;   // ~33 km north
  const byKey = {};
  records.forEach((r) => { byKey[r.storageKey] = r.record; });
  assert.equal(byKey[KEYS.UV_DAY_RECORD_KEY].t, LOCAL_9AM, 'UV: same region, the 09:00 hour kept');
  assert.equal(byKey[KEYS.WIND_DAY_RECORD_KEY].t, LOCAL_9AM + 3600, 'wind: another place, fresh');
});

test('getPayload skips the peaks of kinds no slot shows in Day max or Both', () => {
  const out = provider({ windTrend: new Array(48).fill(5), uvTrend: new Array(48).fill(3),
    dayPeakCodes: ['uv'] }).getPayload();
  assert.ok('UV_DAY_PEAKS' in out);
  assert.equal('WIND_DAY_PEAKS' in out, false);
  assert.equal('GUST_DAY_PEAKS' in out, false);
});

test('the catalog\'s day-max kinds and wire-units\' readers are the same list', () => {
  catalog.DAY_MAX_KINDS.forEach((k) => assert.ok(wireUnits.isDayMaxKind(k), k));
  assert.equal(wireUnits.dayMaxPayloadKeys().length, catalog.DAY_MAX_KINDS.length * 2);
});

test('a fractional wind is rounded once, the same in the record as on the slot', () => {
  // Wunderground's 9 mph = 14.484 km/h at 11:00 and now, nothing higher later today.
  Object.keys(store).forEach((k) => delete store[k]);
  const H = 3600;
  const start = new Date(2026, 6, 15, 12, 0, 0).getTime() / 1000;
  const midnight = start - 12 * H;
  dayPeaks.save(dayPeaks.merge(null, { id: 'wunderground', lat: 49.2, lon: 7.0, scale: 1 },
    new Array(11).fill(3).concat([14.484]), midnight, midnight), KEYS.WIND_DAY_RECORD_KEY);
  const p = provider({ id: 'wunderground', startTime: start, dayPeakCodes: ['wind'],
    windTrend: [14.484].concat(new Array(23).fill(3)) });
  const earlier = dayPeaks.recall(p, 49.2, 7.0).earlier;
  const payload = {};
  dayPeaks.addToPayload(payload, p, earlier);
  assert.equal(payload.WIND_DAY_PEAKS[0], 14);
  assert.equal(payload.WIND_DAY_PEAKS[2], 14, 'not 14.5 -> 15, one above the slot');
});

test('a tomorrow that never prints above 0 is no peak: never "»0"', () => {
  const p = { GUST_TREND_UINT8: [0], GUST_DAY_PEAKS: [0, 0, null] };
  assert.equal(statusLines.formatValue('gust', p, settings({ gustSlotDisplay: 'max', gustSlotUnit: false })), '0');
  assert.equal(statusLines.formatValue('gust', p, settings({ gustSlotDisplay: 'both', gustSlotUnit: false })), '0');
});

test('the unit gives way to the direction arrow on an edge slot', () => {
  const p = { WIND_TREND_UINT8: [12], WIND_DAY_PEAKS: [30, 45, null], WIND_DIR_TREND: [270] };
  assert.equal(statusLines.formatValue('wind', p,
    settings({ windSlotDisplay: 'both', windSlotDirection: true })), '12/30');
  assert.equal(statusLines.formatValue('wind', p,
    settings({ windSlotDisplay: 'both', windSlotDirection: false })), '12/30kph');
  // Day max alone draws no arrow, so the unit keeps its byte.
  assert.equal(statusLines.formatValue('wind', p,
    settings({ windSlotDisplay: 'max', windSlotDirection: true })), '30kph');
});

test('the dew line never draws above the air temperature', () => {
  const fs = require('../src/pkjs/forecast-series.js');
  const out = fs.applyForecastSeries({
    TEMP_RAW_TREND: [49, 48, 47, 46], TEMP_MIN: 46, TEMP_MAX: 49,
    PRECIP_TREND_UINT8: [0, 0, 0, 0], RAIN_TREND_UINT8: [0, 0, 0, 0],
    CURRENT_TEMP: 49, CITY: 'X', DEW_TREND: [49.4, 48.2, 47.3, 46.4]
  }, { secondaryLine: 'dew', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  assert.deepEqual(out.TEMP_TREND_UINT8, [250, 167, 83, 0], 'the band stays the temperature\'s');
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [250, 167, 83, 1], 'fog: dew on the temp curve, floored off byte 0');
});

test('wind peaks stay a byte, like the trend they are compared with', () => {
  const wind = new Array(24).fill(270);
  const payload = {};
  dayPeaks.addToPayload(payload, provider({ windTrend: wind, dayPeakCodes: ['wind'] }), {});
  assert.equal(payload.WIND_DAY_PEAKS[0], 255);
});

test('a trailing next-day mark goes after the unit', () => {
  const p = { WIND_TREND_UINT8: [12], WIND_DAY_PEAKS: [12, 45, null] };
  const f = (extra) => statusLines.formatValue('wind', p,
    settings(Object.assign({ windSlotNextDayMark: 'star' }, extra)));
  assert.equal(f({ windSlotDisplay: 'max' }), '45kph*');
  assert.equal(f({ windSlotDisplay: 'both', windUnits: 'mph' }), '7/28mph*');
  assert.equal(f({ windSlotDisplay: 'both', windSlotOrder: 'max' }), '45*/12', 'mid-text: no room for the unit');
  assert.equal(f({ windSlotDisplay: 'max', windSlotUnit: false }), '45*');
  assert.equal(statusLines.formatValue('wind', p, settings({ windSlotDisplay: 'max' })), '»45kph',
    'a leading mark is untouched');
});
