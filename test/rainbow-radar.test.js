const test = require('node:test');
const assert = require('node:assert/strict');

// Mock the shared XHR BEFORE requiring the module under test: rainbow-radar.js
// captures WeatherProvider.request at load time (same pattern as dwd.test.js).
const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError, headers, body) {
  responder(url, type, onSuccess, onError, headers, body);
};
const rainbowRadar = require('../src/pkjs/weather/rainbow-radar.js');
const radarWire = require('../src/pkjs/weather/radar-wire.js');

const ENDPOINT = 'https://xyz.supabase.co/functions/v1/rainbow-nowcast';
const SLOT0 = 1700000100;   // 5-min aligned (1700000100 % 300 === 0)
const SLOT = 300;
const N = 24;

function zeros() { return new Array(N).fill(0); }

function respondWith(body) {
  responder = function(url, type, onSuccess) { onSuccess(JSON.stringify(body)); };
}

function fetchTuples(cb) {
  rainbowRadar.fetchRadarTuplesAt(ENDPOINT, 52.5, 13.4, SLOT0, cb);
}

/**
 * The one proxy request a fetch at (lat, lon) makes.
 * @param {*} lat Latitude as the fix gives it.
 * @param {*} lon Longitude as the fix gives it.
 * @returns {{url: string, type: string, headers: Object, body: string}} The request.
 */
function proxyRequestFor(lat, lon) {
  const seen = [];
  responder = function(url, type, onSuccess, onError, headers, body) {
    seen.push({ url: url, type: type, headers: headers, body: body });
    onSuccess(JSON.stringify({ forecast: [] }));
  };
  rainbowRadar.fetchRadarTuplesAt(ENDPOINT, lat, lon, SLOT0, function() {});
  assert.equal(seen.length, 1);
  return seen[0];
}

test('POSTs {lat, lon, start} to the proxy endpoint itself: nothing in the URL', () => {
  const req = proxyRequestFor(52.5, 13.4);
  assert.equal(req.url, ENDPOINT, 'no query string');
  assert.equal(req.type, 'POST');
  assert.deepEqual(JSON.parse(req.body), { lat: 52.5, lon: 13.4, start: SLOT0 });
  // text/plain keeps it a CORS simple request (no preflight), as the old GET was.
  assert.deepEqual(req.headers, { 'Content-Type': 'text/plain;charset=UTF-8' });
});

test('the proxy gets the position rounded to 3 decimals, whether the fix gives numbers or strings', () => {
  [
    [52.5170365, 13.3888599, 52.517, 13.389],
    ['52.5170365', '13.3888599', 52.517, 13.389],   // a manual location
    ['+52.52', ' 13.40 ', 52.52, 13.4],
    ['-.5', '-179.9995', -0.5, -179.999],
    [-0.0004, 0.0005, 0, 0.001]
  ].forEach(function(c) {
    const body = JSON.parse(proxyRequestFor(c[0], c[1]).body);
    assert.deepEqual([body.lat, body.lon], [c[2], c[3]], JSON.stringify(c));
    assert.equal(Object.is(body.lat, -0), false);
  });
  const raw = proxyRequestFor(52.5170365, 13.3888599).body;
  assert.equal(raw.indexOf('5170365'), -1, 'no full-precision digit leaves the phone');
});

test('a position that is no coordinate pair: the clear, no request, and no coordinate in the log', () => {
  [[null, 13.4], ['', 13.4], [true, 13.4], [52.5, undefined], ['abc', 13.4], [95, 13.4], [52.5, 181], [NaN, 13.4]].forEach(function(c) {
    let requested = 0;
    responder = function() { requested += 1; };
    let out = 'unset';
    const logs = captureLogs(function() {
      rainbowRadar.fetchRadarTuplesAt(ENDPOINT, c[0], c[1], SLOT0, function(t) { out = t; });
    });
    assert.deepEqual(out, radarWire.clearRadarTuples(), String(c));
    assert.equal(requested, 0, String(c));
    assert.equal(logs.length, 1);
    assert.ok(logs[0].indexOf('not a usable coordinate pair') !== -1);
    assert.equal(/\d{2}\.\d/.test(logs[0]), false, 'the log names no coordinate');
  });
});

test('maps forecast intervals onto 5-min slots (mm/h ×10)', () => {
  // Interval covering slots 0-1 at 1.2 mm/h, an explicit dry interval for
  // slots 2-3, then 0.5 mm/h through the rest of the 2 h window.
  respondWith({ longitude: 13.4, latitude: 52.5, forecast: [
    { precipRate: 1.2, precipType: 'rain', timestampBegin: SLOT0,            timestampEnd: SLOT0 + 2 * SLOT },
    { precipRate: 0,   precipType: 'rain', timestampBegin: SLOT0 + 2 * SLOT, timestampEnd: SLOT0 + 4 * SLOT },
    { precipRate: 0.5, precipType: 'rain', timestampBegin: SLOT0 + 4 * SLOT, timestampEnd: SLOT0 + 24 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  const expected = zeros();
  expected[0] = 12; expected[1] = 12;
  for (let i = 4; i < N; i += 1) { expected[i] = 5; }
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, expected);
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('saturates at 255 (25.5 mm/h) and rounds the ×10 scaling', () => {
  respondWith({ forecast: [
    { precipRate: 30,   timestampBegin: SLOT0,        timestampEnd: SLOT0 + SLOT },
    { precipRate: 0.16, timestampBegin: SLOT0 + SLOT, timestampEnd: SLOT0 + 2 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 255, '30 mm/h saturates the wire byte');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 2, '0.16 mm/h → round(1.6) = 2');
});

test('slot 0 before forecast[0] inherits forecast[0].precipRate (gap guard)', () => {
  // forecast starts 2 min after slot 0: slot 0 must NOT read as a spurious dry "now".
  respondWith({ forecast: [
    { precipRate: 2, timestampBegin: SLOT0 + 120, timestampEnd: SLOT0 + 24 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 20, 'slot 0 inherits the first interval');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 20, 'slot 1 covered normally');
});

test('slots with no covering interval are 0 (gaps and beyond the horizon)', () => {
  respondWith({ forecast: [
    { precipRate: 1, timestampBegin: SLOT0,            timestampEnd: SLOT0 + SLOT },
    { precipRate: 1, timestampBegin: SLOT0 + 2 * SLOT, timestampEnd: SLOT0 + 3 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 0, 'uncovered gap slot is dry');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[3], 0, 'slot beyond the last interval is dry');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[23], 0, 'horizon end is dry');
});

test('empty forecast → 24 zeros (out-of-coverage clear, not a failure)', () => {
  respondWith({ forecast: [] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
});

test('missing forecast field → 24 zeros', () => {
  respondWith({ longitude: 13.4, latitude: 52.5 });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
});

test('area array is always 24 zeros (a point provider has no nearby signal)', () => {
  respondWith({ forecast: [
    { precipRate: 5, timestampBegin: SLOT0, timestampEnd: SLOT0 + 24 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_AREA_UINT8, zeros());
});

test('empty endpoint → one warning + the radar CLEAR, no network', () => {
  // An endpoint-less build can never answer. A null here would leave the watch
  // self-advancing its last window into a made-up "No rain ahead"; the clear
  // takes the radar off the watch instead (the outbox dedupe sends it once).
  let requested = false;
  responder = function() { requested = true; };
  const logs = [];
  const origLog = console.log;
  console.log = function(m) { logs.push(m); };
  let out = 'unset';
  try {
    rainbowRadar.fetchRadarTuplesAt('', 52.5, 13.4, SLOT0, function(t) { out = t; });
  }
  finally {
    console.log = origLog;
  }
  assert.deepEqual(out, { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 });
  assert.equal(requested, false);
  assert.equal(logs.length, 1, 'exactly one warning for this fetch (no persistent latch)');
  assert.ok(logs[0].indexOf('proxy endpoint') >= 0, 'warns about the missing endpoint');
});

test('HTTP failure → callback(null) (transient: the watch keeps its window)', () => {
  // 403 included: a proxy 403 is not proof the service is gone for good (unlike
  // the keyed sources, where it is a key rejection and clears). 502 is also how
  // today's proxy relays an upstream Rainbow 429.
  ['status_500', 'status_502', 'status_503', 'status_504', 'status_403', 'network_error', 'timeout'].forEach(function(code) {
    responder = function(url, type, onSuccess, onError) { onError({ code: code, detail: 'http_status' }); };
    let out = 'unset';
    fetchTuples(function(t) { out = t; });
    assert.equal(out, null, code);
  });
});

test('a proxy 404 or 405 (missing, or from before the POST) → the radar CLEAR, logged without URL or position', () => {
  // The proxy answers Rainbow's out-of-coverage 404 with a 200 empty forecast, so a
  // 404 here is the function itself missing, and a 405 is a proxy that predates the
  // POST (rolled back or not yet deployed). Neither heals on the next cycle: a null
  // would let the watch roll its last window into a made-up "No rain ahead" forever.
  ['status_404', 'status_405'].forEach(function(code) {
    responder = function(url, type, onSuccess, onError) { onError({ code: code, detail: 'http_status' }); };
    let out = 'unset';
    const logs = captureLogs(function() {
      rainbowRadar.fetchRadarTuplesAt(ENDPOINT, 52.5170365, 13.3888599, SLOT0, function(t) { out = t; });
    });
    assert.deepEqual(out, radarWire.clearRadarTuples(), code);
    assert.equal(logs.length, 1, code + ': one log line');
    assert.ok(logs[0].indexOf('Rainbow radar: the proxy is missing or outdated (' + code + ')') !== -1, logs[0]);
    assert.ok(logs[0].indexOf('clearing the watch radar') !== -1, logs[0]);
    assert.equal(logs[0].indexOf('supabase'), -1, code + ': no endpoint in the log');
    assert.equal(logs[0].indexOf('http'), -1, code + ': no URL in the log');
    assert.equal(/\d{2}\.\d/.test(logs[0]), false, code + ': no coordinate in the log');
  });
});

test('a proxy 429 → the limit notice, not a window, a clear or null', () => {
  responder = function(url, type, onSuccess, onError) { onError({ code: 'status_429', detail: 'http_status' }); };
  let out = 'unset';
  const logs = [];
  const orig = console.log;
  console.log = function(m) { logs.push(String(m)); };
  try { fetchTuples(function(t) { out = t; }); } finally { console.log = orig; }
  assert.deepEqual(out, radarWire.limitedRadarTuples());
  assert.equal(logs.filter(function(l) { return l.indexOf('Rainbow radar: request limit reached') !== -1; }).length, 1);
});

test('parse failure → callback(null)', () => {
  responder = function(url, type, onSuccess) { onSuccess('not json'); };
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});

// --- Rainbow (own key): the direct call on the user's key ---------------------
//
// The keyed path's failure streak is module state shared by this whole file, so
// every keyed test starts from a fresh run (resetKeyedStreak).

const DIRECT = 'https://api.rainbow.ai/nowcast/v1/precip-global/13.4/52.5';
const CLEAR = radarWire.clearRadarTuples();
// The three-interval forecast of the mapping test above.
const THREE_INTERVALS = [
  { precipRate: 1.2, precipType: 'rain', timestampBegin: SLOT0,            timestampEnd: SLOT0 + 2 * SLOT },
  { precipRate: 0,   precipType: 'rain', timestampBegin: SLOT0 + 2 * SLOT, timestampEnd: SLOT0 + 4 * SLOT },
  { precipRate: 0.5, precipType: 'rain', timestampBegin: SLOT0 + 4 * SLOT, timestampEnd: SLOT0 + 24 * SLOT }
];

/**
 * One keyed fetch at the test point (52.5, 13.4).
 * @param {*} key The stored key.
 * @param {Function} cb Receives the tuples or null.
 * @param {number} [slotZero] Slot-0 epoch (default SLOT0).
 * @returns {void}
 */
function fetchWithKey(key, cb, slotZero) {
  rainbowRadar.fetchRadarTuplesWithKey(key, 52.5, 13.4, slotZero || SLOT0, cb);
}

/**
 * Answer the keyed requests in order: a string is a 200 body, {code} a transport
 * error; past the list's end the last entry repeats.
 * @param {Array<string|{code: string}>} answers Per-request answers.
 * @returns {Array<{url: string, type: string, headers: Object}>} The request log.
 */
function answerKeyed(answers) {
  const seen = [];
  responder = function(url, type, onSuccess, onError, headers) {
    const a = answers[Math.min(seen.length, answers.length - 1)];
    seen.push({ url: url, type: type, headers: headers });
    if (typeof a === 'string') { onSuccess(a); } else { onError({ code: a.code, detail: 'http_status' }); }
  };
  return seen;
}

/**
 * Run fn with console.log captured.
 * @param {Function} fn Code under test.
 * @returns {string[]} The lines logged.
 */
function captureLogs(fn) {
  const logs = [];
  const orig = console.log;
  console.log = function(m) { logs.push(String(m)); };
  try { fn(); } finally { console.log = orig; }
  return logs;
}

/**
 * One keyed fetch whose single request gets `answer`; returns the callback's value.
 * @param {string|{code: string}} answer The response.
 * @param {number} [slotZero] Slot-0 epoch.
 * @returns {?Object} Tuples or null.
 */
function keyedOutcome(answer, slotZero) {
  answerKeyed([answer]);
  let out = 'unset';
  captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }, slotZero); });
  return out;
}

/**
 * A 200 body with a near echo and the given forecast (omitted → no forecast field).
 * @param {Array} [forecast] Forecast intervals.
 * @returns {string} JSON body.
 */
function echoBody(forecast) {
  const body = { latitude: 52.51, longitude: 13.41 };
  if (forecast) { body.forecast = forecast; }
  return JSON.stringify(body);
}

test('own key: GETs precip-global /lon/lat with start_timestamp, the trimmed key in the header only', () => {
  rainbowRadar.resetKeyedStreak();
  const seen = answerKeyed([echoBody([])]);
  fetchWithKey('  KEY \n', function() {});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, DIRECT + '?start_timestamp=' + SLOT0);
  assert.equal(seen[0].type, 'GET');
  assert.deepEqual(seen[0].headers, { 'Ocp-Apim-Subscription-Key': 'KEY' });
  assert.equal(seen[0].url.indexOf('KEY'), -1, 'the key never rides the URL');
});

test('own key: Rainbow gets the position rounded to 3 decimals, and the echo check uses it', () => {
  rainbowRadar.resetKeyedStreak();
  // The echo is Rainbow's grid point near the rounded request.
  const seen = answerKeyed([JSON.stringify({ latitude: 52.52, longitude: 13.39, forecast: [] })]);
  let out = 'unset';
  captureLogs(function() {
    rainbowRadar.fetchRadarTuplesWithKey('KEY', '52.5170365', 13.3888599, SLOT0, function(t) { out = t; });
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.rainbow.ai/nowcast/v1/precip-global/13.389/52.517?start_timestamp=' + SLOT0);
  assert.ok(out && out.RAIN_RADAR_TREND_UINT8, 'a window, not a miss');
});

test('own key: a position that is no coordinate pair clears without a request and ends the run', () => {
  rainbowRadar.resetKeyedStreak();
  const DOWN = { code: 'status_503' };
  assert.equal(keyedOutcome(DOWN, SLOT0), null, 'a run starts');
  let requested = 0;
  responder = function() { requested += 1; };
  let out = 'unset';
  const logs = captureLogs(function() {
    rainbowRadar.fetchRadarTuplesWithKey('KEY', 'north', 13.4, SLOT0 + 3 * SLOT, function(t) { out = t; });
  });
  assert.deepEqual(out, CLEAR);
  assert.equal(requested, 0);
  assert.equal(logs.length, 1);
  assert.ok(logs[0].indexOf('not a usable coordinate pair') !== -1);
  assert.equal(keyedOutcome(DOWN, SLOT0 + 6 * SLOT), null, 'the run ended: a fresh one, not 30 min on');
});

test('own key: an echo-valid 200 gives the same bytes as the proxy path for that forecast', () => {
  rainbowRadar.resetKeyedStreak();
  respondWith({ forecast: THREE_INTERVALS });
  let viaProxy;
  fetchTuples(function(t) { viaProxy = t; });
  const out = keyedOutcome(echoBody(THREE_INTERVALS));
  assert.ok(out && viaProxy);
  assert.deepEqual(out, viaProxy);
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('own key: a swapped, missing or empty echo is a transient miss (null)', () => {
  [
    JSON.stringify({ latitude: 13.4, longitude: 52.5, forecast: THREE_INTERVALS }),
    JSON.stringify({ forecast: THREE_INTERVALS }),
    '{}',
    'null'
  ].forEach(function(body) {
    rainbowRadar.resetKeyedStreak();
    assert.equal(keyedOutcome(body), null, body.slice(0, 40));
  });
});

test('own key: an empty or non-JSON 200 (an Origin-neutered runtime) is null', () => {
  ['', '<html>'].forEach(function(body) {
    rainbowRadar.resetKeyedStreak();
    assert.equal(keyedOutcome(body), null, JSON.stringify(body));
  });
});

test('own key: an echo with no forecast is 24 zeros anchored at slot 0', () => {
  rainbowRadar.resetKeyedStreak();
  const out = keyedOutcome(echoBody());
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('own key: a 404 is out of coverage — flat zeros at slot 0, not the clear', () => {
  rainbowRadar.resetKeyedStreak();
  const out = keyedOutcome({ code: 'status_404' });
  assert.equal(out.RAIN_RADAR_TREND_UINT8.length, 24, 'not the clear');
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('own key: a 401/403 key rejection clears the watch radar', () => {
  ['status_401', 'status_403'].forEach(function(code) {
    rainbowRadar.resetKeyedStreak();
    assert.deepEqual(keyedOutcome({ code: code }), CLEAR, code);
  });
});

test('own key: 5xx, network errors and timeouts are transient (null)', () => {
  ['status_500', 'status_502', 'status_503', 'network_error', 'timeout'].forEach(function(code) {
    rainbowRadar.resetKeyedStreak();
    assert.equal(keyedOutcome({ code: code }), null, code);
  });
});

test('own key: a 429 is the limit notice, logged once and without the key', () => {
  rainbowRadar.resetKeyedStreak();
  const SECRET = 'RBWSECRET_0123456789abcdef';
  answerKeyed([{ code: 'status_429' }]);
  let out = 'unset';
  const logs = captureLogs(function() { fetchWithKey(SECRET, function(t) { out = t; }); });
  assert.deepEqual(out, radarWire.limitedRadarTuples());
  assert.equal(logs.filter(function(l) { return l.indexOf('Rainbow (own key) radar: request limit reached') !== -1; }).length, 1);
  assert.deepEqual(logs.filter(function(l) { return l.indexOf(SECRET) !== -1; }), []);
});

test('own key: a 429 on the retry without start_timestamp is the limit notice too', () => {
  rainbowRadar.resetKeyedStreak();
  const seen = answerKeyed([{ code: 'status_400' }, { code: 'status_429' }]);
  let out = 'unset';
  captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }); });
  assert.equal(seen.length, 2);
  assert.deepEqual(out, radarWire.limitedRadarTuples());
});

test('own key: a refused start_timestamp (400/422) retries once without it, still anchored at slot 0', () => {
  ['status_400', 'status_422'].forEach(function(code) {
    rainbowRadar.resetKeyedStreak();
    // The retry's forecast starts 2 min after slot 0 (Rainbow's "now"): slot 0 still fills.
    const late = [{ precipRate: 2, timestampBegin: SLOT0 + 120, timestampEnd: SLOT0 + 24 * SLOT }];
    const seen = answerKeyed([{ code: code }, echoBody(late)]);
    let out;
    const logs = captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }); });
    assert.equal(seen.length, 2, code + ': exactly one retry');
    assert.equal(seen[1].url, DIRECT, code + ': the retry drops start_timestamp');
    assert.deepEqual(seen[1].headers, { 'Ocp-Apim-Subscription-Key': 'KEY' });
    assert.equal(out.RAIN_RADAR_START, SLOT0);
    assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 20, code + ': slot 0 inherits the first interval');
    assert.equal(logs.filter(function(l) { return l.indexOf('start time refused (' + code + ')') !== -1; }).length, 1);
  });
});

test('own key: a 400 on the retry is null, and there is no third request', () => {
  rainbowRadar.resetKeyedStreak();
  const seen = answerKeyed([{ code: 'status_400' }, { code: 'status_400' }, echoBody([])]);
  let out = 'unset';
  captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }); });
  assert.equal(seen.length, 2);
  assert.equal(out, null);
});

test('own key streak: nulls spanning 30 min of slot-0 time turn into the clear, and stay it', () => {
  rainbowRadar.resetKeyedStreak();
  const RATE = { code: 'status_503' };
  assert.equal(keyedOutcome(RATE, SLOT0), null);
  assert.equal(keyedOutcome(RATE, SLOT0 + 3 * SLOT), null);
  assert.equal(keyedOutcome(RATE, SLOT0 + 5 * SLOT), null);
  answerKeyed([RATE]);
  let out;
  const logs = captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }, SLOT0 + 6 * SLOT); });
  assert.deepEqual(out, CLEAR, '30 min after the first null');
  assert.equal(logs.filter(function(l) { return l.indexOf('no usable answer for 30 min') !== -1; }).length, 1);
  assert.deepEqual(keyedOutcome(RATE, SLOT0 + 7 * SLOT), CLEAR, 'the run continues past the clear');
});

test('own key streak: a window ends the run', () => {
  rainbowRadar.resetKeyedStreak();
  const RATE = { code: 'status_503' };
  assert.equal(keyedOutcome(RATE, SLOT0), null);
  assert.ok(keyedOutcome(echoBody([]), SLOT0 + 3 * SLOT), 'a real window');
  assert.equal(keyedOutcome(RATE, SLOT0 + 6 * SLOT), null, 'a new run starts here');
  assert.deepEqual(keyedOutcome(RATE, SLOT0 + 12 * SLOT), CLEAR, '30 min into the new run');
});

test('own key streak: a limit that lasts is never turned into the clear', () => {
  // The limit notice is an honest, known state: however long the 429s last, the
  // watch keeps saying "Radar limit reached" rather than losing its radar.
  rainbowRadar.resetKeyedStreak();
  const LIMIT = { code: 'status_429' };
  for (let i = 0; i <= 24; i += 3) {
    assert.deepEqual(keyedOutcome(LIMIT, SLOT0 + i * SLOT), radarWire.limitedRadarTuples(), 'slot ' + i);
  }
  // And the nulls after it start a fresh 30 minutes.
  const DOWN = { code: 'status_503' };
  assert.equal(keyedOutcome(DOWN, SLOT0 + 25 * SLOT), null);
  assert.equal(keyedOutcome(DOWN, SLOT0 + 30 * SLOT), null, '25 min into the run: not yet');
  assert.deepEqual(keyedOutcome(DOWN, SLOT0 + 31 * SLOT), CLEAR);
});

test('own key streak: empty 200s count like any other transient miss', () => {
  rainbowRadar.resetKeyedStreak();
  assert.equal(keyedOutcome('', SLOT0), null);
  assert.deepEqual(keyedOutcome('', SLOT0 + 6 * SLOT), CLEAR);
});

test('own key streak: a tunnel\'s many retries inside 30 min never clear', () => {
  rainbowRadar.resetKeyedStreak();
  const NET = { code: 'network_error' };
  for (let i = 0; i < 5; i += 1) {
    assert.equal(keyedOutcome(NET, SLOT0), null, 'backoff retry ' + i + ' of one slot');
  }
  assert.equal(keyedOutcome(NET, SLOT0 + 5 * SLOT), null, 'no clear before 30 min, however many attempts');
});

test('own key streak: a 404 (flat zeros), a 401 (clear) and a 429 (limit notice) each end a run', () => {
  [{ code: 'status_404' }, { code: 'status_401' }, { code: 'status_429' }].forEach(function(mid) {
    rainbowRadar.resetKeyedStreak();
    const RATE = { code: 'status_503' };
    assert.equal(keyedOutcome(RATE, SLOT0), null);
    assert.notEqual(keyedOutcome(mid, SLOT0 + 3 * SLOT), null, mid.code);
    assert.equal(keyedOutcome(RATE, SLOT0 + 6 * SLOT), null, mid.code + ' ended the run');
  });
});

test('own key: a missing or blank key clears without a request, logging once', () => {
  ['', '   ', undefined].forEach(function(key) {
    rainbowRadar.resetKeyedStreak();
    let requested = 0;
    responder = function() { requested += 1; };
    let out = 'unset';
    const logs = captureLogs(function() { fetchWithKey(key, function(t) { out = t; }); });
    assert.deepEqual(out, CLEAR, JSON.stringify(key));
    assert.equal(requested, 0);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].indexOf('no API key is set') !== -1);
  });
});

test('own key: the 401, parse-error and echo-mismatch logs never carry the key (cheap pin)', () => {
  const SECRET = 'RBWSECRET_0123456789abcdef';
  const logs = [];
  [{ code: 'status_401' }, 'not json', JSON.stringify({ latitude: 0, longitude: 0 })].forEach(function(answer) {
    rainbowRadar.resetKeyedStreak();
    answerKeyed([answer]);
    Array.prototype.push.apply(logs, captureLogs(function() { fetchWithKey(SECRET, function() {}); }));
  });
  assert.equal(logs.length, 3, 'each path logged');
  assert.deepEqual(logs.filter(function(l) { return l.indexOf(SECRET) !== -1; }), []);
});

// The run measures the keyed path's OWN consecutive answers. Any other radar step (another
// source, radar off — each builds its source through radar-factory.js) or the missing-key
// clear ends it: coming back to the keyed path starts a fresh 30 minutes, measured from its
// first new null, not from a null hours old.
const radarFactory = require('../src/pkjs/weather/radar-factory.js');

test('own key streak: a step on another radar source (or radar off) ends the run', () => {
  ['dwd', 'metno', 'rainbow', 'tomorrowio', 'disabled', 'bogus'].forEach(function(otherId) {
    rainbowRadar.resetKeyedStreak();
    const DOWN = { code: 'status_503' };
    assert.equal(keyedOutcome(DOWN, SLOT0), null, otherId + ': the first null');
    radarFactory.createRadarSource(otherId, { rainbowEndpoint: '', tomorrowioApiKey: '' });
    assert.equal(keyedOutcome(DOWN, SLOT0 + 72 * SLOT), null, otherId + ': 6 h later the run starts afresh');
    assert.deepEqual(keyedOutcome(DOWN, SLOT0 + 78 * SLOT), CLEAR, otherId + ': 30 min into the fresh run');
  });
});

test('own key streak: the keyed source\'s own steps keep the run going', () => {
  rainbowRadar.resetKeyedStreak();
  answerKeyed([{ code: 'status_503' }]);
  const outcomes = [];
  captureLogs(function() {
    [SLOT0, SLOT0 + 6 * SLOT].forEach(function(slotZero) {
      radarFactory.createRadarSource('rainbowkey', { rainbowEndpoint: '', rainbowApiKey: 'KEY' })
        .fetchRadarTuplesAt(52.5, 13.4, slotZero, function(t) { outcomes.push(t); });
    });
  });
  assert.equal(outcomes[0], null);
  assert.deepEqual(outcomes[1], CLEAR, 'building the keyed source each cycle does not restart its run');
});

test('own key streak: the missing-key clear ends the run', () => {
  rainbowRadar.resetKeyedStreak();
  const DOWN = { code: 'status_503' };
  assert.equal(keyedOutcome(DOWN, SLOT0), null);
  let out = 'unset';
  captureLogs(function() { fetchWithKey('', function(t) { out = t; }, SLOT0 + 3 * SLOT); });
  assert.deepEqual(out, CLEAR, 'no key: the clear');
  assert.equal(keyedOutcome(DOWN, SLOT0 + 6 * SLOT), null, 'the key is back: a fresh run, not 30 min on');
});
