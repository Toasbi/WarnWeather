#!/usr/bin/env node
'use strict';

// Store art fixtures: the watch screens of the appstore set that scripts/store-art.py builds
// (two showcase GIFs and the five store screens, per platform), each a fixture of its own
// (art-<id>.json, plus art-<id>-<platform>.json for a platform variant), shot by
// scripts/capture-store-art.sh into screenshot/<version>/store-art/frames/<platform>/<id>.png.
//
// THE DAYS. Both showcases are a time-lapse of two real days in Berlin: Labour Day, Thursday
// 1 May 2025, calm and sunny, and Friday 2 May, hot until a storm front at 18:00 (gusts of
// 78 km/h, the temperature down 10 °C in an hour, rain from 19:00). The weather is DWD's
// hourly records for Berlin as Bright Sky serves them (the app's DWD source), the UV index
// Open-Meteo's GFS one (the app's UV source for DWD), and the holidays Nager.Date's
// (fixtures/data/berlin-2025-05.json, written by scripts/fetch-store-art-weather.py). Nothing
// is filled in by hand: every series is read the way the app's DWD provider reads Bright Sky
// (weatherAt), the sun times are SunCalc's (as the app's), and the rain alert is the records'
// own rain. DWD's records carry no chance of rain, which the app reads as 0 % (dwd.js: a
// record's missing precipitation_probability / 100), so no frame draws one; without the UV
// block (Open-Meteo unreachable) no frame draws UV either.
//
// The clock's time is compile-time, so every frame is a scene ('day', day-<d>-<hhmm>):
// half-hourly through Labour Day, hourly through the night, every quarter hour as the storm
// comes. Pebble Time 2 opens on its own frames ('intro', intro-0-<hhmm>): the same morning in
// the long forecast span, the look the old store reel had.
//
// THE PAUSES (1-showcase.gif). At some frames the time-lapse stops and a setting changes: a
// 'variant' is the frame's moment with that setting changed (the UV slot's value, the forecast
// length and the left axis on Pebble Time 2, the three-week calendar, the setup's forecast
// looks, the layouts). A 'band' scene is a moment with the clock drawn in black (colorTime 0):
// on a colour watch its band comes out empty, and it tells store-art.py where the clock is, so
// a pause's card can take its place (a black and white watch ignores the clock colour, and
// takes basalt's: the same layout).
//
// THE CALM RUN (the second showcase, no words). The same days hour by hour, a setting changed
// now and then, one at a time and each kept a while: from the three-week calendar to none,
// through the setup's forecast looks (Classic, Stripes with its rain bars from the top, Clean)
// and on Pebble Time 2 its long forecast span ('calm' scenes, calm-<state>-<d>-<hhmm>; a frame
// in the day's own settings is the day's frame). CALM holds each watch's steps.
//
// The day's settings have no left axis on Pebble Time 2 (the owner's call: the graph looks
// better at its full width), gusts alert from 50 km/h judged on the day itself (Friday's 78
// shows, Thursday's 20 stay quiet), and the rain alert counts down to the storm. Every scene's
// settings name every key that any scene changes (settled), so a capture on a running
// emulator, where a fixture's settings are merged into the last scene's
// (clay-settings.js applyFixtureSettings), shows its own.
//
// `node scripts/gen-store-art-fixtures.js --manifest` prints the scenes (kind, moment,
// platforms, fixtures, the forecast length labels) as JSON, and `--calm` each watch's calm run
// (its frames in order): how store-art.py and capture-store-art.sh learn them. The TABLE ORDER
// is the capture order.

const fs = require('fs');
const path = require('path');
const SunCalc = require('suncalc');
const { withTheme } = require('./gen-showcase-fixtures');
const feelsLike = require('../src/pkjs/weather/feels-like.js');
const { celsiusToFahrenheit } = require('../src/pkjs/wire-units.js');
const wizardForecast = require('../src/pkjs/settings/wizard-forecast.js');

const PLATFORMS = ['emery', 'basalt', 'diorite', 'flint', 'aplite'];
// Not aplite: the frozen lean variant has no Alerts, radar, health, third and fourth metric
// lines, line styles (so no forecast looks), Weather only or custom layouts (AGENTS.md, README).
const NOT_APLITE = ['emery', 'basalt', 'diorite', 'flint'];
// Pebble Time 2 alone has the forecast length and the left axis settings (schema.js).
const EMERY = ['emery'];
// The 144 px watches with the forecast looks.
const SMALL = ['basalt', 'diorite', 'flint'];
// The colour watches, whose clock a band scene draws in black (the others take basalt's band).
const COLOUR = ['emery', 'basalt'];

const DATA = path.join('fixtures', 'data', 'berlin-2025-05.json');
// Day 0: Thursday 1 May 2025. The records start at midnight on 30 April (DATA_DAY_OFFSET days
// before day 0); Berlin keeps summer time (UTC+2) over all of them.
const DAY = { year: 2025, month: 5, day: 1 };
const DATA_DAY_OFFSET = 1;
const UTC_OFFSET_HOURS = 2;
const BERLIN = { lat: 52.52, lon: 13.405 };
// The holidays of a Berlin user: the nationwide ones and Berlin's own (8 May 2025, the 80th
// anniversary of the end of the war).
const HOLIDAY_REGION = 'DE-BE';
// rain_countdown.c's radar reach: two hours of 5-minute slots.
const RADAR_MINUTES = 120;

// The frames: Labour Day half-hourly from 05:00, the night hourly, Friday half-hourly to the
// storm, every quarter hour as it comes, and on to 21:00.
const FRAMES = [].concat(
  halfHours(5, 24).map((t) => [0, t]),
  hours(0, 8).map((t) => [1, t]),
  ['07:30'].concat(halfHours(8, 18)).map((t) => [1, t]),
  [[1, '18:00'], [1, '18:15'], [1, '18:30'], [1, '18:45'], [1, '19:00'], [1, '19:30'], [1, '20:00'],
    [1, '20:30'], [1, '21:00']]);

// Pebble Time 2's opening: Labour Day from 05:00 to 08:00 in the long span.
const INTRO = halfHours(5, 8).concat('08:00').map((t) => [0, t]);
const INTRO_CLAY = { forecastHours: '48' };

// The setup's forecast looks (wizard-forecast.js), as it writes them on a Pebble Time 2 (the
// other watches ignore the left axis and, in black and white, the bars' colour). Classic is a
// fresh install's graph; Stripes and Clean lay theirs over it. The left axis stays off where a
// look would put it beside the graph.
const LOOKS = lookValues();
const CLASSIC = LOOKS.classic;
const STRIPES = LOOKS.stripes;
const CLEAN = LOOKS.clean;

// The day's settings, every scene's: the dark theme, the Roboto clock, the compact calendar,
// the Classic graph over 24 hours without a left axis, the forecast row's temperature, city and
// UV (now and the day's max), the rain alert from DWD's radar, gusts as an On demand alert
// beside the battery, Berlin's holidays.
const DAY_CLAY = Object.assign({
  theme: 'dark', timeFont: 'roboto', layoutPreset: 'compactCal', dayNightShading: true,
  forecastHours: '24', healthMode: 'off', hrScale: '50-100',
  radarProvider: 'dwd', radarMode: 'countdown', radarColor: 'multicolor', rainCountdownHorizon: '60',
  statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'uv', uvSlotDisplay: 'both',
  statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep',
  statusTopOnDemandRightItems: 'battery,gust',
  threshGustOn: true, threshGustWarn: '50', threshGustDanger: '70', alertGustDays: 'today',
  alertGustDisplay: 'value', threshUvOn: false, holidayCountry: 'DE', holidayRegion: HOLIDAY_REGION,
}, CLASSIC);
// The health view: a custom layout of one view, the clock over its health graph and row.
const HEALTH_VIEW = {
  healthMode: 'all', layoutPreset: 'custom', customLayoutSeeded: true, viewCount: '1', viewOrder0: 'TCAB',
  viewBodySize0: 'fill', viewAlign0: 'clock', viewStripOff0: false, viewTop0: 'none', viewBody0: 'health',
  viewUpper0: 'health', viewLower0: 'off',
};

// The calm run's steps, per watch: from which frame, a name, and the settings it changes over
// the steps before (the first over the day's). Each step stays a while, one change at a time:
// the three-week calendar, the compact one (the day's settings), the long span on Pebble Time
// 2, the Stripes look (its rain bars hang from the top once the storm is in view), Clean, and
// no calendar for the storm. Aplite has no looks: its calendar alone goes.
const CALM = {
  emery: [
    { from: [0, '05:00'], name: 'full', clay: { layoutPreset: 'fullCal' } },
    { from: [0, '09:00'], name: 'compact', clay: { layoutPreset: 'compactCal' } },
    { from: [0, '13:00'], name: 'long', clay: { forecastHours: '48' } },
    { from: [0, '17:00'], name: 'stripes', clay: STRIPES },
    { from: [1, '05:00'], name: 'clean', clay: CLEAN },
    { from: [1, '11:00'], name: 'nocal', clay: { layoutPreset: 'noCal' } },
  ],
  small: [
    { from: [0, '05:00'], name: 'full', clay: { layoutPreset: 'fullCal' } },
    { from: [0, '09:00'], name: 'compact', clay: { layoutPreset: 'compactCal' } },
    { from: [0, '15:00'], name: 'stripes', clay: STRIPES },
    { from: [1, '05:00'], name: 'clean', clay: CLEAN },
    { from: [1, '11:00'], name: 'nocal', clay: { layoutPreset: 'noCal' } },
  ],
  aplite: [
    { from: [0, '05:00'], name: 'full', clay: { layoutPreset: 'fullCal' } },
    { from: [0, '11:00'], name: 'compact', clay: { layoutPreset: 'compactCal' } },
    { from: [1, '05:00'], name: 'nocal', clay: { layoutPreset: 'noCal' } },
  ],
};
// The calm run's frames: on the hour, Labour Day from 05:00 to the evening after the storm.
const CALM_FRAMES = [].concat(hours(5, 24).map((t) => [0, t]), hours(0, 22).map((t) => [1, t]));

// The scenes. `at` is the moment ([day, 'HH:MM'], day 0 Labour Day); `mode` 'intro', 'day',
// 'variant', 'band' or 'calm'; `platforms` where it is captured (all five when absent); `clay`
// its settings over DAY_CLAY; `theme` a theme flip (withTheme); `variants` per-platform
// settings over the scene's.
const SCENES = [].concat(
  INTRO.map(([day, time]) => ({ id: 'intro-' + day + '-' + hhmm(time), mode: 'intro', at: [day, time],
    platforms: EMERY, clay: INTRO_CLAY })),
  FRAMES.map(([day, time]) => ({ id: dayId(day, time), mode: 'day', at: [day, time] })),
  [
    // 11:00 on Labour Day: the UV slot's Now and Day max ("Both" is the day's).
    { id: 'uv-now', mode: 'variant', at: [0, '11:00'], clay: { uvSlotDisplay: 'current' } },
    { id: 'uv-max', mode: 'variant', at: [0, '11:00'], clay: { uvSlotDisplay: 'max' } },
    { id: 'band-compact', mode: 'band', at: [0, '10:00'], platforms: COLOUR, clay: { colorTime: 0 } },
    // 14:00, Pebble Time 2: the forecast length (12 hours, the long span) and the left axis'
    // values (on the axis, on the graph).
    { id: 'span-12', mode: 'variant', at: [0, '14:00'], platforms: EMERY, clay: { forecastHours: '12' } },
    { id: 'span-long', mode: 'variant', at: [0, '14:00'], platforms: EMERY, clay: { forecastHours: '48' } },
    { id: 'axis-on', mode: 'variant', at: [0, '14:00'], platforms: EMERY, clay: { forecastAxisNumbers: 'axis' } },
    { id: 'axis-graph', mode: 'variant', at: [0, '14:00'], platforms: EMERY, clay: { forecastAxisNumbers: 'graph' } },
    // 08:00 on Friday: the three-week calendar (Easter Monday, Labour Day and Berlin's 8 May).
    { id: 'cal-full', mode: 'variant', at: [1, '08:00'], clay: { layoutPreset: 'fullCal' } },
    { id: 'band-full', mode: 'band', at: [1, '08:00'], platforms: COLOUR,
      clay: { layoutPreset: 'fullCal', colorTime: 0 } },
    // Noon on Friday, the storm in view: the setup's forecast looks; aplite's UV line instead.
    { id: 'look-stripes', mode: 'variant', at: [1, '12:00'], platforms: NOT_APLITE, clay: STRIPES },
    { id: 'look-clean', mode: 'variant', at: [1, '12:00'], platforms: NOT_APLITE, clay: CLEAN },
    { id: 'uv-line', mode: 'variant', at: [1, '12:00'], platforms: ['aplite'],
      clay: { secondaryLine: 'uv', secondaryLineFill: true, barSource: 'off' } },
    // 21:00 on Friday, the storm passed: the layouts. Weather only without the radar (radar
    // Off: clock, weather row, big graph), the Light theme, the health view (steps, sleep and,
    // on Pebble Time 2, the heart rate; Pebble 2 measures none in the emulator, so its row
    // keeps the steps and sleep the watches without a heart rate sensor show); aplite's
    // No calendar.
    { id: 'layout-weather', mode: 'variant', at: [1, '21:00'], platforms: NOT_APLITE,
      clay: { layoutPreset: 'weatherOnly', radarMode: 'off' } },
    { id: 'layout-light', mode: 'variant', at: [1, '21:00'], platforms: NOT_APLITE, theme: 'light' },
    { id: 'view-health', mode: 'variant', at: [1, '21:00'], platforms: NOT_APLITE, clay: HEALTH_VIEW,
      variants: { emery: { statusHealthMid: 'sleep', statusHealthRight: 'hr' } } },
    { id: 'layout-nocal', mode: 'variant', at: [1, '21:00'], platforms: ['aplite'], clay: { layoutPreset: 'noCal' } },
  ],
  calmScenes().scenes);

/**
 * Times from one hour to another, every half hour.
 * @param {number} from First hour.
 * @param {number} to Hour to stop before.
 * @returns {string[]} 'HH:MM' times.
 */
function halfHours(from, to) {
  const out = [];
  for (let h = from; h < to; h++) { out.push(pad(h) + ':00', pad(h) + ':30'); }
  return out;
}

/**
 * Times from one hour to another, on the hour.
 * @param {number} from First hour.
 * @param {number} to Hour to stop before.
 * @returns {string[]} 'HH:MM' times.
 */
function hours(from, to) {
  const out = [];
  for (let h = from; h < to; h++) { out.push(pad(h) + ':00'); }
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
 * A time without its colon.
 * @param {string} time 'HH:MM'.
 * @returns {string} 'HHMM'.
 */
function hhmm(time) {
  return time.replace(':', '');
}

/**
 * A day frame's scene id.
 * @param {number} day 0 for Labour Day, 1 for the Friday.
 * @param {string} time 'HH:MM'.
 * @returns {string} e.g. 'day-1-1845'.
 */
function dayId(day, time) {
  return 'day-' + day + '-' + hhmm(time);
}

/**
 * Minutes from midnight on day 0 to a moment.
 * @param {[number, string]} at The moment.
 * @returns {number} Minutes.
 */
function minuteOf(at) {
  const [hour, minute] = at[1].split(':').map(Number);
  return at[0] * 1440 + hour * 60 + minute;
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
 * Round to two decimals (the fixtures' °F and feels-like values).
 * @param {number} v A number.
 * @returns {number} It, rounded.
 */
function r2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * The setup's three forecast looks as it writes them on a Pebble Time 2, from the defaults a
 * fresh install starts on, the left axis off where a look would draw it beside the graph.
 * @returns {{classic: Object, stripes: Object, clean: Object}} Each look's settings.
 */
function lookValues() {
  const claySettings = require('../src/pkjs/clay-settings.js');
  const pebbleColors = require('../src/pkjs/pebble-colors.js');
  const defaults = claySettings.getDefaults({ white: pebbleColors.GColorWhite,
    folly: pebbleColors.GColorFolly, holiday: pebbleColors.GColorBlueMoon });
  const out = {};
  for (const look of wizardForecast.looks(defaults, { platform: 'emery', color: true }, defaults, null)) {
    const values = Object.assign({}, look.values);
    if (values.forecastAxisNumbers === 'axis') { values.forecastAxisNumbers = 'off'; }
    out[look.id] = values;
  }
  return out;
}

/**
 * The real weather (DATA): DWD's hourly records, the UV hours (or null), the holidays.
 * @returns {{records: Object, uv: ?Object, holidays: Object}} The file's blocks.
 */
function realData() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const h = data.records.hours;
  const n = h.temperature.length;
  for (const key of Object.keys(h)) {
    if (h[key].length !== n) { throw new Error(DATA + ': ' + key + ' has ' + h[key].length + ' hours, not ' + n); }
  }
  if (data.uv && data.uv.hours.length !== n) { throw new Error(DATA + ': the UV has ' + data.uv.hours.length + ' hours'); }
  const start = new Date(data.records.start);
  const day0 = Date.UTC(DAY.year, DAY.month - 1, DAY.day) - UTC_OFFSET_HOURS * 3600e3;
  if (start.getTime() !== day0 - DATA_DAY_OFFSET * 86400e3) {
    throw new Error(DATA + ' starts at ' + data.records.start + ', not midnight ' + DATA_DAY_OFFSET + ' day(s) before day 0');
  }
  return data;
}

/**
 * A record hour's feels-like (°F), the way the app's DWD provider works it out (dwd.js
 * hourFeels): Steadman from the humidity, else from the dew point, else the temperature.
 * @param {Object} h The records' hours.
 * @param {number} i The hour's index.
 * @returns {number} °F.
 */
function hourFeels(h, i) {
  const tempF = celsiusToFahrenheit(h.temperature[i]);
  let feels = feelsLike.feelsLikeF(tempF, h.relative_humidity[i], h.wind_speed[i]);
  if (feels === null) { feels = feelsLike.feelsLikeFromDewF(tempF, celsiusToFahrenheit(h.dew_point[i]), h.wind_speed[i]); }
  return feels === null ? tempF : feels;
}

/**
 * The next two sun events after a moment, SunCalc's for Berlin (as the app's sun-events.js),
 * in the fixture's readable form, days counted from the moment's.
 * @param {[number, string]} at The moment.
 * @returns {{type: string, dayOffset: number, hour: number, minute: number}[]} Two events.
 */
function nextSunEvents(at) {
  const now = minuteOf(at);
  const events = [];
  for (let d = at[0]; d <= at[0] + 2; d++) {
    const times = SunCalc.getTimes(new Date(Date.UTC(DAY.year, DAY.month - 1, DAY.day + d, 10)), BERLIN.lat, BERLIN.lon);
    for (const type of ['sunrise', 'sunset']) {
      const local = new Date(times[type].getTime() + UTC_OFFSET_HOURS * 3600e3);
      const minute = d * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
      if (minute > now) {
        events.push({ type, dayOffset: d - at[0], hour: local.getUTCHours(), minute: local.getUTCMinutes() });
      }
    }
  }
  return events.slice(0, 2);
}

/**
 * The rain alert at a moment, from the records' rain (the hour's rain falls from its start, as
 * the graph draws it): the minutes until it starts while it is within the alert's hour, or how
 * long it keeps raining within the radar's two hours (100: past them, "+99'"), and the
 * heaviest tier of the rain ahead in those two hours. Null without rain that near.
 * @param {number[]} rainMm The moment's slots' rain (mm), slot 0 the moment's hour.
 * @param {number} minute The moment's minutes past its hour.
 * @returns {?{mins: number, raining: boolean, tier: number}} The countdown block.
 */
function countdownAt(rainMm, minute) {
  const rainTier = require('../src/pkjs/weather/rain-tier.js');
  const wet = (s) => (rainMm[s] || 0) > 0;
  const tierOf = (s) => rainTier.tierOfTenths(Math.round((rainMm[s] || 0) * 10));
  const reach = (s) => s * 60 - minute;          // minutes from the moment to slot s's start
  let tier = 0;
  for (let s = 0; reach(s) < RADAR_MINUTES; s++) {
    if (wet(s)) { tier = Math.max(tier, tierOf(s)); }
  }
  if (wet(0)) {
    let s = 0;
    while (wet(s) && reach(s) < RADAR_MINUTES) { s++; }
    const mins = wet(s) || reach(s) >= RADAR_MINUTES ? 100 : Math.min(99, reach(s));
    return { mins, raining: true, tier };
  }
  for (let s = 1; reach(s) <= 60; s++) {
    if (wet(s)) { return { mins: reach(s), raining: false, tier }; }
  }
  return null;
}

/**
 * A moment's weather, read from the records the way the app's DWD provider reads Bright Sky
 * (dwd.js slotRecords): slot i the hour starting i hours after the moment's own; its instants
 * (temperature, wind, pressure, cloud cover, dew point, bearing, feels-like) from the record of
 * that hour, its hour totals (rain, gusts) and the UV (openmeteo.js mapUv) from the record an
 * hour on. The current temperature is the moment's hour's record (the last one before it); the
 * clock, the sun events after it and the rain alert at it.
 * @param {Object} data realData().
 * @param {[number, string]} at The moment.
 * @returns {Object} The fixture, before the scene's settings.
 */
function weatherAt(data, at) {
  const [hour, minute] = at[1].split(':').map(Number);
  const h = data.records.hours;
  const i0 = (DATA_DAY_OFFSET + at[0]) * 24 + hour;
  const n = h.temperature.length - i0 - 1;
  const own = (key) => h[key].slice(i0, i0 + n);
  const next = (key) => h[key].slice(i0 + 1, i0 + 1 + n);
  const weather = {
    city: 'Berlin',
    startHour: hour,
    currentTemp: r2(celsiusToFahrenheit(h.temperature[i0])),
    currentFeels: r2(hourFeels(h, i0)),
    temps: own('temperature').map((c) => r2(celsiusToFahrenheit(c))),
    feelsTemps: own('temperature').map((_, k) => r2(hourFeels(h, i0 + k))),
    // The records' chance of rain as the app reads it: none, so 0 % (dwd.js precipTrend).
    precipPct: new Array(n).fill(0),
    rainMm: next('precipitation'),
    windKmh: own('wind_speed'),
    gustKmh: next('wind_gust_speed'),
    windDirection: own('wind_direction'),
    cloudPct: own('cloud_cover'),
    dewPoint: own('dew_point').map((c) => r2(celsiusToFahrenheit(c))),
    pressureHpa: own('pressure_msl'),
  };
  if (data.uv) { weather.uvIndex = data.uv.hours.slice(i0 + 1, i0 + 1 + n); }
  weather.sunEvents = nextSunEvents(at);
  const date = new Date(Date.UTC(DAY.year, DAY.month - 1, DAY.day + at[0], hour, minute));
  const fx = {
    name: 'store-art',
    claySettings: { provider: 'dwd' },
    watch: {
      now: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute, second: 0 },
      battery: { percent: 74 },
    },
    weather,
  };
  const countdown = countdownAt(weather.rainMm, minute);
  if (countdown) { fx.countdown = countdown; }
  return fx;
}

/**
 * The holidays block a fixture hands the phone (fixture-holidays.js): the year's holidays in
 * nager-source.js' cache shape.
 * @param {Object} data realData().
 * @returns {{country: string, year: number, days: Array}} The block.
 */
function holidaysOf(data) {
  return { country: 'DE', year: DAY.year, days: data.holidays.days.map(([date, regions]) => [date.slice(5), regions]) };
}

/**
 * The calm run's scenes and each watch's frames: per watch, its steps' settings laid one over
 * the other along CALM_FRAMES; a frame in the day's own settings is the day's frame, any other
 * a calm scene shared by every watch whose run shows the same settings at that moment, named
 * after the steps still in effect. At a step's first frame a watch shows the moment twice:
 * before the step, and after it.
 * @returns {{scenes: Object[], runs: Object<string, Array<{id: string, at: Array}>>}} The scenes,
 *   and each platform's frames in order.
 */
function calmScenes() {
  const tracks = { emery: CALM.emery, basalt: CALM.small, diorite: CALM.small, flint: CALM.small, aplite: CALM.aplite };
  const byKey = new Map();
  const runs = {};
  for (const platform of PLATFORMS) {
    const steps = tracks[platform];
    runs[platform] = [];
    let k = -1;
    let state = {};
    const frameAt = (at, st) => {
      const id = calmId(at, st.clay, st.names);
      if (id.startsWith('day-')) { return id; }
      const key = id + ' ' + JSON.stringify(st.clay);
      if (!byKey.has(key)) {
        byKey.set(key, { id, mode: 'calm', at, platforms: [], clay: st.clay });
      }
      const scene = byKey.get(key);
      if (!scene.platforms.includes(platform)) { scene.platforms.push(platform); }
      return id;
    };
    for (const at of CALM_FRAMES) {
      while (k + 1 < steps.length && minuteOf(steps[k + 1].from) <= minuteOf(at)) {
        if (k >= 0) { runs[platform].push({ id: frameAt(at, state), at }); }
        k += 1;
        state = calmState(steps.slice(0, k + 1));
      }
      runs[platform].push({ id: frameAt(at, state), at });
    }
  }
  const scenes = [...byKey.values()].map((s) => Object.assign(s, {
    platforms: PLATFORMS.filter((p) => s.platforms.includes(p)) }));
  scenes.sort((a, b) => minuteOf(a.at) - minuteOf(b.at) || (a.id < b.id ? -1 : 1));
  return { scenes, runs };
}

/**
 * A calm run's settings after some steps: each step's laid over the last, kept only where they
 * differ from the day's; and the names of the steps whose settings are still in effect.
 * @param {Object[]} steps The steps so far.
 * @returns {{clay: Object, names: string[]}} The settings over the day's, and their steps.
 */
function calmState(steps) {
  const clay = {};
  for (const step of steps) { Object.assign(clay, step.clay); }
  for (const key of Object.keys(clay)) {
    if (JSON.stringify(clay[key]) === JSON.stringify(DAY_CLAY[key])) { delete clay[key]; }
  }
  const names = steps.filter((step) => Object.keys(step.clay).some((key) => key in clay
    && JSON.stringify(clay[key]) === JSON.stringify(step.clay[key]))).map((step) => step.name);
  return { clay, names };
}

/**
 * A calm frame's scene id: the day's frame where the run is in the day's settings.
 * @param {[number, string]} at The moment.
 * @param {Object} clay Its settings over the day's.
 * @param {string[]} names The steps in effect.
 * @returns {string} e.g. 'calm-long-stripes-0-1700', or 'day-0-1000'.
 */
function calmId(at, clay, names) {
  if (!Object.keys(clay).length) { return dayId(at[0], at[1]); }
  return 'calm-' + names.join('-') + '-' + at[0] + '-' + hhmm(at[1]);
}

/**
 * A scene's settings before SETTLED: the base's, the day's, the scene's own and a platform
 * variant's, with the scene's theme flip.
 * @param {Object} base The fixture's own settings (weatherAt's).
 * @param {Object} scene A SCENES entry.
 * @param {?Object} variantClay The platform variant's settings, or null.
 * @returns {Object} claySettings.
 */
function sceneClay(base, scene, variantClay) {
  const clay = Object.assign({}, base, DAY_CLAY, scene.clay || {}, variantClay || {});
  return scene.theme && scene.theme !== clay.theme ? withTheme(clay, scene.theme) : clay;
}

/**
 * Every settings key some scene sets to something other than the day's, with the day's value:
 * what every scene names, so none keeps the last scene's (see the top). The day's value of a key
 * the day doesn't set is the settings' default.
 * @returns {Object} key -> the day's value.
 */
function settled() {
  const claySettings = require('../src/pkjs/clay-settings.js');
  const pebbleColors = require('../src/pkjs/pebble-colors.js');
  const defaults = claySettings.getDefaults({ white: pebbleColors.GColorWhite,
    folly: pebbleColors.GColorFolly, holiday: pebbleColors.GColorBlueMoon });
  const base = { provider: 'dwd' };
  const day = Object.assign({}, defaults, base, DAY_CLAY);
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
 * @param {Object} data realData().
 * @param {Object} keys settled().
 * @param {?Object} variantClay The platform variant's settings, or null.
 * @returns {Object} The fixture.
 */
function buildScene(scene, data, keys, variantClay) {
  const fx = weatherAt(data, scene.at);
  fx.claySettings = Object.assign({}, keys, sceneClay(fx.claySettings, scene, variantClay));
  fx.holidays = holidaysOf(data);
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
  const data = realData();
  const keys = settled();
  const written = [];
  const write = (slug, fx) => {
    const p = path.join(outDir, slug + '.json');
    fs.writeFileSync(p, JSON.stringify(fx, null, 2) + '\n');
    written.push(p);
  };
  for (const scene of SCENES) {
    write('art-' + scene.id, buildScene(scene, data, keys, null));
    for (const platform of Object.keys(scene.variants || {})) {
      write('art-' + scene.id + '-' + platform, buildScene(scene, data, keys, scene.variants[platform]));
    }
  }
  return written;
}

/**
 * The Forecast length options as the settings page names them for a scene's settings on a
 * Pebble Time 2 (forecast-span-hours.js spanOptions: the long span named by the hours it
 * shows), or null for a scene that doesn't set the length.
 * @param {Object} scene A SCENES entry.
 * @returns {?string[]} The option labels, e.g. ['12 h', '24 h', '66 h'].
 */
function spanLabels(scene) {
  if (!scene.clay || !scene.clay.forecastHours) { return null; }
  const forecastSpanHours = require('../src/pkjs/forecast-span-hours.js');
  const settings = sceneClay({ provider: 'dwd' }, scene, null);
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

/**
 * Each watch's calm run, as store-art.py reads it: its frames in order, a scene id and its
 * moment each (a step's first moment twice: before and after it).
 * @returns {Object<string, Array<{id: string, at: Array}>>} Platform -> frames.
 */
function calmRuns() {
  return calmScenes().runs;
}

if (require.main === module) {
  if (process.argv.includes('--manifest')) {
    process.stdout.write(JSON.stringify(manifest(), null, 2) + '\n');
  } else if (process.argv.includes('--calm')) {
    process.stdout.write(JSON.stringify(calmRuns(), null, 2) + '\n');
  } else {
    const written = generateStoreArtFixtures();
    console.log('Wrote ' + written.length + ' store art fixtures');
  }
}

module.exports = { generateStoreArtFixtures, manifest, calmRuns, SCENES, FRAMES, INTRO, CALM, CALM_FRAMES,
  PLATFORMS, NOT_APLITE, EMERY, SMALL, COLOUR, DAY_CLAY, INTRO_CLAY, CLASSIC, STRIPES, CLEAN, DATA,
  scenePlatforms, fixtureFor, weatherAt, realData, settled, nextSunEvents, countdownAt, dayId, minuteOf };
