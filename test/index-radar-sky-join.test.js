// test/index-radar-sky-join.test.js
//
// The radar's sky rows (radar-sky.js) come from a request of their own,
// independent of the radar's. It used to start only once the radar had
// answered, so every forecast fetch waited out the two round trips in series.
// withRainRadarTuplesAt now starts both at once and joins the answers
// (radarSky.joinRadarAndSky, unit-tested in radar-sky.test.js); this pins that
// wiring in the real index.js.
//
// Boots the real index.js in a child process (see helpers/boot-radar-probe.js),
// holding the Rainbow radar's answer back so the sky request's timing shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROBE = path.join(__dirname, 'helpers', 'boot-radar-probe.js');

function probe(platform, opts) {
  return JSON.parse(execFileSync(process.execPath, [PROBE, platform, JSON.stringify(opts)],
    { encoding: 'utf8' }).trim());
}

test('the sky request goes out while the radar request is still in flight', () => {
  const out = probe('basalt', { settings: { radarProvider: 'rainbow', radarSky: true }, holdRadar: true });
  assert.ok(out.radarRequests >= 1, 'the radar half did run');
  assert.ok(out.skyRequests >= 1, 'the sky half did run');
  assert.equal(out.skyBeforeRadarAnswer, true, 'the sky did not wait for the radar to answer');
});

test('aplite makes no sky request either: the radar gate comes before both', () => {
  const out = probe('aplite', { settings: { radarSky: true } });
  assert.equal(out.radarRequests, 0);
  assert.equal(out.skyRequests, 0);
});
