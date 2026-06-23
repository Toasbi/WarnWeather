#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { dateFromWatchNow } = require('./lib/fixture-time');

// Phase B (radar) reuses the original 24h Berlin fixture — it keeps the full
// 24-slot forecast/radar arrays the radar view needs and does not scroll.
const BASE_PATH = path.join('fixtures', 'berlin.json');
// Phase A (forecast) scrolls a full-width 24-slot window, which needs MORE than
// 24h of base data to slide over. berlin-timelapse.json is real DWD/Brightsky
// data from 2026-06-20 (39h) whose 2026-06-21 noon thunderstorm scrolls in from
// the right as the clock advances.
const PHASE_A_BASE_PATH = path.join('fixtures', 'berlin-timelapse.json');

// Phase A (forecast/calendar view): rain-probability line with a filled area,
// multicolor rain bars, Leco main time font. Phase B (radar view): wind speed
// with the auto-drawn dotted gust line, rain bars off.
const PHASE_A_CLAY = {
  secondaryLine: 'precip_prob',
  secondaryLineFill: true,
  barSource: 'rain',
  rainBarColor: 'multicolor',
  timeFont: 'leco',
};
const PHASE_B_CLAY = {
  secondaryLine: 'wind',
  barSource: 'off',
};

/**
 * Parse an "HH:MM" string into {hour, minute}.
 *
 * @param {string} hhmm Time string like "20:45".
 * @returns {{hour: number, minute: number}} Parsed components.
 */
function parseHHMM(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) {
    throw new Error('Expected HH:MM, got "' + hhmm + '"');
  }
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * Compute fixed temperature axis bounds that every scrolling window shares.
 *
 * The watch derives the temp axis lo/hi with min_max() over the *visible*
 * window, so a sliding window would rescale the curve vertically frame to
 * frame. Pinning the axis means making min_max() return the same pair for every
 * frame, which requires those two values to be present in every window and no
 * value to exceed them. The tightest such pair is lo = max of the per-window
 * minima and hi = min of the per-window maxima: clamping the series to [lo, hi]
 * then leaves every window with min==lo and max==hi (each window's own min is
 * <= lo and max is >= hi by construction, so clamping snaps them onto the rail).
 *
 * @param {number[]} temps Full base temperature series.
 * @param {number} frames Number of scrolling frames.
 * @param {number} windowSize Window width in entries.
 * @returns {{lo: number, hi: number}} Pinned bounds.
 */
function computePinnedTempBounds(temps, frames, windowSize) {
  let lo = -Infinity;
  let hi = Infinity;
  for (let i = 0; i < frames; i++) {
    const win = temps.slice(i, i + windowSize);
    const wMin = Math.min(...win);
    const wMax = Math.max(...win);
    if (wMin > lo) { lo = wMin; }
    if (wMax < hi) { hi = wMax; }
  }
  if (!(lo < hi)) {
    throw new Error(
      'cannot pin temp axis: every window must share a lo<hi, got lo=' + lo + ' hi=' + hi
      + ' (the data swings too much across the window — widen the window or pick steadier data)'
    );
  }
  return { lo, hi };
}

/**
 * Write one phase's frames. watch.now advances stepMin per frame from startHHMM.
 *
 * Non-scrolling (Phase B / radar): startEpoch is pinned at anchorHHMM and the
 * full forecast/radar arrays are kept; the watch self-advances its radar window
 * on tick, so only the clock moves frame-to-frame.
 *
 * Scrolling (Phase A / forecast): the forecast graph has no now-marker, so a
 * pinned anchor would leave it frozen. Instead the anchor advances one hour per
 * frame and every hourly forecast series slides a `window`-wide view over the
 * base data (frame i shows base[i .. i+window)). Because the data is pinned in
 * absolute time, the curve scrolls left, the night hatch sweeps, and the axis
 * advances in lockstep with the clock.
 *
 * @param {Object} base Parsed base fixture (berlin.json).
 * @param {Object} opts Phase options.
 * @param {string} opts.outDir Directory to write into.
 * @param {string} opts.prefix Filename prefix, e.g. "timelapse-a".
 * @param {string} opts.startHHMM First frame's watch.now time.
 * @param {string} opts.anchorHHMM Forecast/radar anchor time of the first frame.
 * @param {Object} opts.clay claySettings overrides for this phase.
 * @param {number} opts.frames Number of frames.
 * @param {number} opts.stepMin Minutes between frames.
 * @param {boolean} [opts.scroll=false] Advance the anchor and slide the data window.
 * @param {number} [opts.window=null] Hours of forecast data shown per scrolling frame.
 * @returns {string[]} Paths of the written fixture files.
 */
function writePhase(base, opts) {
  const {
    outDir, prefix, startHHMM, anchorHHMM, clay, frames, stepMin,
    scroll = false, window: windowSize = null,
  } = opts;
  const baseNow = base.watch.now;
  const start = parseHHMM(startHHMM);
  const anchor = parseHHMM(anchorHHMM);
  const startEpoch = dateFromWatchNow(baseNow, { hour: anchor.hour, minute: anchor.minute });
  const baseDataLen = Array.isArray(base.weather && base.weather.temps)
    ? base.weather.temps.length : 0;

  if (scroll) {
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new Error('window must be a positive integer for a scrolling phase, got ' + windowSize);
    }
    if ((frames - 1) + windowSize > baseDataLen) {
      throw new Error(
        'scroll window overflows base data: (frames-1)+window = ' + ((frames - 1) + windowSize)
        + ' exceeds the ' + baseDataLen + ' base hours; reduce frames or window'
      );
    }
  }
  // Pin the temp axis so the scrolling curve keeps one vertical scale (see
  // computePinnedTempBounds). Non-scrolling phases need no pin — their window
  // is constant, so min_max() is already stable.
  const pinnedTemps = scroll
    ? computePinnedTempBounds(base.weather.temps, frames, windowSize)
    : null;
  const written = [];

  for (let i = 0; i < frames; i++) {
    const totalMin = start.hour * 60 + start.minute + i * stepMin;
    if (totalMin >= 24 * 60) {
      throw new Error('Frame ' + i + ' of ' + prefix + ' crosses midnight; narrow the window or frame count');
    }
    const frame = JSON.parse(JSON.stringify(base));
    frame.watch.now = {
      ...baseNow,
      hour: Math.floor(totalMin / 60),
      minute: totalMin % 60,
      second: 0,
    };
    // Drop the readable startHour so prepare-fixture.js leaves startEpoch
    // untouched. sunEvents stay in dayOffset/hour/minute form: same calendar
    // day => identical epochs, so the night hatch is consistent across frames.
    delete frame.weather.startHour;
    delete frame.weather.startDayOffset;
    if (scroll) {
      frame.weather.startEpoch = startEpoch + i * 3600;
      for (const key of Object.keys(frame.weather)) {
        const arr = frame.weather[key];
        if (Array.isArray(arr) && arr.length === baseDataLen) {
          frame.weather[key] = arr.slice(i, i + windowSize);
        }
      }
      // Clamp the (already-sliced) temps onto the shared axis rail.
      frame.weather.temps = frame.weather.temps.map(function clampToPin(value) {
        if (value < pinnedTemps.lo) { return pinnedTemps.lo; }
        if (value > pinnedTemps.hi) { return pinnedTemps.hi; }
        return value;
      });
    } else {
      frame.weather.startEpoch = startEpoch;
    }
    frame.claySettings = { ...base.claySettings, ...clay };

    const nn = String(i).padStart(2, '0');
    const outPath = path.join(outDir, prefix + '-' + nn + '.json');
    fs.writeFileSync(outPath, JSON.stringify(frame, null, 2) + '\n');
    written.push(outPath);
  }

  return written;
}

/**
 * Assert a phase parameter is a positive integer.
 *
 * @param {string} label Parameter name for the error message.
 * @param {number} value Resolved value.
 * @returns {void}
 */
function assertPositiveInt(label, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(label + ' must be a positive integer, got ' + value);
  }
}

/**
 * Build the two-phase time-lapse fixtures and write them to disk.
 *
 * Phase A (forecast) scrolls: it steps one hour per frame and slides a
 * `phaseAWindow`-hour view over the base data, defaulting to end exactly where
 * Phase B begins (22:20) so the combined clock is continuous. Phase B (radar)
 * keeps the original fine-grained, pinned-anchor behavior.
 *
 * @param {Object} [opts] Options.
 * @param {string} [opts.outDir="fixtures"] Output directory.
 * @param {string} [opts.phaseAStart="11:20"] Phase A first watch.now + anchor.
 * @param {number} [opts.phaseAFrames=12] Phase A frame count.
 * @param {number} [opts.phaseAStep=60] Phase A minutes between frames (1h scroll).
 * @param {number} [opts.phaseAWindow=24] Phase A forecast hours shown per frame
 *   (24 = the full chart grid, so the curve fills the width and new values
 *   enter from the right edge instead of cutting off mid-screen).
 * @param {string} [opts.phaseBStart="22:20"] Phase B first watch.now + anchor.
 * @param {number} [opts.phaseBFrames=20] Phase B frame count.
 * @param {number} [opts.phaseBStep=5] Phase B minutes between frames.
 * @returns {{a: string[], b: string[]}} Written fixture paths per phase.
 */
function generateFrames(opts = {}) {
  const outDir = opts.outDir ?? 'fixtures';
  const phaseAStart = opts.phaseAStart ?? '11:20';
  const phaseAFrames = opts.phaseAFrames ?? 12;
  const phaseAStep = opts.phaseAStep ?? 60;
  const phaseAWindow = opts.phaseAWindow ?? 24;
  const phaseBStart = opts.phaseBStart ?? '22:20';
  const phaseBFrames = opts.phaseBFrames ?? 20;
  const phaseBStep = opts.phaseBStep ?? 5;

  assertPositiveInt('phaseAFrames', phaseAFrames);
  assertPositiveInt('phaseAStep', phaseAStep);
  assertPositiveInt('phaseAWindow', phaseAWindow);
  assertPositiveInt('phaseBFrames', phaseBFrames);
  assertPositiveInt('phaseBStep', phaseBStep);

  const phaseABase = JSON.parse(fs.readFileSync(PHASE_A_BASE_PATH, 'utf8'));
  const phaseBBase = JSON.parse(fs.readFileSync(BASE_PATH, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  // Clear any timelapse fixtures from a prior run so the on-disk set always
  // matches this run's frame counts — capture-timelapse.sh globs
  // timelapse-[ab]-*.json, and a shorter run would otherwise leave stale,
  // higher-numbered frames behind.
  for (const name of fs.readdirSync(outDir)) {
    if (/^timelapse-[ab]-\d+\.json$/.test(name)) {
      fs.unlinkSync(path.join(outDir, name));
    }
  }

  const a = writePhase(phaseABase, {
    outDir, prefix: 'timelapse-a', startHHMM: phaseAStart, anchorHHMM: phaseAStart,
    clay: PHASE_A_CLAY, frames: phaseAFrames, stepMin: phaseAStep,
    scroll: true, window: phaseAWindow,
  });
  const b = writePhase(phaseBBase, {
    outDir, prefix: 'timelapse-b', startHHMM: phaseBStart, anchorHHMM: phaseBStart,
    clay: PHASE_B_CLAY, frames: phaseBFrames, stepMin: phaseBStep,
  });
  return { a, b };
}

/**
 * Read --key=value / --key value flags from argv into an options object.
 *
 * @param {string[]} argv Process args (process.argv.slice(2)).
 * @returns {Object} Parsed options for generateFrames.
 */
function parseArgs(argv) {
  const opts = {};
  const map = {
    'out-dir': 'outDir',
    'phase-a-start': 'phaseAStart',
    'phase-a-frames': 'phaseAFrames',
    'phase-a-step-min': 'phaseAStep',
    'phase-a-window': 'phaseAWindow',
    'phase-b-start': 'phaseBStart',
    'phase-b-frames': 'phaseBFrames',
    'phase-b-step-min': 'phaseBStep',
  };
  const numericKeys = new Set([
    'phaseAFrames', 'phaseAStep', 'phaseAWindow', 'phaseBFrames', 'phaseBStep',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    let key;
    let val;
    if (arg.startsWith('--') && eq !== -1) {
      key = arg.slice(2, eq);
      val = arg.slice(eq + 1);
    } else if (arg.startsWith('--')) {
      key = arg.slice(2);
      val = argv[++i];
      if (val === undefined || val.startsWith('--')) {
        throw new Error('Flag --' + key + ' requires a value');
      }
    } else {
      continue;
    }
    const optKey = map[key];
    if (!optKey) {
      continue;
    }
    opts[optKey] = numericKeys.has(optKey) ? Number(val) : val;
  }
  return opts;
}

if (require.main === module) {
  const { a, b } = generateFrames(parseArgs(process.argv.slice(2)));
  console.log('Wrote ' + a.length + ' Phase A + ' + b.length + ' Phase B fixtures to ' + path.dirname(a[0]));
}

module.exports = {
  generateFrames, writePhase, parseHHMM, parseArgs, computePinnedTempBounds,
  PHASE_A_CLAY, PHASE_B_CLAY, PHASE_A_BASE_PATH, BASE_PATH,
};
