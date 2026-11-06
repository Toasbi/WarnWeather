#!/usr/bin/env node
'use strict';

// Store art fixtures: the watch screens of the appstore set that scripts/store-art.py builds
// (two showcase GIFs and the five store screens, per platform), each a fixture of its own
// (art-<id>.json, plus art-<id>-<platform>.json for a platform variant), shot by
// scripts/capture-store-art.sh into screenshot/<version>/store-art/frames/<platform>/<id>.png.
//
// THE DAYS. Both showcases are a time-lapse of two real days in Berlin: Wednesday 25 June 2025,
// its wet morning dried up, a windy afternoon of broken sun, and Thursday 26 June, clear and hot
// (32 °C) until the evening storm (gusts of 94 km/h at 18:00, a downpour on the radar at 18:15,
// rain into the night). The weather is the offline snapshot recorded for the promo reel, the
// current store showcase (fixtures/data/berlin-dwd-2025-06-26, see its PROVENANCE.md): DWD's
// hourly station records for Berlin as Bright Sky serves them, the chance of rain filled in from
// ECMWF as the app reads it, the UV (GFS) and the AQI (CAMS) the app takes from Open-Meteo, and
// DWD's 5-minute radar. Nothing is filled in by hand: every series is read the way the app's DWD
// provider reads Bright Sky (weatherAt), the sun times are SunCalc's (as the app's), and the rain
// alert reads the recorded radar the way the app does (countdownAt). DWD's feed reaches the full
// 68 hours, so Pebble Time 2's long span shows its 66.
//
// The clock's time is compile-time, so every frame is a scene ('day', day-<d>-<hhmm>):
// half-hourly through Wednesday, hourly through the night, every quarter hour as the storm
// comes. Pebble Time 2 opens on its own frames ('intro', intro-0-<hhmm>): the same afternoon in
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
// better at its full width), gusts alert at the app's levels judged on the day itself
// (Thursday's 94 km/h shows from midnight, Wednesday's 55 stay quiet), and the rain alert
// counts down to the storm. Every scene's
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
const { celsiusToFahrenheit, normalizeBearing } = require('../src/pkjs/wire-units.js');
const feelsLike = require('../src/pkjs/weather/feels-like.js');
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

const DATA = path.join('fixtures', 'data', 'berlin-dwd-2025-06-26');
// Day 0: Wednesday 25 June 2025. Berlin keeps summer time (UTC+2) over the snapshot.
const DAY = { year: 2025, month: 6, day: 25 };
const UTC_OFFSET_HOURS = 2;
const BERLIN = { lat: 52.52, lon: 13.405 };
// The hours the graph is sent: DWD's full feed (forecast-span-hours.js FULL_HOURS).
const FEED_HOURS = 68;
// Germany's public holidays of 2025, Nager.Date's (the app's holiday source), in
// nager-source.js' cache shape: the nationwide ones, and the regions of the others. A Berlin user
// sees the nationwide ones and Berlin's own (DE-BE): none falls in the calendar's weeks of
// late June, as on a real watch.
const HOLIDAY_REGION = 'DE-BE';
const HOLIDAYS = {
  country: 'DE', year: 2025,
  days: [['01-01', null], ['01-06', ['DE-BW', 'DE-BY', 'DE-ST']], ['03-08', ['DE-BE', 'DE-MV']], ['04-18', null],
    ['04-20', ['DE-BB']], ['04-21', null], ['05-01', null], ['05-08', ['DE-BE']], ['05-29', null],
    ['06-08', ['DE-BB']], ['06-09', null], ['06-19', ['DE-BW', 'DE-BY', 'DE-HE', 'DE-NW', 'DE-RP', 'DE-SL']],
    ['08-15', ['DE-SL']], ['09-20', ['DE-TH']], ['10-03', null],
    ['10-31', ['DE-BB', 'DE-MV', 'DE-SN', 'DE-ST', 'DE-TH', 'DE-HB', 'DE-HH', 'DE-NI', 'DE-SH']],
    ['11-01', ['DE-BW', 'DE-BY', 'DE-NW', 'DE-RP', 'DE-SL']], ['11-19', ['DE-SN']], ['12-25', null], ['12-26', null]],
};

// The frames: Wednesday half-hourly from noon, the night hourly, Thursday half-hourly to the
// storm, every quarter hour as it comes, and on to 21:00.
const FRAMES = [].concat(
  halfHours(12, 24).map((t) => [0, t]),
  hours(0, 8).map((t) => [1, t]),
  ['07:30'].concat(halfHours(8, 17)).map((t) => [1, t]),
  ['17:00', '17:15', '17:30', '17:45', '18:00', '18:15', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']
    .map((t) => [1, t]));

// Pebble Time 2's opening: Wednesday from noon to 15:00 in the long span.
const INTRO = halfHours(12, 15).concat('15:00').map((t) => [0, t]);
const INTRO_CLAY = { forecastHours: '48', forecastAxisNumbers: 'graph' };

// The setup's forecast looks (wizard-forecast.js), as it writes them on a Pebble Time 2 (the
// other watches ignore the left axis and, in black and white, the bars' colour). Classic is a
// fresh install's graph; Stripes and Clean lay theirs over it. The left axis stays off where a
// look would put it beside the graph.
const LOOKS = lookValues();
const CLASSIC = LOOKS.classic;
const STRIPES = LOOKS.stripes;
const CLEAN = LOOKS.clean;

// The day's settings, every scene's: the current store showcase's dense look (the promo reel's
// berlin-dense: the compact calendar with a second status bar above the clock for the AQI, the
// wind and the gusts, each now and the day's peak, the wind with its direction; the Forecast
// Status Bar's temperature with its feels-like, the city; the top bar's week, date and battery),
// with the UV slot (now and the day's max) where the reel has the next sun event, in the dark
// theme with the Roboto clock and the Classic graph over 24 hours without a left axis. Alerts
// beside the battery: the rain alert from DWD's radar on the left, gusts on the right at the
// app's levels judged on the day itself (Wednesday's 55 km/h stay quiet, Thursday's 94 shows
// from midnight).
const DAY_CLAY = Object.assign({
  theme: 'dark', timeFont: 'roboto', layoutPreset: 'compactDense', dayNightShading: true,
  forecastHours: '24', healthMode: 'off', hrScale: '50-100',
  radarProvider: 'dwd', radarMode: 'status', radarColor: 'multicolor', rainCountdownHorizon: '60',
  aqiSource: 'openmeteo', aqiScale: 'european', temperatureUnits: 'c', windUnits: 'kph',
  statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'battery',
  statusRadarLeft: 'aqi', statusRadarMid: 'wind', statusRadarRight: 'gust',
  windSlotDisplay: 'both', windSlotDirection: true, gustSlotDisplay: 'both', windSlotUnit: true, gustSlotUnit: true,
  statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'uv', uvSlotDisplay: 'both',
  tempSlotDisplay: 'both', tempSlotSeparator: 'bar', tempSlotUnit: false,
  statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep',
  statusTopOnDemandLeftItems: 'rain,bt,qt,snooze', statusTopOnDemandRightItems: 'battery,gust',
  threshGustOn: true, threshGustWarn: '65', threshGustDanger: '90', alertGustDays: 'today',
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
    { from: [0, '12:00'], name: 'full', clay: { layoutPreset: 'fullCal' } },
    { from: [0, '17:00'], name: 'dense', clay: { layoutPreset: 'compactDense' } },
    { from: [0, '22:00'], name: 'long', clay: { forecastHours: '48' } },
    { from: [1, '03:00'], name: 'stripes', clay: STRIPES },
    { from: [1, '09:00'], name: 'clean', clay: CLEAN },
    { from: [1, '14:00'], name: 'nocal', clay: { layoutPreset: 'noCal' } },
  ],
  small: [
    { from: [0, '12:00'], name: 'full', clay: { layoutPreset: 'fullCal' } },
    { from: [0, '17:00'], name: 'dense', clay: { layoutPreset: 'compactDense' } },
    { from: [0, '22:00'], name: 'stripes', clay: STRIPES },
    { from: [1, '06:00'], name: 'clean', clay: CLEAN },
    { from: [1, '13:00'], name: 'nocal', clay: { layoutPreset: 'noCal' } },
  ],
  aplite: [
    { from: [0, '12:00'], name: 'full', clay: { layoutPreset: 'fullCal' } },
    // Aplite has no second status bar: its compact calendar is the dense look's (dormant there).
    { from: [0, '18:00'], name: 'compact', clay: { layoutPreset: 'compactDense' } },
    { from: [1, '08:00'], name: 'nocal', clay: { layoutPreset: 'noCal' } },
  ],
};
// The calm run's frames: on the hour, Wednesday from noon to the evening after the storm.
const CALM_FRAMES = [].concat(hours(12, 24).map((t) => [0, t]), hours(0, 22).map((t) => [1, t]));

// The scenes. `at` is the moment ([day, 'HH:MM'], day 0 Wednesday 25 June); `mode` 'intro', 'day',
// 'variant', 'band' or 'calm'; `platforms` where it is captured (all five when absent); `clay`
// its settings over DAY_CLAY; `theme` a theme flip (withTheme); `variants` per-platform
// settings over the scene's.
const SCENES = [].concat(
  INTRO.map(([day, time]) => ({ id: 'intro-' + day + '-' + hhmm(time), mode: 'intro', at: [day, time],
    platforms: EMERY, clay: INTRO_CLAY })),
  FRAMES.map(([day, time]) => ({ id: dayId(day, time), mode: 'day', at: [day, time] })),
  [
    { id: 'band-compact', mode: 'band', at: [0, '13:00'], platforms: COLOUR, clay: { colorTime: 0 } },
    // 16:00 on Wednesday, Pebble Time 2: the forecast length (12 hours, the long span, the storm
    // in it) and the left axis' values (on the axis, on the graph).
    { id: 'span-12', mode: 'variant', at: [0, '16:00'], platforms: EMERY, clay: { forecastHours: '12' } },
    { id: 'span-long', mode: 'variant', at: [0, '16:00'], platforms: EMERY, clay: { forecastHours: '48' } },
    { id: 'axis-on', mode: 'variant', at: [0, '16:00'], platforms: EMERY, clay: { forecastAxisNumbers: 'axis' } },
    { id: 'axis-graph', mode: 'variant', at: [0, '16:00'], platforms: EMERY, clay: { forecastAxisNumbers: 'graph' } },
    // 08:00 on Thursday: the three-week calendar.
    { id: 'cal-full', mode: 'variant', at: [1, '08:00'], clay: { layoutPreset: 'fullCal' } },
    { id: 'band-full', mode: 'band', at: [1, '08:00'], platforms: COLOUR,
      clay: { layoutPreset: 'fullCal', colorTime: 0 } },
    // 10:00 on Thursday (UV 5 now, 7 at 14:00): the UV slot's Now and Day max ("Both" is the day's).
    { id: 'uv-now', mode: 'variant', at: [1, '10:00'], clay: { uvSlotDisplay: 'current' } },
    { id: 'uv-max', mode: 'variant', at: [1, '10:00'], clay: { uvSlotDisplay: 'max' } },
    // Noon on Thursday, the storm in view: the setup's forecast looks; aplite's UV line instead.
    { id: 'look-stripes', mode: 'variant', at: [1, '12:00'], platforms: NOT_APLITE, clay: STRIPES },
    { id: 'look-clean', mode: 'variant', at: [1, '12:00'], platforms: NOT_APLITE, clay: CLEAN },
    { id: 'uv-line', mode: 'variant', at: [1, '12:00'], platforms: ['aplite'],
      clay: { secondaryLine: 'uv', secondaryLineFill: true, barSource: 'off' } },
    // 21:00 on Thursday, the storm passed: the layouts. Weather only without the radar (radar
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
 * @param {number} day 0 for the Wednesday, 1 for the Thursday.
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
 * The real weather (DATA): DWD's hourly records as Bright Sky serves them (filled), the GFS UV and
 * the CAMS AQI as Open-Meteo answers them, each by its epoch second, and the radar window.
 * @returns {{records: Map<number, Object>, uv: Map<number, number>, aqi: Map<number, number>,
 *   radar: Object}} The data.
 */
function realData() {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
  const records = new Map(read('brightsky-weather.filled.json').weather
    .map((r) => [Date.parse(r.timestamp) / 1000, r]));
  const byTime = (json, key) => new Map(json.hourly.time.map((t, i) => [t, json.hourly[key][i]]));
  return {
    records,
    uv: byTime(read('openmeteo-uv-gfs.json'), 'uv_index'),
    aqi: byTime(read('air-quality.json'), 'european_aqi'),
    radar: read('radar-dwd-yw-window.json'),
  };
}

/**
 * A moment as epoch seconds.
 * @param {[number, string]} at The moment.
 * @returns {number} Epoch seconds.
 */
function epochOf(at) {
  const [hour, minute] = at[1].split(':').map(Number);
  return Date.UTC(DAY.year, DAY.month - 1, DAY.day + at[0], hour - UTC_OFFSET_HOURS, minute) / 1000;
}

/**
 * A record's feels-like (°F), the way the app's DWD provider works it out (dwd.js hourFeels):
 * Steadman from the humidity, else from the dew point, else the temperature.
 * @param {Object} r A Bright Sky record.
 * @returns {number} °F.
 */
function hourFeels(r) {
  const tempF = celsiusToFahrenheit(r.temperature);
  let feels = feelsLike.feelsLikeF(tempF, r.relative_humidity, r.wind_speed || 0);
  if (feels === null && typeof r.dew_point === 'number') {
    feels = feelsLike.feelsLikeFromDewF(tempF, celsiusToFahrenheit(r.dew_point), r.wind_speed || 0);
  }
  return feels === null ? tempF : feels;
}

/**
 * The next two sun events after a moment, SunCalc's for Berlin (as the app's sun-events.js for
 * DWD, whose records carry none), in the fixture's readable form, days counted from the moment's.
 * @param {[number, string]} at The moment.
 * @returns {{type: string, dayOffset: number, hour: number, minute: number}[]} Two events.
 */
function nextSunEvents(at) {
  const now = epochOf(at);
  const day0 = epochOf([at[0], '00:00']);
  const events = [];
  for (let d = at[0]; d <= at[0] + 2; d++) {
    const times = SunCalc.getTimes(new Date(Date.UTC(DAY.year, DAY.month - 1, DAY.day + d, 10)), BERLIN.lat, BERLIN.lon);
    for (const type of ['sunrise', 'sunset']) {
      const t = Math.floor(times[type].getTime() / 1000);
      if (t > now) { events.push([t, type]); }
    }
  }
  return events.sort((x, y) => x[0] - y[0]).slice(0, 2).map(([t, type]) => {
    const local = new Date((t + UTC_OFFSET_HOURS * 3600) * 1000);
    return { type, dayOffset: Math.floor((t - day0) / 86400), hour: local.getUTCHours(), minute: local.getUTCMinutes() };
  });
}

/**
 * The rain alert at a moment, read from the recorded radar as the app reads its nowcast: the
 * radar's two hours from the moment's 5-minute slot (radar-wire.js slotZeroEpochFor), each slot
 * the frame closing it, sampled at the point (dwd-radar.js sampleFrame); then the watch's rule
 * (rain_countdown.c): the first rain at or after now and where it stops, the minutes to its start
 * (rounded) or, while it rains, to its end (rounded up), shown within the alert's hour, and the
 * tier of its heaviest slot. Null without rain that near.
 * @param {Object} radar The radar window (realData().radar).
 * @param {number} now The moment, epoch seconds.
 * @param {number} [horizon] The alert's look-ahead in minutes (rainCountdownHorizon).
 * @returns {?{mins: number, raining: boolean, tier: number}} The countdown block.
 */
function countdownAt(radar, now, horizon = 60) {
  const radarWire = require('../src/pkjs/weather/radar-wire.js');
  const dwdRadar = require('../src/pkjs/weather/dwd-radar.js');
  const rainTier = require('../src/pkjs/weather/rain-tier.js');
  const slotZero = radarWire.slotZeroEpochFor(now * 1000);
  const byTime = new Map(radar.frames.map((f) => [f.t, f]));
  const xy = radar.window.latlon_position;
  const exact = [];
  for (let i = 0; i < radarWire.NUM_BARS; i++) {
    const frame = byTime.get(slotZero + (i + 1) * radarWire.SLOT_SECONDS);
    if (!frame) { throw new Error('the radar has no frame for ' + (slotZero + (i + 1) * radarWire.SLOT_SECONDS)); }
    exact.push(dwdRadar.sampleFrame({ precipitation_5: frame.p }, xy, true).exact);
  }
  let i = 0;
  while (i < exact.length && exact[i] === 0) { i++; }
  if (i >= exact.length) { return null; }
  let j = i;
  while (j < exact.length && exact[j] !== 0) { j++; }
  const start = slotZero + i * radarWire.SLOT_SECONDS;
  const end = slotZero + j * radarWire.SLOT_SECONDS;
  const raining = now >= start;
  let mins = raining ? Math.floor((end - now + 59) / 60) : Math.floor((start - now + 30) / 60);
  mins = Math.max(1, mins);
  if (!raining && mins > horizon) { return null; }
  return { mins: mins > 99 ? 100 : mins, raining, tier: rainTier.tierOfTenths(Math.max(...exact.slice(i, j))) };
}

/**
 * A moment's weather, read from the records the way the app's DWD provider reads Bright Sky
 * (dwd.js slotRecords): slot i the hour starting i hours after the moment's own, its instants
 * (temperature, wind, pressure, cloud cover, dew point, bearing, feels-like) from the record
 * stamped at that hour, its hour totals (rain, its chance, gusts) and the UV (openmeteo.js mapUv)
 * from the one stamped an hour on, the AQI (air-quality.js mapAqi) at the hour; FEED_HOURS of
 * them. The current temperature is the moment's hour's record (the last one before it); the
 * clock, the sun events after it and the rain alert at it.
 * @param {Object} data realData().
 * @param {[number, string]} at The moment.
 * @returns {Object} The fixture, before the scene's settings.
 */
function weatherAt(data, at) {
  const [hour, minute] = at[1].split(':').map(Number);
  const now = epochOf(at);
  const start = now - minute * 60;
  const own = [];
  const next = [];
  const uv = [];
  const aqi = [];
  for (let i = 0; i < FEED_HOURS; i++) {
    const t = start + i * 3600;
    const [r, f] = [data.records.get(t), data.records.get(t + 3600)];
    if (!r || !f || !data.uv.has(t + 3600) || !data.aqi.has(t)) { throw new Error('the data has no hour ' + t + ' for ' + at); }
    own.push(r);
    next.push(f);
    uv.push(data.uv.get(t + 3600));
    aqi.push(data.aqi.get(t));
  }
  const weather = {
    city: 'Berlin',
    startHour: hour,
    currentTemp: r2(celsiusToFahrenheit(own[0].temperature)),
    currentFeels: r2(hourFeels(own[0])),
    temps: own.map((r) => r2(celsiusToFahrenheit(r.temperature))),
    feelsTemps: own.map((r) => r2(hourFeels(r))),
    precipPct: next.map((r) => r.precipitation_probability || 0),
    rainMm: next.map((r) => r.precipitation || 0),
    windKmh: own.map((r) => r.wind_speed || 0),
    gustKmh: next.map((r) => r.wind_gust_speed || 0),
    uvIndex: uv,
    aqi,
    windDirection: own.map((r) => normalizeBearing(r.wind_direction)),
    cloudPct: own.map((r) => r.cloud_cover || 0),
    dewPoint: own.map((r) => r2(celsiusToFahrenheit(r.dew_point))),
    pressureHpa: own.map((r) => r.pressure_msl || 0),
    sunEvents: nextSunEvents(at),
  };
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
  const countdown = countdownAt(data.radar, now);
  if (countdown) { fx.countdown = countdown; }
  return fx;
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
  PLATFORMS, NOT_APLITE, EMERY, SMALL, COLOUR, DAY_CLAY, INTRO_CLAY, CLASSIC, STRIPES, CLEAN, DATA, HOLIDAYS,
  FEED_HOURS, scenePlatforms, fixtureFor, weatherAt, realData, settled, nextSunEvents, countdownAt, dayId, minuteOf,
  epochOf };
