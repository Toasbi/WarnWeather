const test = require('node:test');
const assert = require('node:assert');
const statusLines = require('../src/pkjs/status-lines.js');
const catalog = require('../src/pkjs/status-line-catalog.js');

const K = catalog.KINDS, I = catalog.ICONS;
const WATCH_BASALT = { platform: 'basalt' };
const WATCH_EMERY = { platform: 'emery' };

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
    GUST_TREND_UINT8: [48],
    PRECIP_TREND_UINT8: [80]
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
  assert.equal(statusLines.formatValue('precip_prob', p, baseSettings()), '80%');
  assert.equal(statusLines.formatValue('city', p, baseSettings()), 'Saarbrücken');
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
  assert.equal(forecast[2].icon, I.DRAWN_SUN);

  const radar = decodeLine(p.STATUS_LINE_2_UINT8);
  assert.equal(radar[1].text, 'Saarbrücken');

  const top = decodeLine(p.STATUS_LINE_3_UINT8);
  assert.equal(top[0].kind, K.EMPTY);
  assert.equal(top[1].kind, K.LIVE_DATE); // mid slot is selectable; defaults to date
  assert.equal(top[2].kind, K.LIVE_BATTERY); // default right = battery

  const health = decodeLine(p.STATUS_LINE_4_UINT8);
  assert.deepEqual(health.map(s => s.kind), [K.LIVE_STEPS, K.EMPTY, K.LIVE_SLEEP]);
  assert.deepEqual(health.map(s => s.len), [0, 0, 0]); // LIVE = no value bytes
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
  // default: empty / date / battery
  let slots = decodeLine(statusLines.packLine(topLine, p, baseSettings(), env));
  assert.deepEqual(slots.map(s => s.kind), [K.EMPTY, K.LIVE_DATE, K.LIVE_BATTERY]);
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
