#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { dateFromWatchNow } = require('./lib/fixture-time');

// Phase B (radar) reuses the original 24h Berlin fixture for its 24-slot radar
// arrays. Its forecast series get padded one hour so the bottom graph can slide
// a full window forward each time the clock crosses into a new hour (the radar
// scrolls every 5 min; the hourly curve can only move on the hour).
const BASE_PATH = path.join('fixtures', 'berlin.json');
// Phase A (forecast) scrolls a full-width 24-slot window, which needs MORE than
// 24h of base data to slide over. berlin-timelapse.json is real DWD/Brightsky
// data from 2026-06-20 (39h) whose 2026-06-21 noon thunderstorm scrolls in from
// the right as the clock advances.
const PHASE_A_BASE_PATH = path.join('fixtures', 'berlin-timelapse.json');

// Phase A (forecast/calendar view): rain-probability line with a filled area,
// multicolor rain bars, Leco main time font. Phase B (radar view): wind speed
// with the auto-drawn dotted gust line, rain bars off, same Leco main time font.
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
  timeFont: 'leco',
};

// Radar window geometry, mirrored from the C side (rain_radar_layer.c:
// RADAR_NUM_SLOTS / RADAR_SLOT_SECONDS). Phase B scrolls a RADAR_WINDOW-slot
// view over a longer base radar series, advancing one slot per RADAR_SLOT_SECONDS
// of clock — the watch can't self-advance the radar in compile-time fixture
// builds (the tick handler is #ifndef WW_FIXTURE_NOW_YEAR), so the scroll has to
// be baked into the frames.
const RADAR_WINDOW = 24;
const RADAR_SLOT_SECONDS = 5 * 60;

/**
 * Build the next sunrise/sunset pair after a minute-of-day, in the readable
 * {type, dayOffset, hour, minute} fixture form (next event first).
 *
 * The watch shows sunEvents[0] (with an up/down arrow keyed off its type — see
 * provider.js SUN_EVENTS), so each frame must carry the event that is actually
 * next at its watch.now; otherwise the indicator sticks on a sun event the clock
 * has already passed. Assumes a single daily sunrise before sunset (true at the
 * fixture's latitude/season).
 *
 * @param {number} nowMin Minutes past midnight of the frame's watch.now.
 * @param {{hour:number, minute:number}} sunrise Daily sunrise clock time.
 * @param {{hour:number, minute:number}} sunset Daily sunset clock time.
 * @returns {{type:string, dayOffset:number, hour:number, minute:number}[]} Two events.
 */
function nextSunEvents(nowMin, sunrise, sunset) {
  const riseMin = sunrise.hour * 60 + sunrise.minute;
  const setMin = sunset.hour * 60 + sunset.minute;
  const rise = (dayOffset) => ({ type: 'sunrise', dayOffset, hour: sunrise.hour, minute: sunrise.minute });
  const set = (dayOffset) => ({ type: 'sunset', dayOffset, hour: sunset.hour, minute: sunset.minute });
  if (nowMin < riseMin) { return [rise(0), set(0)]; }
  if (nowMin < setMin) { return [set(0), rise(1)]; }
  return [rise(1), set(1)];
}

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
 * Scrolling (`scroll`): the forecast graph has no now-marker, and its curve is
 * plotted by slot *index* (chart.c maps slot i -> x, never by time), so it can
 * only move a whole slot at a time. Each frame slides a `window`-wide view of
 * every hourly series by hourOffset(i) = whole clock-hours past the start hour,
 * and advances the anchor by the same. The curve scrolls left, the night hatch
 * sweeps, and the axis advances together — but only when the clock enters a new
 * hour. Phase A (60-min step) advances every frame; Phase B (5-min radar step)
 * advances once per hour and holds on the sub-hour frames in between.
 *
 * Radar-scrolling (`radarScroll`, Phase B): independent of the forecast, a
 * sliding RADAR_WINDOW view (frame i shows radar[i .. i+RADAR_WINDOW)) and its
 * own radarStartEpoch scroll the rain radar one 5-min slot per frame, so the
 * radar keeps moving smoothly between the forecast's hour-boundary steps. The
 * watch can't self-advance the radar in compile-time fixture builds (its tick
 * handler is compiled out under WW_FIXTURE_NOW_YEAR), so it's baked in here.
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
 * @param {boolean} [opts.scroll=false] Slide the forecast window + anchor by whole
 *   clock-hours (hourOffset) per frame.
 * @param {number} [opts.window=null] Hours of forecast data shown per scrolling frame.
 * @param {boolean} [opts.padForecast=false] When the sliding window would overflow
 *   the base forecast series, extend each series (repeat last value) instead of
 *   throwing — lets a short base (Phase B's 24h) scroll. Off for Phase A so it
 *   errors rather than inventing DWD data.
 * @param {boolean} [opts.radarScroll=false] Scroll a RADAR_WINDOW-slot radar view
 *   over a longer base radar series (one slot per stepMin) via a separate
 *   radarStartEpoch. Mutually independent of `scroll` (which is for the forecast).
 * @returns {string[]} Paths of the written fixture files.
 */
function writePhase(base, opts) {
  const {
    outDir, prefix, startHHMM, anchorHHMM, clay, frames, stepMin,
    scroll = false, window: windowSize = null, radarScroll = false,
    padForecast = false,
  } = opts;
  const baseNow = base.watch.now;
  const start = parseHHMM(startHHMM);
  const anchor = parseHHMM(anchorHHMM);
  const startEpoch = dateFromWatchNow(baseNow, { hour: anchor.hour, minute: anchor.minute });

  // hourOffset(i): whole clock-hours watch.now has advanced past the phase's
  // start hour by frame i. With a 60-min step (Phase A) it equals i; with the
  // 5-min radar step (Phase B) it stays 0 until the clock rolls into the next
  // hour, then ticks up. The hourly forecast curve is plotted by slot *index*
  // (chart.c maps slot i -> x, never by time), so it can only move a whole slot
  // at a time — driving the slide off hourOffset advances it exactly when the
  // hour changes and leaves it put on sub-hour frames, while the radar scrolls on.
  const startMinOfDay = start.hour * 60 + start.minute;
  const hourOffset = (i) => Math.floor((startMinOfDay + i * stepMin) / 60) - start.hour;

  let forecastLen = Array.isArray(base.weather && base.weather.temps)
    ? base.weather.temps.length : 0;

  if (scroll) {
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new Error('window must be a positive integer for a scrolling phase, got ' + windowSize);
    }
    const needed = hourOffset(frames - 1) + windowSize;
    if (needed > forecastLen) {
      if (!padForecast) {
        throw new Error(
          'scroll window overflows base data: maxHourOffset+window = ' + needed
          + ' exceeds the ' + forecastLen + ' base hours; reduce frames or window'
        );
      }
      if (forecastLen < 1) {
        throw new Error('cannot scroll a phase whose base has no forecast data');
      }
      // Phase B's 24h base has no spare hours for a full window to slide into.
      // Extend every forecast series (each as long as temps) by repeating its
      // last value so the window stays full after the hour-boundary slide; the
      // longer radar arrays are a different length and are left untouched.
      for (const key of Object.keys(base.weather)) {
        const arr = base.weather[key];
        if (Array.isArray(arr) && arr.length === forecastLen) {
          const last = arr[arr.length - 1];
          while (arr.length < needed) { arr.push(last); }
        }
      }
      forecastLen = needed;
    }
  }
  // A radar-scrolling phase slides a RADAR_WINDOW view one slot per frame, so the
  // step must be a whole number of 5-min radar slots and the base radar arrays
  // must be long enough for the last window to still fit.
  if (radarScroll) {
    if ((stepMin * 60) % RADAR_SLOT_SECONDS !== 0) {
      throw new Error(
        'radar scroll needs stepMin to be a whole number of '
        + (RADAR_SLOT_SECONDS / 60) + '-min slots, got ' + stepMin
      );
    }
    const exact = base.weather.rainRadarExactMm;
    const area = base.weather.rainRadarAreaMm;
    if (!Array.isArray(exact) || !Array.isArray(area)) {
      throw new Error('radar scroll requires rainRadarExactMm and rainRadarAreaMm arrays in the base fixture');
    }
    const slotsPerFrame = (stepMin * 60) / RADAR_SLOT_SECONDS;
    const needed = RADAR_WINDOW + (frames - 1) * slotsPerFrame;
    if (exact.length < needed || area.length < needed) {
      throw new Error(
        'radar scroll window overflows base radar data: need ' + needed + ' slots ('
        + RADAR_WINDOW + ' window + ' + (frames - 1) + '*' + slotsPerFrame
        + '), but base has exact=' + exact.length + ' area=' + area.length
        + '; extend the radar arrays or reduce frames'
      );
    }
  }
  // Pin the temp axis so the scrolling curve keeps one vertical scale (see
  // computePinnedTempBounds). The distinct windows are indexed by hourOffset
  // (0..maxHourOffset), not by frame, so a phase that revisits the same window
  // across several sub-hour frames still shares one rail. Non-scrolling phases
  // need no pin — their window is constant, so min_max() is already stable.
  const pinnedTemps = scroll
    ? computePinnedTempBounds(base.weather.temps, hourOffset(frames - 1) + 1, windowSize)
    : null;

  // Daily sunrise/sunset clock times from the base, used to recompute each
  // frame's "next event" so the sun indicator tracks the clock (nextSunEvents).
  // Skip if the base lacks a clean sunrise+sunset pair.
  const baseSunrise = (base.weather.sunEvents || []).find((e) => e.type === 'sunrise');
  const baseSunset = (base.weather.sunEvents || []).find((e) => e.type === 'sunset');
  const dynamicSun = Boolean(
    baseSunrise && baseSunset
    && typeof baseSunrise.hour === 'number' && typeof baseSunset.hour === 'number'
  );
  const written = [];

  for (let i = 0; i < frames; i++) {
    const totalMin = startMinOfDay + i * stepMin;
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
    // untouched. sunEvents stay in dayOffset/hour/minute form so prepare-fixture
    // re-anchors their epochs to this frame's watch.now.
    delete frame.weather.startHour;
    delete frame.weather.startDayOffset;
    // Re-point the sun indicator at the event that is next as of this frame's
    // clock, so it flips from the coming sunset to the next sunrise once the
    // clock passes sunset (the watch shows sunEvents[0] + its arrow).
    if (dynamicSun) {
      frame.weather.sunEvents = nextSunEvents(totalMin, baseSunrise, baseSunset);
    }
    // Track the "current temp" readout with the clock — the base carries one
    // fixed currentTemp, so it would otherwise sit unchanged every frame. Use the
    // temp at the now-hour (hourOffset), matching the forecast curve's left edge.
    if (Array.isArray(base.weather.temps) && base.weather.temps.length > 0) {
      const nowIdx = Math.min(hourOffset(i), base.weather.temps.length - 1);
      frame.weather.currentTemp = base.weather.temps[nowIdx];
    }
    if (scroll) {
      // Slide the forecast window by whole clock-hours (hourOffset), so the
      // index-plotted curve, hour axis, and night hatch all advance together the
      // moment the clock enters a new hour.
      const off = hourOffset(i);
      frame.weather.startEpoch = startEpoch + off * 3600;
      for (const key of Object.keys(frame.weather)) {
        const arr = frame.weather[key];
        if (Array.isArray(arr) && arr.length === forecastLen) {
          frame.weather[key] = arr.slice(off, off + windowSize);
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
    if (radarScroll) {
      // Slide the radar window one 5-min slot per frame and anchor it to the
      // clock (slot 0 == "now"), independent of the forecast's hour-granular
      // anchor — the radar keeps scrolling smoothly between hour boundaries.
      const radarOff = i * ((stepMin * 60) / RADAR_SLOT_SECONDS);
      frame.weather.rainRadarExactMm = base.weather.rainRadarExactMm.slice(radarOff, radarOff + RADAR_WINDOW);
      frame.weather.rainRadarAreaMm = base.weather.rainRadarAreaMm.slice(radarOff, radarOff + RADAR_WINDOW);
      frame.weather.radarStartEpoch = startEpoch + radarOff * RADAR_SLOT_SECONDS;
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
 * steps 5 min/frame: its radar scrolls every frame while its forecast graph
 * advances one slot only when the clock crosses into a new hour.
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
 * @param {number} [opts.phaseBWindow=24] Phase B forecast hours shown per frame
 *   (the base is padded so a full window can slide one slot at the hour boundary).
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
  const phaseBWindow = opts.phaseBWindow ?? 24;

  assertPositiveInt('phaseAFrames', phaseAFrames);
  assertPositiveInt('phaseAStep', phaseAStep);
  assertPositiveInt('phaseAWindow', phaseAWindow);
  assertPositiveInt('phaseBFrames', phaseBFrames);
  assertPositiveInt('phaseBStep', phaseBStep);
  assertPositiveInt('phaseBWindow', phaseBWindow);

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
    // Scroll the forecast one slot per clock-hour (padForecast gives the 24h base
    // headroom to slide into) while radarScroll scrolls the radar every 5 min.
    radarScroll: true, scroll: true, window: phaseBWindow, padForecast: true,
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
    'phase-b-window': 'phaseBWindow',
  };
  const numericKeys = new Set([
    'phaseAFrames', 'phaseAStep', 'phaseAWindow', 'phaseBFrames', 'phaseBStep',
    'phaseBWindow',
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
