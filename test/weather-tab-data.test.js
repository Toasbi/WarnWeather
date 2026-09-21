// test/weather-tab-data.test.js — the Weather tab's provider parsers against
// compact fixture responses: unit conversion at the adapter boundary
// (m/s→km/h, pop→%), icon normalization, and the daily strip's sourcing
// (provider daily array vs client-side aggregation).
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../src/pkjs/settings/weather-tab-data.js');

const NOON = new Date(2026, 8, 20, 12, 0, 0).getTime();
const DAY0 = new Date(2026, 8, 20, 0, 0, 0).getTime();

test('Open-Meteo parser: hourly series + provider daily, unixtime seconds → ms', () => {
  const hours = [NOON / 1000, NOON / 1000 + 3600];
  const fixture = {
    utc_offset_seconds: 7200,
    hourly: {
      time: hours,
      temperature_2m: [18.2, 17.9],
      precipitation: [0.4, 0],
      precipitation_probability: [55, 20],
      wind_speed_10m: [12, 14],
      wind_gusts_10m: [24, 28],
      wind_direction_10m: [225, 230],
      relative_humidity_2m: [62, 65],
      dew_point_2m: [10.4, 10.6],
      pressure_msl: [1015.2, 1015.0],
      weather_code: [61, 3]
    },
    daily: {
      time: [DAY0 / 1000 - 86400, DAY0 / 1000, DAY0 / 1000 + 86400],
      weather_code: [3, 61, 0],
      temperature_2m_max: [20, 21, 19],
      temperature_2m_min: [12, 13, 11],
      precipitation_sum: [0, 5, 0],
      precipitation_probability_max: [10, 80, 5],
      sunshine_duration: [3600, 7200, 28800]
    }
  };
  const out = data.parsers.openmeteo(fixture, NOON);
  assert.equal(out.hourly.time[0], NOON);
  assert.equal(out.hourly.temp[0], 18.2);
  assert.equal(out.hourly.prob[1], 20);
  assert.equal(out.hourly.icon[0], 'rain');
  assert.equal(out.hourly.icon[1], 'cloudy');
  assert.equal(out.daily.length, 2, 'yesterday is dropped');
  assert.equal(out.daily[0].tmax, 21);
  assert.equal(out.daily[0].sunshineH, 2);
  assert.equal(out.daily[1].icon, 'clear');
  assert.equal(out.utcOffsetSec, 7200, 'the location clock rides the normalized result');
  assert.equal(data.parsers.openmeteo({ hourly: { time: [] } }, NOON), null);
});

test('Brightsky parser: DWD units pass through, daily aggregates client-side', () => {
  const rows = [];
  for (let h = 0; h < 30; h += 1) {
    rows.push({
      timestamp: new Date(DAY0 + h * 3600000).toISOString(),
      temperature: 10 + h % 24,
      precipitation: h === 15 ? 1.2 : 0,
      precipitation_probability: h === 15 ? 70 : null,
      wind_speed: 12,
      wind_gust_speed: 30,
      wind_direction: 200,
      relative_humidity: 60,
      dew_point: 9,
      pressure_msl: 1013,
      sunshine: h >= 9 && h < 17 ? 45 : 0,
      icon: h === 15 ? 'rain' : 'partly-cloudy-day'
    });
  }
  const out = data.parsers.dwd({ weather: rows }, NOON);
  assert.equal(out.hourly.wind[0], 12, 'Brightsky wind is already km/h');
  assert.equal(out.hourly.rh[0], 60);
  assert.equal(out.hourly.icon[15], 'rain');
  assert.ok(out.daily.length >= 1);
  assert.equal(out.daily[0].icon, 'rain');
  assert.equal(out.daily[0].sunshineH, 6);
  assert.equal(data.parsers.dwd({ weather: [] }, NOON), null);

  // Brightsky answers in the timezone we ASKED in — it adopts the `date`
  // parameter's offset, and only when that offset is not UTC. We send a
  // Z-suffixed date, so a UTC suffix coming back is our own request read
  // aloud: it says nothing about where the location is, and reading a
  // location clock off it put the whole DWD timeline on UTC.
  assert.equal(out.utcOffsetSec, null,
    'a UTC echo is not a location clock — fall back to the phone\'s offset');
  // A non-UTC suffix could only come from a zone we named ourselves, so it
  // is real and is taken.
  const berlin = data.parsers.dwd({
    weather: rows.map((r) => ({ ...r, timestamp: r.timestamp.replace('Z', '+02:00') }))
  }, NOON);
  assert.equal(berlin.utcOffsetSec, 7200, 'an offset we asked for is the location clock');
});

test('OWM parser: m/s → km/h, pop 0..1 → %, its own daily array', () => {
  const fixture = {
    hourly: [{
      dt: NOON / 1000,
      temp: 18, humidity: 60, dew_point: 10, pressure: 1015,
      wind_speed: 5, wind_gust: 10, wind_deg: 180,
      pop: 0.4, rain: { '1h': 0.6 }, weather: [{ id: 500 }]
    }],
    daily: [{
      dt: NOON / 1000,
      temp: { min: 12, max: 21 }, pop: 0.8, rain: 5.1, weather: [{ id: 802 }]
    }]
  };
  const out = data.parsers.openweathermap(fixture, NOON);
  assert.equal(out.hourly.wind[0], 18, '5 m/s = 18 km/h');
  assert.equal(out.hourly.gust[0], 36);
  assert.equal(out.hourly.prob[0], 40);
  assert.equal(out.hourly.rain[0], 0.6);
  assert.equal(out.hourly.icon[0], 'rain');
  assert.equal(out.daily[0].probMax, 80);
  assert.equal(out.daily[0].icon, 'partly');
  assert.equal(out.daily[0].sunshineH, null, 'OWM has no sunshine duration');
});

test('OWM 3-hourly forecast parser + tail merge extend the timeline coarsely', () => {
  const tail = {
    city: { timezone: 3600 },
    list: [
      { // overlaps the hourly range — must NOT be merged
        dt: NOON / 1000,
        main: { temp: 17, humidity: 58, pressure: 1014 },
        wind: { speed: 4, gust: 8, deg: 190 },
        pop: 0.2, rain: { '3h': 0.9 }, weather: [{ id: 500 }]
      },
      { // past the hourly range — merged
        dt: NOON / 1000 + 3 * 3600,
        main: { temp: 16, humidity: 62, pressure: 1013 },
        wind: { speed: 6, gust: 12, deg: 210 },
        pop: 0.5, weather: [{ id: 802 }]
      }
    ]
  };
  const parsed = data.parsers.owmForecast3h(tail);
  assert.equal(parsed.hourly.rain[0], 0.3, "rain['3h'] totals become mm/h rates");
  assert.equal(parsed.hourly.dew[0], null, '2.5/forecast has no dew point');
  assert.equal(parsed.utcOffsetSec, 3600);
  assert.equal(data.parsers.owmForecast3h({ list: [] }), null);

  const base = data.parsers.openweathermap({
    hourly: [{
      dt: NOON / 1000,
      temp: 18, humidity: 60, dew_point: 10, pressure: 1015,
      wind_speed: 5, wind_gust: 10, wind_deg: 180,
      pop: 0.4, rain: { '1h': 0.6 }, weather: [{ id: 500 }]
    }],
    daily: []
  }, NOON);
  data.mergeOwmTail(base, parsed);
  assert.equal(base.hourly.time.length, 2, 'only rows past the last hourly stamp merge');
  assert.equal(base.hourly.temp[1], 16);
  assert.equal(base.hourly.temp[0], 18, 'One Call stays authoritative where they overlap');
  assert.equal(base.utcOffsetSec, 3600, 'the tail offset fills in when One Call has none');
});

test('tomorrow.io parser: m/s → km/h, weatherCode mapping, aggregated daily', () => {
  const intervals = [];
  for (let h = 0; h < 26; h += 1) {
    intervals.push({
      startTime: new Date(DAY0 + h * 3600000).toISOString(),
      values: {
        temperature: 15 + (h % 24) / 2,
        precipitationIntensity: 0,
        precipitationProbability: 15,
        windSpeed: 4, windGust: 8, windDirection: 300,
        humidity: 55, dewPoint: 8, pressureSeaLevel: 1011,
        weatherCode: 1101
      }
    });
  }
  const out = data.parsers.tomorrowio({ data: { timelines: [{ intervals: intervals }] } }, NOON);
  assert.equal(Math.round(out.hourly.wind[0] * 10) / 10, 14.4, '4 m/s = 14.4 km/h');
  assert.equal(out.hourly.icon[0], 'partly');
  assert.ok(out.daily.length >= 1);
  assert.equal(out.daily[0].icon, 'partly');
  assert.equal(data.parsers.tomorrowio({ data: { timelines: [] } }, NOON), null);
});

test('getGpsFix: no geolocation API answers synchronously; a stubbed one maps coords and errors', () => {
  // Node's navigator has no geolocation → the unavailable path, same tick.
  let got = null;
  data.getGpsFix((fix, err) => { got = [fix, err]; });
  assert.deepEqual(got, [null, 'unavailable']);

  // A stubbed webview API: success maps to {lat, lon}, permission code 1 → 'denied'.
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(ok, fail, opts) {
          assert.ok(opts.timeout > 0 && opts.maximumAge >= 0, 'bounded request');
          globalThis.__gpsOk = ok;
          globalThis.__gpsFail = fail;
        }
      }
    }
  });
  try {
    got = null;
    data.getGpsFix((fix, err) => { got = [fix, err]; });
    globalThis.__gpsOk({ coords: { latitude: 53.55, longitude: 9.99 } });
    assert.deepEqual(got, [{ lat: 53.55, lon: 9.99 }, null]);
    globalThis.__gpsFail({ code: 1 });   // late duplicate must not re-fire

    got = null;
    data.getGpsFix((fix, err) => { got = [fix, err]; });
    globalThis.__gpsFail({ code: 1 });
    assert.deepEqual(got, [null, 'denied']);

    got = null;
    data.getGpsFix((fix, err) => { got = [fix, err]; });
    globalThis.__gpsOk({ coords: { latitude: 'x', longitude: 9 } });
    assert.deepEqual(got, [null, 'empty'], 'non-numeric coords never reach callers');
  } finally {
    delete globalThis.__gpsOk;
    delete globalThis.__gpsFail;
    if (desc) { Object.defineProperty(globalThis, 'navigator', desc); }
  }
});

test('reverseGeocode: ArcGIS lon,lat order and the District > City > Region name pick', () => {
  const seen = [];
  class FakeXhr {
    open(method, url) { seen.push(url); this.url = url; }
    send() {
      this.status = 200;
      this.responseText = JSON.stringify({ address: { City: 'Hamburg', Region: 'HH' } });
      this.onload();
    }
  }
  const realXhr = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr;
  try {
    let got = null;
    data.reverseGeocode(53.55, 9.99, (name, err) => { got = [name, err]; });
    assert.deepEqual(got, ['Hamburg', null]);
    assert.ok(seen[0].indexOf('location=9.99,53.55') !== -1, 'ArcGIS wants lon,lat');
    assert.ok(seen[0].indexOf('geocode.arcgis.com') !== -1);
  } finally {
    if (realXhr === undefined) { delete globalThis.XMLHttpRequest; } else { globalThis.XMLHttpRequest = realXhr; }
  }
});

test('Brightsky provenance: each hour says whether a station measured it', () => {
  const H = Date.UTC(2026, 8, 21, 14, 0);
  const iso = (ms) => new Date(ms).toISOString().replace('Z', '+00:00');
  const rows = [];
  for (let i = -6; i <= 6; i += 1) {
    rows.push({
      timestamp: iso(H + i * 3600000),
      // The observation network lags: the last two hours before now are
      // already MOSMIX even though they are in the past.
      source_id: i <= -3 ? 11 : 99,
      temperature: 12, precipitation: i === -5 ? 0.7 : 0,
      precipitation_probability: i <= -3 ? null : 30,
      wind_speed: 10, wind_gust_speed: 18, wind_direction: 200,
      relative_humidity: 60, dew_point: 8, pressure_msl: 1013,
      icon: 'partly-cloudy-day', sunshine: 20
    });
  }
  const sources = [
    { id: 11, observation_type: 'historical' },
    { id: 99, observation_type: 'forecast' }
  ];
  const out = data.parsers.dwd({ weather: rows, sources }, H);
  assert.deepEqual(out.hourly.measured.slice(0, 4), [true, true, true, true],
    'rows from a station source are measurements');
  assert.deepEqual(out.hourly.measured.slice(4), [false, false, false, false, false, false, false, false, false],
    'rows from the MOSMIX source are not — including the ones already in the past');
  // These rows carry no fallback map at all, which is the ordinary case:
  // a station row that needed nothing filled in is measured outright.
  assert.deepEqual(out.hourly.measuredAll.slice(0, 4), [true, true, true, true]);
  assert.deepEqual(out.hourly.measuredAll.slice(4), [false, false, false, false, false, false, false, false, false]);

  // 'current' is a station reading too; anything else is not.
  const kinds = ['historical', 'current', 'synop', 'forecast', 'nonsense'];
  kinds.forEach((kind, n) => {
    const one = data.parsers.dwd({
      weather: [{ timestamp: iso(H), source_id: 7, temperature: 1 }],
      sources: [{ id: 7, observation_type: kind }]
    }, H);
    assert.equal(one.hourly.measured[0], n < 3, kind + ' → measured=' + (n < 3));
  });

  // Brightsky fills a missing field on an observation row from ANOTHER
  // source and records which in fallback_source_ids. A row that is an
  // observation overall can therefore carry a MOSMIX precipitation — and
  // precipitation is the field the page draws as history.
  const leaked = data.parsers.dwd({
    weather: [
      { timestamp: iso(H - 3600000), source_id: 11, temperature: 9, precipitation: 0.4,
        fallback_source_ids: { precipitation: 99 } },
      { timestamp: iso(H - 7200000), source_id: 11, temperature: 9, precipitation: 0.4,
        fallback_source_ids: { relative_humidity: 99 } },
      { timestamp: iso(H - 10800000), source_id: 11, temperature: 9, precipitation: 0.4,
        fallback_source_ids: {} }
    ],
    sources
  }, H);
  assert.deepEqual(leaked.hourly.measured, [false, true, true],
    'a rain value borrowed from the forecast source is not a measurement, '
    + 'while a borrowed humidity says nothing about the rain');
  // The caption stands over EVERY panel, so it takes the whole drawn row
  // or nothing: a borrowed humidity is a modelled humidity line, and the
  // word cannot span it even though the rain beneath was read.
  assert.deepEqual(leaked.hourly.measuredAll, [false, false, true],
    'the row-level flag fails on any drawn field that fell back to MOSMIX');

  // The two flags answer two questions and must not be conflated. An
  // observation row whose TEMPERATURE came from MOSMIX still read the rain,
  // so the rain bar stands — but the temperature line above it is modelled,
  // so the caption must not call that hour Measured.
  const mixed = data.parsers.dwd({
    weather: [{ timestamp: iso(H - 3600000), source_id: 11, temperature: 9, precipitation: 0.4,
      fallback_source_ids: { temperature: 99 } }],
    sources
  }, H);
  assert.equal(mixed.hourly.measured[0], true, 'the rain itself was read');
  assert.equal(mixed.hourly.measuredAll[0], false, 'but not everything drawn above it');

  // Fields Brightsky never cross-fills cannot drag the flag down: MOSMIX
  // carries no relative_humidity and a station carries no probability, so
  // neither appears in a fallback map pointing the wrong way. A fallback
  // key the page draws nothing from is likewise none of the caption's
  // business.
  const unrelated = data.parsers.dwd({
    weather: [{ timestamp: iso(H - 3600000), source_id: 11, temperature: 9, precipitation: 0.4,
      fallback_source_ids: { wind_gust_direction: 99, cloud_cover: 99 } }],
    sources
  }, H);
  assert.equal(unrelated.hourly.measuredAll[0], true,
    'a borrowed field the panels never plot leaves the word intact');

  // And a MOSMIX row is never measured whatever its fallbacks say.
  const mosmix = data.parsers.dwd({
    weather: [{ timestamp: iso(H - 3600000), source_id: 99, temperature: 9, precipitation: 0.4,
      fallback_source_ids: { temperature: 11 } }],
    sources
  }, H);
  assert.equal(mosmix.hourly.measuredAll[0], false, 'the row itself is model output');

  // A response with no sources block at all claims nothing.
  const bare = data.parsers.dwd({ weather: rows }, H);
  assert.equal(bare.hourly.measured.every((m) => m === false), true,
    'no sources block → nothing is claimed as measured');

  // And every other provider leaves the array empty, so the grid reads null
  // and the view reads "not measured".
  const om = data.parsers.openmeteo({
    hourly: { time: [H / 1000], temperature_2m: [12], precipitation: [0] },
    utc_offset_seconds: 0
  }, H);
  assert.deepEqual(om.hourly.measured, [], 'Open-Meteo measures nothing: past_days is the past forecast');
});
