'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  generateStoreArtFixtures, manifest, calmRuns, SCENES, FRAMES, INTRO, CALM_FRAMES, PLATFORMS, EMERY, NOT_APLITE,
  COLOUR, DAY_CLAY, INTRO_CLAY, CLASSIC, STRIPES, CLEAN, realData, settled, countdownAt, dayId, minuteOf,
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

test('the real weather: DWD\'s records for Berlin, nothing filled in, their chance of rain read as 0 %', () => {
  const data = realData();
  assert.match(data.records.station, /^Berlin/);
  assert.match(data.records.source, /^https:\/\/api\.brightsky\.dev\/weather\?/);
  assert.equal(data.records.start, '2025-04-30T00:00:00+02:00');
  for (const values of Object.values(data.records.hours)) {
    assert.ok(values.every((v) => v !== null && v !== undefined));
  }
  const fx = generate();
  for (const slug of Object.keys(fx)) {
    assert.ok(fx[slug].weather.precipPct.every((p) => p === 0), slug);
    assert.equal(fx[slug].weather.precipPct.length, fx[slug].weather.temps.length, slug);
    assert.equal(fx[slug].weather.rainRadarExactMm, undefined, slug);
  }
});

test('the day runs forward: each frame later than the last, read from the records as the app reads Bright Sky', () => {
  const fx = generate();
  const h = realData().records.hours;
  let last = -1;
  for (const [day, time] of FRAMES) {
    const frame = fx['art-' + dayId(day, time)];
    const [hour, minute] = time.split(':').map(Number);
    assert.deepEqual(frame.watch.now, { year: 2025, month: 5, day: 1 + day, hour, minute, second: 0 }, time);
    assert.ok(minuteOf([day, time]) > last, time + ' after the frame before it');
    last = minuteOf([day, time]);
    // The records start at midnight on 30 April: the frame's hour is record i, its instants
    // read from record i on, its hour totals (rain, gusts) from record i + 1 on.
    const i = (1 + day) * 24 + hour;
    const w = frame.weather;
    assert.equal(w.startHour, hour);
    assert.equal(w.currentTemp, Math.round(celsiusToFahrenheit(h.temperature[i]) * 100) / 100);
    assert.equal(w.temps[1], Math.round(celsiusToFahrenheit(h.temperature[i + 1]) * 100) / 100);
    assert.deepEqual(w.rainMm.slice(0, 3), h.precipitation.slice(i + 1, i + 4));
    assert.deepEqual(w.gustKmh.slice(0, 3), h.wind_gust_speed.slice(i + 1, i + 4));
    assert.deepEqual(w.windKmh.slice(0, 3), h.wind_speed.slice(i, i + 3));
    assert.deepEqual(w.cloudPct.slice(0, 3), h.cloud_cover.slice(i, i + 3));
    assert.ok(w.temps.length >= 69, time + ' reaches the long span');
    for (const key of ['feelsTemps', 'precipPct', 'rainMm', 'windKmh', 'gustKmh', 'cloudPct', 'dewPoint', 'pressureHpa']) {
      assert.equal(w[key].length, w.temps.length, key);
    }
  }
});

test('the sun events are SunCalc\'s for Berlin, the next two after the clock', () => {
  const fx = generate();
  assert.deepEqual(fx['art-day-0-0500'].weather.sunEvents,
    [{ type: 'sunrise', dayOffset: 0, hour: 5, minute: 36 }, { type: 'sunset', dayOffset: 0, hour: 20, minute: 33 }]);
  assert.deepEqual(fx['art-day-0-2100'].weather.sunEvents,
    [{ type: 'sunrise', dayOffset: 1, hour: 5, minute: 34 }, { type: 'sunset', dayOffset: 1, hour: 20, minute: 34 }]);
});

test('the storm: gusts of 78 km/h just after 18:00 on Friday, the rain alert counting down to 19:00', () => {
  const fx = generate();
  assert.equal(Math.round(fx['art-day-1-1800'].weather.gustKmh[0]), 79);
  assert.ok(Math.max(...fx['art-day-0-0500'].weather.gustKmh.slice(0, 19)) < 50, 'Labour Day stays calm');
  assert.deepEqual(fx['art-day-1-1800'].countdown, { mins: 60, raining: false, tier: 3 });
  assert.deepEqual(fx['art-day-1-1845'].countdown, { mins: 15, raining: false, tier: 3 });
  assert.deepEqual(fx['art-day-1-1900'].countdown, { mins: 100, raining: true, tier: 3 });
  assert.deepEqual(fx['art-day-1-2100'].countdown, { mins: 60, raining: true, tier: 1 });
  for (const [day, time] of FRAMES) {
    if (minuteOf([day, time]) < minuteOf([1, '18:00'])) {
      assert.equal(fx['art-' + dayId(day, time)].countdown, undefined, day + ' ' + time);
    }
  }
});

test('the rain alert: minutes to the next wet hour within the hour, how long it rains within the radar\'s two hours', () => {
  assert.equal(countdownAt([0, 0, 2, 0], 0), null);
  assert.deepEqual(countdownAt([0, 2, 0, 0], 30), { mins: 30, raining: false, tier: 3 });
  assert.deepEqual(countdownAt([0.3, 0, 0], 0), { mins: 60, raining: true, tier: 2 });
  assert.deepEqual(countdownAt([0.3, 0.3, 0.3], 0), { mins: 100, raining: true, tier: 2 });
  assert.deepEqual(countdownAt([12, 0.1, 0], 30), { mins: 90, raining: true, tier: 5 });
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
  const day = fx['art-day-0-1200'].claySettings;
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
  const fx = generate();
  assert.equal(fx['art-axis-on'].claySettings.forecastAxisNumbers, 'axis');
  assert.equal(fx['art-look-stripes'].claySettings.rainBarFrom, 'top');
});

test('the alerts as the story needs them: gusts from 50 km/h on the day itself, beside the battery; Berlin\'s holidays', () => {
  const fx = generate();
  for (const slug of Object.keys(fx)) {
    const clay = fx[slug].claySettings;
    assert.equal(clay.statusTopOnDemandRightItems, 'battery,gust', slug);
    assert.equal(clay.threshGustWarn, '50', slug);
    assert.equal(clay.alertGustDays, 'today', slug);
    assert.equal(clay.holidayRegion, 'DE-BE', slug);
    assert.equal(fx[slug].holidays.country, 'DE');
    assert.equal(fx[slug].holidays.year, 2025);
  }
  const days = fx['art-day-0-0500'].holidays.days;
  assert.deepEqual(days.find(([md]) => md === '05-01'), ['05-01', null]);
  assert.deepEqual(days.find(([md]) => md === '05-08'), ['05-08', ['DE-BE']]);
  assert.deepEqual(days.find(([md]) => md === '04-21'), ['04-21', null]);
});

test('no scene shows the rain radar: the radar runs for the rain alert, Weather only with it Off', () => {
  const fx = generate();
  for (const slug of Object.keys(fx)) {
    assert.ok(['countdown', 'off'].includes(fx[slug].claySettings.radarMode), slug);
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
  assert.deepEqual(byId['day-0-0800'].platforms, PLATFORMS);
  assert.equal(byId['day-0-0800'].spanLabels, null);
  assert.equal(byId['view-health'].fixtures.emery, 'art-view-health-emery');
  assert.equal(byId['view-health'].fixtures.basalt, 'art-view-health');
  const fx = generate();
  assert.equal(fx['art-view-health-emery'].claySettings.statusHealthRight, 'hr');
  assert.equal(fx['art-view-health'].claySettings.statusHealthRight, 'sleep');
  for (const [day, time] of INTRO) {
    assert.equal(fx['art-intro-' + day + '-' + time.replace(':', '')].claySettings.forecastHours, INTRO_CLAY.forecastHours);
  }
});

test('the calm run: hour by hour from the three-week calendar to none, one step at a time, each a while', () => {
  const runs = calmRuns();
  const byId = Object.fromEntries(manifest().map((s) => [s.id, s]));
  const fx = generate();
  for (const platform of PLATFORMS) {
    const run = runs[platform];
    assert.equal(run[0].id, 'calm-full-0-0500', platform);
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
    assert.equal(steps, { emery: 5, aplite: 2 }[platform] || 4, platform);
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
  for (const slug of ['art-day-0-0500', 'art-intro-0-0500', 'art-calm-full-0-0500', 'art-day-1-1845']) {
    const payload = fixtureWeather.getFixtureWeatherPayload(fx[slug], fx[slug].claySettings, { platform: 'emery' });
    assert.ok(payload, slug);
  }
});
