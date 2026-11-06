'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  generateStoreArtFixtures, manifest, SCENES, FRAMES, PLATFORMS, EMERY, NOT_APLITE, COLOUR, DAY_CLAY, dayBase,
  settled, dayId,
} = require('../scripts/gen-store-art-fixtures');

/**
 * Generate the scenes into a throwaway dir.
 * @returns {Object<string, Object>} Slug -> parsed fixture.
 */
function generate() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-store-art-'));
  const out = {};
  try {
    for (const file of generateStoreArtFixtures({ outDir })) {
      out[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
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

test('the day runs forward: each frame later than the last, its clock and forecast at its moment', () => {
  const fx = generate();
  const base = dayBase();
  let last = -1;
  for (const [day, time] of FRAMES) {
    const frame = fx['art-' + dayId(day, time)];
    const [hour, minute] = time.split(':').map(Number);
    assert.deepEqual(frame.watch.now, { year: 2026, month: 6, day: 20 + day, hour, minute, second: 0 }, time);
    const at = day * 24 * 60 + hour * 60 + minute;
    assert.ok(at > last, time + ' after the frame before it');
    last = at;
    // The forecast starts at the frame's hour, the current temperature between it and the next.
    const index = day * 24 + hour - 8;
    assert.equal(frame.weather.startHour, hour);
    assert.deepEqual(frame.weather.temps.slice(0, 3), base.weather.temps.slice(index, index + 3));
    const [a, b] = base.weather.temps.slice(index, index + 2);
    assert.equal(frame.weather.currentTemp, Math.round(a + (b - a) * minute / 60));
    assert.ok(frame.weather.temps.length >= 24, time + ' has a day ahead');
    assert.equal(frame.weather.uvIndex.length, frame.weather.temps.length);
    // The sun event next after the clock.
    const next = frame.weather.sunEvents[0];
    if (hour * 60 + minute < 4 * 60 + 44) {
      assert.equal(next.type, 'sunrise');
    } else if (hour * 60 + minute < 21 * 60 + 33) {
      assert.equal(next.type, 'sunset');
    } else {
      assert.equal(next.type, 'sunrise');
    }
  }
});

test('the real forecast sits in the day where it starts, the filled-in hours around it', () => {
  const real = JSON.parse(fs.readFileSync(path.join('fixtures', 'berlin-timelapse.json'), 'utf8'));
  const base = dayBase();
  for (const key of ['temps', 'precipPct', 'rainMm', 'windKmh', 'gustKmh']) {
    assert.deepEqual(base.weather[key].slice(3, 3 + real.weather[key].length), real.weather[key], key);
  }
  // The long forecast span from 14:00 on Saturday reaches its 60 hours.
  assert.ok(base.weather.temps.length - 6 >= 62);
});

test('the story\'s numbers: UV 5 now and 8 to come on Saturday morning, 3 the next day, the storm on Sunday', () => {
  const fx = generate();
  const morning = fx['art-day-0-1000'].weather;
  assert.equal(Math.round(morning.uvIndex[0]), 5);
  assert.equal(Math.max(...morning.uvIndex.slice(0, 14)), 8);
  const night = fx['art-day-0-2200'].weather;
  assert.equal(Math.round(night.uvIndex[0]), 0);
  assert.equal(Math.round(Math.max(...night.uvIndex.slice(2, 26))), 3);
  // Sunday's gust of 59 km/h at noon passes the gust alert's 50, Saturday's never do.
  const saturday = fx['art-day-0-0800'].weather.gustKmh.slice(0, 16);
  assert.ok(Math.max(...saturday) < 50);
  const sunday = fx['art-day-1-0000'].weather.gustKmh.slice(0, 24);
  assert.equal(Math.round(Math.max(...sunday)), 59);
});

test('the rain alert counts down to the storm on Sunday morning, and is quiet before', () => {
  const fx = generate();
  assert.deepEqual(fx['art-day-1-0845'].countdown, { mins: 15, raining: false, tier: 4 });
  assert.equal(fx['art-day-1-0845'].weather.rainRadarExactMm.length, 24);
  assert.equal(fx['art-day-1-1200'].countdown.raining, true);
  for (const [day, time] of FRAMES) {
    const frame = fx['art-' + dayId(day, time)];
    if (day === 0 || time < '08:00') {
      assert.equal(frame.countdown, undefined, time);
      assert.equal(frame.weather.rainRadarExactMm, undefined, time);
    } else {
      assert.ok(frame.countdown, 'day ' + day + ' ' + time);
    }
  }
});

test('every scene names every key a scene changes, so one carries nothing over from another', () => {
  const fx = generate();
  const keys = Object.keys(settled(dayBase()));
  assert.ok(keys.includes('uvSlotDisplay') && keys.includes('layoutPreset') && keys.includes('colorTime'));
  for (const slug of Object.keys(fx)) {
    for (const key of keys) { assert.ok(key in fx[slug].claySettings, slug + ' names ' + key); }
  }
  // A day frame has the day's settings; a variant only its own changes over them.
  const day = fx['art-day-0-1200'].claySettings;
  for (const key of Object.keys(DAY_CLAY)) { assert.deepEqual(day[key], DAY_CLAY[key], key); }
  const wind = fx['art-lines-wind'].claySettings;
  assert.equal(wind.secondaryLine, 'wind');
  assert.equal(wind.thirdLine, 'gust');
  assert.equal(wind.uvSlotDisplay, 'both');
  assert.equal(fx['art-uv-now'].claySettings.uvSlotDisplay, 'current');
  assert.equal(fx['art-uv-max'].claySettings.uvSlotDisplay, 'max');
  assert.equal(fx['art-band-compact'].claySettings.colorTime, 0);
  assert.notEqual(fx['art-uv-now'].claySettings.colorTime, 0);
  assert.equal(fx['art-layout-light'].claySettings.theme, 'light');
  assert.equal(fx['art-day-1-1400'].claySettings.theme, 'dark');
});

test('the alerts as the story needs them: gusts from 50 km/h on the day itself, beside the battery', () => {
  const fx = generate();
  for (const slug of Object.keys(fx)) {
    const clay = fx[slug].claySettings;
    assert.equal(clay.statusTopOnDemandRightItems, 'battery,gust', slug);
    assert.equal(clay.threshGustWarn, '50', slug);
    assert.equal(clay.alertGustDays, 'today', slug);
  }
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
  for (const id of ['span-12', 'span-long', 'axis-graph', 'axis-off']) { assert.deepEqual(byId[id].platforms, EMERY, id); }
  for (const id of ['lines-mix', 'layout-weather', 'layout-light', 'view-health']) {
    assert.deepEqual(byId[id].platforms, NOT_APLITE, id);
  }
  for (const id of ['band-compact', 'band-full']) { assert.deepEqual(byId[id].platforms, COLOUR, id); }
  assert.deepEqual(byId['uv-line'].platforms, ['aplite']);
  assert.deepEqual(byId['day-0-0800'].platforms, PLATFORMS);
  assert.equal(byId['day-0-0800'].mode, 'day');
  assert.deepEqual(byId['span-long'].spanLabels, ['12 h', '24 h', '60 h']);
  assert.equal(byId['day-0-0800'].spanLabels, null);
  assert.equal(byId['view-health'].fixtures.emery, 'art-view-health-emery');
  assert.equal(byId['view-health'].fixtures.basalt, 'art-view-health');
  const fx = generate();
  assert.equal(fx['art-view-health-emery'].claySettings.statusHealthRight, 'hr');
  assert.equal(fx['art-view-health'].claySettings.statusHealthRight, 'sleep');
});
