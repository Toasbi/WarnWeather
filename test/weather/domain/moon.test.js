// test/weather/domain/moon.test.js
// The moon's phases (weather/domain/moon.js), held to the published instants of 2026 and 2027:
// Fred Espenak's "Phases of the Moon: 2001 to 2100" (NASA GSFC), in universal time to the
// minute. A day's name follows the phone's zone, so those cases run in a child process started
// in the zone (test/helpers/in-zone.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const SunCalc = require('suncalc');
const moon = require('../../../src/pkjs/weather/domain/moon.js');
const { inZone } = require('../../helpers/in-zone.js');

const MOON = require.resolve('../../../src/pkjs/weather/domain/moon.js');
const QUARTER_MS = 29.530588861 / 4 * 24 * 60 * 60 * 1000;

const PUBLISHED = [
  '2026-01-03 10:03 full', '2026-01-10 15:48 last', '2026-01-18 19:52 new', '2026-01-26 04:47 first',
  '2026-02-01 22:09 full', '2026-02-09 12:43 last', '2026-02-17 12:01 new', '2026-02-24 12:28 first',
  '2026-03-03 11:38 full', '2026-03-11 09:39 last', '2026-03-19 01:23 new', '2026-03-25 19:18 first',
  '2026-04-02 02:12 full', '2026-04-10 04:52 last', '2026-04-17 11:52 new', '2026-04-24 02:32 first',
  '2026-05-01 17:23 full', '2026-05-09 21:10 last', '2026-05-16 20:01 new', '2026-05-23 11:11 first',
  '2026-05-31 08:45 full', '2026-06-08 10:00 last', '2026-06-15 02:54 new', '2026-06-21 21:55 first',
  '2026-06-29 23:57 full', '2026-07-07 19:29 last', '2026-07-14 09:43 new', '2026-07-21 11:06 first',
  '2026-07-29 14:36 full', '2026-08-06 02:21 last', '2026-08-12 17:37 new', '2026-08-20 02:46 first',
  '2026-08-28 04:18 full', '2026-09-04 07:51 last', '2026-09-11 03:27 new', '2026-09-18 20:44 first',
  '2026-09-26 16:49 full', '2026-10-03 13:25 last', '2026-10-10 15:50 new', '2026-10-18 16:13 first',
  '2026-10-26 04:12 full', '2026-11-01 20:28 last', '2026-11-09 07:02 new', '2026-11-17 11:48 first',
  '2026-11-24 14:53 full', '2026-12-01 06:09 last', '2026-12-09 00:52 new', '2026-12-17 05:43 first',
  '2026-12-24 01:28 full', '2026-12-30 18:59 last', '2027-01-07 20:24 new', '2027-01-15 20:34 first',
  '2027-01-22 12:17 full', '2027-01-29 10:55 last', '2027-02-06 15:56 new', '2027-02-14 07:58 first',
  '2027-02-20 23:23 full', '2027-02-28 05:16 last', '2027-03-08 09:29 new', '2027-03-15 16:25 first',
  '2027-03-22 10:44 full', '2027-03-30 00:54 last', '2027-04-06 23:51 new', '2027-04-13 22:57 first',
  '2027-04-20 22:27 full', '2027-04-28 20:18 last', '2027-05-06 10:58 new', '2027-05-13 04:44 first',
  '2027-05-20 10:59 full', '2027-05-28 13:58 last', '2027-06-04 19:40 new', '2027-06-11 10:56 first',
  '2027-06-19 00:44 full', '2027-06-27 04:54 last', '2027-07-04 03:02 new', '2027-07-10 18:39 first',
  '2027-07-18 15:45 full', '2027-07-26 16:55 last', '2027-08-02 10:05 new', '2027-08-09 04:54 first',
  '2027-08-17 07:29 full', '2027-08-25 02:27 last', '2027-08-31 17:41 new', '2027-09-07 18:31 first',
  '2027-09-15 23:04 full', '2027-09-23 10:20 last', '2027-09-30 02:36 new', '2027-10-07 11:47 first',
  '2027-10-15 13:47 full', '2027-10-22 17:29 last', '2027-10-29 13:36 new', '2027-11-06 08:00 first',
  '2027-11-14 03:26 full', '2027-11-21 00:48 last', '2027-11-28 03:24 new', '2027-12-06 05:22 first',
  '2027-12-13 16:09 full', '2027-12-20 09:11 last', '2027-12-27 20:12 new'
].map((row) => {
  const [date, time, phase] = row.split(' ');
  return { row, ms: Date.parse(date + 'T' + time + ':00Z'), phase };
});
// A phase's index among the principal ones, as principalInstant counts them (k4 % 4).
const QUARTER = { new: 0, first: 1, full: 2, last: 3 };
// How much of the disc each principal phase lights.
const LIT = { new: 0, first: 0.5, full: 1, last: 0.5 };

/**
 * The count principalInstant takes for a published phase: the mean phases' count nearest it.
 * @param {number} ms The published instant.
 * @returns {number} Its k4.
 */
function countOf(ms) {
  return Math.round((ms - moon.principalInstant(0)) / QUARTER_MS);
}

test('every principal phase of 2026 and 2027 lands within a minute of its published instant', () => {
  assert.equal(PUBLISHED.length, 99);
  for (const { row, ms, phase } of PUBLISHED) {
    const k4 = countOf(ms);
    assert.equal(((k4 % 4) + 4) % 4, QUARTER[phase], row + ': the count names another phase');
    const off = Math.abs(moon.principalInstant(k4) - ms);
    assert.ok(off <= 60 * 1000, row + ': ' + Math.round(off / 1000) + ' s off');
  }
});

test('the moon is dark at new moon, half lit at the quarters and whole at full moon', () => {
  for (const { row, ms, phase } of PUBLISHED) {
    const lit = moon.litShare(ms);
    assert.ok(Math.abs(lit - LIT[phase]) < 0.01, row + ': ' + lit.toFixed(4) + ' lit');
  }
  // Three days past full moon, 27 Nov 2026 10:00 UT.
  assert.equal(Math.round(moon.litShare(Date.UTC(2026, 10, 27, 10)) * 100), 89);
});

test('between the principal phases the lit share keeps within two points of SunCalc\'s', () => {
  // SunCalc's own formula is a coarser one, so it is a check of the curve, not of the instants.
  for (let ms = Date.UTC(2026, 10, 1); ms < Date.UTC(2027, 0, 1); ms += 6 * 60 * 60 * 1000) {
    const theirs = SunCalc.getMoonIllumination(new Date(ms)).fraction;
    assert.ok(Math.abs(moon.litShare(ms) - theirs) < 0.02, new Date(ms).toISOString());
  }
});

test('a principal phase names the whole local day it falls on, the phases between the days between', () => {
  const got = inZone('Europe/Berlin', { moon: MOON }, ({ moon }) => {
    let days = '';
    for (let d = 1; d <= 30; d += 1) { days += moon.phaseOfDay(new Date(2026, 10, d, 12).getTime()); }
    // Midnight to midnight: the same day's first and last minute name it alike.
    const edges = [new Date(2026, 10, 24, 0, 0).getTime(), new Date(2026, 10, 24, 23, 59).getTime(),
      new Date(2026, 10, 25, 0, 0).getTime()].map(moon.phaseOfDay);
    return { days, edges };
  });
  // November 2026 in Berlin: last quarter on the 1st (21:28), new moon on the 9th, first
  // quarter on the 17th, full moon on the 24th.
  assert.equal(got.days, '6' + '7'.repeat(7) + '0' + '1'.repeat(7) + '2' + '3'.repeat(6) + '4' + '5'.repeat(6));
  assert.deepEqual(got.edges, [moon.FULL, moon.FULL, moon.FULL + 1]);
});

test('the same instant names the day it falls on in each zone', () => {
  // The full moon of 1 Feb 2026 at 22:09 UT: 23:09 on the 1st in Berlin, 00:09 on the 2nd in
  // Helsinki.
  const days = (zone) => inZone(zone, { moon: MOON }, ({ moon }) =>
    [1, 2].map((d) => moon.phaseOfDay(new Date(2026, 1, d, 12).getTime())));
  assert.deepEqual(days('Europe/Berlin'), [moon.FULL, moon.FULL + 1]);
  assert.deepEqual(days('Europe/Helsinki'), [moon.FULL - 1, moon.FULL]);
});

test('a day runs from midnight to midnight across a clock change', () => {
  // A 25-hour day: New York's clocks go back on 7 Nov 2060, and that day's full moon comes in
  // its last hour (23:17 EST). A 23-hour day: Sydney's go forward on 7 Oct 2063, and the full
  // moon comes at 00:27 the next day, under 24 hours from the short day's start.
  const nyc = inZone('America/New_York', { moon: MOON }, ({ moon }) =>
    [7, 8].map((d) => moon.phaseOfDay(new Date(2060, 10, d, 12).getTime())));
  const sydney = inZone('Australia/Sydney', { moon: MOON }, ({ moon }) =>
    [7, 8].map((d) => moon.phaseOfDay(new Date(2063, 9, d, 12).getTime())));
  assert.deepEqual(nyc, [moon.FULL, moon.FULL + 1]);
  assert.deepEqual(sydney, [moon.FULL - 1, moon.FULL]);
});

test('the next day a principal phase names counts today, even after its instant', () => {
  const got = inZone('Europe/Berlin', { moon: MOON }, ({ moon }) => {
    const day = (ms, phase) => {
      const d = moon.nextDayOf(ms, phase);
      return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()].join('-');
    };
    return [
      day(new Date(2026, 10, 20, 12).getTime(), moon.FULL),
      day(new Date(2026, 10, 24, 0, 0).getTime(), moon.FULL),
      day(new Date(2026, 10, 24, 23, 30).getTime(), moon.FULL),
      day(new Date(2026, 10, 25, 0, 10).getTime(), moon.FULL),
      day(new Date(2026, 10, 20, 12).getTime(), moon.NEW),
      day(new Date(2026, 1, 1, 12).getTime(), moon.FULL)
    ];
  });
  assert.deepEqual(got, [
    '2026-11-24-0-0', '2026-11-24-0-0', '2026-11-24-0-0',
    // Past the full moon's day, the next one: 24 Dec at 02:28 CET.
    '2026-12-24-0-0',
    // The new moon of 9 Dec at 01:52 CET.
    '2026-12-9-0-0',
    '2026-2-1-0-0'
  ]);
  const helsinki = inZone('Europe/Helsinki', { moon: MOON }, ({ moon }) =>
    moon.nextDayOf(new Date(2026, 1, 1, 12).getTime(), moon.FULL).getDate());
  assert.equal(helsinki, 2);
});

test('seenFrom: south of the equator the waxing and the waning phases swap pictures, read only for those', () => {
  const reads = [];
  const seen = (phase, at) => moon.seenFrom(phase, () => { reads.push(phase); return at; });
  const SOUTH = { lat: -33.87, lon: 151.21 };
  const NORTH = { lat: 52.52, lon: 13.40 };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((p) => seen(p, SOUTH)), [0, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(reads, [1, 2, 3, 5, 6, 7], 'the new and the full moon look the same everywhere: no place read');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((p) => seen(p, NORTH)), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([1, 5].map((p) => seen(p, null)), [1, 5], 'no place yet: as the north sees it');
  assert.deepEqual([1, 5].map((p) => seen(p, { lat: 0, lon: 0 })), [1, 5], 'on the equator: as the north does');
});
