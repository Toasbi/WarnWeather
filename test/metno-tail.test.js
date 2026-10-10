// test/metno-tail.test.js
// Met.no on emery's long span (forecast-span.js: 68 hours sent). /complete
// is hourly only to a fixed model time (57 to 63 hours from the anchor in recorded
// responses), then 6-hourly; hourlyTail makes that tail hourly so the long payload reaches
// 68 and the watch keeps its 3 px pitch. Every other window maps the response as 1fb8bb9
// did (test/metno-gate.golden.json).
const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
let responder;
WeatherProvider.request = function(url, type, onSuccess, onError, headers) {
  responder(url, type, onSuccess, onError, headers);
};
const metno = require('../src/pkjs/weather/metno.js');
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');
const { MAX_FORECAST_HOURS, PEAK_HOURS } = require('../src/pkjs/weather/hourly-window.js');
const { HOUR, metnoFeed } = require('./helpers/metno-feed.js');
const golden = require('./metno-gate.golden.json');

const NOW = golden.now;                       // some wall-clock "now"
const HOUR0 = Math.floor(NOW / HOUR) * HOUR;  // floored current hour: bucket 0
const LONG = MAX_FORECAST_HOURS;              // 68

const epochOf = (b) => Date.parse(b.time) / 1000;
const details = (b) => b.data.instant.details;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

/**
 * Run `fn` with Date.now() pinned (withProviderData anchors on it).
 * @param {number} epochSeconds Fixed "now" in epoch seconds.
 * @param {Function} fn Body.
 * @returns {void}
 */
function withMockedNow(epochSeconds, fn) {
  const realNow = Date.now;
  Date.now = function() { return epochSeconds * 1000; };
  try { fn(); } finally { Date.now = realNow; }
}

/**
 * Fetch `body` through MetnoProvider with the given span.
 * @param {Object} body A locationforecast body.
 * @param {number} forecastHours fetch-options forecastHours.
 * @returns {Object} The provider after adoptMapped.
 */
function fetched(body, forecastHours) {
  responder = function(url, type, onSuccess) { onSuccess(JSON.stringify(body)); };
  const p = new metno.MetnoProvider();
  p.options = fetchOptions.defaults({ forecastHours: forecastHours, fetchUv: true });
  withMockedNow(NOW, () => {
    p.withProviderData(59.91, 10.75, true, () => {}, () => { throw new Error('must not fail'); });
  });
  return p;
}

const GRAPH = ['tempTrend', 'precipTrend', 'rainTrend', 'pressureTrend', 'cloudTrend', 'feelsTrend',
  'dewTrend', 'windDirTrend', 'windTrend', 'gustTrend', 'uvTrend'];

test('long span: an hourly feed of 69+ hours maps 68 hours in every series, the day-max ones included', () => {
  const body = metnoFeed({ start: HOUR0, hourly: 70, sixHourly: 0 });
  const mapped = metno.mapResponse(body, NOW, LONG);
  GRAPH.forEach((k) => assert.equal(mapped[k].length, LONG, k));
  const p = fetched(body, LONG);
  assert.equal(p.uvTrend.length, LONG, 'UV reads on to the window, not PEAK_HOURS (49)');
  assert.equal(p.getPayload().NUM_ENTRIES, LONG);
});

test('long span: a 57-hour run then 6-hourly buckets reaches 68 hours (payload 68, not 57 or 49)', () => {
  const body = metnoFeed({ start: HOUR0, hourly: 57 });
  const mapped = metno.mapResponse(body, NOW, LONG);
  GRAPH.forEach((k) => assert.equal(mapped[k].length, LONG, k));
  assert.equal(fetched(body, LONG).getPayload().NUM_ENTRIES, LONG);
});

test('hourlyTail: hourly to anchor + hours + 1, the hourly run kept as is', () => {
  const body = metnoFeed({ start: HOUR0, hourly: 57 });
  const ts = body.properties.timeseries;
  const out = metno.hourlyTail(ts, 0, LONG);
  assert.equal(out.length, LONG + 1, 'the slots plus the bucket followingGust reads');
  out.forEach((b, i) => assert.equal(epochOf(b), HOUR0 + i * HOUR, `bucket ${i} is hour ${i}`));
  for (let i = 0; i < 56; i += 1) { assert.equal(out[i], ts[i], `bucket ${i} is the response's own`); }
  // An anchor past 0 keeps the indices: out[anchor + i] is hour i from the anchor.
  const late = metno.hourlyTail(ts, 3, LONG);
  assert.equal(late.length, 3 + LONG + 1);
  assert.equal(late[3], ts[3]);
  assert.equal(epochOf(late[3 + LONG]), HOUR0 + (3 + LONG) * HOUR);
});

test('hourlyTail: instants run linearly between the real buckets, the bearing held', () => {
  const ts = metnoFeed({ start: HOUR0, hourly: 57 }).properties.timeseries;
  const out = metno.hourlyTail(ts, 0, LONG);
  const real = new Map(ts.map((b) => [epochOf(b), b]));
  let synthesized = 0;
  out.forEach((b, i) => {
    const t = epochOf(b);
    if (real.has(t)) { return; }
    synthesized += 1;
    const before = ts.filter((r) => epochOf(r) < t).pop();
    const after = ts.find((r) => epochOf(r) > t);
    const f = (t - epochOf(before)) / (epochOf(after) - epochOf(before));
    ['air_temperature', 'wind_speed', 'dew_point_temperature', 'relative_humidity',
      'air_pressure_at_sea_level', 'cloud_area_fraction', 'cloud_area_fraction_low'].forEach((k) =>
      close(details(b)[k], details(before)[k] + f * (details(after)[k] - details(before)[k]), `${k} at ${i}`));
    assert.equal(details(b).wind_from_direction, details(before).wind_from_direction, `bearing at ${i}`);
  });
  assert.ok(synthesized >= 6, `${synthesized} hours synthesized`);
});

test('hourlyTail: rain is each 6-hour total spread evenly (totals conserved), the chance its own', () => {
  // A 52-hour run: the first 6-hourly bucket is hour 56, so its whole 6 hours are in the window.
  const ts = metnoFeed({ start: HOUR0, hourly: 52 }).properties.timeseries;
  const out = metno.hourlyTail(ts, 0, LONG);
  // The first 6-hourly bucket and the five hours after it: one 6-hour total.
  const first = ts.findIndex((b, i) => i > 0 && epochOf(b) - epochOf(ts[i - 1]) > HOUR);
  const six = ts[first].data.next_6_hours.details;
  const at = out.findIndex((b) => epochOf(b) === epochOf(ts[first]));
  assert.ok(at + 6 <= out.length, 'the whole 6 hours lie in the window');
  let sum = 0;
  for (let i = at; i < at + 6; i += 1) {
    const n1 = out[i].data.next_1_hours.details;
    close(n1.precipitation_amount, six.precipitation_amount / 6, `amount at ${i}`);
    assert.equal(n1.probability_of_precipitation, six.probability_of_precipitation, `chance at ${i}`);
    sum += n1.precipitation_amount;
  }
  close(sum, six.precipitation_amount, 'the 6-hour total');
  // The hours between the last hourly bucket and the first 6-hourly one read the last
  // hourly bucket's own 6-hour total.
  const last = ts[first - 1];
  for (let i = first; i < at; i += 1) {
    close(out[i].data.next_1_hours.details.precipitation_amount,
      last.data.next_6_hours.details.precipitation_amount / 6, `amount at ${i}`);
  }
});

test('hourlyTail: the last hourly bucket, lacking next_1_hours, reads its 6-hour total / 6', () => {
  const ts = metnoFeed({ start: HOUR0, hourly: 57 }).properties.timeseries;
  assert.equal(ts[56].data.next_1_hours, undefined, 'the fixture is Berlin-shaped');
  const out = metno.hourlyTail(ts, 0, LONG);
  assert.notEqual(out[56], ts[56], 'a copy');
  close(out[56].data.next_1_hours.details.precipitation_amount,
    ts[56].data.next_6_hours.details.precipitation_amount / 6, 'amount');
  const mapped = metno.mapResponse({ properties: { timeseries: ts } }, NOW, LONG);
  close(mapped.rainTrend[56], ts[56].data.next_6_hours.details.precipitation_amount / 6, 'rainTrend');
});

test('hourlyTail: no chance in the feed reads as no chance, not a made-up one', () => {
  const ts = metnoFeed({ start: HOUR0, hourly: 57, nordic: false }).properties.timeseries;
  const out = metno.hourlyTail(ts, 0, LONG);
  out.slice(57).forEach((b, i) => {
    assert.equal(b.data.next_1_hours.details.probability_of_precipitation, undefined, `hour ${57 + i}`);
  });
  const mapped = metno.mapResponse({ properties: { timeseries: ts } }, NOW, LONG);
  mapped.precipTrend.slice(57).forEach((p) => assert.equal(p, 0));
});

test('hourlyTail: clear-sky UV is the same hour\'s a day earlier, synthesized and real 6-hourly alike', () => {
  const ts = metnoFeed({ start: HOUR0, hourly: 57 }).properties.timeseries;
  const out = metno.hourlyTail(ts, 0, LONG);
  for (let i = 57; i < out.length; i += 1) {
    assert.equal(details(out[i]).ultraviolet_index_clear_sky, details(out[i - 24]).ultraviolet_index_clear_sky,
      `UV at ${i}`);
  }
  assert.ok(out.slice(57).some((b) => details(b).ultraviolet_index_clear_sky > 0), 'a daytime hour in the tail');
});

test('hourlyTail: the Nordic gust follows the wind at the last real gust / wind ratio; none without one', () => {
  const ts = metnoFeed({ start: HOUR0, hourly: 57 }).properties.timeseries;
  const ratio = details(ts[56]).wind_speed_of_gust / details(ts[56]).wind_speed;
  const out = metno.hourlyTail(ts, 0, LONG);
  for (let i = 57; i < out.length; i += 1) {
    close(details(out[i]).wind_speed_of_gust, details(out[i]).wind_speed * ratio, `gust at ${i}`);
  }
  const plain = metno.hourlyTail(metnoFeed({ start: HOUR0, hourly: 57, nordic: false }).properties.timeseries,
    0, LONG);
  plain.forEach((b, i) => assert.equal(details(b).wind_speed_of_gust, undefined, `gust at ${i}`));
  const mapped = metno.mapResponse({ properties: { timeseries: ts } }, NOW, LONG);
  assert.ok(mapped.gustTrend.slice(56).every((g) => g > 0), 'no gust dips to 0 at a 6-hourly bucket');
});

test('hourlyTail: stops before a bucket without a temperature, and at a 12-hour step', () => {
  const noTemp = metnoFeed({ start: HOUR0, hourly: 57 });
  const ts = noTemp.properties.timeseries;
  const first = ts.findIndex((b, i) => i > 0 && epochOf(b) - epochOf(ts[i - 1]) > HOUR);
  delete details(ts[first + 1]).air_temperature;
  let out = metno.hourlyTail(ts, 0, LONG);
  assert.equal(epochOf(out[out.length - 1]), epochOf(ts[first]), 'no hour interpolated toward it');
  const mapped = metno.mapResponse(noTemp, NOW, LONG);
  assert.equal(mapped.tempTrend.length, out.length, 'a short long payload, not a failure');

  const gap = metnoFeed({ start: HOUR0, hourly: 57 });
  const g = gap.properties.timeseries;
  const at = g.findIndex((b, i) => i > 0 && epochOf(b) - epochOf(g[i - 1]) > HOUR);
  g.splice(at + 1, 1);   // a 12-hour step after the first 6-hourly bucket
  out = metno.hourlyTail(g, 0, LONG);
  assert.equal(epochOf(out[out.length - 1]), epochOf(g[at]), 'stops at the 12-hour step');
});

test('hourlyTail: the parsed response is not modified', () => {
  const body = metnoFeed({ start: HOUR0, hourly: 57 });
  const before = JSON.stringify(body);
  metno.hourlyTail(body.properties.timeseries, 0, LONG);
  metno.mapResponse(body, NOW, LONG);
  assert.equal(JSON.stringify(body), before);
});

test('gate: windows 24 and 48 (and none) map exactly as 1fb8bb9 did, no hour synthesized', () => {
  Object.keys(golden.cases).forEach((name) => {
    const c = golden.cases[name];
    Object.keys(c.mapped).forEach((w) => {
      const window = w === 'undefined' ? undefined : Number(w);
      assert.ok(window === undefined || window <= PEAK_HOURS, 'the gate is the long span only');
      assert.deepEqual(metno.mapResponse(metnoFeed(c.feed), NOW, window), c.mapped[w], `${name} at ${w}`);
    });
  });
  // A 30-hour run at 48 still stops at 30, as it always has.
  assert.equal(golden.cases.global30.mapped['48'].tempTrend.length, 30);
});
