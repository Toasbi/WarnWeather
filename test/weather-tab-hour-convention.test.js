// test/weather-tab-hour-convention.test.js — every hour of the Weather tab is
// the hour STARTING at its stamp, as every slot of the watch is: a tap on
// 14:00 reads the rain still to fall between 14:00 and 15:00, and the watch's
// 14:00 bar shows the same figure from the same provider. Open-Meteo and DWD
// stamp rain, chance and gust at the END of their hour, so their parsers
// re-stamp those fields. tomorrow.io and OWM One Call report an instant at
// the stamp, held for the hour starting there, and must not be touched, or
// they land an hour early.
const test = require('node:test');
const assert = require('node:assert/strict');
// The DWD adapter keeps the request function it finds at load: stub it first.
const WeatherProvider = require('../src/pkjs/weather/provider.js');
let responder = null;
WeatherProvider.request = function (url, type, onSuccess, onError) { responder(url, onSuccess, onError); };
const DwdProvider = require('../src/pkjs/weather/dwd.js');
const charts = require('../src/pkjs/settings/weather-tab-charts.js');
const model = require('../src/pkjs/settings/weather-tab-model.js');
const data = require('../src/pkjs/settings/weather-tab-data.js');
const openmeteo = require('../src/pkjs/weather/openmeteo.js');

const H = 3600000;
const DAY0 = new Date(2026, 8, 20, 0, 0, 0).getTime();
const NOON = DAY0 + 12 * H;

test('startHourFields pairs each hour with the stamp an hour later, by time', () => {
  const hourly = {
    // 03:00 is missing: the provider skipped it.
    time: [0, H, 2 * H, 4 * H, 5 * H],
    rain: [1, 2, 3, 5, 6],
    temp: [10, 11, 12, 14, 15],
    icon: ['a', 'b', 'c', 'e', 'f'],
    measured: [true, false, true, true, true],
    short: [1]
  };
  const from = model.startHourFields(hourly, { rain: null, measured: false });
  assert.deepEqual(hourly.time, [0, H, 2 * H, 3 * H, 4 * H, 5 * H],
    'the skipped 03:00 gets a row, or 04:00\'s value (03:00-04:00) had nowhere to land');
  assert.deepEqual(from, [1, 2, -1, 3, 4, -1], 'the index each row took its values from');
  assert.deepEqual(hourly.rain, [2, 3, null, 5, 6, null],
    'row 02:00 has no 03:00 partner, and an index shift would have handed it 04:00\'s');
  assert.deepEqual(hourly.measured, [false, true, false, true, true, false], 'each key takes its own fill');
  assert.deepEqual(hourly.temp, [10, 11, 12, 13, 14, 15],
    'series it is not given stay on their stamp; the added row interpolates, as the grid would');
  assert.deepEqual(hourly.icon, ['a', 'b', 'c', 'c', 'e', 'f'], 'a stepped series takes the nearest');
  assert.deepEqual(hourly.short, [1], 'an array that is not per-row is left alone');

  // Rows closer than an hour: an added row would land before the row it
  // follows, so none is added and the rows stay in time order.
  const dense = { time: [0, H / 2, H * 5 / 4], rain: [1, 2, 3] };
  model.startHourFields(dense, { rain: null });
  assert.deepEqual(dense.time, [0, H / 2, H * 5 / 4]);
});

test('a skipped DWD record: the tab draws each hour the watch does, and loses none', () => {
  // Brightsky skips the 16:00 record. The 17:00 one holds 16:00-17:00's
  // shower, which the watch's 16:00 slot shows (dwd.js slotRecords).
  const records = [];
  for (let h = 14; h <= 40; h += 1) {
    if (h === 16) { continue; }
    const wet = h === 17;
    records.push({ timestamp: new Date(DAY0 + h * H).toISOString(), temperature: 15 + (h === 17 ? 2 : 0),
      wind_speed: 10, pressure_msl: 1013, relative_humidity: 70, dew_point: 9,
      precipitation: wet ? 7 : (h === 18 ? 1 : 0), precipitation_probability: wet ? 60 : 5,
      wind_gust_speed: wet ? 80 : 20 });
  }
  const NOW = DAY0 + 14 * H + 10 * 60000;
  const realNow = Date.now;
  const watch = new DwdProvider();
  responder = function (url, onSuccess) {
    onSuccess(JSON.stringify(url.indexOf('/current_weather') !== -1
      ? { weather: { temperature: 15 } } : { weather: records }));
  };
  try {
    Date.now = () => NOW;
    watch.withProviderData(0, 0, false, () => {}, (f) => { throw new Error(JSON.stringify(f)); });
  } finally {
    Date.now = realNow;
  }
  assert.equal(watch.startTime * 1000, DAY0 + 14 * H);
  assert.equal(watch.rainTrend[2], 7, 'precondition: the watch\'s 16:00 slot holds the shower');

  const tab = data.parsers.dwd({ weather: records }, NOW);
  const view = charts.prepareView(tab, NOW);
  for (let s = 0; s < 6; s += 1) {
    const g = view.times.indexOf(DAY0 + (14 + s) * H);
    const hour = (14 + s) + ':00';
    assert.equal(view.rain[g] || 0, watch.rainTrend[s], hour + ' rain');
    assert.equal(view.gust[g] || 0, watch.gustTrend[s], hour + ' gust');
    assert.equal((view.prob[g] || 0) / 100, watch.precipTrend[s], hour + ' chance');
  }
  const i16 = tab.hourly.time.indexOf(DAY0 + 16 * H);
  assert.equal(tab.hourly.temp[i16], 16, 'the added hour\'s temperature is the interpolated one');
  assert.equal(tab.daily[0].rainMm, 8, 'the day tile counts the shower');
});

test('the tab and the watch read the same Open-Meteo hour for 14:00', () => {
  // One response, as both callers would receive it: a 2 mm shower with a 70%
  // chance and a 70 km/h gust, stamped 15:00 because Open-Meteo reports the
  // PRECEDING hour — it fell between 14:00 and 15:00.
  const BASE = Math.floor(DAY0 / 1000);
  const hourly = { time: [], temperature_2m: [], precipitation: [], precipitation_probability: [],
    windspeed_10m: [], windgusts_10m: [], wind_speed_10m: [], wind_gusts_10m: [] };
  for (let i = 0; i < 48; i += 1) {
    const shower = i === 15;
    hourly.time.push(BASE + i * 3600);
    hourly.temperature_2m.push(15);
    hourly.precipitation.push(shower ? 2 : 0);
    hourly.precipitation_probability.push(shower ? 70 : 5);
    hourly.windspeed_10m.push(10);
    hourly.wind_speed_10m.push(10);
    hourly.windgusts_10m.push(shower ? 70 : 20);
    hourly.wind_gusts_10m.push(shower ? 70 : 20);
  }
  const json = { current: { temperature_2m: 15 }, hourly: hourly, utc_offset_seconds: 0 };

  // The watch at 14:10: slot 0 is the hour starting at 14:00.
  const watch = openmeteo.mapResponse(json, BASE + 14 * 3600 + 600);
  assert.equal(watch.startTime, BASE + 14 * 3600);
  assert.equal(watch.rainTrend[0], 2, 'precondition: the watch puts the shower in its 14:00 slot');

  // The tab's row for 14:00 carries the same hour.
  const tab = data.parsers.openmeteo(json, DAY0 + 14 * H);
  const i14 = tab.hourly.time.indexOf(DAY0 + 14 * H);
  assert.equal(tab.hourly.rain[i14], watch.rainTrend[0], 'the same rain');
  assert.equal(tab.hourly.prob[i14] / 100, watch.precipTrend[0], 'the same chance');
  assert.equal(tab.hourly.gust[i14], watch.gustTrend[0], 'the same gust');
  assert.equal(tab.hourly.rain[i14 + 1], 0, 'and 15:00 is dry, as the watch\'s next slot is');
  assert.equal(tab.hourly.rain[i14 + 1], watch.rainTrend[1]);
  assert.equal(tab.hourly.temp[i14], watch.tempTrend[0], 'instants stay on their own stamp');
});

test('tomorrow.io and OWM One Call report the hour starting at the stamp: no re-stamping', () => {
  const intervals = [];
  for (let h = 0; h < 26; h += 1) {
    intervals.push({ startTime: new Date(DAY0 + h * H).toISOString(),
      values: { temperature: 15, precipitationIntensity: h === 14 ? 2 : 0,
        precipitationProbability: h === 14 ? 70 : 5, windSpeed: 3, windGust: h === 14 ? 20 : 5 } });
  }
  const tio = data.parsers.tomorrowio({ data: { timelines: [{ intervals: intervals }] } }, NOON);
  const t14 = tio.hourly.time.indexOf(DAY0 + 14 * H);
  assert.equal(tio.hourly.rain[t14], 2, 'tomorrow.io\'s 14:00 interval is 14:00-15:00');
  assert.equal(tio.hourly.prob[t14], 70);
  assert.equal(tio.hourly.gust[t14], 72);

  const rows = [];
  for (let h = 0; h < 26; h += 1) {
    rows.push({ dt: (DAY0 + h * H) / 1000, temp: 15, wind_speed: 3, wind_gust: h === 14 ? 20 : 5,
      pop: h === 14 ? 0.7 : 0.05, rain: h === 14 ? { '1h': 2 } : undefined });
  }
  const owm = data.parsers.openweathermap({ hourly: rows, daily: [] }, NOON);
  const o14 = owm.hourly.time.indexOf(DAY0 + 14 * H);
  assert.equal(owm.hourly.rain[o14], 2, 'OWM\'s 14:00 hour is the one the watch reads there too');
  assert.equal(owm.hourly.prob[o14], 70);
  assert.equal(owm.hourly.gust[o14], 72);
});

test('a DWD day tile totals its own calendar day, 00:00 to 24:00', () => {
  // Stamped 00:00 today: yesterday's last hour. Stamped 00:00 tomorrow:
  // today's last hour. Brightsky stamps both at the hour's END.
  const rows = [];
  for (let h = -2; h < 50; h += 1) {
    rows.push({ timestamp: new Date(DAY0 + h * H).toISOString(), temperature: 12,
      precipitation: h === 0 ? 5 : (h === 24 ? 3 : 0), sunshine: h === 24 ? 60 : 0 });
  }
  const out = data.parsers.dwd({ weather: rows }, NOON);
  assert.equal(out.daily[0].rainMm, 3, 'today holds 23:00-24:00\'s 3 mm, not yesterday evening\'s 5');
  assert.equal(out.daily[0].sunshineH, 1, 'and that hour\'s sunshine');
  assert.equal(out.daily[1].rainMm, 0, 'tomorrow does not');
  const at23 = out.hourly.time.indexOf(DAY0 + 23 * H);
  assert.equal(out.hourly.rain[at23], 3, 'the bar for 23:00 carries it');
});

test('an Open-Meteo day tile totals the same bars it sits over', () => {
  // The API's own daily sum runs over the 24 values STAMPED in the day, which
  // for preceding-hour values is 23:00 the evening before to 23:00. The tile
  // is rebuilt from the re-stamped hours, so it adds up the day's own bars.
  // The location keeps a clock 5 h off the phone's: the days are ITS days.
  const phoneOff = -new Date(DAY0).getTimezoneOffset() * 60;
  const off = phoneOff >= 0 ? phoneOff - 5 * 3600 : phoneOff + 5 * 3600;
  const LOC0 = model.localDayStart(NOON, off);
  const BASE = Math.floor(LOC0 / 1000);
  const hourly = { time: [], temperature_2m: [], precipitation: [], precipitation_probability: [] };
  for (let i = -24; i < 72; i += 1) {
    // Day 2 carries no hourly rain at all: its tile falls back on the API's.
    const unsourced = i > 48;
    hourly.time.push(BASE + i * 3600);
    hourly.temperature_2m.push(12);
    hourly.precipitation.push(unsourced ? null : (i === 0 ? 5 : (i === 24 ? 3 : 0)));
    hourly.precipitation_probability.push(unsourced ? null : (i === 0 ? 90 : (i === 24 ? 40 : 10)));
  }
  // Day 1's stamp sits an hour off its midnight, as a DST change leaves it
  // against the fixed offset the hours are bucketed with.
  const daily = { time: [BASE, BASE + 86400 + 3600, BASE + 2 * 86400],
    temperature_2m_max: [15, 15, 15], temperature_2m_min: [9, 9, 9],
    precipitation_sum: [5, 99, 7], precipitation_probability_max: [90, 99, 15],
    sunshine_duration: [0, 0, 0], weather_code: [61, 61, 0] };
  const out = data.parsers.openmeteo({ hourly: hourly, daily: daily, utc_offset_seconds: off }, NOON);
  assert.equal(out.daily[0].rainMm, 3, 'today: the 3 mm that fell 23:00-24:00, not last night\'s 5');
  assert.equal(out.daily[0].probMax, 40, 'and the chance of today\'s hours only');
  assert.equal(out.daily[1].rainMm, 0, 'tomorrow keeps nothing of today\'s, an hour of DST slack or not');
  assert.equal(out.daily[1].probMax, 10);
  assert.equal(out.daily[2].rainMm, 7, 'a day with no hourly rain shows the API\'s own sum');
  assert.equal(out.daily[2].probMax, 15);
  assert.equal(out.daily[0].tmax, 15, 'the rest of the tile is still the API\'s own');
});
