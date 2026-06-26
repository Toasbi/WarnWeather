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
const { normalizeWeather, dateFromWatchNow } = require('../scripts/lib/fixture-time');

const A_FRAMES = 12;
const A_WINDOW = 24;
const B_FRAMES = 20;
// Phase A scrolls a full-width window over the long DWD fixture; Phase B reuses
// the 24h Berlin fixture, sliding its forecast one slot per clock-hour while the
// radar scrolls every 5 min.
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
    assert.equal(b.claySettings.timeFont, 'leco');
  }
  assert.deepEqual(PHASE_A_CLAY, {
    secondaryLine: 'precip_prob', secondaryLineFill: true, barSource: 'rain',
    rainBarColor: 'multicolor', timeFont: 'leco',
  });
  assert.deepEqual(PHASE_B_CLAY, { secondaryLine: 'wind', barSource: 'off', timeFont: 'leco' });
});

test('config overrides preserve unrelated base claySettings (e.g. provider)', () => {
  const { outDir } = run();
  const a = readFrame(outDir, 'timelapse-a-00.json');
  assert.equal(a.claySettings.provider, 'dwd');
});

test('Phase A anchor advances 1h/frame; Phase B anchor advances at the clock-hour boundary', () => {
  const { outDir } = run();
  const aEpochs = [];
  for (let i = 0; i < A_FRAMES; i++) {
    const a = readFrame(outDir, `timelapse-a-${String(i).padStart(2, '0')}.json`);
    assert.equal(a.weather.startHour, undefined);
    aEpochs.push(a.weather.startEpoch);
  }
  for (let i = 1; i < aEpochs.length; i++) {
    assert.equal(aEpochs[i] - aEpochs[i - 1], 3600, `Phase A anchor must step 3600s at frame ${i}`);
  }
  // Phase B steps 5 min/frame, so its forecast anchor holds within an hour and
  // jumps a single 3600s step exactly when the clock rolls over (22:20 + 40 min
  // = 23:00, frame 8) — not every frame.
  const b00Epoch = readFrame(outDir, 'timelapse-b-00.json').weather.startEpoch;
  for (let i = 0; i < B_FRAMES; i++) {
    const b = readFrame(outDir, `timelapse-b-${String(i).padStart(2, '0')}.json`);
    assert.equal(b.weather.startHour, undefined);
    const expectedOffset = Math.floor((22 * 60 + 20 + i * 5) / 60) - 22;
    assert.equal(
      b.weather.startEpoch - b00Epoch, expectedOffset * 3600,
      `Phase B anchor steps with the clock hour at frame ${i}`
    );
  }
  // (Cross-phase epoch ordering is intentionally not asserted: the two phases
  // anchor on different calendar dates — Phase A on the DWD fixture's day, Phase
  // B on the Berlin fixture's day. Clock continuity at the 22:20 hand-off is
  // covered by the watch.now continuity test.)
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

test('Phase B slides the forecast one slot at the hour boundary; radar scrolls every 5 min', () => {
  const { outDir } = run();
  const RADAR_WINDOW = 24;
  const B_WINDOW = 24;
  // Phase B pads the 24h base by one hour (repeat last) so a full 24-slot window
  // can slide forward, and pins the temp axis over the two windows it visits.
  const padded = BASE.weather.temps.concat(BASE.weather.temps[BASE.weather.temps.length - 1]);
  const bPin = computePinnedTempBounds(padded, 2, B_WINDOW);
  const clampB = (v) => Math.max(bPin.lo, Math.min(bPin.hi, v));
  const b00 = readFrame(outDir, 'timelapse-b-00.json');
  for (let i = 0; i < B_FRAMES; i++) {
    const b = readFrame(outDir, `timelapse-b-${String(i).padStart(2, '0')}.json`);
    const off = Math.floor((22 * 60 + 20 + i * 5) / 60) - 22;   // 0 until 23:00, then 1
    // Forecast window stays full-width but its content shifts one slot once the
    // clock crosses into the next hour.
    assert.equal(b.weather.temps.length, B_WINDOW, `temps window stays ${B_WINDOW} (frame ${i})`);
    assert.deepEqual(
      b.weather.temps, padded.slice(off, off + B_WINDOW).map(clampB),
      `temps == clamped padded[${off}..${off + B_WINDOW}) (frame ${i})`
    );
    // Radar is a RADAR_WINDOW view sliced from the longer base, advancing one
    // 5-min slot per frame regardless of the forecast's hour-granular slide.
    assert.equal(b.weather.rainRadarExactMm.length, RADAR_WINDOW, `radar exact window (frame ${i})`);
    assert.equal(b.weather.rainRadarAreaMm.length, RADAR_WINDOW, `radar area window (frame ${i})`);
    assert.deepEqual(
      b.weather.rainRadarExactMm, BASE.weather.rainRadarExactMm.slice(i, i + RADAR_WINDOW),
      `radar exact b-${i} == base[${i}..${i + RADAR_WINDOW})`
    );
    assert.deepEqual(
      b.weather.rainRadarAreaMm, BASE.weather.rainRadarAreaMm.slice(i, i + RADAR_WINDOW),
      `radar area b-${i} == base[${i}..${i + RADAR_WINDOW})`
    );
    // Radar anchor (radarStartEpoch) tracks the clock at 300 s/frame, independent
    // of the forecast anchor's hour-boundary step.
    assert.equal(
      b.weather.radarStartEpoch - b00.weather.radarStartEpoch, i * 300,
      `radarStartEpoch steps 300s at frame ${i}`
    );
  }
  // The forecast holds within the hour and actually moves across the boundary.
  const pre = readFrame(outDir, 'timelapse-b-07.json').weather.temps;
  const post = readFrame(outDir, 'timelapse-b-08.json').weather.temps;
  assert.deepEqual(readFrame(outDir, 'timelapse-b-00.json').weather.temps, pre, 'flat within the first hour');
  assert.notDeepEqual(pre, post, 'forecast curve advances one slot at 23:00');
});

test('current temp tracks the clock instead of the base fixture constant', () => {
  const { outDir } = run();
  // Phase A: the now-hour temp advances one slot per frame with the scroll.
  const aTemps = [];
  for (let i = 0; i < A_FRAMES; i++) {
    const a = readFrame(outDir, `timelapse-a-${String(i).padStart(2, '0')}.json`);
    assert.equal(a.weather.currentTemp, A_BASE.weather.temps[i], `A current temp == base temps[${i}]`);
    aTemps.push(a.weather.currentTemp);
  }
  assert.ok(new Set(aTemps).size > 1, 'current temp varies across Phase A');
  // Phase B: holds the 22:xx hour temp, then steps to the next hour's at 23:00.
  for (let i = 0; i < B_FRAMES; i++) {
    const b = readFrame(outDir, `timelapse-b-${String(i).padStart(2, '0')}.json`);
    const off = Math.floor((22 * 60 + 20 + i * 5) / 60) - 22;
    assert.equal(b.weather.currentTemp, BASE.weather.temps[off], `B current temp == base temps[${off}]`);
  }
});

test('generateFrames throws when the radar scroll window overflows the radar base data', () => {
  // Phase B needs RADAR_WINDOW + (frames-1) radar slots; berlin.json has 44.
  // Start early enough that the midnight guard doesn't trip first.
  assert.throws(() => run({ phaseBStart: '10:00', phaseBFrames: 30 }), /radar/);
});

test('sun events track watch.now: the indicated event is always the next one ahead', () => {
  const { outDir } = run();
  // sunEvents[0] is what the watch shows (with an arrow keyed off its type), so
  // for every frame it must be the first event strictly after watch.now, ordered.
  const firstType = (name) => {
    const fx = readFrame(outDir, name);
    const nowEpoch = dateFromWatchNow(fx.watch.now, {
      hour: fx.watch.now.hour, minute: fx.watch.now.minute,
    });
    normalizeWeather(fx);
    const ev = fx.weather.sunEvents;
    assert.ok(ev[0].epoch > nowEpoch, `${name}: first sun event must be after now`);
    assert.ok(ev[1].epoch > ev[0].epoch, `${name}: events must be ordered`);
    return ev[0].type;
  };
  for (let i = 0; i < A_FRAMES; i++) firstType(`timelapse-a-${String(i).padStart(2, '0')}.json`);
  for (let i = 0; i < B_FRAMES; i++) firstType(`timelapse-b-${String(i).padStart(2, '0')}.json`);
  // Phase A passes sunset (~21:30) near its end, so the indicator flips from the
  // coming sunset to the next sunrise; Phase B is always past sunset, so it
  // consistently points at the next sunrise.
  assert.equal(firstType('timelapse-a-00.json'), 'sunset', '11:20 -> next is the coming sunset');
  assert.equal(
    firstType(`timelapse-a-${String(A_FRAMES - 1).padStart(2, '0')}.json`), 'sunrise',
    '22:20 -> sunset passed, next is sunrise'
  );
  assert.equal(firstType('timelapse-b-00.json'), 'sunrise', 'Phase B -> next is sunrise');
  assert.equal(firstType('timelapse-b-19.json'), 'sunrise', 'Phase B -> next is sunrise');
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
