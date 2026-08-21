const test = require('node:test');
const assert = require('node:assert');

// The bake now asks phone-battery.js for the phone's cached charge (and whether
// this host can read one at all), and that module answers out of localStorage.
// AGENTS.md: install the mock BEFORE the watch modules load. Node 26 does define
// an implicit global `localStorage`, but it is undefined on first access, so a
// suite that leans on it passes or fails at random.
const phoneBatteryStore = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(phoneBatteryStore, k) ? phoneBatteryStore[k] : null; },
  setItem(k, v) { phoneBatteryStore[k] = String(v); },
  removeItem(k) { delete phoneBatteryStore[k]; }
};

const statusLines = require('../src/pkjs/status-lines.js');
const catalog = require('../src/pkjs/status-line-catalog.js');
const STORAGE_KEYS = require('../src/pkjs/storage-keys.js');

/**
 * Put a phone-battery reading in the cache the baker reads, or clear it.
 *
 * The cached level is the phone's EXACT percentage — phone-battery.js's 5-point
 * bucket is its send trigger and never reaches this cache — so the values here
 * are deliberately not multiples of 5.
 *
 * @param {number|null} pct Exact charge percentage 0..100, or null for "no reading".
 * @param {boolean} [charging] Whether the phone is plugged in.
 * @returns {void}
 */
function setPhoneBattery(pct, charging) {
  global.localStorage.setItem(STORAGE_KEYS.PHONE_BATTERY_SUPPORTED, 'true');
  if (pct === null) {
    global.localStorage.removeItem(STORAGE_KEYS.PHONE_BATTERY_LEVEL);
    global.localStorage.removeItem(STORAGE_KEYS.PHONE_BATTERY_CHARGING);
    return;
  }
  global.localStorage.setItem(STORAGE_KEYS.PHONE_BATTERY_LEVEL, String(pct));
  global.localStorage.setItem(STORAGE_KEYS.PHONE_BATTERY_CHARGING, charging ? 'true' : 'false');
}

/**
 * Forget both the reading and the detector verdict (an iPhone, or the emulator).
 * @returns {void}
 */
function clearPhoneBattery() {
  Object.keys(phoneBatteryStore).forEach((k) => { delete phoneBatteryStore[k]; });
}

const K = catalog.KINDS, I = catalog.ICONS;
const WATCH_BASALT = { platform: 'basalt' };
const WATCH_EMERY = { platform: 'emery' };
const WATCH_APLITE = { platform: 'aplite' };

function sunEvents(startType, epochs) {
  const bytes = [startType];
  epochs.forEach(e => {
    bytes.push(e & 0xFF, (e >> 8) & 0xFF, (e >> 16) & 0xFF, (e >> 24) & 0xFF);
  });
  return bytes;
}

function basePayload() {
  return {
    CURRENT_TEMP: 68, // degrees F
    CITY: 'Saarbrücken',
    SUN_EVENTS: sunEvents(1, [1767258000]), // 2026-01-01T09:00:00Z
    UV_TREND_UINT8: [64],
    WIND_TREND_UINT8: [17],
    GUST_TREND_UINT8: [48]
  };
}

function baseSettings(extra) {
  return Object.assign({
    temperatureUnits: 'c', axisTimeFormat: '24h', timeShowAmPm: false,
    timeLeadingZero: false, healthMode: 'all', radarProvider: 'disabled'
  }, extra || {});
}

// Decode one packed line back into [{kind, icon, text}] for assertions.
function decodeLine(bytes) {
  const slots = [];
  let off = 0;
  for (let i = 0; i < 3; i++) {
    const kind = bytes[off], icon = bytes[off + 1], len = bytes[off + 2];
    off += 3;
    const text = Buffer.from(bytes.slice(off, off + len)).toString('utf8');
    off += len;
    slots.push({ kind, icon, len, text });
  }
  assert.equal(off, bytes.length, 'no trailing bytes');
  return slots;
}

// packLine() test helpers (Task 3: forecast middle is now a configurable slot).
function forecastLine() {
  return catalog.LINES.filter(l => l.id === 'forecast')[0];
}

function basaltEnv() {
  return { color: true, round: false, platform: 'basalt', health: true, radar: true };
}

function decodeMidText(bytes) {
  return decodeLine(bytes)[1].text;
}

test('utf8 encode + boundary-safe truncate', () => {
  assert.deepEqual(statusLines.utf8Encode('a°'), [0x61, 0xC2, 0xB0]);
  // cap in the middle of degree symbol backs off to the code-point boundary
  assert.deepEqual(statusLines.utf8Truncate(statusLines.utf8Encode('a°'), 2), [0x61]);
  assert.deepEqual(statusLines.utf8Truncate(statusLines.utf8Encode('ab'), 2), [0x61, 0x62]);
});

test('utf8 encode replaces unpaired UTF-16 surrogates', () => {
  assert.deepEqual(statusLines.utf8Encode('\uD800'), [0xEF, 0xBF, 0xBD]);
  assert.deepEqual(statusLines.utf8Encode('\uDC00'), [0xEF, 0xBF, 0xBD]);
});

test('utf8 encode and truncate preserve astral code-point boundaries', () => {
  const encoded = statusLines.utf8Encode('a\uD83D\uDE00b');
  assert.deepEqual(encoded, [0x61, 0xF0, 0x9F, 0x98, 0x80, 0x62]);
  assert.deepEqual(statusLines.utf8Truncate(encoded, 4), [0x61]);
  assert.deepEqual(statusLines.utf8Truncate(encoded, 5),
    [0x61, 0xF0, 0x9F, 0x98, 0x80]);
});

test('value formatting', () => {
  const p = basePayload();
  assert.equal(statusLines.formatValue('temp', p, baseSettings()), '20'); // 68F → 20C, bare number
  assert.equal(statusLines.formatValue('temp', p, baseSettings({ temperatureUnits: 'f' })), '68');
  assert.equal(statusLines.formatValue('uv', p, baseSettings()), '6'); // 64 tenths
  assert.equal(statusLines.formatValue('wind', p, baseSettings()), '17kph');
  assert.equal(statusLines.formatValue('gust', p, baseSettings()), '48kph');
  assert.equal(statusLines.formatValue('city', p, baseSettings()), 'Saarbrücken');
});

test('temp slot display modes: actual, feels, and slash-separated both', () => {
  const p = Object.assign(basePayload(), { FEELS_CURRENT: 50 }); // 68F/50F = 20C/10C
  assert.equal(statusLines.formatValue('temp', p, baseSettings()), '20',
    'absent tempSlotDisplay defaults to actual');
  assert.equal(statusLines.formatValue('temp', p,
    baseSettings({ tempSlotDisplay: 'actual' })), '20');
  assert.equal(statusLines.formatValue('temp', p,
    baseSettings({ tempSlotDisplay: 'feels' })), '10');
  assert.equal(statusLines.formatValue('temp', p,
    baseSettings({ tempSlotDisplay: 'both' })), '20/10', 'actual first');
});

test('temp display modes convert both halves with temperatureUnits', () => {
  const p = Object.assign(basePayload(), { FEELS_CURRENT: 50 });
  assert.equal(statusLines.formatValue('temp', p,
    baseSettings({ tempSlotDisplay: 'both', temperatureUnits: 'f' })), '68/50');
  assert.equal(statusLines.formatValue('temp', p,
    baseSettings({ tempSlotDisplay: 'feels', temperatureUnits: 'f' })), '50');
});

test('missing or null FEELS_CURRENT renders the actual temp alone in every mode', () => {
  const missing = basePayload(); // no FEELS_CURRENT at all (stale pre-upgrade cache)
  const nulled = Object.assign(basePayload(), { FEELS_CURRENT: null });
  ['actual', 'feels', 'both'].forEach((mode) => {
    assert.equal(statusLines.formatValue('temp', missing,
      baseSettings({ tempSlotDisplay: mode })), '20', mode + ': never --/-- or 12/--');
    assert.equal(statusLines.formatValue('temp', nulled,
      baseSettings({ tempSlotDisplay: mode })), '20', mode + ': null feels = absent');
  });
  // And a missing actual temp still bakes as -- regardless of mode.
  const noTemp = basePayload(); delete noTemp.CURRENT_TEMP;
  assert.equal(statusLines.formatValue('temp', noTemp,
    baseSettings({ tempSlotDisplay: 'both' })), '--');
});

test('worst realistic both-mode text fits the edge-slot byte cap untruncated', () => {
  // 10F = -12C, 14F = -10C -> "-12/-10", 7 bytes vs EDGE_TEXT_MAX = 8.
  const p = Object.assign(basePayload(), { CURRENT_TEMP: 10, FEELS_CURRENT: 14 });
  const text = statusLines.formatValue('temp', p, baseSettings({ tempSlotDisplay: 'both' }));
  assert.equal(text, '-12/-10');
  assert.ok(statusLines.utf8Encode(text).length <= catalog.CAPS.EDGE_TEXT_MAX,
    'both-mode worst case must survive the edge slot without truncation');
});

test('countdown formats future, today, passed, missing, malformed, and leap dates', () => {
  const now = new Date(2028, 1, 28, 17, 45);
  assert.equal(statusLines.formatCountdown('2028-03-01', now), '2d');
  assert.equal(statusLines.formatCountdown('2028-02-28', now), 'now');
  assert.equal(statusLines.formatCountdown('2028-02-27', now), '--');
  assert.equal(statusLines.formatCountdown('0099-01-01', now), '--',
    'four-digit years below 100 remain valid local calendar years');
  assert.equal(statusLines.formatCountdown(undefined, now), 'now');
  assert.equal(statusLines.formatCountdown('2028-02-31', now), 'now');
  assert.equal(statusLines.formatCountdown('2028-02-29', now), '1d',
    'leap day is a real local calendar day');
});

test('each countdown slot reads its own target-date key and packs as TEXT', () => {
  const line = forecastLine();
  const settings = baseSettings({
    statusForecastLeft: 'countdown',
    statusForecastMid: 'countdown',
    statusForecastRight: 'countdown',
    statusForecastLeftCountdown: '2099-01-01',
    statusForecastMidCountdown: '2000-01-01'
  });
  const slots = decodeLine(statusLines.packLine(line, basePayload(), settings, basaltEnv()));
  assert.deepEqual(slots.map((s) => s.kind), [K.TEXT, K.TEXT, K.TEXT]);
  assert.deepEqual(slots.map((s) => s.icon),
    [I.COUNTDOWN, I.COUNTDOWN, I.COUNTDOWN]);
  assert.match(slots[0].text, /^\d+d$/);
  assert.equal(slots[1].text, '--');
  assert.equal(slots[2].text, 'now', 'missing date falls back to today');
  slots.forEach((slot) => assert.ok(slot.len <= catalog.CAPS.EDGE_TEXT_MAX,
    'every countdown output fits even the narrow edge cap'));
});

test('wind + gust format in the selected wind unit (default kph)', () => {
  const p = Object.assign(basePayload(), { WIND_TREND_UINT8: [50], GUST_TREND_UINT8: [50] });
  assert.equal(statusLines.formatValue('wind', p, baseSettings()), '50kph'); // default = kph
  assert.equal(statusLines.formatValue('wind', p, baseSettings({ windUnits: 'kph' })), '50kph');
  assert.equal(statusLines.formatValue('wind', p, baseSettings({ windUnits: 'mph' })), '31mph');
  assert.equal(statusLines.formatValue('wind', p, baseSettings({ windUnits: 'knots' })), '27kn');
  assert.equal(statusLines.formatValue('gust', p, baseSettings({ windUnits: 'mph' })), '31mph');
  const absent = basePayload(); delete absent.WIND_TREND_UINT8;
  assert.equal(statusLines.formatValue('wind', absent, baseSettings({ windUnits: 'mph' })), '--');
});

test('missing weather values bake as --', () => {
  const p = basePayload();
  delete p.CURRENT_TEMP;
  p.UV_TREND_UINT8 = [];
  delete p.WIND_TREND_UINT8;
  assert.equal(statusLines.formatValue('temp', p, baseSettings()), '--');
  assert.equal(statusLines.formatValue('uv', p, baseSettings()), '--');
  assert.equal(statusLines.formatValue('wind', p, baseSettings()), '--');
});

test('buildStatusLines packs four lines with defaults', () => {
  const p = basePayload();
  statusLines.buildStatusLines(p, baseSettings(), WATCH_BASALT);

  const forecast = decodeLine(p.STATUS_LINE_1_UINT8);
  assert.equal(forecast[0].kind, K.TEXT);
  assert.equal(forecast[0].icon, I.TEMP);
  assert.equal(forecast[0].text, '20'); // bare number; thermometer icon carries context
  assert.equal(forecast[1].icon, I.NONE);
  assert.equal(forecast[1].text, 'Saarbrücken'); // default mid = city
  assert.equal(forecast[2].icon, I.AQI);

  const radar = decodeLine(p.STATUS_LINE_2_UINT8);
  assert.equal(radar[1].icon, I.WIND);
  assert.equal(radar[2].icon, I.GUST);

  const top = decodeLine(p.STATUS_LINE_3_UINT8);
  assert.equal(top[0].kind, K.LIVE_WEEK); // default left = calendar week (available on basalt)
  assert.equal(top[1].kind, K.LIVE_DATE); // mid slot is selectable; defaults to date
  assert.equal(top[2].icon, I.DRAWN_SUN); // default right = sunrise/sunset (TEXT + sun glyph)

  const health = decodeLine(p.STATUS_LINE_4_UINT8);
  // non-HR default (basalt): steps / empty / sleep
  assert.deepEqual(health.map(s => s.kind), [K.LIVE_STEPS, K.EMPTY, K.LIVE_SLEEP]);
  assert.deepEqual(health.map(s => s.len), [0, 0, 0]); // LIVE/empty = no value bytes
});

test('user selections and availability resolution', () => {
  const p = basePayload();
  const s = baseSettings({
    statusForecastLeft: 'uv', statusForecastRight: 'wind',
    statusHealthRight: 'hr' // hr on basalt -> resolves to empty
  });
  statusLines.buildStatusLines(p, s, WATCH_BASALT);
  const forecast = decodeLine(p.STATUS_LINE_1_UINT8);
  assert.equal(forecast[0].icon, I.UV);
  assert.equal(forecast[0].text, '6');
  assert.equal(forecast[2].icon, I.WIND);
  const health = decodeLine(p.STATUS_LINE_4_UINT8);
  assert.equal(health[2].kind, K.EMPTY);

  statusLines.buildStatusLines(p, s, WATCH_EMERY);
  const healthEmery = decodeLine(p.STATUS_LINE_4_UINT8);
  assert.equal(healthEmery[2].kind, K.LIVE_HR); // same stored choice, capable watch
});

test('forecast line sources its middle from statusForecastMid', () => {
  const payload = { CURRENT_TEMP: 50, CITY: 'Berlin' };  // 50F -> 10C
  // default (unset) -> city
  const def = statusLines.packLine(forecastLine(), payload, {}, basaltEnv());
  assert.ok(decodeMidText(def).indexOf('Berlin') === 0);
  // explicit selection -> UV (a TEXT item), city no longer forced
  const uv = statusLines.packLine(forecastLine(),
    { UV_TREND_UINT8: [30] }, { statusForecastMid: 'uv' }, basaltEnv());
  assert.equal(decodeMidText(uv), '3');
});

test('distance slot packs km vs mi kind from distanceUnits', () => {
  const env = basaltEnv(); // health: true
  const sel = (u) => Object.assign(
    { statusForecastLeft: 'distance', healthMode: 'all' },
    u === undefined ? {} : { distanceUnits: u });
  const metric = statusLines.packLine(forecastLine(), {}, sel('metric'), env);
  assert.equal(decodeLine(metric)[0].kind, catalog.KINDS.LIVE_DISTANCE);
  const imperial = statusLines.packLine(forecastLine(), {}, sel('imperial'), env);
  assert.equal(decodeLine(imperial)[0].kind, catalog.KINDS.LIVE_DISTANCE_MI);
  const unset = statusLines.packLine(forecastLine(), {}, sel(undefined), env);
  assert.equal(decodeLine(unset)[0].kind, catalog.KINDS.LIVE_DISTANCE); // defaults to km
  // Icon is the distance icon in both units.
  assert.equal(decodeLine(imperial)[0].icon, catalog.ICONS.DISTANCE);
  assert.equal(decodeLine(metric)[0].icon, catalog.ICONS.DISTANCE);
});

test('top line: mid defaults to live date; stored mid packs; date is rejected at edges', () => {
  const topLine = catalog.LINES.filter(l => l.id === 'top')[0];
  const env = basaltEnv();
  const p = basePayload();
  // default: week / date / sun
  let slots = decodeLine(statusLines.packLine(topLine, p, baseSettings(), env));
  assert.deepEqual(slots.map(s => s.kind), [K.LIVE_WEEK, K.LIVE_DATE, K.TEXT]);
  // stored mid selection packs as TEXT
  slots = decodeLine(statusLines.packLine(topLine, p,
    baseSettings({ statusTopMid: 'city' }), env));
  assert.equal(slots[1].kind, K.TEXT);
  assert.equal(slots[1].text, 'Saarbrücken');
  // a stray 'date' in an edge slot resolves to empty (position gate)
  slots = decodeLine(statusLines.packLine(topLine, p,
    baseSettings({ statusTopLeft: 'date' }), env));
  assert.equal(slots[0].kind, K.EMPTY);
});

test('city cap: 19 bytes in mid, 8 in edge, code-point safe', () => {
  const p = basePayload();
  p.CITY = 'Mönchengladbach-Ost'; // 20 UTF-8 bytes (o-umlaut = 2)
  const s = baseSettings({ statusRadarLeft: 'city' });
  statusLines.buildStatusLines(p, s, WATCH_BASALT);
  const forecast = decodeLine(p.STATUS_LINE_1_UINT8);
  assert.ok(forecast[1].len <= 19);
  assert.ok(forecast[1].text.length > 0);
  const radar = decodeLine(p.STATUS_LINE_2_UINT8);
  assert.ok(radar[0].len <= 8); // city in an edge slot
});

test('sun time formats 24h and 12h', () => {
  const p = basePayload();
  const t24 = statusLines.formatValue('sun', p, baseSettings());
  assert.match(t24, /^\d{1,2}:\d{2}$/);
  const t12 = statusLines.formatValue('sun', p,
    baseSettings({ axisTimeFormat: '12h', timeShowAmPm: true }));
  assert.match(t12, /^\d{1,2}:\d{2}[ap]$/);
  assert.ok(statusLines.utf8Encode(t12).length <= 7);
});

test('sun time mirrors leading-zero and AM/PM settings', () => {
  const p = basePayload();
  const localDate = new Date(1767258000 * 1000);
  const hour24 = localDate.getHours();
  const hour12 = hour24 % 12 || 12;
  const minute = String(localDate.getMinutes()).padStart(2, '0');
  const marker = hour24 < 12 ? 'a' : 'p';
  assert.equal(statusLines.formatValue('sun', p,
    baseSettings({ timeLeadingZero: true })), String(hour24).padStart(2, '0') + ':' + minute);
  assert.equal(statusLines.formatValue('sun', p,
    baseSettings({ axisTimeFormat: '12h', timeLeadingZero: true })),
    String(hour12).padStart(2, '0') + ':' + minute);
  assert.equal(statusLines.formatValue('sun', p,
    baseSettings({ axisTimeFormat: '12h', timeShowAmPm: true })),
    hour12 + ':' + minute + marker);
});

test('aqi slot renders the bare index from AQI_TREND head (leaf icon carries context)', () => {
  const payload = Object.assign(basePayload(), { AQI_TREND: [42, 50] });
  const settings = baseSettings({ statusForecastLeft: 'aqi' });
  statusLines.buildStatusLines(payload, settings, WATCH_BASALT);
  const slots = decodeLine(payload.STATUS_LINE_1_UINT8);
  assert.equal(slots[0].kind, K.TEXT);
  assert.equal(slots[0].icon, I.AQI);
  assert.equal(slots[0].text, '42');
});

test('aqi slot shows -- when AQI_TREND head is null or absent', () => {
  const nulls = Object.assign(basePayload(), { AQI_TREND: [null] });
  statusLines.buildStatusLines(nulls, baseSettings({ statusForecastLeft: 'aqi' }), WATCH_BASALT);
  assert.equal(decodeLine(nulls.STATUS_LINE_1_UINT8)[0].text, '--');

  const absent = basePayload(); // no AQI_TREND at all
  statusLines.buildStatusLines(absent, baseSettings({ statusForecastLeft: 'aqi' }), WATCH_BASALT);
  assert.equal(decodeLine(absent.STATUS_LINE_1_UINT8)[0].text, '--');
});

test('pollen slot emits POLLEN_TODAY verbatim with the pollen icon', () => {
  const payload = Object.assign(basePayload(), { POLLEN_TODAY: '2-3' });
  const settings = baseSettings({ provider: 'dwd', statusForecastLeft: 'pollen' });
  statusLines.buildStatusLines(payload, settings, WATCH_BASALT);
  const slot = decodeLine(payload.STATUS_LINE_1_UINT8)[0];
  assert.equal(statusLines.formatValue('pollen', payload, settings), '2-3');
  assert.equal(slot.kind, K.TEXT);
  assert.equal(slot.icon, I.POLLEN);
  assert.equal(slot.text, '2-3');
});

test('pollen slot shows -- when POLLEN_TODAY is null or absent', () => {
  const settings = baseSettings({ provider: 'dwd', statusForecastLeft: 'pollen' });
  const missing = basePayload();
  statusLines.buildStatusLines(missing, settings, WATCH_BASALT);
  assert.equal(decodeLine(missing.STATUS_LINE_1_UINT8)[0].text, '--');

  const nullValue = Object.assign(basePayload(), { POLLEN_TODAY: null });
  statusLines.buildStatusLines(nullValue, settings, WATCH_BASALT);
  assert.equal(decodeLine(nullValue.STATUS_LINE_1_UINT8)[0].text, '--');
});

test('every baked line validates against the caps', () => {
  const p = basePayload();
  statusLines.buildStatusLines(p, baseSettings(), WATCH_EMERY);
  ['STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8',
   'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8'].forEach(k => {
    assert.ok(Array.isArray(p[k]), k + ' present');
    assert.ok(p[k].length >= 9 && p[k].length <= catalog.CAPS.LINE_MAX, k + ' size');
  });
});

test('week slot bakes as a LIVE_WEEK kind (watch renders it live, no baked text)', () => {
  const payload = basePayload();
  statusLines.buildStatusLines(payload, baseSettings({ statusForecastLeft: 'week' }), WATCH_BASALT);
  const slots = decodeLine(payload.STATUS_LINE_1_UINT8);
  assert.equal(slots[0].kind, K.LIVE_WEEK);
  assert.equal(slots[0].icon, I.NONE);
  assert.equal(slots[0].len, 0);
});

test('week slot bakes as phone-baked TEXT on aplite', () => {
  const payload = basePayload();
  statusLines.buildStatusLines(payload, baseSettings({ statusForecastLeft: 'week' }), WATCH_APLITE);
  const slots = decodeLine(payload.STATUS_LINE_1_UINT8);
  assert.equal(slots[0].kind, K.TEXT);
  assert.equal(slots[0].icon, I.NONE);
  // value is "W" + 1..53
  assert.match(slots[0].text, /^W([1-9]|[1-4][0-9]|5[0-3])$/);
});

test('isoWeek matches known ISO-8601 week numbers', () => {
  assert.equal(statusLines.isoWeek(new Date(2021, 0, 4)), 1);
  assert.equal(statusLines.isoWeek(new Date(2021, 0, 1)), 53); // belongs to 2020 (leap, Jan1=Wed)
  assert.equal(statusLines.isoWeek(new Date(2023, 0, 1)), 52); // Sun, belongs to 2022
  assert.equal(statusLines.isoWeek(new Date(2024, 0, 1)), 1);
  assert.equal(statusLines.isoWeek(new Date(2020, 11, 31)), 53);
});

test('pressure slot renders the rounded value with its unit (text-only icon id)', () => {
  const bytes = statusLines.packLine(
    catalog.LINES[1],
    { PRESSURE_TREND: [1013.4, 1014] },
    { statusRadarLeft: 'pressure', statusRadarMid: 'empty', statusRadarRight: 'empty' },
    { platform: 'basalt', color: true, health: true });
  assert.equal(bytes[0], catalog.KINDS.TEXT);
  // PRESSURE discriminates the slot from city on the wire (per-kind bold mode);
  // the watch never loads a glyph for it, so the slot still renders text-only.
  assert.equal(bytes[1], catalog.ICONS.PRESSURE);
  assert.equal(bytes[2], 7);
  assert.equal(Buffer.from(bytes.slice(3, 10)).toString('utf8'), '1013hPa');
});

test('pressure slot shows -- when PRESSURE_TREND is empty or absent', () => {
  for (const payload of [{ PRESSURE_TREND: [] }, {}]) {
    const bytes = statusLines.packLine(
      catalog.LINES[1], payload,
      { statusRadarLeft: 'pressure', statusRadarMid: 'empty', statusRadarRight: 'empty' },
      { platform: 'basalt', color: true, health: true });
    assert.equal(Buffer.from(bytes.slice(3, 3 + bytes[2])).toString('utf8'), '--');
  }
});

test('pressure text fits the 8-byte edge cap at every plausible value', () => {
  for (const hpa of [870, 999.6, 1013, 1050]) {
    const text = statusLines.formatValue('pressure', { PRESSURE_TREND: [hpa] }, {}, 'statusRadarLeft');
    assert.ok(statusLines.utf8Encode(text).length <= catalog.CAPS.EDGE_TEXT_MAX,
      `"${text}" exceeds EDGE_TEXT_MAX`);
  }
});

// Five of six providers (dwd/metno/openweathermap/tomorrowio/wunderground) zero-fill an
// unreported hour rather than null-filling it, so PRESSURE_TREND[0] === 0 is a common
// real-world case, not a hypothetical. The graph line already rejects 0 as implausible
// (forecast-series.pressurePermille) and turns itself off; the status slot must agree,
// not print a bogus "0hPa" as though it were a real reading.
test('pressure slot shows -- for an implausible current-hour value (provider zero-fill), not "0hPa"', () => {
  const text = statusLines.formatValue('pressure', { PRESSURE_TREND: [0, 1013] }, {}, 'statusRadarLeft');
  assert.equal(text, '--');
});

// DEW_TREND carries the provider's UNROUNDED °F value (Part 1 keeps full precision
// so the °C conversion rounds once, not twice), so the °F path has to round too --
// a raw 53.6 would otherwise render as the nonsense "53.6" in an 8-byte slot.
test('dew point renders as a bare rounded number in both units', () => {
  const p = { DEW_TREND: [53.6] }; // 53.6F = 12.0C
  assert.equal(statusLines.formatValue('dew', p, { temperatureUnits: 'c' }, 'statusRadarLeft'), '12');
  assert.equal(statusLines.formatValue('dew', p, { temperatureUnits: 'f' }, 'statusRadarLeft'), '54');
  // Negative readings keep their sign and stay bare (the droplets icon carries context).
  const cold = { DEW_TREND: [-4.3] }; // -4.3F = -20.2C
  assert.equal(statusLines.formatValue('dew', cold, { temperatureUnits: 'c' }, 'statusRadarLeft'), '-20');
  assert.equal(statusLines.formatValue('dew', cold, { temperatureUnits: 'f' }, 'statusRadarLeft'), '-4');
});

test('dew point degrades to -- when unsourced', () => {
  for (const payload of [{}, { DEW_TREND: [] }, { DEW_TREND: [null] }]) {
    assert.equal(statusLines.formatValue('dew', payload, { temperatureUnits: 'c' },
      'statusRadarLeft'), '--', JSON.stringify(payload));
    assert.equal(statusLines.formatValue('dew', payload, { temperatureUnits: 'f' },
      'statusRadarLeft'), '--', JSON.stringify(payload));
  }
});

test('dew point text fits the 8-byte edge cap at every plausible value', () => {
  // -60..100 °F spans every dew point the planet produces, in both units.
  for (let f = -60; f <= 100; f += 1) {
    for (const units of ['c', 'f']) {
      const text = statusLines.formatValue('dew', { DEW_TREND: [f] },
        { temperatureUnits: units }, 'statusRadarLeft');
      assert.ok(statusLines.utf8Encode(text).length <= catalog.CAPS.EDGE_TEXT_MAX,
        `"${text}" exceeds EDGE_TEXT_MAX (${f}F as ${units})`);
      assert.match(text, /^-?\d+$/, `"${text}" is not a bare number (${f}F as ${units})`);
    }
  }
});

test('dew point packs as TEXT under its own icon id, on aplite too', () => {
  const settings = {
    statusRadarLeft: 'dew', statusRadarMid: 'empty', statusRadarRight: 'empty',
    temperatureUnits: 'c'
  };
  for (const env of [{ platform: 'basalt', color: true, health: true },
                     { platform: 'aplite', color: false, health: false }]) {
    const bytes = statusLines.packLine(catalog.LINES[1], { DEW_TREND: [53.6] }, settings, env);
    assert.equal(bytes[0], K.TEXT, env.platform + ' kind');
    // Its own icon id even though the glyph is optional: a TEXT slot with
    // ICON_NONE would inherit City's bold mode (status_threshold.h).
    assert.equal(bytes[1], I.DEWPOINT, env.platform + ' icon');
    assert.notEqual(bytes[1], I.NONE, env.platform + ' must not share City\'s id');
    assert.equal(Buffer.from(bytes.slice(3, 3 + bytes[2])).toString('utf8'), '12',
      env.platform + ' text');
  }
});

// --- Wind-direction sentinel -------------------------------------------------
// Wire contract: ONE trailing byte, 0x01 + sector, sector 0..15 = 16 compass
// points of 22.5°, sector 0 = the arrow points NORTH (screen up), counted
// CLOCKWISE, and ALREADY flipped downwind by the phone -- the watch never sees
// the meteorological "comes from" convention. Bytes < 0x80 are valid UTF-8, so
// the arrow rides inside the slot's already-paid-for text bytes for 0 wire cost.
const SENTINEL_BASE = 0x01;

// The raw value bytes of one slot, walking the [kind, icon, len, ...value]
// triples the way status_line.c does. decodeLine() cannot serve here: the
// sentinel is a control byte, not text.
function sliceSlot(bytes, index) {
  let off = 0;
  for (let i = 0; i < index; i++) { off += 3 + bytes[off + 2]; }
  return bytes.slice(off + 3, off + 3 + bytes[off + 2]);
}

function tailByte(slotBytes) { return slotBytes[slotBytes.length - 1]; }

function radarLine() {
  return catalog.LINES.filter(l => l.id === 'radar')[0];
}

// Pack the radar line with one item in the LEFT slot and read that slot back raw.
function slotBytesFor(code, payload, settings, env) {
  const s = Object.assign({
    statusRadarLeft: code, statusRadarMid: 'empty', statusRadarRight: 'empty',
    windUnits: 'kph', temperatureUnits: 'c'
  }, settings || {});
  return sliceSlot(statusLines.packLine(radarLine(), payload, s, env || basaltEnv()), 0);
}

// The same, in the MID slot — the roomy 19-byte cap rather than the 8-byte edge.
function midSlotBytesFor(code, payload, settings, env) {
  const s = Object.assign({
    statusRadarLeft: 'empty', statusRadarMid: code, statusRadarRight: 'empty',
    windUnits: 'kph', temperatureUnits: 'c'
  }, settings || {});
  return sliceSlot(statusLines.packLine(radarLine(), payload, s, env || basaltEnv()), 1);
}

function assertPlainText(slotBytes, expected, message) {
  assert.equal(Buffer.from(slotBytes).toString('utf8'), expected, message);
  slotBytes.forEach((b) => assert.ok(b >= 0x20,
    (message || '') + ' — unexpected control byte ' + b));
}

test('a westerly (from 270) points east: sector 4', () => {
  const slot = slotBytesFor('wind', { WIND_TREND_UINT8: [17], WIND_DIR_TREND: [270] },
    { windSlotDirection: true });
  assert.equal(Buffer.from(slot.slice(0, slot.length - 1)).toString('utf8'), '17kph');
  assert.equal(tailByte(slot), SENTINEL_BASE + 4);
});

test('a north wind (from 0) points south: sector 8', () => {
  const slot = slotBytesFor('wind', { WIND_TREND_UINT8: [17], WIND_DIR_TREND: [0] },
    { windSlotDirection: true });
  assert.equal(tailByte(slot), SENTINEL_BASE + 8);
});

test('every bearing yields a byte inside 0x01..0x10 — round() never wraps to 16', () => {
  // 350 is the case the reviewer flagged: it must not round out of the sector
  // range. The real wrap lives at downwind >= 348.75, i.e. a "from" in
  // [168.75, 180) -- 170 flips to 350 and must come back as sector 0, not 16.
  assert.equal(tailByte(slotBytesFor('wind',
    { WIND_TREND_UINT8: [17], WIND_DIR_TREND: [350] }, { windSlotDirection: true })),
    SENTINEL_BASE + 8, 'from 350 flips to 170 -> sector 8');
  assert.equal(tailByte(slotBytesFor('wind',
    { WIND_TREND_UINT8: [17], WIND_DIR_TREND: [170] }, { windSlotDirection: true })),
    SENTINEL_BASE, 'from 170 flips to 350 -> sector 0, never 16');
  // Met.no reports one decimal, so non-integer bearings are real traffic.
  for (let from = 0; from < 360; from += 0.1) {
    const b = tailByte(slotBytesFor('wind',
      { WIND_TREND_UINT8: [17], WIND_DIR_TREND: [Math.round(from * 10) / 10] },
      { windSlotDirection: true }));
    assert.ok(b >= 0x01 && b <= 0x10, `bearing ${from} produced byte ${b}`);
  }
});

test('no sentinel when the toggle is off', () => {
  assertPlainText(slotBytesFor('wind',
    { WIND_TREND_UINT8: [17], WIND_DIR_TREND: [270] }, {}), '17kph', 'absent toggle');
  assertPlainText(slotBytesFor('wind',
    { WIND_TREND_UINT8: [17], WIND_DIR_TREND: [270] }, { windSlotDirection: false }),
    '17kph', 'toggle off');
});

test('no sentinel when the bearing is unsourced', () => {
  for (const trend of [undefined, [], [null]]) {
    const payload = { WIND_TREND_UINT8: [17] };
    if (trend !== undefined) { payload.WIND_DIR_TREND = trend; }
    assertPlainText(slotBytesFor('wind', payload, { windSlotDirection: true }),
      '17kph', JSON.stringify(trend));
  }
});

// The speed and the bearing fail INDEPENDENTLY: a provider can report a bearing
// for an hour whose speed is missing. An arrow beside a dead reading would read
// as live data next to nothing.
test('no sentinel when the slot text is --', () => {
  assertPlainText(slotBytesFor('wind', { WIND_DIR_TREND: [270] },
    { windSlotDirection: true }), '--', 'speed missing, bearing present');
  assertPlainText(slotBytesFor('gust', { WIND_DIR_TREND: [270] },
    { gustSlotDirection: true }), '--', 'gust speed missing');
});

test('never sent to aplite (its lean status-row twin would draw a glyph box)', () => {
  assertPlainText(slotBytesFor('wind',
    { WIND_TREND_UINT8: [17], WIND_DIR_TREND: [270] }, { windSlotDirection: true },
    { platform: 'aplite', color: false, health: false }), '17kph');
});

test('the gust slot obeys gustSlotDirection, not windSlotDirection', () => {
  const payload = { GUST_TREND_UINT8: [48], WIND_DIR_TREND: [270] };
  assert.equal(tailByte(slotBytesFor('gust', payload, { gustSlotDirection: true })),
    SENTINEL_BASE + 4, 'own toggle on');
  assertPlainText(slotBytesFor('gust', payload,
    { windSlotDirection: true, gustSlotDirection: false }), '48kph',
    'the wind toggle must not reach the gust slot');
  // ...and the reverse: the gust toggle must not reach the wind slot.
  assertPlainText(slotBytesFor('wind',
    { WIND_TREND_UINT8: [17], WIND_DIR_TREND: [270] },
    { gustSlotDirection: true, windSlotDirection: false }), '17kph');
});

test('no other slot kind ever gets a sentinel', () => {
  const both = { windSlotDirection: true, gustSlotDirection: true };
  const payload = {
    CURRENT_TEMP: 68, CITY: 'Berlin', UV_TREND_UINT8: [64],
    PRESSURE_TREND: [1013], DEW_TREND: [53.6], AQI_TREND: [42],
    WIND_DIR_TREND: [270]
  };
  const expected = {
    temp: '20', city: 'Berlin', uv: '6', pressure: '1013hPa', dew: '12', aqi: '42'
  };
  Object.keys(expected).forEach((code) => {
    assertPlainText(slotBytesFor(code, payload, both), expected[code], code);
  });
});

test('the sentinel never pushes a slot past its 8-byte edge cap', () => {
  for (const unit of ['kph', 'mph', 'knots']) {
    for (let v = 0; v <= 255; v += 1) {
      const slot = slotBytesFor('wind', { WIND_TREND_UINT8: [v], WIND_DIR_TREND: [180] },
        { windUnits: unit, windSlotDirection: true });
      assert.ok(slot.length <= catalog.CAPS.EDGE_TEXT_MAX,
        `${v} ${unit} overflows the 8-byte edge cap (${slot.length} B)`);
      // from 180 flips to downwind 0 -> sector 0 -> 0x01, and it must survive
      // every speed: the guard only drops it if the text already fills the cap.
      assert.equal(tailByte(slot), SENTINEL_BASE, `${v} ${unit} lost its arrow`);
    }
  }
});

// --- Per-kind "Show unit" toggles --------------------------------------------
// Six slots whose text the PHONE bakes each carry their own unit switch. The
// four watch-formatted slots (distance, heart rate, sleep, battery %) are out of
// scope: their flag would have to ride the wire.
//
// The DEFAULTS are chosen so nothing changes appearance until a user flips a
// switch — the four slots that show a unit today default ON, the two bare ones
// default OFF — and the "absent setting" test below is what pins that.
//
// Temperature and dew point get the DEGREE SIGN ALONE (U+00B0, TWO UTF-8 bytes),
// never '°C'/'°F': the letter would duplicate the global temperature-unit
// setting, and those two bytes are what makes the 8-byte edge cap interesting.
const DEG = '°';

// A YYYY-MM-DD target n whole local days from today. formatValue() reaches for
// the real clock (no injectable now), so the fixture has to move with it.
function daysAheadDate(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p2 = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

const UNIT_CASES = [
  { code: 'wind', key: 'windSlotUnit', on: true,
    payload: { WIND_TREND_UINT8: [12] }, withUnit: '12kph', bare: '12' },
  { code: 'gust', key: 'gustSlotUnit', on: true,
    payload: { GUST_TREND_UINT8: [24] }, withUnit: '24kph', bare: '24' },
  { code: 'pressure', key: 'pressureSlotUnit', on: true,
    payload: { PRESSURE_TREND: [1013] }, withUnit: '1013hPa', bare: '1013' },
  { code: 'countdown', key: 'countdownSlotUnit', on: true,
    payload: {}, extra: () => ({ statusRadarLeftCountdown: daysAheadDate(5) }),
    withUnit: '5d', bare: '5' },
  { code: 'temp', key: 'tempSlotUnit', on: false,
    payload: { CURRENT_TEMP: 53.6 }, withUnit: '12' + DEG, bare: '12' },
  { code: 'dew', key: 'dewSlotUnit', on: false,
    payload: { DEW_TREND: [53.6] }, withUnit: '12' + DEG, bare: '12' }
];

// One case's slot text, with `override` merged over the case's own settings.
function unitText(c, override) {
  const settings = Object.assign(baseSettings(),
    c.extra ? c.extra() : {}, override || {});
  return statusLines.formatValue(c.code, c.payload, settings, 'statusRadarLeft');
}

test('every unit-bearing slot appends its unit only when its own toggle is on', () => {
  UNIT_CASES.forEach((c) => {
    assert.equal(unitText(c, { [c.key]: true }), c.withUnit, c.code + ' on');
    assert.equal(unitText(c, { [c.key]: false }), c.bare, c.code + ' off');
  });
});

test('an ABSENT unit setting renders exactly what this build renders today', () => {
  // A settings blob written before the feature has none of these keys. Each slot
  // must fall back to its own default: wind/gust/pressure/countdown keep their
  // unit, temp/dew stay bare. Anything else is a silent appearance change on
  // upgrade for every existing user.
  UNIT_CASES.forEach((c) => {
    assert.equal(unitText(c, {}), c.on ? c.withUnit : c.bare,
      c.code + ': absent must mean ' + c.on);
    assert.equal(unitText(c, { [c.key]: undefined }), c.on ? c.withUnit : c.bare,
      c.code + ': explicit undefined is still absent');
  });
});

test('one slot\'s unit toggle never reaches another slot', () => {
  // All six keys forced the WRONG way round: every default-on slot off, every
  // default-off slot on. Each case must follow its own key, not a neighbour's.
  const crossed = {};
  UNIT_CASES.forEach((c) => { crossed[c.key] = !c.on; });
  UNIT_CASES.forEach((c) => {
    assert.equal(unitText(c, crossed), c.on ? c.bare : c.withUnit, c.code);
  });
});

test('countdown "now" and "--" carry no unit in either toggle state', () => {
  const now = new Date(2028, 1, 28, 17, 45);
  [true, false, undefined].forEach((flag) => {
    assert.equal(statusLines.formatCountdown('2028-02-28', now, flag), 'now',
      'today, showUnit=' + flag);
    assert.equal(statusLines.formatCountdown('2028-02-27', now, flag), '--',
      'passed, showUnit=' + flag);
  });
  // ...and through formatValue, where the target date is today by default.
  const s = baseSettings({ countdownSlotUnit: true });
  assert.equal(statusLines.formatValue('countdown', {}, s, 'statusRadarLeft'), 'now');
});

test('an unavailable reading stays "--" with the unit on', () => {
  // '--' is the absence marker, not a value: '--kph' or '--°' would read as a
  // measurement of nothing.
  const on = {
    windSlotUnit: true, gustSlotUnit: true, pressureSlotUnit: true,
    tempSlotUnit: true, dewSlotUnit: true
  };
  const empty = {};
  ['wind', 'gust', 'pressure', 'temp', 'dew'].forEach((code) => {
    assert.equal(statusLines.formatValue(code, empty, baseSettings(on),
      'statusRadarLeft'), '--', code);
  });
});

// THE HARD CASE. '-12/-10' is 7 bytes and the degree sign is 2, so the edge
// slot's 8-byte cap cannot hold both. utf8Truncate would chop the degree back
// off at the code-point boundary — the slot would look untouched while silently
// ignoring the setting — so the unit is appended only when it actually fits.
test('both-mode never takes a degree, whatever is stored or however wide it is', () => {
  // The two are mutually exclusive: the settings page keeps them apart, and this
  // is the authoritative gate for a blob that predates that. Deciding by WIDTH
  // instead would make the degree appear and vanish with the digit count as the
  // day warmed up, and differ between an edge slot and a mid slot.
  const wide = Object.assign(basePayload(), { CURRENT_TEMP: 10, FEELS_CURRENT: 14 });
  const narrow = Object.assign(basePayload(), { CURRENT_TEMP: 68, FEELS_CURRENT: 50 });
  const s = baseSettings({ tempSlotDisplay: 'both', tempSlotUnit: true });

  assert.equal(statusLines.formatValue('temp', wide, s, 'statusRadarLeft',
    catalog.CAPS.EDGE_TEXT_MAX), '-12/-10');
  assertPlainText(slotBytesFor('temp', wide, s), '-12/-10', 'packed edge slot');
  // A mid slot has 19 bytes to spare and still gets no degree — the rule is the
  // mode, not the room.
  assert.equal(statusLines.formatValue('temp', wide, s, 'statusForecastMid',
    catalog.CAPS.MID_TEXT_MAX), '-12/-10');
  // And a value that would comfortably fit one still does not get it.
  assert.equal(statusLines.formatValue('temp', narrow, s, 'statusRadarLeft'), '20/10');
});

test('the other two temp modes still take the degree when it is switched on', () => {
  const p = Object.assign(basePayload(), { CURRENT_TEMP: 68, FEELS_CURRENT: 50 });
  assert.equal(statusLines.formatValue('temp', p,
    baseSettings({ tempSlotDisplay: 'actual', tempSlotUnit: true }), 'statusRadarLeft'),
    '20' + DEG);
  assert.equal(statusLines.formatValue('temp', p,
    baseSettings({ tempSlotDisplay: 'feels', tempSlotUnit: true }), 'statusRadarLeft'),
    '10' + DEG);
});

test('no unit ever pushes a slot past its 8-byte edge cap', () => {
  const fits = (text, what) => assert.ok(
    statusLines.utf8Encode(text).length <= catalog.CAPS.EDGE_TEXT_MAX,
    `"${text}" exceeds EDGE_TEXT_MAX (${what})`);

  // Wind + gust: the whole uint8 wire range in all three units.
  for (const unit of ['kph', 'mph', 'knots']) {
    for (let v = 0; v <= 255; v += 1) {
      fits(statusLines.formatValue('wind', { WIND_TREND_UINT8: [v] },
        baseSettings({ windUnits: unit, windSlotUnit: true }), 'statusRadarLeft'),
        `wind ${v} ${unit}`);
      fits(statusLines.formatValue('gust', { GUST_TREND_UINT8: [v] },
        baseSettings({ windUnits: unit, gustSlotUnit: true }), 'statusRadarLeft'),
        `gust ${v} ${unit}`);
    }
  }
  // Pressure: the full plausibility window (800..1100 hPa).
  for (let hpa = 800; hpa <= 1100; hpa += 1) {
    fits(statusLines.formatValue('pressure', { PRESSURE_TREND: [hpa] },
      baseSettings({ pressureSlotUnit: true }), 'statusRadarLeft'), `${hpa} hPa`);
  }
  // Temperature + dew: -80..140 °F covers the planet, in both display units,
  // and the temp slot in all three display modes.
  for (let f = -80; f <= 140; f += 1) {
    for (const units of ['c', 'f']) {
      for (const mode of ['actual', 'feels', 'both']) {
        fits(statusLines.formatValue('temp',
          { CURRENT_TEMP: f, FEELS_CURRENT: f - 8 },
          baseSettings({ temperatureUnits: units, tempSlotDisplay: mode,
                         tempSlotUnit: true }), 'statusRadarLeft'),
          `temp ${f}F ${units} ${mode}`);
      }
      fits(statusLines.formatValue('dew', { DEW_TREND: [f] },
        baseSettings({ temperatureUnits: units, dewSlotUnit: true }),
        'statusRadarLeft'), `dew ${f}F ${units}`);
    }
  }
  // Countdown: today out to the far end of the four-digit year the picker allows.
  const now = new Date(2026, 0, 1);
  for (const target of ['2026-01-02', '2026-04-11', '2029-01-01', '9999-12-31']) {
    fits(statusLines.formatCountdown(target, now, true), 'countdown ' + target);
  }
});

test('the direction arrow still rides along when the wind unit is off', () => {
  const slot = slotBytesFor('wind', { WIND_TREND_UINT8: [12], WIND_DIR_TREND: [270] },
    { windSlotDirection: true, windSlotUnit: false });
  assert.equal(Buffer.from(slot.slice(0, slot.length - 1)).toString('utf8'), '12',
    'bare number, arrow byte stripped');
  assert.equal(tailByte(slot), SENTINEL_BASE + 4, 'westerly still points east');
  // Both toggles, every speed and unit: the arrow survives with the unit either way.
  for (const unit of ['kph', 'mph', 'knots']) {
    for (const showUnit of [true, false]) {
      for (let v = 0; v <= 255; v += 1) {
        const s = slotBytesFor('wind',
          { WIND_TREND_UINT8: [v], WIND_DIR_TREND: [180] },
          { windUnits: unit, windSlotDirection: true, windSlotUnit: showUnit });
        assert.ok(s.length <= catalog.CAPS.EDGE_TEXT_MAX,
          `${v} ${unit} unit=${showUnit} overflows (${s.length} B)`);
        assert.equal(tailByte(s), SENTINEL_BASE,
          `${v} ${unit} unit=${showUnit} lost its arrow`);
      }
    }
  }
});

// --- Phone battery ---------------------------------------------------------
// The one status item with nothing to do with the weather fetch: the phone bakes
// its OWN charge into the slot's text, and picks the icon id per bake so charging
// reaches the watch inside a byte the slot already pays for (no wire field, no C
// plumbing). Android only — see phone-battery.js and test/phone-battery.test.js.
//
// The text is the EXACT percentage. phone-battery.js's 5-point bucket decides
// only WHEN a resend fires; baking it would show a phone at 31% as "30%", which
// is precisely the on-device bug this pair of jobs was split to fix.

test('phone battery renders the cached percentage as NN%, both codes alike', () => {
  setPhoneBattery(87, false);
  assert.equal(statusLines.formatValue('phoneBattery', {}, {}, 'statusForecastLeft'), '87%');
  assert.equal(statusLines.formatValue('phoneBatteryPlain', {}, {}, 'statusForecastLeft'), '87%');
  // The two items differ only in the icon they pack; the text is identical.
  setPhoneBattery(0, false);
  assert.equal(statusLines.formatValue('phoneBattery', {}, {}, 'statusForecastLeft'), '0%');
  setPhoneBattery(100, true);
  assert.equal(statusLines.formatValue('phoneBattery', {}, {}, 'statusForecastLeft'), '100%',
    'charging changes the icon, never the text');
  assert.equal(statusLines.formatValue('phoneBatteryPlain', {}, {}, 'statusForecastLeft'), '100%');
});

test('the reported percentage is never rounded to a 5-point step', () => {
  // "it 31% on my phone but shows 30% when plugging in" — the send trigger may
  // quantize, the display must not. Every value the phone can report survives
  // the bake intact.
  [31, 30, 1, 7, 49, 63, 99].forEach((pct) => {
    setPhoneBattery(pct, false);
    assert.equal(statusLines.formatValue('phoneBattery', {}, {}, 'statusForecastLeft'), pct + '%');
    assert.equal(statusLines.formatValue('phoneBatteryPlain', {}, {}, 'statusForecastLeft'), pct + '%');
  });
});

test('phone battery is -- with no reading, and on a phone that cannot report one', () => {
  // '--' covers "Android, but no event has landed yet" and "no battery API at
  // all". It is also what the watch substitutes while Bluetooth is down
  // (status_row.c's freshness rule), so the two paths agree by construction.
  setPhoneBattery(null);
  assert.equal(statusLines.formatValue('phoneBattery', {}, {}, 'statusForecastLeft'), '--');
  assert.equal(statusLines.formatValue('phoneBatteryPlain', {}, {}, 'statusForecastLeft'), '--');
  clearPhoneBattery();
  assert.equal(statusLines.formatValue('phoneBattery', {}, {}, 'statusForecastLeft'), '--');
  assert.equal(statusLines.formatValue('phoneBatteryPlain', {}, {}, 'statusForecastLeft'), '--');
});

test('phone battery text fits the narrow edge cap at every whole percentage', () => {
  // Every value 0..100 now, not just the 5-point steps: any of them can be baked.
  for (let pct = 0; pct <= 100; pct += 1) {
    for (const charging of [false, true]) {
      setPhoneBattery(pct, charging);
      const text = statusLines.formatValue('phoneBattery', {}, {}, 'statusForecastLeft');
      assert.ok(statusLines.utf8Encode(text).length <= catalog.CAPS.EDGE_TEXT_MAX,
        `${pct}% overflows the edge slot`);
    }
  }
});

test('charging swaps the packed icon id, and only for the icon-bearing item', () => {
  const env = Object.assign(basaltEnv(), { phoneBattery: true });
  const line = forecastLine();
  const sel = (code) => ({ statusForecastLeft: code, statusForecastMid: 'empty',
                           statusForecastRight: 'empty' });

  setPhoneBattery(63, false);
  let slot = decodeLine(statusLines.packLine(line, {}, sel('phoneBattery'), env))[0];
  assert.equal(slot.kind, catalog.KINDS.TEXT);
  assert.equal(slot.icon, catalog.ICONS.PHONE_BATTERY);
  assert.equal(slot.text, '63%');

  setPhoneBattery(63, true);
  slot = decodeLine(statusLines.packLine(line, {}, sel('phoneBattery'), env))[0];
  assert.equal(slot.icon, catalog.ICONS.PHONE_BATTERY_CHG, 'charging glyph, same text');
  assert.equal(slot.text, '63%');

  // The no-icon variant draws nothing in either state, so its id never varies.
  // It still needs an id of its own: TEXT + ICON_NONE maps to THRESH_CITY on the
  // watch, so without one its Bold row would silently drive City.
  for (const charging of [false, true]) {
    setPhoneBattery(63, charging);
    slot = decodeLine(statusLines.packLine(line, {}, sel('phoneBatteryPlain'), env))[0];
    assert.equal(slot.icon, catalog.ICONS.PHONE_BATTERY_PLAIN, `plain, charging=${charging}`);
    assert.equal(slot.text, '63%');
  }
});

test('an unreadable phone battery still packs its slot, as --', () => {
  const env = Object.assign(basaltEnv(), { phoneBattery: true });
  setPhoneBattery(null);
  const slot = decodeLine(statusLines.packLine(forecastLine(), {},
    { statusForecastLeft: 'phoneBattery', statusForecastMid: 'empty',
      statusForecastRight: 'empty' }, env))[0];
  assert.equal(slot.icon, catalog.ICONS.PHONE_BATTERY, 'not the charging glyph');
  assert.equal(slot.text, '--');
});

test('buildStatusLines derives env.phoneBattery from the persisted detector verdict', () => {
  // computeEnv() knows only WATCH facts; the gate is a PHONE fact. Without the
  // flag being added inside buildStatusLines, itemAvailable() fails and the slot
  // silently collapses to empty even on a phone that CAN read its battery.
  const settings = baseSettings({ statusForecastLeft: 'phoneBattery',
    statusForecastMid: 'empty', statusForecastRight: 'empty' });

  setPhoneBattery(47, false);
  let p = basePayload();
  statusLines.buildStatusLines(p, settings, WATCH_BASALT);
  let slot = decodeLine(p.STATUS_LINE_1_UINT8)[0];
  assert.equal(slot.icon, catalog.ICONS.PHONE_BATTERY);
  assert.equal(slot.text, '47%');

  // No battery API on this phone: the item is not available, so the slot
  // resolves to 'empty' rather than baking a made-up value.
  clearPhoneBattery();
  p = basePayload();
  statusLines.buildStatusLines(p, settings, WATCH_BASALT);
  slot = decodeLine(p.STATUS_LINE_1_UINT8)[0];
  assert.equal(slot.kind, catalog.KINDS.EMPTY);
  assert.equal(slot.text, '');
});

// ── SOURCE_KEYS is the snapshot contract ──────────────────────────────────────
//
// phone-battery.js persists exactly the payload slice named by SOURCE_KEYS so a
// charging event can re-bake after a PKJS restart. If a new slot starts reading a
// payload key that is not on the list, the key is absent from the restored blob
// and that slot silently re-bakes as '--' -- no throw, no failing assertion, just
// a wrong watchface after every relaunch. So pin the list to the code: scan both
// baking modules for payload.<KEY> accesses and require the list to match.
//
// Deliberately an exact set equality, not a subset check: an EXTRA key on the list
// is dead weight persisted to flash on every fetch, which is worth catching too.
test('SOURCE_KEYS matches every payload key the bake reads', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const SRC = path.join(__dirname, '..', 'src', 'pkjs');
  const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

  // Written by the bake, never read from an incoming payload — so not snapshot input.
  const WRITTEN = new Set(['STATUS_LEVELS_UINT8']);

  const seen = new Set();
  for (const file of ['status-lines.js', 'status-thresholds.js']) {
    for (const m of read(file).matchAll(/payload\.([A-Z][A-Z_0-9]*)/g)) {
      if (!WRITTEN.has(m[1])) { seen.add(m[1]); }
    }
  }

  const declared = new Set(statusLines.SOURCE_KEYS);
  const missing = [...seen].filter((k) => !declared.has(k)).sort();
  const extra = [...declared].filter((k) => !seen.has(k)).sort();

  assert.deepEqual(missing, [], 'payload keys read by the bake but absent from '
    + 'status-lines.js SOURCE_KEYS -- they would restore as undefined after a PKJS '
    + 'restart and re-bake as "--". Add them and bump SNAPSHOT_VERSION in phone-battery.js.');
  assert.deepEqual(extra, [], 'keys on SOURCE_KEYS that the bake never reads -- '
    + 'dead weight persisted to flash on every fetch.');
  assert.ok(declared.size > 0);
});
