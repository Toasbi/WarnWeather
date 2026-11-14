'use strict';
// src/pkjs/weather/domain/condition.js: the weather condition slot's vocabulary (the owner's list,
// 2026-11-13) and each provider's codes mapped into it.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/pkjs/weather/domain/condition.js');
const catalog = require('../src/pkjs/status-bars/domain/status-line-catalog.js');

test('the list: full names and short forms as approved, RAIN and SNOW for every intensity', () => {
  const rows = Object.keys(C.CONDITIONS).map((id) => [id, C.names(id, false).full, C.names(id, false).short]);
  assert.deepEqual(rows, [
    ['clear', 'Sunny', 'SUN'], ['fair', 'Fair', 'FAIR'], ['partly', 'Partly cloudy', 'PCLDY'],
    ['mostly', 'Mostly cloudy', 'MCLDY'], ['cloudy', 'Cloudy', 'CLDY'], ['fog', 'Fog', 'FOG'],
    ['haze', 'Haze', 'HAZE'], ['drizzle', 'Drizzle', 'DRZL'], ['lightrain', 'Light rain', 'RAIN'],
    ['rain', 'Rain', 'RAIN'], ['heavyrain', 'Heavy rain', 'RAIN'], ['showers', 'Showers', 'SHWR'],
    ['freezing', 'Freezing rain', 'FZRA'], ['sleet', 'Sleet', 'SLT'], ['lightsnow', 'Light snow', 'SNOW'],
    ['snow', 'Snow', 'SNOW'], ['heavysnow', 'Heavy snow', 'SNOW'], ['snowshowers', 'Snow showers', 'SNOW'],
    ['hail', 'Hail', 'HAIL'], ['thunder', 'Thunderstorm', 'TSTM'], ['windy', 'Windy', 'WNDY']
  ]);
  assert.deepEqual(C.names('clear', true), { full: 'Clear', short: 'CLR' }, 'a clear night');
  assert.deepEqual(C.names('rain', true), C.names('rain', false), 'the rest read the same by night');
  assert.equal(C.names('nope', false), null);
});

// The owner's, 2026-11-14: a name ending in -y keeps its Y in the short form (CLDY, WNDY, PCLDY).
test('the cloudy kinds\' short forms end in Y', () => {
  assert.deepEqual(['partly', 'mostly', 'cloudy', 'windy'].map((id) => C.names(id, false).short),
    ['PCLDY', 'MCLDY', 'CLDY', 'WNDY']);
});

test('every name fits the middle slot with its short form, and every short form an edge slot', () => {
  Object.keys(C.CONDITIONS).forEach((id) => [false, true].forEach((night) => {
    const n = C.names(id, night);
    // The middle slot carries both: full, a separator byte, short (slot-text.js conditionText).
    assert.ok(Buffer.byteLength(n.full + catalog.ALT_SEP + n.short) <= catalog.CAPS.MID_TEXT_MAX, id + ' fits the middle slot');
    // At most five capitals (status_line.h STATUS_TEXT_ALT_MAX: PCLDY, MCLDY), which an edge
    // slot's 8 bytes hold too.
    assert.ok(n.short.length <= 5 && /^[A-Z]+$/.test(n.short), id + ': ' + n.short);
  }));
});

test('glyphs: sun and moon by day and night, a cloud for both cloudy kinds', () => {
  assert.equal(C.glyph('clear', false), 'COND_SUN');
  assert.equal(C.glyph('clear', true), 'COND_MOON');
  assert.equal(C.glyph('partly', true), 'COND_MOON_CLOUD');
  assert.equal(C.glyph('fair', false), 'COND_SUN_CLOUD');
  assert.equal(C.glyph('cloudy', true), 'COND_CLOUD');
  assert.equal(C.glyph('mostly', false), 'COND_CLOUD');
  assert.equal(C.glyph('windy', false), 'COND_WIND');
  assert.equal(C.glyph('x', false), null);
});

test('WMO (Open-Meteo)', () => {
  const cases = { 0: 'clear', 1: 'fair', 2: 'partly', 3: 'cloudy', 45: 'fog', 48: 'fog', 51: 'drizzle', 55: 'drizzle',
    56: 'freezing', 67: 'freezing', 61: 'lightrain', 63: 'rain', 65: 'heavyrain', 71: 'lightsnow', 73: 'snow',
    75: 'heavysnow', 77: 'snow', 80: 'showers', 82: 'showers', 85: 'snowshowers', 95: 'thunder', 99: 'thunder' };
  Object.keys(cases).forEach((k) => assert.equal(C.fromWmo(Number(k)), cases[k], 'WMO ' + k));
  [null, undefined, '', 'x', 4, 100].forEach((v) => assert.equal(C.fromWmo(v), null, String(v)));
});

test('met.no symbol codes, any suffix, thunder whatever it comes with', () => {
  assert.equal(C.fromMetno('clearsky_day'), 'clear');
  assert.equal(C.fromMetno('clearsky_polartwilight'), 'clear');
  assert.equal(C.fromMetno('fair_night'), 'fair');
  assert.equal(C.fromMetno('partlycloudy_day'), 'partly');
  assert.equal(C.fromMetno('cloudy'), 'cloudy');
  assert.equal(C.fromMetno('fog'), 'fog');
  assert.equal(C.fromMetno('lightrain'), 'lightrain');
  assert.equal(C.fromMetno('heavyrainshowers_day'), 'showers');
  assert.equal(C.fromMetno('lightsleetshowers_night'), 'sleet');
  assert.equal(C.fromMetno('heavysnow'), 'heavysnow');
  assert.equal(C.fromMetno('snowshowers_day'), 'snowshowers');
  assert.equal(C.fromMetno('lightrainshowersandthunder_night'), 'thunder');
  assert.equal(C.fromMetno('heavysnowandthunder'), 'thunder');
  [null, '', 'unknown_day', 42].forEach((v) => assert.equal(C.fromMetno(v), null, String(v)));
});

test('Bright Sky (DWD): its icon, else its condition, rain and snow graded by the hour\'s precipitation', () => {
  assert.equal(C.fromBrightsky('clear-night'), 'clear');
  assert.equal(C.fromBrightsky('partly-cloudy-day'), 'partly');
  assert.equal(C.fromBrightsky('wind'), 'windy');
  assert.equal(C.fromBrightsky('hail'), 'hail');
  assert.equal(C.fromBrightsky(null, 'thunderstorm'), 'thunder');
  assert.equal(C.fromBrightsky(undefined, 'dry'), null, 'dry and no icon: nothing to name');
  assert.equal(C.fromBrightsky('rain', 'rain'), 'rain', 'no amount: plain rain');
  assert.equal(C.fromBrightsky('rain', 'rain', 0.2), 'lightrain');
  assert.equal(C.fromBrightsky('rain', 'rain', 1.5), 'rain');
  assert.equal(C.fromBrightsky('rain', 'rain', 6), 'heavyrain');
  assert.equal(C.fromBrightsky('snow', 'snow', 0.1), 'lightsnow');
  assert.equal(C.fromBrightsky('snow', 'snow', 5), 'heavysnow');
  assert.equal(C.fromBrightsky('sleet', 'sleet', 9), 'sleet', 'only rain and snow are graded');
});

test('OpenWeatherMap ids', () => {
  const cases = { 211: 'thunder', 301: 'drizzle', 500: 'lightrain', 501: 'rain', 503: 'heavyrain', 511: 'freezing',
    521: 'showers', 600: 'lightsnow', 601: 'snow', 602: 'heavysnow', 613: 'sleet', 621: 'snowshowers',
    701: 'fog', 741: 'fog', 711: 'haze', 721: 'haze', 762: 'haze', 771: 'windy', 781: 'windy', 800: 'clear',
    801: 'fair', 802: 'partly', 803: 'mostly', 804: 'cloudy' };
  Object.keys(cases).forEach((k) => assert.equal(C.fromOwm(Number(k)), cases[k], 'OWM ' + k));
  assert.equal(C.fromOwm('802'), 'partly', 'a string id too');
  [null, 100, 900].forEach((v) => assert.equal(C.fromOwm(v), null, String(v)));
});

test('tomorrow.io weatherCode', () => {
  const cases = { 1000: 'clear', 1100: 'fair', 1101: 'partly', 1102: 'mostly', 1001: 'cloudy', 2100: 'fog',
    4000: 'drizzle', 4200: 'lightrain', 4001: 'rain', 4201: 'heavyrain', 5001: 'lightsnow', 5000: 'snow',
    5101: 'heavysnow', 6201: 'freezing', 7102: 'sleet', 8000: 'thunder' };
  Object.keys(cases).forEach((k) => assert.equal(C.fromTomorrow(Number(k)), cases[k], 'tomorrow ' + k));
  [0, 1, null, 'x'].forEach((v) => assert.equal(C.fromTomorrow(v), null, String(v)));
});

test('Weather Underground iconCode, 0 to 47', () => {
  const cases = { 4: 'thunder', 5: 'sleet', 9: 'drizzle', 10: 'freezing', 11: 'showers', 12: 'rain', 16: 'snow',
    17: 'hail', 20: 'fog', 21: 'haze', 24: 'windy', 26: 'cloudy', 28: 'mostly', 30: 'partly', 31: 'clear',
    32: 'clear', 34: 'fair', 40: 'heavyrain', 42: 'heavysnow', 47: 'thunder' };
  Object.keys(cases).forEach((k) => assert.equal(C.fromWu(Number(k)), cases[k], 'WU ' + k));
  [25, 44, 48, -1, 3.5, null].forEach((v) => assert.equal(C.fromWu(v), null, String(v)));
});

test('Yandex conditions, either spelling', () => {
  assert.equal(C.fromYandex('partly-cloudy'), 'partly');
  assert.equal(C.fromYandex('PARTLY_CLOUDY'), 'partly');
  assert.equal(C.fromYandex('cloudy'), 'mostly');
  assert.equal(C.fromYandex('OVERCAST'), 'cloudy');
  assert.equal(C.fromYandex('wet-snow'), 'sleet');
  assert.equal(C.fromYandex('THUNDERSTORM_WITH_HAIL'), 'thunder');
  assert.equal(C.fromYandex('SNOWFALL'), 'heavysnow');
  [null, '', 'NOPE'].forEach((v) => assert.equal(C.fromYandex(v), null, String(v)));
});

test('every mapping lands on the list', () => {
  const all = [];
  for (let i = 0; i < 100; i++) { all.push(C.fromWmo(i), C.fromWu(i)); }
  for (let i = 200; i < 900; i++) { all.push(C.fromOwm(i)); }
  for (let i = 1000; i < 9000; i++) { all.push(C.fromTomorrow(i)); }
  all.filter((v) => v !== null).forEach((id) => assert.ok(C.isCondition(id), id));
});

test('the numeric mappers read only whole numbers and digit strings: no odd value lands on 0', () => {
  const odd = [false, true, [], [800], ' ', '0x1F', '8 02', '1e3', 2.5, NaN, Infinity, -0.5, {}];
  [C.fromWmo, C.fromOwm, C.fromTomorrow, C.fromWu].forEach((fn) => odd.forEach((v) => {
    assert.equal(fn(v), null, fn.name + '(' + JSON.stringify(v) + ')');
  }));
  assert.equal(C.fromWmo('0'), 'clear', 'a digit string still reads');
  assert.equal(C.fromWu('31'), 'clear');
  assert.equal(C.fromTomorrow('1101'), 'partly');
});
