// test/weather/domain/pollen-days.test.js — the pollen bands' rules
// (src/pkjs/weather/domain/pollen-days.js): which source a Provider reads, each source's bands
// by local day, the CAMS types' levels, where each source is asked and the last answer's
// stand-in.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pollenDays = require('../../../src/pkjs/weather/domain/pollen-days.js');

const HOUR = 3600;
const FIELDS = pollenDays.CAMS_TYPES.map((type) => type.field);

/**
 * An Open-Meteo air quality answer for the CAMS pollen fields.
 * @param {number} start The first hour, epoch seconds.
 * @param {number} hours How many hours.
 * @param {function(string, number): ?number} valueAt A field's value at hour i.
 * @returns {Object}
 */
function camsAnswer(start, hours, valueAt) {
  const hourly = { time: Array.from({ length: hours }, (_, i) => start + i * HOUR) };
  FIELDS.forEach((field) => { hourly[field] = hourly.time.map((_, i) => valueAt(field, i)); });
  return { hourly: hourly };
}

/**
 * A DWD WFS feature.
 * @param {string} date FORECAST_DATE.
 * @param {*} pollenInt POLLENINT.
 * @returns {Object}
 */
function feature(date, pollenInt) {
  return { type: 'Feature', properties: { FORECAST_DATE: date, POLLENINT: pollenInt } };
}

test('the DWD Provider reads the DWD\'s index, every other one the CAMS forecast', () => {
  assert.equal(pollenDays.sourceOf('dwd'), 'dwd');
  ['openmeteo', 'metno', 'owm', 'tomorrowio', 'wunderground', 'yandex', '', null, undefined].forEach((id) => {
    assert.equal(pollenDays.sourceOf(id), 'cams', String(id));
  });
});

test('the sources sourceOf names are the ones SOURCES holds, and nothing else is one', () => {
  assert.deepEqual(Object.keys(pollenDays.SOURCES).sort(), ['cams', 'dwd']);
  assert.equal(pollenDays.SOURCES.dwd.bands, pollenDays.dwdBands);
  assert.equal(pollenDays.SOURCES.cams.bands, pollenDays.camsBands);
  ['dwd', 'cams'].forEach((id) => assert.equal(pollenDays.isSource(id), true, id));
  ['cam', 'DWD', 'toString', '', null, undefined, 1].forEach((id) => {
    assert.equal(pollenDays.isSource(id), false, String(id));
  });
});

test('localDateKey uses the local calendar date with zero-padded month and day', () => {
  assert.equal(pollenDays.localDateKey(new Date(2026, 1, 3, 23, 45)), '2026-02-03');
});

test('nextLocalDay steps one local calendar day, across a month end and a DST change', () => {
  const next = (date) => pollenDays.localDateKey(pollenDays.nextLocalDay(date));
  assert.equal(next(new Date(2026, 0, 31, 23, 50)), '2026-02-01');
  assert.equal(next(new Date(2026, 2, 29, 0, 30)), '2026-03-30');
  assert.equal(next(new Date(2026, 9, 25, 12, 0)), '2026-10-26');
});

test('dwdBands maps every POLLENINT ordinal to its band', () => {
  pollenDays.BANDS.forEach((band, pollenInt) => {
    assert.deepEqual(pollenDays.dwdBands({ features: [feature('2026-07-19T00:00:00Z', pollenInt)] }),
      { '2026-07-19': band }, 'POLLENINT ' + pollenInt);
  });
});

test('dwdBands takes each day\'s worst over every type and neighbouring region', () => {
  const features = [
    feature('2026-07-18T00:00:00Z', 6),
    feature('2026-07-19T00:00:00Z', 2),
    feature('2026-07-19T00:00:00Z', 5),
    feature('2026-07-19T00:00:00Z', 4),
    feature('2026-07-20T00:00:00Z', 0)
  ];
  assert.deepEqual(pollenDays.dwdBands({ type: 'FeatureCollection', features: features }),
    { '2026-07-18': '3', '2026-07-19': '2-3', '2026-07-20': '0' });
});

test('dwdBands skips invalid values, malformed features and dates without a time', () => {
  const features = [
    feature('2026-07-19T00:00:00Z', -1),
    feature('2026-07-19T00:00:00Z', 7),
    feature('2026-07-19T00:00:00Z', 1.5),
    feature('2026-07-19T00:00:00Z', '6'),
    feature('2026-07-190T00:00:00Z', 6),
    feature('2026-07-19', 6),
    feature('2026-07-19 00:00:00Z', 6),
    { type: 'Feature' },
    { type: 'Feature', properties: { FORECAST_DATE: '2026-07-19T00:00:00Z' } },
    null,
    feature('2026-07-19T00:00:00Z', 3)
  ];
  assert.deepEqual(pollenDays.dwdBands({ features: features }), { '2026-07-19': '1-2' });
  [null, {}, { features: null }, { features: {} }, { features: [] }].forEach((json) => {
    assert.deepEqual(pollenDays.dwdBands(json), {}, JSON.stringify(json));
  });
});

test('a CAMS type\'s day mean takes the DWD\'s classes for the type, olive the Spanish network\'s', () => {
  const type = (field) => pollenDays.CAMS_TYPES.find((t) => t.field === field);
  const levels = (field, means) => means.map((mean) => pollenDays.levelOf(type(field), mean));
  assert.deepEqual(levels('birch_pollen', [0, 0.9, 1, 10, 10.1, 50, 50.1]), [0, 0, 1, 1, 2, 2, 3]);
  assert.deepEqual(levels('alder_pollen', [10, 10.1, 100, 100.1]), [1, 2, 2, 3]);
  assert.deepEqual(levels('grass_pollen', [5, 5.1, 30, 30.1]), [1, 2, 2, 3]);
  assert.deepEqual(levels('mugwort_pollen', [5, 5.1, 10, 10.1]), [1, 2, 2, 3]);
  assert.deepEqual(levels('ragweed_pollen', [5, 5.1, 10, 10.1]), [1, 2, 2, 3]);
  assert.deepEqual(levels('olive_pollen', [1, 50, 50.1, 200, 200.1]), [1, 1, 2, 2, 3]);
  assert.deepEqual(FIELDS, ['alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'olive_pollen',
    'ragweed_pollen'], 'the six types CAMS holds');
});

test('camsBands puts each local day\'s worst type in whole levels', () => {
  const midnight = new Date(2026, 5, 20).getTime() / 1000;
  const answer = camsAnswer(midnight, 48, (field, i) => {
    const today = i < 24;
    if (field === 'birch_pollen') { return today ? (i < 12 ? 30 : 0) : 12; }
    if (field === 'grass_pollen') { return today ? 4 : null; }
    return 0;
  });
  assert.deepEqual(pollenDays.camsBands(answer), { '2026-06-20': '2', '2026-06-21': '2' },
    'today: birch\'s mean of 15 is medium, grass\'s 4 low; tomorrow: birch\'s 12 is medium, grass has no hours');
});

test('camsBands needs twelve hours of a type for its day mean', () => {
  const midnight = new Date(2026, 5, 20).getTime() / 1000;
  const answer = camsAnswer(midnight, 24, (field, i) => (field === 'grass_pollen' && i >= 12 ? 40 : null));
  assert.deepEqual(pollenDays.camsBands(answer), { '2026-06-20': '3' }, 'twelve hours of grass at 40: high');
  answer.hourly.grass_pollen[12] = null;
  assert.deepEqual(pollenDays.camsBands(answer), {}, 'eleven hours: no band');
});

test('camsBands reads the answers recorded at Berlin and New York on 2026-11-28', () => {
  // Berlin, in winter: every type 0 for the place's today and tomorrow (from its midnight, CET).
  const berlin = camsAnswer(1795820400, 48, () => 0);
  const days = [12, 36].map((i) => pollenDays.localDateKey(new Date((1795820400 + i * HOUR) * 1000)));
  const bands = pollenDays.camsBands(berlin);
  days.forEach((day) => assert.equal(bands[day], '0', day));
  // New York lies outside the forecast's area: every hour null.
  assert.deepEqual(pollenDays.camsBands(camsAnswer(1795755600, 48, () => null)), {});
  [null, {}, { hourly: {} }, { hourly: { time: 'x' } }].forEach((json) => {
    assert.deepEqual(pollenDays.camsBands(json), {}, JSON.stringify(json));
  });
});

test('the CAMS forecast is asked across Europe but the Canary Islands, the Azores and Svalbard', () => {
  [[52.52, 13.41], [40.42, -3.7], [64.15, -21.94], [41.01, 28.98], ['48.86', '2.35']].forEach(([lat, lon]) => {
    assert.equal(pollenDays.covers('cams', lat, lon), true, lat + ',' + lon);
  });
  [[28.12, -15.43], [37.74, -25.67], [78.22, 15.65], [40.71, -74.01], [NaN, 2], ['', '']].forEach(([lat, lon]) => {
    assert.equal(pollenDays.covers('cams', lat, lon), false, lat + ',' + lon);
  });
});

test('the DWD\'s index is asked anywhere: its answer says where it has no band', () => {
  [[52.52, 13.41], [40.71, -74.01], [28.12, -15.43]].forEach(([lat, lon]) => {
    assert.equal(pollenDays.covers('dwd', lat, lon), true, lat + ',' + lon);
  });
});

test('the stand-in is the last answer\'s days, from the same source at the same place', () => {
  const record = pollenDays.recordOf('cams', '48.8566', 2.3522,
    { '2026-06-19': '3', '2026-06-20': '1', '2026-06-21': '2' }, ['2026-06-20', '2026-06-21']);
  assert.deepEqual(record, { source: 'cams', lat: 48.86, lon: 2.35, bands: { '2026-06-20': '1', '2026-06-21': '2' } },
    'the days a fetch shows, the place to 2 decimals');
  assert.deepEqual(pollenDays.standIn(record, 'cams', 48.9, 2.31), record.bands, 'within 0.05° on each axis');
  assert.deepEqual(pollenDays.standIn(record, 'dwd', 48.86, 2.35), {}, 'another source');
  assert.deepEqual(pollenDays.standIn(record, 'cams', 48.92, 2.35), {}, 'another place');
  [null, '', 'x', {}, { source: 'cams', lat: 48.86, lon: 2.35, bands: null }].forEach((stored) => {
    assert.deepEqual(pollenDays.standIn(stored, 'cams', 48.86, 2.35), {}, JSON.stringify(stored));
  });
});

test('settle shows and keeps an answer with today\'s band, and reads no stored record', () => {
  const now = new Date(2026, 5, 20, 9, 0);
  const answer = { '2026-06-19': '3', '2026-06-20': '2-3', '2026-06-21': '1' };
  const day = pollenDays.settle(answer, () => { throw new Error('read the store'); }, 'dwd', 52.5208, 13.4094, now);
  assert.deepEqual(day, { today: '2-3', tomorrow: '1', standsIn: false,
    keep: { source: 'dwd', lat: 52.52, lon: 13.41, bands: { '2026-06-20': '2-3', '2026-06-21': '1' } } });
});

test('settle takes the days an answer lacks from the last answer at the same source and place, and keeps nothing', () => {
  const now = new Date(2026, 5, 20, 9, 0);
  const stored = { source: 'cams', lat: 48.86, lon: 2.35, bands: { '2026-06-20': '1', '2026-06-21': '2' } };
  let reads = 0;
  const load = () => { reads += 1; return stored; };
  const failed = pollenDays.settle({}, load, 'cams', 48.86, 2.35, now);
  assert.deepEqual(failed, { today: '1', tomorrow: '2', keep: null, standsIn: true }, 'a refresh that brings nothing');
  // An answer without today's band is not kept, but its tomorrow is newer than the last one's.
  const late = pollenDays.settle({ '2026-06-21': '3' }, load, 'cams', 48.86, 2.35, now);
  assert.deepEqual(late, { today: '1', tomorrow: '3', keep: null, standsIn: true }, 'an answer without today');
  assert.equal(reads, 2);
  assert.deepEqual(pollenDays.settle({ '2026-06-21': '3' }, () => null, 'cams', 48.86, 2.35, now),
    { today: null, tomorrow: '3', keep: null, standsIn: false }, 'an answer without today, and nothing stored');
  assert.deepEqual(pollenDays.settle({}, load, 'dwd', 48.86, 2.35, now),
    { today: null, tomorrow: null, keep: null, standsIn: false }, 'another source');
  // The next day, yesterday's answer still holds that day's band.
  assert.deepEqual(pollenDays.settle({}, load, 'cams', 48.86, 2.35, new Date(2026, 5, 21, 7, 0)),
    { today: '2', tomorrow: null, keep: null, standsIn: true }, 'the day after');
  assert.deepEqual(pollenDays.settle({}, () => null, 'cams', 48.86, 2.35, now),
    { today: null, tomorrow: null, keep: null, standsIn: false }, 'nothing stored');
});

test('bandOn reads a day\'s band and nothing else', () => {
  const bands = { '2026-06-20': '1-2', '2026-06-21': 'high' };
  assert.equal(pollenDays.bandOn(bands, '2026-06-20'), '1-2');
  assert.equal(pollenDays.bandOn(bands, '2026-06-21'), null, 'not a band');
  assert.equal(pollenDays.bandOn(bands, '2026-06-22'), null);
  assert.equal(pollenDays.bandOn(bands, 'constructor'), null);
});
