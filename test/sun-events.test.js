// test/sun-events.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickNext24hSunEvents } = require('../src/pkjs/weather/sun-events');

test('keeps only future events and caps at two', () => {
  const now = new Date('2026-06-19T12:00:00Z');
  const events = [
    { type: 'sunrise', date: new Date('2026-06-19T05:00:00Z') }, // past
    { type: 'sunset',  date: new Date('2026-06-19T21:00:00Z') }, // future
    { type: 'sunrise', date: new Date('2026-06-20T05:00:00Z') }, // future
    { type: 'sunset',  date: new Date('2026-06-20T21:00:00Z') }  // future (dropped, >2)
  ];
  const out = pickNext24hSunEvents(events, now);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'sunset');
  assert.equal(out[1].type, 'sunrise');
});

test('returns fewer than two when only one is future', () => {
  const now = new Date('2026-06-19T22:00:00Z');
  const events = [
    { type: 'sunset', date: new Date('2026-06-19T21:00:00Z') },
    { type: 'sunrise', date: new Date('2026-06-20T05:00:00Z') }
  ];
  assert.deepEqual(pickNext24hSunEvents(events, now).map(function(e){return e.type;}), ['sunrise']);
});
