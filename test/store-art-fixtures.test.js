'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  generateStoreArtFixtures, manifest, calmRuns, SCENES, FRAMES, INTRO, INTRO_FULL, CALM_FRAMES, PLATFORMS, EMERY,
  NOT_APLITE, COLOUR, DAY_CLAY, INTRO_CLAY, LONG, CLASSIC, STRIPES, CLEAN, HOLIDAYS, FEED_HOURS, realData, settled,
  countdownAt, dayId, minuteOf, epochOf,
} = require('../scripts/gen-store-art-fixtures');
const wizardForecast = require('../src/pkjs/settings/wizard-forecast.js');
const { celsiusToFahrenheit } = require('../src/pkjs/wire-units.js');

let cache = null;
/**
 * Generate the scenes into a throwaway dir (once per run).
 * @returns {Object<string, Object>} Slug -> parsed fixture.
 */
function generate() {
  if (cache) { return cache; }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-store-art-'));
  const out = {};
  try {
    for (const file of generateStoreArtFixtures({ outDir })) {
      out[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  cache = out;
  return out;
}

test('writes a fixture per scene and per platform variant', () => {
  const fx = generate();
  for (const scene of SCENES) {
    assert.ok(fx['art-' + scene.id], scene.id);
    for (const platform of Object.keys(scene.variants || {})) {
      assert.ok(fx['art-' + scene.id + '-' + platform], scene.id + ' on ' + platform);
    }
  }
});

test('the real weather: the reel\'s DWD snapshot, read as the app reads Bright Sky, nothing filled in by hand', () => {
  const data = realData();
  assert.ok(data.records.size > 500);
  assert.equal(data.radar.frame_count, data.radar.frames.length);
  const fx = generate();
  for (const slug of Object.keys(fx)) {
    const w = fx[slug].weather;
    assert.equal(w.temps.length, FEED_HOURS, slug);
    for (const key of ['feelsTemps', 'precipPct', 'rainMm', 'windKmh', 'gustKmh', 'uvIndex', 'aqi', 'cloudPct', 'dewPoint', 'pressureHpa']) {
      assert.equal(w[key].length, FEED_HOURS, slug + ' ' + key);
    }
    assert.equal(w.rainRadarExactMm, undefined, slug);
  }
});

test('the day runs forward: each frame an hour after the last, its instants from its hour\'s record, its totals from the next', () => {
  const fx = generate();
  const data = realData();
  let last = -1;
  for (const [day, time] of FRAMES) {
    const frame = fx['art-' + dayId(day, time)];
    const [hour, minute] = time.split(':').map(Number);
    assert.deepEqual(frame.watch.now, { year: 2025, month: 6, day: 25 + day, hour, minute, second: 0 }, time);
    if (last >= 0) { assert.equal(minuteOf([day, time]) - last, 60, time + ' an hour after the frame before it'); }
    last = minuteOf([day, time]);
    const t = epochOf([day, time]) - minute * 60;
    const [r, f] = [data.records.get(t), data.records.get(t + 3600)];
    const w = frame.weather;
    assert.equal(w.startHour, hour);
    assert.equal(w.currentTemp, Math.round(celsiusToFahrenheit(r.temperature) * 100) / 100);
    assert.equal(w.temps[0], w.currentTemp);
    assert.equal(w.rainMm[0], f.precipitation);
    assert.equal(w.precipPct[0], f.precipitation_probability);
    assert.equal(w.gustKmh[0], f.wind_gust_speed);
    assert.equal(w.windKmh[0], r.wind_speed);
    assert.equal(w.uvIndex[0], data.uv.get(t + 3600));
    assert.equal(w.aqi[0], data.aqi.get(t));
  }
});

test('the sun events are SunCalc\'s for Berlin, the next two after the clock', () => {
  const fx = generate();
  assert.deepEqual(fx['art-day-0-1200'].weather.sunEvents,
    [{ type: 'sunset', dayOffset: 0, hour: 21, minute: 34 }, { type: 'sunrise', dayOffset: 1, hour: 4, minute: 46 }]);
  assert.deepEqual(fx['art-day-0-2200'].weather.sunEvents.map((e) => [e.type, e.dayOffset]), [['sunrise', 1], ['sunset', 1]]);
});

test('the storm: gusts of 94 km/h at 18:00 on Thursday, the radar\'s downpour counted down to 18:15', () => {
  const fx = generate();
  const data = realData();
  assert.equal(Math.round(fx['art-day-1-1800'].weather.gustKmh[0]), 94);
  assert.ok(Math.max(...fx['art-day-0-1200'].weather.gustKmh.slice(0, 12)) < 65, 'Wednesday stays below the alert');
  assert.deepEqual(countdownAt(data.radar, epochOf([1, '17:15'])), { mins: 60, raining: false, tier: 5 });
  assert.deepEqual(fx['art-day-1-1800'].countdown, { mins: 15, raining: false, tier: 5 });
  assert.deepEqual(countdownAt(data.radar, epochOf([1, '18:15'])), { mins: 10, raining: true, tier: 5 });
  // An hour a frame: the rain alert shows at the alerts' stop alone.
  for (const [day, time] of FRAMES) {
    if (dayId(day, time) !== 'day-1-1800') {
      assert.equal(fx['art-' + dayId(day, time)].countdown, undefined, day + ' ' + time);
    }
  }
});

test('the rain alert: no rain on the radar within the hour, no alert', () => {
  const data = realData();
  assert.equal(countdownAt(data.radar, epochOf([1, '12:00'])), null);
  assert.deepEqual(countdownAt(data.radar, epochOf([0, '09:30'])), { mins: 15, raining: false, tier: 2 });
});

test('every scene names every key a scene changes, so one carries nothing over from another', () => {
  const fx = generate();
  const keys = Object.keys(settled());
  for (const key of ['uvSlotDisplay', 'layoutPreset', 'colorTime', 'forecastHours', 'rainBarFrom', 'thirdLine']) {
    assert.ok(keys.includes(key), key);
  }
  for (const slug of Object.keys(fx)) {
    for (const key of keys) { assert.ok(key in fx[slug].claySettings, slug + ' names ' + key); }
  }
  const day = fx['art-day-0-1300'].claySettings;
  for (const key of Object.keys(DAY_CLAY)) { assert.deepEqual(day[key], DAY_CLAY[key], key); }
  assert.equal(fx['art-uv-now'].claySettings.uvSlotDisplay, 'current');
  assert.equal(fx['art-uv-max'].claySettings.uvSlotDisplay, 'max');
  assert.equal(fx['art-band-compact'].claySettings.colorTime, 0);
  assert.notEqual(fx['art-uv-now'].claySettings.colorTime, 0);
  assert.equal(fx['art-layout-light'].claySettings.theme, 'light');
  assert.equal(fx['art-day-1-2100'].claySettings.theme, 'dark');
});

test('the graph: the setup\'s forecast looks, no left axis on Pebble Time 2 unless a scene asks', () => {
  const claySettings = require('../src/pkjs/clay-settings.js');
  const pebbleColors = require('../src/pkjs/pebble-colors.js');
  const defaults = claySettings.getDefaults({ white: pebbleColors.GColorWhite, folly: pebbleColors.GColorFolly,
    holiday: pebbleColors.GColorBlueMoon });
  const looks = Object.fromEntries(wizardForecast.looks(defaults, { platform: 'emery', color: true }, defaults, null)
    .map((look) => [look.id, look.values]));
  for (const [id, ours] of [['classic', CLASSIC], ['stripes', STRIPES], ['clean', CLEAN]]) {
    for (const key of Object.keys(looks[id])) {
      if (key === 'forecastAxisNumbers') { continue; }
      assert.deepEqual(ours[key], looks[id][key], id + ' ' + key);
    }
  }
  assert.equal(STRIPES.rainBarFrom, 'top');
  assert.equal(CLEAN.forecastAxisNumbers, 'graph');
  assert.equal(DAY_CLAY.forecastAxisNumbers, 'off');
  // The current store showcase's dense status slots.
  assert.equal(DAY_CLAY.layoutPreset, 'compactDense');
  assert.deepEqual([DAY_CLAY.statusRadarLeft, DAY_CLAY.statusRadarMid, DAY_CLAY.statusRadarRight], ['aqi', 'wind', 'gust']);
  assert.equal(DAY_CLAY.tempSlotDisplay, 'both');
  const fx = generate();
  assert.equal(fx['art-axis-on'].claySettings.forecastAxisNumbers, 'axis');
  assert.equal(fx['art-look-stripes'].claySettings.rainBarFrom, 'top');
});

test('the alerts as the story needs them: gusts at the app\'s levels on the day itself, beside the battery; Berlin\'s holidays', () => {
  const fx = generate();
  for (const slug of Object.keys(fx)) {
    const clay = fx[slug].claySettings;
    assert.equal(clay.statusTopOnDemandRightItems, 'battery,gust', slug);
    assert.equal(clay.threshGustWarn, '65', slug);
    assert.equal(clay.threshGustDanger, '90', slug);
    assert.equal(clay.alertGustDays, 'today', slug);
    assert.equal(clay.holidayRegion, 'DE-BE', slug);
    assert.deepEqual(fx[slug].holidays, HOLIDAYS, slug);
  }
  assert.deepEqual(HOLIDAYS.days.find(([md]) => md === '06-09'), ['06-09', null]);
  assert.deepEqual(HOLIDAYS.days.find(([md]) => md === '05-08'), ['05-08', ['DE-BE']]);
});

test('no scene shows the rain radar: the radar runs for the status bar and the rain alert, Weather only with it Off', () => {
  const fx = generate();
  for (const slug of Object.keys(fx)) {
    assert.ok(['status', 'off'].includes(fx[slug].claySettings.radarMode), slug);
  }
  assert.equal(fx['art-layout-weather'].claySettings.layoutPreset, 'weatherOnly');
  assert.equal(fx['art-layout-weather'].claySettings.radarMode, 'off');
});

test('the manifest: where each scene is captured, the forecast length labels, the health view', () => {
  const byId = Object.fromEntries(manifest().map((s) => [s.id, s]));
  for (const id of ['span-12', 'span-long', 'axis-on', 'axis-graph']) { assert.deepEqual(byId[id].platforms, EMERY, id); }
  for (const id of ['look-stripes', 'look-clean', 'layout-weather', 'layout-light', 'view-health']) {
    assert.deepEqual(byId[id].platforms, NOT_APLITE, id);
  }
  for (const id of ['band-compact', 'band-full']) { assert.deepEqual(byId[id].platforms, COLOUR, id); }
  for (const [day, time] of INTRO) {
    const intro = byId['intro-' + day + '-' + time.replace(':', '')];
    assert.equal(intro.mode, 'intro');
    assert.deepEqual(intro.platforms, EMERY);
    assert.deepEqual(intro.spanLabels, ['12 h', '24 h', '66 h']);
  }
  assert.deepEqual(byId['span-long'].spanLabels, ['12 h', '24 h', '66 h']);
  assert.deepEqual(byId['uv-line'].platforms, ['aplite']);
  assert.deepEqual(byId['day-0-1300'].platforms, PLATFORMS);
  assert.equal(byId['day-0-1300'].spanLabels, null);
  assert.equal(byId['view-health'].fixtures.emery, 'art-view-health-emery');
  assert.equal(byId['view-health'].fixtures.basalt, 'art-view-health');
  const fx = generate();
  assert.equal(fx['art-view-health-emery'].claySettings.statusHealthRight, 'hr');
  assert.equal(fx['art-view-health'].claySettings.statusHealthRight, 'sleep');
  for (const [day, time] of INTRO) {
    assert.equal(fx['art-intro-' + day + '-' + time.replace(':', '')].claySettings.forecastHours, INTRO_CLAY.forecastHours);
  }
});

test('the opening: every watch starts on the three-week calendar, then one setting changes at a time', () => {
  const scenes = manifest();
  const byId = Object.fromEntries(scenes.map((s) => [s.id, s]));
  const fx = generate();
  const settings = (id, platform) => fx[byId[id].fixtures[platform]].claySettings;
  const changed = (a, b) => Object.keys(a).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();
  assert.deepEqual(INTRO_FULL.map((at) => at[1]), ['12:00', '13:00']);
  for (const platform of PLATFORMS) {
    const intro = scenes.filter((s) => s.mode === 'intro' && s.platforms.includes(platform)).map((s) => s.id);
    const expected = INTRO_FULL.map(([day, time]) => 'intro-full-' + day + '-' + time.replace(':', ''));
    if (platform === 'emery') { expected.push(...INTRO.map(([day, time]) => 'intro-' + day + '-' + time.replace(':', ''))); }
    assert.deepEqual(intro, expected, platform);
    const first = settings(intro[0], platform);
    assert.equal(first.layoutPreset, 'fullCal', platform);
    assert.equal(first.forecastHours, platform === 'emery' ? LONG.forecastHours : DAY_CLAY.forecastHours, platform);
    // The run's frames in order, the day's view of the last moment after them: where two share a
    // moment, the screen is redrawn with one setting changed.
    const last = byId[intro[intro.length - 1]];
    const frames = intro.concat(dayId(last.at[0], last.at[1]));
    const switches = [];
    for (let i = 1; i < frames.length; i++) {
      const [a, b] = [byId[frames[i - 1]], byId[frames[i]]];
      if (minuteOf(a.at) === minuteOf(b.at)) {
        switches.push(a.at[1] + ' ' + changed(settings(a.id, platform), settings(b.id, platform)).join(','));
      } else {
        assert.equal(minuteOf(b.at) - minuteOf(a.at), 60, platform + ' runs an hour a frame');
        assert.deepEqual(changed(settings(a.id, platform), settings(b.id, platform)), [], platform + ' ' + b.id);
      }
    }
    assert.deepEqual(switches, platform === 'emery'
      ? ['13:00 layoutPreset', '15:00 forecastAxisNumbers,forecastHours'] : ['13:00 layoutPreset'], platform);
  }
});

test('the calm run: hour by hour from the calm Saturday, the three-week calendar to none, one step at a time', () => {
  const runs = calmRuns();
  const byId = Object.fromEntries(manifest().map((s) => [s.id, s]));
  const fx = generate();
  for (const platform of PLATFORMS) {
    const run = runs[platform];
    assert.equal(run[0].id, platform === 'emery' ? 'calm-full-66h-0621-1100' : 'calm-full-0621-1100', platform);
    assert.deepEqual(run[run.length - 1].at, CALM_FRAMES[CALM_FRAMES.length - 1], platform);
    let steps = 0;
    let since = 0;
    for (let i = 1; i < run.length; i++) {
      const [a, b] = [run[i - 1], run[i]];
      assert.ok(byId[b.id].platforms.includes(platform), b.id + ' captured on ' + platform);
      if (minuteOf(a.at) === minuteOf(b.at)) {
        // A step: the moment twice, its settings changed, a while after the last one.
        steps += 1;
        assert.notEqual(a.id, b.id);
        assert.ok(since >= 3, platform + ' ' + b.id + ' comes ' + since + ' hours after the last step');
        since = 0;
      } else {
        assert.equal(minuteOf(b.at) - minuteOf(a.at), 60, platform + ' runs on the hour');
        since += 1;
      }
    }
    const last = fx['art-' + run[run.length - 1].id].claySettings;
    assert.equal(last.layoutPreset, 'noCal', platform + ' ends without a calendar');
    assert.equal(steps, platform === 'aplite' ? 3 : 6, platform);
  }
  assert.equal(fx['art-' + runs.emery[runs.emery.length - 1].id].claySettings.forecastHours, '48');
  const looks = runs.basalt.map((f) => fx['art-' + f.id].claySettings.rainBarFrom);
  assert.ok(looks.includes('top'), 'Stripes hangs the rain bars from the top');
  assert.ok(runs.aplite.every((f) => fx['art-' + f.id].claySettings.thirdLine === CLASSIC.thirdLine));
});

test('every fixture\'s weather is a payload the app sends', () => {
  global.localStorage = global.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const fixtureWeather = require('../src/pkjs/fixture-weather.js');
  const fx = generate();
  for (const slug of ['art-day-0-1200', 'art-intro-full-0-1200', 'art-intro-full-0-1200-emery', 'art-intro-0-1300',
    'art-calm-full-66h-0621-1100', 'art-calm-nocal-clean-bitham-0626-2100', 'art-day-1-1800']) {
    const payload = fixtureWeather.getFixtureWeatherPayload(fx[slug], fx[slug].claySettings, { platform: 'emery' });
    assert.ok(payload, slug);
  }
});
