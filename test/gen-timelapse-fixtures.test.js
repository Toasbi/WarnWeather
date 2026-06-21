'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  generateFrames, parseHHMM, parseArgs, PHASE_A_CLAY, PHASE_B_CLAY,
} = require('../scripts/gen-timelapse-fixtures');
const { normalizeWeather } = require('../scripts/lib/fixture-time');

function run(opts = {}) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-tl-'));
  const result = generateFrames({ outDir, ...opts });
  return { outDir, result };
}

function readFrame(outDir, name) {
  return JSON.parse(fs.readFileSync(path.join(outDir, name), 'utf8'));
}

test('generates 20 Phase A + 20 Phase B frames with correct names', () => {
  const { outDir, result } = run();
  assert.equal(result.a.length, 20);
  assert.equal(result.b.length, 20);
  for (let i = 0; i < 20; i++) {
    const nn = String(i).padStart(2, '0');
    assert.ok(fs.existsSync(path.join(outDir, `timelapse-a-${nn}.json`)), `missing a ${nn}`);
    assert.ok(fs.existsSync(path.join(outDir, `timelapse-b-${nn}.json`)), `missing b ${nn}`);
  }
});

test('Phase A watch.now advances 5 min from 20:45; Phase B continues from 22:20', () => {
  const { outDir } = run();
  for (let i = 0; i < 20; i++) {
    const nn = String(i).padStart(2, '0');
    const a = readFrame(outDir, `timelapse-a-${nn}.json`);
    const aMin = 20 * 60 + 45 + i * 5;
    assert.equal(a.watch.now.hour, Math.floor(aMin / 60));
    assert.equal(a.watch.now.minute, aMin % 60);
    assert.equal(a.watch.now.second, 0);
    const b = readFrame(outDir, `timelapse-b-${nn}.json`);
    const bMin = 22 * 60 + 20 + i * 5;
    assert.equal(b.watch.now.hour, Math.floor(bMin / 60));
    assert.equal(b.watch.now.minute, bMin % 60);
  }
});

test('timeline is continuous: Phase B begins at the same instant Phase A ended', () => {
  const { outDir } = run();
  const a19 = readFrame(outDir, 'timelapse-a-19.json');
  const b00 = readFrame(outDir, 'timelapse-b-00.json');
  const a19Min = a19.watch.now.hour * 60 + a19.watch.now.minute;
  const b00Min = b00.watch.now.hour * 60 + b00.watch.now.minute;
  assert.equal(b00Min - a19Min, 0);
});

test('Phase A frames carry config A; Phase B frames carry config B', () => {
  const { outDir } = run();
  for (let i = 0; i < 20; i++) {
    const nn = String(i).padStart(2, '0');
    const a = readFrame(outDir, `timelapse-a-${nn}.json`);
    assert.equal(a.claySettings.secondaryLine, 'precip_prob');
    assert.equal(a.claySettings.secondaryLineFill, false);
    assert.equal(a.claySettings.barSource, 'rain');
    assert.equal(a.claySettings.rainBarColor, 'white');
    const b = readFrame(outDir, `timelapse-b-${nn}.json`);
    assert.equal(b.claySettings.secondaryLine, 'wind');
    assert.equal(b.claySettings.barSource, 'off');
  }
  assert.deepEqual(PHASE_A_CLAY, {
    secondaryLine: 'precip_prob', secondaryLineFill: false, barSource: 'rain', rainBarColor: 'white',
  });
  assert.deepEqual(PHASE_B_CLAY, { secondaryLine: 'wind', barSource: 'off' });
});

test('config overrides preserve unrelated base claySettings (e.g. provider)', () => {
  const { outDir } = run();
  const a = readFrame(outDir, 'timelapse-a-00.json');
  assert.equal(a.claySettings.provider, 'dwd');
});

test('startEpoch is fixed within each phase but differs between phases', () => {
  const { outDir } = run();
  const aEpochs = new Set();
  const bEpochs = new Set();
  for (let i = 0; i < 20; i++) {
    const nn = String(i).padStart(2, '0');
    const a = readFrame(outDir, `timelapse-a-${nn}.json`);
    const b = readFrame(outDir, `timelapse-b-${nn}.json`);
    assert.equal(a.weather.startHour, undefined);
    assert.equal(b.weather.startHour, undefined);
    aEpochs.add(a.weather.startEpoch);
    bEpochs.add(b.weather.startEpoch);
  }
  assert.equal(aEpochs.size, 1, 'Phase A anchor must be constant');
  assert.equal(bEpochs.size, 1, 'Phase B anchor must be constant');
  assert.notEqual([...aEpochs][0], [...bEpochs][0], 'phases use different anchors');
  assert.ok([...bEpochs][0] > [...aEpochs][0], 'Phase B anchor is later');
});

test('every frame normalizes to identical sun-event epochs and 24 radar slots', () => {
  const { outDir } = run();
  let ref = null;
  for (const name of ['timelapse-a-00.json', 'timelapse-a-19.json', 'timelapse-b-00.json', 'timelapse-b-19.json']) {
    const fx = readFrame(outDir, name);
    assert.equal(fx.weather.rainRadarExactMm.length, 24);
    assert.equal(fx.weather.rainRadarAreaMm.length, 24);
    normalizeWeather(fx);
    const epochs = fx.weather.sunEvents.map((e) => e.epoch);
    if (ref === null) ref = epochs;
    assert.deepEqual(epochs, ref);
  }
});

test('parseHHMM throws on malformed input', () => {
  assert.throws(() => parseHHMM('not-a-time'), /Expected HH:MM/);
  assert.throws(() => parseHHMM('2045'), /Expected HH:MM/);
});

test('generateFrames throws when a phase crosses midnight', () => {
  assert.throws(
    () => run({ phaseBStart: '23:50', frames: 5 }),
    /crosses midnight/
  );
});

test('generateFrames rejects non-positive / non-integer frame counts', () => {
  assert.throws(() => run({ frames: 0 }), /positive integer/);
  assert.throws(() => run({ frames: NaN }), /positive integer/);
  assert.throws(() => run({ stepMin: 0 }), /positive integer/);
});

test('parseArgs parses new phase flags and numeric coercion', () => {
  assert.deepEqual(
    parseArgs(['--frames=3', '--phase-a-start=21:00', '--phase-b-start=22:30', '--step-min=10']),
    { frames: 3, phaseAStart: '21:00', phaseBStart: '22:30', stepMin: 10 }
  );
});

test('parseArgs throws when a space-separated flag is missing its value', () => {
  assert.throws(() => parseArgs(['--phase-a-start']), /requires a value/);
  assert.throws(() => parseArgs(['--phase-a-start', '--frames']), /requires a value/);
});
