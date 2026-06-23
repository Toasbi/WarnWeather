'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  generateFrames, parseHHMM, parseArgs, computePinnedTempBounds,
  PHASE_A_CLAY, PHASE_B_CLAY,
} = require('../scripts/gen-timelapse-fixtures');
const { normalizeWeather } = require('../scripts/lib/fixture-time');

const A_FRAMES = 12;
const A_WINDOW = 24;
const B_FRAMES = 20;
// Phase A scrolls a full-width window over the long DWD fixture; Phase B reuses
// the 24h Berlin fixture unscrolled.
const A_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'berlin-timelapse.json'), 'utf8'));
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'berlin.json'), 'utf8'));
const A_PIN = computePinnedTempBounds(A_BASE.weather.temps, A_FRAMES, A_WINDOW);
const clampToPin = (v) => Math.max(A_PIN.lo, Math.min(A_PIN.hi, v));

function run(opts = {}) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-tl-'));
  const result = generateFrames({ outDir, ...opts });
  return { outDir, result };
}

function readFrame(outDir, name) {
  return JSON.parse(fs.readFileSync(path.join(outDir, name), 'utf8'));
}

test('generates 12 Phase A + 20 Phase B frames with correct names', () => {
  const { outDir, result } = run();
  assert.equal(result.a.length, A_FRAMES);
  assert.equal(result.b.length, B_FRAMES);
  for (let i = 0; i < A_FRAMES; i++) {
    const nn = String(i).padStart(2, '0');
    assert.ok(fs.existsSync(path.join(outDir, `timelapse-a-${nn}.json`)), `missing a ${nn}`);
  }
  for (let i = 0; i < B_FRAMES; i++) {
    const nn = String(i).padStart(2, '0');
    assert.ok(fs.existsSync(path.join(outDir, `timelapse-b-${nn}.json`)), `missing b ${nn}`);
  }
});

test('Phase A watch.now advances 1h from 11:20; Phase B continues 5 min from 22:20', () => {
  const { outDir } = run();
  for (let i = 0; i < A_FRAMES; i++) {
    const nn = String(i).padStart(2, '0');
    const a = readFrame(outDir, `timelapse-a-${nn}.json`);
    const aMin = 11 * 60 + 20 + i * 60;
    assert.equal(a.watch.now.hour, Math.floor(aMin / 60));
    assert.equal(a.watch.now.minute, aMin % 60);
    assert.equal(a.watch.now.second, 0);
  }
  for (let i = 0; i < B_FRAMES; i++) {
    const nn = String(i).padStart(2, '0');
    const b = readFrame(outDir, `timelapse-b-${nn}.json`);
    const bMin = 22 * 60 + 20 + i * 5;
    assert.equal(b.watch.now.hour, Math.floor(bMin / 60));
    assert.equal(b.watch.now.minute, bMin % 60);
  }
});

test('timeline is continuous: Phase B begins at the same instant Phase A ended', () => {
  const { outDir } = run();
  const aLast = readFrame(outDir, `timelapse-a-${String(A_FRAMES - 1).padStart(2, '0')}.json`);
  const b00 = readFrame(outDir, 'timelapse-b-00.json');
  const aLastMin = aLast.watch.now.hour * 60 + aLast.watch.now.minute;
  const b00Min = b00.watch.now.hour * 60 + b00.watch.now.minute;
  assert.equal(b00Min - aLastMin, 0);
});

test('Phase A frames carry config A; Phase B frames carry config B', () => {
  const { outDir } = run();
  for (let i = 0; i < A_FRAMES; i++) {
    const nn = String(i).padStart(2, '0');
    const a = readFrame(outDir, `timelapse-a-${nn}.json`);
    assert.equal(a.claySettings.secondaryLine, 'precip_prob');
    assert.equal(a.claySettings.secondaryLineFill, true);
    assert.equal(a.claySettings.barSource, 'rain');
    assert.equal(a.claySettings.rainBarColor, 'multicolor');
    assert.equal(a.claySettings.timeFont, 'leco');
  }
  for (let i = 0; i < B_FRAMES; i++) {
    const nn = String(i).padStart(2, '0');
    const b = readFrame(outDir, `timelapse-b-${nn}.json`);
    assert.equal(b.claySettings.secondaryLine, 'wind');
    assert.equal(b.claySettings.barSource, 'off');
  }
  assert.deepEqual(PHASE_A_CLAY, {
    secondaryLine: 'precip_prob', secondaryLineFill: true, barSource: 'rain',
    rainBarColor: 'multicolor', timeFont: 'leco',
  });
  assert.deepEqual(PHASE_B_CLAY, { secondaryLine: 'wind', barSource: 'off' });
});

test('config overrides preserve unrelated base claySettings (e.g. provider)', () => {
  const { outDir } = run();
  const a = readFrame(outDir, 'timelapse-a-00.json');
  assert.equal(a.claySettings.provider, 'dwd');
});

test('Phase A anchor advances 1h/frame (scroll); Phase B anchor stays pinned', () => {
  const { outDir } = run();
  const aEpochs = [];
  const bEpochs = new Set();
  for (let i = 0; i < A_FRAMES; i++) {
    const a = readFrame(outDir, `timelapse-a-${String(i).padStart(2, '0')}.json`);
    assert.equal(a.weather.startHour, undefined);
    aEpochs.push(a.weather.startEpoch);
  }
  for (let i = 0; i < B_FRAMES; i++) {
    const b = readFrame(outDir, `timelapse-b-${String(i).padStart(2, '0')}.json`);
    assert.equal(b.weather.startHour, undefined);
    bEpochs.add(b.weather.startEpoch);
  }
  for (let i = 1; i < aEpochs.length; i++) {
    assert.equal(aEpochs[i] - aEpochs[i - 1], 3600, `Phase A anchor must step 3600s at frame ${i}`);
  }
  assert.equal(bEpochs.size, 1, 'Phase B anchor must be constant');
  // (Cross-phase epoch ordering is intentionally not asserted: the two phases
  // anchor on different calendar dates now — Phase A on the DWD fixture's day,
  // Phase B on the Berlin fixture's day. Clock-of-day continuity at the 22:20
  // hand-off is covered by the watch.now continuity test.)
});

test('Phase A slides a full-width 24h forecast window over the long DWD base', () => {
  const { outDir } = run();
  // Unclamped series slice verbatim; temps are additionally pinned (clamped),
  // so they're checked against the clamped slice below.
  const series = ['precipPct', 'rainMm', 'windKmh', 'gustKmh'];
  const a0 = readFrame(outDir, 'timelapse-a-00.json');
  for (const k of series) {
    assert.equal(a0.weather[k].length, A_WINDOW, `${k} should be ${A_WINDOW} long in Phase A`);
    assert.deepEqual(a0.weather[k], A_BASE.weather[k].slice(0, A_WINDOW), `${k} a-00 == base[0..${A_WINDOW})`);
  }
  assert.equal(a0.weather.temps.length, A_WINDOW, 'temps should be 24 long in Phase A');
  // Frame i is the base window shifted right by i (curve scrolls left), with
  // temps clamped onto the pinned axis rail.
  for (let i = 0; i < A_FRAMES; i++) {
    const a = readFrame(outDir, `timelapse-a-${String(i).padStart(2, '0')}.json`);
    assert.deepEqual(
      a.weather.rainMm, A_BASE.weather.rainMm.slice(i, i + A_WINDOW),
      `rainMm a-${i} == base[${i}..${i + A_WINDOW})`
    );
    assert.deepEqual(
      a.weather.temps, A_BASE.weather.temps.slice(i, i + A_WINDOW).map(clampToPin),
      `temps a-${i} == clamped base[${i}..${i + A_WINDOW})`
    );
  }
});

test('Phase A pins the temp axis: every frame shares one min/max', () => {
  const { outDir } = run();
  for (let i = 0; i < A_FRAMES; i++) {
    const a = readFrame(outDir, `timelapse-a-${String(i).padStart(2, '0')}.json`);
    assert.equal(Math.min(...a.weather.temps), A_PIN.lo, `frame ${i} min == pinned lo`);
    assert.equal(Math.max(...a.weather.temps), A_PIN.hi, `frame ${i} max == pinned hi`);
  }
});

test('Phase B keeps the full 24 forecast/radar slots (no scroll, no slice)', () => {
  const { outDir } = run();
  for (const name of ['timelapse-b-00.json', 'timelapse-b-19.json']) {
    const b = readFrame(outDir, name);
    assert.equal(b.weather.temps.length, 24);
    assert.equal(b.weather.rainRadarExactMm.length, 24);
    assert.equal(b.weather.rainRadarAreaMm.length, 24);
  }
});

test('frames within a phase normalize to identical sun-event epochs', () => {
  const { outDir } = run();
  // Each phase has its own base date (Phase A: 2026-06-20; Phase B: the Berlin
  // fixture's day), so epochs are constant within a phase, not across phases.
  const checkConstant = (names) => {
    let ref = null;
    for (const name of names) {
      const fx = readFrame(outDir, name);
      normalizeWeather(fx);
      const epochs = fx.weather.sunEvents.map((e) => e.epoch);
      if (ref === null) ref = epochs;
      assert.deepEqual(epochs, ref);
    }
  };
  checkConstant(['timelapse-a-00.json', 'timelapse-a-11.json']);
  checkConstant(['timelapse-b-00.json', 'timelapse-b-19.json']);
});

test('clears stale timelapse fixtures so the on-disk set matches the run', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-tl-'));
  // Leftovers from a previous, higher-frame-count run plus an unrelated file.
  fs.writeFileSync(path.join(outDir, 'timelapse-a-19.json'), '{}');
  fs.writeFileSync(path.join(outDir, 'timelapse-b-25.json'), '{}');
  fs.writeFileSync(path.join(outDir, 'berlin.json'), '{}');
  generateFrames({ outDir });
  assert.ok(!fs.existsSync(path.join(outDir, 'timelapse-a-19.json')), 'stale a-19 removed');
  assert.ok(!fs.existsSync(path.join(outDir, 'timelapse-b-25.json')), 'stale b-25 removed');
  assert.ok(fs.existsSync(path.join(outDir, 'berlin.json')), 'unrelated file kept');
  assert.ok(fs.existsSync(path.join(outDir, 'timelapse-a-11.json')), 'new a-11 written');
});

test('parseHHMM throws on malformed input', () => {
  assert.throws(() => parseHHMM('not-a-time'), /Expected HH:MM/);
  assert.throws(() => parseHHMM('2045'), /Expected HH:MM/);
});

test('generateFrames throws when a phase crosses midnight', () => {
  assert.throws(
    () => run({ phaseBStart: '23:50', phaseBFrames: 5 }),
    /crosses midnight/
  );
});

test('generateFrames throws when the scroll window exceeds the base data', () => {
  // (frames-1)+window must fit in the Phase A base series (the 39h DWD fixture).
  assert.throws(() => run({ phaseAFrames: 12, phaseAWindow: 30 }), /window/);
});

test('generateFrames rejects non-positive / non-integer frame counts', () => {
  assert.throws(() => run({ phaseAFrames: 0 }), /positive integer/);
  assert.throws(() => run({ phaseAFrames: NaN }), /positive integer/);
  assert.throws(() => run({ phaseBStep: 0 }), /positive integer/);
});

test('parseArgs parses phase-specific flags and numeric coercion', () => {
  assert.deepEqual(
    parseArgs([
      '--phase-a-frames=12', '--phase-a-window=13', '--phase-a-start=11:20',
      '--phase-b-start=22:30', '--phase-b-step-min=10',
    ]),
    {
      phaseAFrames: 12, phaseAWindow: 13, phaseAStart: '11:20',
      phaseBStart: '22:30', phaseBStep: 10,
    }
  );
});

test('parseArgs throws when a space-separated flag is missing its value', () => {
  assert.throws(() => parseArgs(['--phase-a-start']), /requires a value/);
  assert.throws(() => parseArgs(['--phase-a-start', '--phase-a-frames']), /requires a value/);
});
