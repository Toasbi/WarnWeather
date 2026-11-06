#!/usr/bin/env node
'use strict';

// Store art fixtures: the watch screens of the appstore set that scripts/store-art.py builds
// (the showcase GIF and the five store screens, per platform), each a fixture of its own
// (art-<id>.json, plus art-<id>-<platform>.json for a platform variant), shot by
// scripts/capture-store-art.sh into screenshot/<version>/store-art/frames/<platform>/<id>.png.
//
// THE DAY. The showcase is a time-lapse of a day and a half in Berlin over the Whitsun weekend,
// Saturday 23 and Sunday 24 May 2026: a hot, calm Saturday, the evening and the night, then
// Sunday's thunderstorm, with Whit Monday ahead in the calendar (a holiday: HOLIDAYS). The
// weather is a real DWD forecast, berlin-timelapse.json's (Brightsky, 39 hours from 11:00 on
// 20 June 2026, its hours moved onto the weekend's), with what it lacks filled in by hand
// (DAY_EXTRA): the six morning hours before it, the hours after it that the later frames'
// graphs reach (to the long forecast span), and the UV index (clear on Saturday, low under
// Sunday's storm). The clock's time is compile-time, so every frame is a scene ('day',
// day-<d>-<hhmm>): half-hourly through Saturday, hourly through the night, every quarter hour
// as the storm comes. Pebble Time 2 opens on its own frames ('intro', intro-0-<hhmm>): the same
// morning in the long forecast span without the left axis, the look the old store reel had.
//
// THE PAUSES. At some frames the time-lapse stops and a setting changes: a 'variant' is the
// frame's moment with that setting changed (the UV slot's value, the graph's lines, the forecast
// length and the left axis on Pebble Time 2, the three-week calendar, the layouts). A 'band'
// scene is a moment with the clock drawn in black (colorTime 0): on a colour watch its band
// comes out empty, and it tells store-art.py where the clock is, so a pause's card can take its
// place (a black and white watch ignores the clock colour, and takes basalt's: the same layout).
//
// The weather alerts are set the way the story needs them: gusts from 50 km/h judged on the day
// itself (Sunday's storm brings 59 km/h at noon, Saturday's 35 stay quiet), and the rain alert
// counting down to the storm (the countdown block: the wscript bakes it). The UV index is in the
// forecast row's right slot, now and the day's max ("5/8"), not an On demand alert, so the
// calm Saturday keeps its Watch Status Bar plain. Every scene's settings name every key that
// any scene changes (SETTLED), so a capture on a running emulator, where a fixture's settings
// are merged into the last scene's (clay-settings.js applyFixtureSettings), shows its own.
//
// `node scripts/gen-store-art-fixtures.js --manifest` prints the scenes (kind, moment,
// platforms, fixtures, the forecast length labels) as JSON: how store-art.py and
// capture-store-art.sh learn them. The TABLE ORDER is the capture order.

const fs = require('fs');
const path = require('path');
const { withTheme } = require('./gen-showcase-fixtures');

const PLATFORMS = ['emery', 'basalt', 'diorite', 'flint', 'aplite'];
// Not aplite: the frozen lean variant has no Alerts, radar, health, third and fourth metric
// lines, line styles, Weather only or custom layouts (AGENTS.md, README).
const NOT_APLITE = ['emery', 'basalt', 'diorite', 'flint'];
// Pebble Time 2 alone has the forecast length and the left axis settings (schema.js).
const EMERY = ['emery'];
// The colour watches, whose clock a band scene draws in black (the others take basalt's band).
const COLOUR = ['emery', 'basalt'];

const REAL = path.join('fixtures', 'berlin-timelapse.json');
// The day's first frame and the series' first hour: Saturday 23 May 2026, 05:00. The real
// forecast starts six hours later (REAL_OFFSET).
const DAY = { year: 2026, month: 5, day: 23 };
const FIRST_HOUR = 5;
const REAL_OFFSET = 6;
// Filled in by hand (plausible for Berlin in late spring), around the real forecast: the morning
// before it (05:00 to 10:00 on Saturday) and the hours after it (from 02:00 on Monday), in the
// fixture's units (°F, %, mm, km/h); and the UV index for every hour from 05:00 on Saturday.
const DAY_EXTRA = {
  before: {
    temps: [62, 65, 70, 74, 78, 81], precipPct: [0, 0, 0, 0, 0, 0], rainMm: [0, 0, 0, 0, 0, 0],
    windKmh: [8, 10, 12, 14, 17, 20], gustKmh: [14, 17, 20, 24, 28, 32],
  },
  after: {
    temps: [68, 67, 66, 65, 66, 68, 71, 73, 75, 77, 78, 79, 80, 80, 79, 78, 76, 74, 72, 70, 69, 68,
      67, 66, 65, 64, 64, 64, 65, 67, 70, 72, 74, 76, 77, 78, 78, 77],
    precipPct: [14, 12, 10, 9, 8, 7, 6, 6, 5, 5, 5, 6, 8, 10, 12, 12, 10, 8, 7, 6, 5, 5,
      5, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20],
    rainMm: new Array(38).fill(0),
    windKmh: [8, 7, 6, 6, 5, 6, 8, 10, 12, 13, 14, 15, 15, 14, 13, 12, 10, 9, 8, 7, 7, 6,
      6, 5, 5, 5, 6, 7, 9, 11, 13, 14, 15, 16, 16, 15, 14, 13],
    gustKmh: [14, 12, 11, 10, 10, 12, 15, 19, 23, 25, 27, 28, 28, 27, 25, 23, 20, 18, 16, 14, 13, 12,
      11, 10, 10, 10, 11, 13, 17, 21, 24, 26, 28, 30, 30, 29, 27, 25],
  },
  uvIndex: [
    // Saturday from 05:00: clear, 8 at 13:00.
    0.1, 0.5, 1.4, 2.6, 4.0, 5.2, 6.6, 7.5, 8.0, 7.6, 6.5, 5.0, 3.5, 2.1, 1.0, 0.3, 0, 0, 0,
    // Sunday: the storm keeps it low, 3 in the afternoon's clearing.
    0, 0, 0, 0, 0, 0.1, 0.4, 0.9, 1.4, 1.2, 0.9, 0.7, 0.6, 1.3, 2.4, 3.3, 3.0, 2.2, 1.3, 0.6, 0.2, 0, 0, 0,
    // Monday and Tuesday: clear again.
    0, 0, 0, 0, 0, 0.1, 0.5, 1.4, 2.8, 4.4, 5.9, 7.0, 7.7, 7.9, 7.4, 6.4, 5.0, 3.5, 2.1, 1.0, 0.3, 0, 0, 0,
    0, 0, 0, 0, 0, 0.1, 0.5, 1.3, 2.6, 4.2, 5.7, 6.8, 7.4, 7.6, 7.1, 6.1,
  ],
};
// The series DAY_EXTRA fills (every other key of the real forecast's weather is kept).
const SERIES = ['temps', 'precipPct', 'rainMm', 'windKmh', 'gustKmh'];
// Berlin's sun on 23 and 24 May.
const SUNRISE = { hour: 4, minute: 54 };
const SUNSET = { hour: 21, minute: 11 };
// Germany's nationwide holidays of 2026 (Nager.Date's, in nager-source.js' cache shape), which
// the fixture hands the phone (fixture-holidays.js): Ascension on the 14th and Whit Monday on
// the 25th are in the calendar's weeks.
const HOLIDAYS = {
  country: 'DE', year: 2026,
  days: [['01-01', null], ['04-03', null], ['04-06', null], ['05-01', null], ['05-14', null],
    ['05-25', null], ['10-03', null], ['12-25', null], ['12-26', null]],
};

// The frames: Saturday half-hourly from 05:00, the night hourly, Sunday's storm by the quarter
// hour, to 14:00 on Sunday; Pebble Time 2's opening, Saturday from 05:00 to 08:00.
const FRAMES = [].concat(
  halfHours(0, 5, 24).map((t) => [0, t]),
  ['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '07:30', '08:00', '08:15',
    '08:30', '08:45', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00',
    '13:30', '14:00'].map((t) => [1, t]));

// The rain alert on Sunday, as the countdown block bakes it: counting down to the storm's first
// drops at 09:00, then raining on (past the radar's two hours: "+99'"), heaviest at noon
// (tier 5: "Downpour" on Pebble Time 2, whose strip is wide enough), and easing to drizzle.
const COUNTDOWN = {
  '08:00': { mins: 60, raining: false, tier: 3 }, '08:15': { mins: 45, raining: false, tier: 3 },
  '08:30': { mins: 30, raining: false, tier: 3 }, '08:45': { mins: 15, raining: false, tier: 4 },
  '09:00': { mins: 100, raining: true, tier: 3 }, '09:30': { mins: 100, raining: true, tier: 3 },
  '10:00': { mins: 100, raining: true, tier: 4 }, '10:30': { mins: 100, raining: true, tier: 4 },
  '11:00': { mins: 100, raining: true, tier: 5 }, '11:30': { mins: 100, raining: true, tier: 5 },
  '12:00': { mins: 100, raining: true, tier: 5 }, '12:30': { mins: 100, raining: true, tier: 5 },
  '13:00': { mins: 100, raining: true, tier: 4 }, '13:30': { mins: 100, raining: true, tier: 3 },
  '14:00': { mins: 75, raining: true, tier: 2 },
};
const RADAR_SLOTS = 24;   // rain_countdown.c RC_NUM_SLOTS: two hours of 5-minute slots

const INTRO = halfHours(0, 5, 8).concat('08:00').map((t) => [0, t]);
// The opening's look: the long forecast span, the left axis' values off (the graph's full width).
const INTRO_CLAY = { forecastHours: '48', forecastAxisNumbers: 'off' };

// The day's settings, every scene's: the dark theme, the Roboto clock, the compact calendar,
// the forecast's rain chance and rain bars over 24 hours, the forecast row's temperature, city
// and UV (now and the day's max), the rain alert from DWD's radar, gusts as an On demand
// alert beside the battery.
const DAY_CLAY = {
  theme: 'dark', timeFont: 'roboto', layoutPreset: 'compactCal', dayNightShading: true,
  forecastHours: '24', forecastAxisNumbers: 'axis', healthMode: 'off', hrScale: '50-100',
  radarProvider: 'dwd', radarMode: 'countdown', radarColor: 'multicolor', rainCountdownHorizon: '60',
  statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'uv', uvSlotDisplay: 'both',
  statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep',
  statusTopOnDemandRightItems: 'battery,gust',
  threshGustOn: true, threshGustWarn: '50', threshGustDanger: '70', alertGustDays: 'today',
  alertGustDisplay: 'value', threshUvOn: false,
  secondaryLine: 'precip_prob', secondaryLineFill: true, secondaryLineStyle: 'line',
  thirdLine: 'off', fourthLine: 'off', fifthLine: 'off', barSource: 'rain', rainBarColor: 'multicolor',
};
// The graph's other looks: wind with its gusts, and four lines at once (rain chance as a stripe
// along the top, UV as dots, wind as a line, gusts as crosses, white rain bars).
const LINES_WIND = {
  secondaryLine: 'wind', secondaryLineFill: true, secondaryLineStyle: 'line',
  thirdLine: 'gust', thirdLineStyle: 'x', fourthLine: 'off', fifthLine: 'off', barSource: 'off',
};
const LINES_MIX = {
  secondaryLine: 'precip_prob', secondaryLineFill: false, secondaryLineStyle: 'stripeTop',
  thirdLine: 'uv', thirdLineStyle: 'dots', fourthLine: 'wind', fourthLineStyle: 'line',
  fifthLine: 'gust', fifthLineStyle: 'x', barSource: 'rain', rainBarColor: 'white', windScale: 'mid',
};
// The health view: a custom layout of one view, the clock over its health graph and row.
const HEALTH_VIEW = {
  healthMode: 'all', layoutPreset: 'custom', customLayoutSeeded: true, viewCount: '1', viewOrder0: 'TCAB',
  viewBodySize0: 'fill', viewAlign0: 'clock', viewStripOff0: false, viewTop0: 'none', viewBody0: 'health',
  viewUpper0: 'health', viewLower0: 'off',
};

// The scenes. `at` is the moment ([day, 'HH:MM'], day 0 the 20th); `mode` 'day', 'variant' or
// 'band'; `platforms` where it is captured (all five when absent); `clay` its settings over
// DAY_CLAY; `theme` a theme flip (withTheme); `variants` per-platform settings over the scene's.
const SCENES = [].concat(
  INTRO.map(([day, time]) => ({ id: 'intro-' + day + '-' + time.replace(':', ''), mode: 'intro', at: [day, time],
    platforms: EMERY, clay: INTRO_CLAY })),
  FRAMES.map(([day, time]) => ({ id: dayId(day, time), mode: 'day', at: [day, time] })),
  [
    // 11:00 on Saturday (UV 7 now, 8 at 13:00): the UV slot's Now and Day max ("Both" is the day's).
    { id: 'uv-now', mode: 'variant', at: [0, '11:00'], clay: { uvSlotDisplay: 'current' } },
    { id: 'uv-max', mode: 'variant', at: [0, '11:00'], clay: { uvSlotDisplay: 'max' } },
    { id: 'band-compact', mode: 'band', at: [0, '10:00'], platforms: COLOUR, clay: { colorTime: 0 } },
    // Noon on Saturday: the graph's lines.
    { id: 'lines-wind', mode: 'variant', at: [0, '12:00'], clay: LINES_WIND },
    { id: 'lines-mix', mode: 'variant', at: [0, '12:00'], platforms: NOT_APLITE, clay: LINES_MIX },
    { id: 'uv-line', mode: 'variant', at: [0, '12:00'], platforms: ['aplite'],
      clay: { secondaryLine: 'uv', secondaryLineFill: true, barSource: 'off' } },
    // 14:00 on Saturday, Pebble Time 2: the forecast length (12 hours, the long span) and the left
    // axis' values (on the graph, off).
    { id: 'span-12', mode: 'variant', at: [0, '14:00'], platforms: EMERY, clay: { forecastHours: '12' } },
    { id: 'span-long', mode: 'variant', at: [0, '14:00'], platforms: EMERY, clay: { forecastHours: '48' } },
    { id: 'axis-graph', mode: 'variant', at: [0, '14:00'], platforms: EMERY, clay: { forecastAxisNumbers: 'graph' } },
    { id: 'axis-off', mode: 'variant', at: [0, '14:00'], platforms: EMERY, clay: { forecastAxisNumbers: 'off' } },
    // 18:00 on Saturday: the three-week calendar (Ascension and Whit Monday highlighted).
    { id: 'cal-full', mode: 'variant', at: [0, '18:00'], clay: { layoutPreset: 'fullCal' } },
    { id: 'band-full', mode: 'band', at: [0, '18:00'], platforms: COLOUR,
      clay: { layoutPreset: 'fullCal', colorTime: 0 } },
    // 14:00 on Sunday, the storm passing: the layouts. Weather only without the radar (radar
    // Off: clock, weather row, big graph), the Light theme, the health view (steps, sleep and,
    // on Pebble Time 2, the heart rate; Pebble 2 measures none in the emulator, so its row
    // keeps the steps and sleep the watches without a heart rate sensor show); aplite's
    // No calendar.
    { id: 'layout-weather', mode: 'variant', at: [1, '14:00'], platforms: NOT_APLITE,
      clay: { layoutPreset: 'weatherOnly', radarMode: 'off' } },
    { id: 'layout-light', mode: 'variant', at: [1, '14:00'], platforms: NOT_APLITE, theme: 'light' },
    { id: 'view-health', mode: 'variant', at: [1, '14:00'], platforms: NOT_APLITE, clay: HEALTH_VIEW,
      variants: { emery: { statusHealthMid: 'sleep', statusHealthRight: 'hr' } } },
    { id: 'layout-nocal', mode: 'variant', at: [1, '14:00'], platforms: ['aplite'], clay: { layoutPreset: 'noCal' } },
  ]);

/**
 * Half-hour times from one hour to another.
 * @param {number} _day Unused (keeps the call readable).
 * @param {number} from First hour.
 * @param {number} to Hour to stop before.
 * @returns {string[]} 'HH:MM' times.
 */
function halfHours(_day, from, to) {
  const out = [];
  for (let h = from; h < to; h++) { out.push(pad(h) + ':00', pad(h) + ':30'); }
  return out;
}

/**
 * Two digits.
 * @param {number} n A number under 100.
 * @returns {string} It, zero-padded.
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * A day frame's scene id.
 * @param {number} day 0 for the 20th, 1 for the 21st.
 * @param {string} time 'HH:MM'.
 * @returns {string} e.g. 'day-1-0845'.
 */
function dayId(day, time) {
  return 'day-' + day + '-' + time.replace(':', '');
}

/**
 * Deep-copy JSON data.
 * @param {*} value JSON-safe value.
 * @returns {*} A copy.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * The day's weather base: the real forecast with DAY_EXTRA around it, its series from 08:00 on
 * the 20th.
 * @returns {Object} The base fixture (watch, weather, claySettings).
 */
function dayBase() {
  const real = JSON.parse(fs.readFileSync(REAL, 'utf8'));
  const fx = clone(real);
  const w = fx.weather;
  if (real.weather.startHour !== FIRST_HOUR + REAL_OFFSET) {
    throw new Error('berlin-timelapse.json no longer starts at ' + (FIRST_HOUR + REAL_OFFSET) + ':00');
  }
  for (const key of SERIES) {
    w[key] = DAY_EXTRA.before[key].concat(real.weather[key], DAY_EXTRA.after[key]);
  }
  w.uvIndex = DAY_EXTRA.uvIndex.slice();
  for (const key of SERIES.concat('uvIndex')) {
    if (w[key].length !== w.temps.length) { throw new Error('DAY_EXTRA: ' + key + ' is not as long as temps'); }
  }
  delete w.startDayOffset;
  return fx;
}

/**
 * The next two sun events after a minute of the day, in the fixture's readable form.
 * @param {number} nowMin Minutes past midnight.
 * @returns {{type: string, dayOffset: number, hour: number, minute: number}[]} Two events.
 */
function nextSunEvents(nowMin) {
  const rise = (d) => ({ type: 'sunrise', dayOffset: d, hour: SUNRISE.hour, minute: SUNRISE.minute });
  const set = (d) => ({ type: 'sunset', dayOffset: d, hour: SUNSET.hour, minute: SUNSET.minute });
  if (nowMin < SUNRISE.hour * 60 + SUNRISE.minute) { return [rise(0), set(0)]; }
  if (nowMin < SUNSET.hour * 60 + SUNSET.minute) { return [set(0), rise(1)]; }
  return [rise(1), set(1)];
}

/**
 * Hours from the series' first hour to a moment, whole and in fractions.
 * @param {[number, string]} at The moment.
 * @returns {{index: number, hour: number, minute: number}} Its hour's index, its hour and minute.
 */
function momentOf(at) {
  const [day, time] = at;
  const [hour, minute] = time.split(':').map(Number);
  return { index: day * 24 + hour - FIRST_HOUR, hour, minute };
}

/**
 * The rain the radar shows over the next two hours from a moment, as the countdown says it
 * comes: dry until it starts, then the hour's rain (from the forecast) slot by slot.
 * @param {Object} weather The day's weather (rainMm from 08:00 on the 20th).
 * @param {[number, string]} at The moment.
 * @param {{mins: number, raining: boolean}} countdown Its countdown block.
 * @returns {number[]} RADAR_SLOTS mm/h values.
 */
function radarAt(weather, at, countdown) {
  const m = momentOf(at);
  const startSlot = countdown.raining ? 0 : Math.round(countdown.mins / 5);
  const out = [];
  for (let s = 0; s < RADAR_SLOTS; s++) {
    const hours = m.index + (m.minute + s * 5) / 60;
    const a = weather.rainMm[Math.floor(hours)] || 0;
    const b = weather.rainMm[Math.floor(hours) + 1] || 0;
    const mm = a + (b - a) * (hours - Math.floor(hours));
    out.push(s < startSlot ? 0 : Math.round(Math.max(mm, 0.6) * 10) / 10);
  }
  return out;
}

/**
 * A moment's weather: the day's series from the moment's hour on, the clock at the moment, the
 * current temperature between the hour's and the next, the sun events next after it, and on
 * Sunday morning the rain alert and the radar behind it.
 * @param {Object} base dayBase().
 * @param {[number, string]} at The moment.
 * @returns {Object} The fixture, before the scene's settings.
 */
function weatherAt(base, at) {
  const fx = clone(base);
  const m = momentOf(at);
  const w = fx.weather;
  for (const key of SERIES.concat('uvIndex')) { w[key] = w[key].slice(m.index); }
  const date = new Date(DAY.year, DAY.month - 1, DAY.day + at[0], m.hour, m.minute);
  fx.watch.now = { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
    hour: m.hour, minute: m.minute, second: 0 };
  w.startHour = m.hour;
  w.currentTemp = Math.round(w.temps[0] + (w.temps[1] - w.temps[0]) * m.minute / 60);
  w.sunEvents = nextSunEvents(m.hour * 60 + m.minute);
  const countdown = at[0] === 1 ? COUNTDOWN[at[1]] : null;
  if (countdown) {
    fx.countdown = Object.assign({}, countdown);
    const radar = radarAt(base.weather, at, countdown);
    w.rainRadarExactMm = radar;
    w.rainRadarAreaMm = radar.map((v) => Math.round(v * 11) / 10);
  } else {
    delete w.rainRadarExactMm;
    delete w.rainRadarAreaMm;
  }
  return fx;
}

/**
 * A scene's settings before SETTLED: the base's, the day's, the scene's own and a platform
 * variant's, with the scene's theme flip.
 * @param {Object} base dayBase().
 * @param {Object} scene A SCENES entry.
 * @param {?Object} variantClay The platform variant's settings, or null.
 * @returns {Object} claySettings.
 */
function sceneClay(base, scene, variantClay) {
  const clay = Object.assign({}, base.claySettings, DAY_CLAY, scene.clay || {}, variantClay || {});
  return scene.theme && scene.theme !== clay.theme ? withTheme(clay, scene.theme) : clay;
}

/**
 * Every settings key some scene sets to something other than the day's, with the day's value:
 * what every scene names, so none keeps the last scene's (see the top). The day's value of a key
 * the day doesn't set is the settings' default.
 * @param {Object} base dayBase().
 * @returns {Object} key -> the day's value.
 */
function settled(base) {
  const claySettings = require('../src/pkjs/clay-settings.js');
  const pebbleColors = require('../src/pkjs/pebble-colors.js');
  const defaults = claySettings.getDefaults({ white: pebbleColors.GColorWhite,
    folly: pebbleColors.GColorFolly, holiday: pebbleColors.GColorBlueMoon });
  const day = Object.assign({}, defaults, base.claySettings, DAY_CLAY);
  const out = {};
  for (const scene of SCENES) {
    const variants = [null].concat(Object.values(scene.variants || {}));
    for (const variant of variants) {
      const clay = sceneClay(base, scene, variant);
      for (const key of Object.keys(clay)) {
        if (JSON.stringify(clay[key]) !== JSON.stringify(day[key])) {
          if (!(key in day)) { throw new Error(scene.id + ' sets ' + key + ', which has no default'); }
          out[key] = day[key];
        }
      }
    }
  }
  return out;
}

/**
 * One scene's fixture for one platform (or its base fixture, without a variant).
 * @param {Object} scene A SCENES entry.
 * @param {Object} base dayBase().
 * @param {Object} keys settled(base).
 * @param {?Object} variantClay The platform variant's settings, or null.
 * @returns {Object} The fixture.
 */
function buildScene(scene, base, keys, variantClay) {
  const fx = weatherAt(base, scene.at);
  fx.claySettings = Object.assign({}, keys, sceneClay(base, scene, variantClay));
  fx.holidays = clone(HOLIDAYS);
  return fx;
}

/**
 * The platforms a scene is captured on.
 * @param {Object} scene A SCENES entry.
 * @returns {string[]} Platform names.
 */
function scenePlatforms(scene) {
  return scene.platforms || PLATFORMS;
}

/**
 * The fixture slug a platform captures a scene from: its variant's, or the scene's own.
 * @param {Object} scene A SCENES entry.
 * @param {string} platform Platform name.
 * @returns {string} Fixture slug (fixtures/<slug>.json).
 */
function fixtureFor(scene, platform) {
  return (scene.variants && scene.variants[platform]) ? 'art-' + scene.id + '-' + platform : 'art-' + scene.id;
}

/**
 * Write every scene's fixtures (and their platform variants), clearing the old ones first.
 * @param {{outDir?: string}} [opts] Where to write (fixtures/ by default).
 * @returns {string[]} The written paths.
 */
function generateStoreArtFixtures(opts = {}) {
  const outDir = opts.outDir || 'fixtures';
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of fs.readdirSync(outDir)) {
    if (/^art-.+\.json$/.test(name)) { fs.unlinkSync(path.join(outDir, name)); }
  }
  const base = dayBase();
  const keys = settled(base);
  const written = [];
  const write = (slug, fx) => {
    const p = path.join(outDir, slug + '.json');
    fs.writeFileSync(p, JSON.stringify(fx, null, 2) + '\n');
    written.push(p);
  };
  for (const scene of SCENES) {
    write('art-' + scene.id, buildScene(scene, base, keys, null));
    for (const platform of Object.keys(scene.variants || {})) {
      write('art-' + scene.id + '-' + platform, buildScene(scene, base, keys, scene.variants[platform]));
    }
  }
  return written;
}

/**
 * The Forecast length options as the settings page names them for a scene's settings on a
 * Pebble Time 2 (forecast-span-hours.js spanOptions: the long span named by the hours it
 * shows), or null for a scene that doesn't set the length.
 * @param {Object} scene A SCENES entry.
 * @returns {?string[]} The option labels, e.g. ['12 h', '24 h', '58 h'].
 */
function spanLabels(scene) {
  if (!scene.clay || !scene.clay.forecastHours) { return null; }
  const forecastSpanHours = require('../src/pkjs/forecast-span-hours.js');
  const settings = sceneClay(dayBase(), scene, null);
  return forecastSpanHours.spanOptions(settings, { platform: 'emery', forecastSpan: true, color: true })
    .map((option) => option[0]);
}

/**
 * The scenes as capture-store-art.sh and store-art.py read them.
 * @returns {{id: string, mode: string, at: Array, platforms: string[], fixtures: Object,
 *   spanLabels: ?string[]}[]} One entry per scene; `fixtures` maps each platform to the slug it
 *   captures from.
 */
function manifest() {
  return SCENES.map((scene) => {
    const fixtures = {};
    for (const platform of scenePlatforms(scene)) { fixtures[platform] = fixtureFor(scene, platform); }
    return { id: scene.id, mode: scene.mode, at: scene.at, platforms: scenePlatforms(scene), fixtures,
      spanLabels: spanLabels(scene) };
  });
}

if (require.main === module) {
  if (process.argv.includes('--manifest')) {
    process.stdout.write(JSON.stringify(manifest(), null, 2) + '\n');
  } else {
    const written = generateStoreArtFixtures();
    console.log('Wrote ' + written.length + ' store art fixtures');
  }
}

module.exports = { generateStoreArtFixtures, manifest, SCENES, FRAMES, INTRO, PLATFORMS, NOT_APLITE, EMERY, COLOUR,
  DAY_CLAY, INTRO_CLAY, HOLIDAYS, scenePlatforms, fixtureFor, weatherAt, dayBase, settled, nextSunEvents, dayId };
