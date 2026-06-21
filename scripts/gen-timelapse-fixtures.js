#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { dateFromWatchNow } = require('./lib/fixture-time');

const BASE_PATH = path.join('fixtures', 'berlin.json');

// Phase A (forecast/calendar view): rain-probability line, no area fill, no
// multicolor bars. Phase B (radar view): wind speed with the auto-drawn dotted
// gust line, rain bars off. These are the only claySettings that differ.
const PHASE_A_CLAY = {
  secondaryLine: 'precip_prob',
  secondaryLineFill: false,
  barSource: 'rain',
  rainBarColor: 'white',
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
 * Write one phase's frames. watch.now advances stepMin per frame from startHHMM
 * while startEpoch (the shared forecast + radar anchor) is pinned at anchorHHMM,
 * which makes the now-marker slide and the radar current-slot step forward.
 *
 * @param {Object} base Parsed base fixture (berlin.json).
 * @param {Object} opts Phase options.
 * @param {string} opts.outDir Directory to write into.
 * @param {string} opts.prefix Filename prefix, e.g. "timelapse-a".
 * @param {string} opts.startHHMM First frame's watch.now time.
 * @param {string} opts.anchorHHMM Pinned forecast/radar anchor time.
 * @param {Object} opts.clay claySettings overrides for this phase.
 * @param {number} opts.frames Number of frames.
 * @param {number} opts.stepMin Minutes between frames.
 * @returns {string[]} Paths of the written fixture files.
 */
function writePhase(base, opts) {
  const { outDir, prefix, startHHMM, anchorHHMM, clay, frames, stepMin } = opts;
  const baseNow = base.watch.now;
  const start = parseHHMM(startHHMM);
  const anchor = parseHHMM(anchorHHMM);
  const startEpoch = dateFromWatchNow(baseNow, { hour: anchor.hour, minute: anchor.minute });
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
    // Pin the forecast/radar anchor and drop the readable startHour so
    // prepare-fixture.js leaves startEpoch untouched. sunEvents stay in
    // dayOffset/hour/minute form: same calendar day => identical epochs.
    delete frame.weather.startHour;
    delete frame.weather.startDayOffset;
    frame.weather.startEpoch = startEpoch;
    frame.claySettings = { ...base.claySettings, ...clay };

    const nn = String(i).padStart(2, '0');
    const outPath = path.join(outDir, prefix + '-' + nn + '.json');
    fs.writeFileSync(outPath, JSON.stringify(frame, null, 2) + '\n');
    written.push(outPath);
  }

  return written;
}

/**
 * Build the two-phase time-lapse fixtures and write them to disk.
 *
 * @param {Object} [opts] Options.
 * @param {string} [opts.outDir="fixtures"] Output directory.
 * @param {number} [opts.frames=20] Frames per phase.
 * @param {number} [opts.stepMin=5] Minutes between frames.
 * @param {string} [opts.phaseAStart="20:45"] Phase A first watch.now + anchor.
 * @param {string} [opts.phaseBStart="22:20"] Phase B first watch.now + anchor.
 * @returns {{a: string[], b: string[]}} Written fixture paths per phase.
 */
function generateFrames(opts = {}) {
  const outDir = opts.outDir ?? 'fixtures';
  const frames = opts.frames ?? 20;
  const stepMin = opts.stepMin ?? 5;
  const phaseAStart = opts.phaseAStart ?? '20:45';
  const phaseBStart = opts.phaseBStart ?? '22:20';

  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error('frames must be a positive integer, got ' + opts.frames);
  }
  if (!Number.isInteger(stepMin) || stepMin < 1) {
    throw new Error('stepMin must be a positive integer, got ' + opts.stepMin);
  }

  const base = JSON.parse(fs.readFileSync(BASE_PATH, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  const a = writePhase(base, {
    outDir, prefix: 'timelapse-a', startHHMM: phaseAStart, anchorHHMM: phaseAStart,
    clay: PHASE_A_CLAY, frames, stepMin,
  });
  const b = writePhase(base, {
    outDir, prefix: 'timelapse-b', startHHMM: phaseBStart, anchorHHMM: phaseBStart,
    clay: PHASE_B_CLAY, frames, stepMin,
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
    'frames': 'frames',
    'step-min': 'stepMin',
    'phase-a-start': 'phaseAStart',
    'phase-b-start': 'phaseBStart',
  };
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
    opts[optKey] = (optKey === 'frames' || optKey === 'stepMin') ? Number(val) : val;
  }
  return opts;
}

if (require.main === module) {
  const { a, b } = generateFrames(parseArgs(process.argv.slice(2)));
  console.log('Wrote ' + a.length + ' Phase A + ' + b.length + ' Phase B fixtures to ' + path.dirname(a[0]));
}

module.exports = { generateFrames, writePhase, parseHHMM, parseArgs, PHASE_A_CLAY, PHASE_B_CLAY };
