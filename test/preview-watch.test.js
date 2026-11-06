// test/preview-watch.test.js — the Watchface tab's watch (settings/preview-watch.js): every
// view of the cycle drawn on its screen's grid, its bands on the seats the watch gives them
// (view-cycle.js stackSeats), in the theme's colours, with the status bars' slots and the
// graph previews in their bands.
const test = require('node:test');
const assert = require('node:assert/strict');

// The engine's registries first (the icons the status rows draw), as the page loads them.
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
require('../src/pkjs/settings/status-slot-icons.js');
const VC = require('../src/pkjs/view-cycle.js');
const plat = require('../src/pkjs/config-ui/lib/platform.js');
const schema = require('../src/pkjs/settings/schema.js');
const pw = require('../src/pkjs/settings/preview-watch.js');
const onbuild = require('../src/pkjs/settings/onbuild.js');

/**
 * Settings as a fresh install holds them, with overrides.
 * @param {Object} [over] Stored values over the hydrated defaults.
 * @returns {Object} S.
 */
function settings(over) {
  return Object.assign(eng.hydrate(schema, {}), over || {});
}

/**
 * The view cycle a state resolves to, and the platform's env.
 * @param {Object} S Settings.
 * @param {string} platform Platform name.
 * @returns {{views: !Array, env: !Object}}
 */
function cycle(S, platform) {
  const env = plat.computeEnv({ platform: platform });
  return { views: VC.resolveViewCycle(S, env), env: env };
}

/**
 * Each view's spoken description, as the block labels it.
 * @param {string} html The block.
 * @returns {string[]}
 */
function labels(html) {
  return (html.match(/class="wpv-v" role="img" aria-label="[^"]*"/g) || []).map((m) => /aria-label="([^"]*)"/.exec(m)[1]);
}

test('every preset\'s views sit on the watch\'s seats, the filling graph running to the screen\'s foot', () => {
  ['basalt', 'emery'].forEach((platform) => {
    const f = platform === 'emery' ? 1 : 0, sc = pw.SCREEN[f];
    ['fullCal', 'compactCal', 'compactDense', 'noCal', 'weatherOnly'].forEach((preset) => {
      const c = cycle(settings({ layoutPreset: preset, radarMode: 'graph', healthMode: 'all' }), platform);
      c.views.forEach((spec, i) => {
        if (!spec) { return; }
        const lay = pw.layoutView(spec, f), at = preset + ' ' + platform + ' view ' + i;
        assert.equal(lay.strip, spec.stripOff ? 0 : sc.floor - VC.FIT_PX.availStrip[f], at + ': the top bar');
        const walk = VC.isStacked(spec) ? spec : Object.assign(VC.cloneSpec(spec),
          { order: spec.tier === VC.TIER_COMPACT ? 0 : 1 });
        const seats = VC.stackSeats(walk, f).seats;
        assert.deepEqual(lay.bands.map((b) => b.band), seats.map((s) => s.band), at + ': the bands, in order');
        for (let j = 1; j < lay.bands.length; j++) {
          assert.equal(lay.bands[j].y, lay.bands[j - 1].y + lay.bands[j - 1].h + seats[j - 1].gap,
            at + ': band ' + j + ' follows the one above');
        }
        const last = lay.bands[lay.bands.length - 1];
        if (seats.some((s) => s.fill)) {
          assert.equal(last.y + last.h, sc.h, at + ': the graph fills to the foot');
        } else {
          assert.ok(last.y + last.h <= sc.h, at + ': it fits');
        }
      });
    });
  });
});

test('each view is named and spoken band by band, in the Layout card\'s words', () => {
  const S = settings({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'all' });
  const env = plat.computeEnv({ platform: 'basalt' });
  assert.deepEqual(labels(pw.watchPreview(S, env, {})), [
    'Default: Watch Status, Calendar (2 rows), Clock, Forecast Status, Forecast',
    'Flick 1: Watch Status, Clock, Health Status, Health graph',
    'Flick 2: Watch Status, Clock, Radar Status, Radar'
  ]);
  assert.deepEqual(labels(pw.watchPreview(settings({ layoutPreset: 'fullCal', radarMode: 'off', healthMode: 'off' }), env, {})),
    ['Default: Watch Status, Calendar (3 rows), Clock, Forecast Status, Forecast'], 'one view, one screen');
  assert.match(pw.watchPreview(S, env, {}), /^<div class="wpv n3" role="group" aria-label="Your watch">/);
});

test('aplite draws a single Default view; emery its own 200×228 screen', () => {
  const S = settings({ layoutPreset: 'compactDense', radarMode: 'graph', healthMode: 'all' });
  // The page's load normalises what aplite cannot draw, as it does before any block renders.
  const apliteEnv = plat.computeEnv({ platform: 'aplite' });
  const onAplite = Object.assign({}, S);
  onbuild.onLoad({ env: apliteEnv, get: (k) => onAplite[k], set: (k, v) => { onAplite[k] = v; },
    getInitial: (k) => onAplite[k] });
  const aplite = pw.watchPreview(onAplite, apliteEnv, {});
  assert.equal(labels(aplite).length, 1);
  assert.match(labels(aplite)[0], /^Default: /);
  assert.match(aplite, /viewBox="0 0 144 168"/);
  assert.match(pw.watchPreview(S, plat.computeEnv({ platform: 'emery' }), {}), /viewBox="0 0 200 228"/);
});

test('the calendar: its week as Start week on says, today in its cell, Auto taking the weekday\'s colour', () => {
  const env = plat.computeEnv({ platform: 'basalt' });
  const c = cycle(settings({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off' }), 'basalt');
  const friday = new Date(2026, 10, 6), sunday = new Date(2026, 10, 8);
  const draw = (over, now) => pw.screenSvg(c.views[0], 0, settings(Object.assign({ layoutPreset: 'compactCal' }, over)),
    env, {}, 0, now).svg;
  const todayCell = (svg) => /<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" rx="2" fill="([^"]*)"><\/rect><text[^>]*fill="([^"]*)"[^>]*>(\d+)</.exec(svg);
  // A Monday start puts Friday the 6th fifth in its row; a Sunday start sixth.
  const firstRow = (svg) => (svg.match(/>(\d+)<\/text>/g) || []).slice(0, 7).map((t) => t.replace(/\D/g, ''));
  assert.deepEqual(firstRow(draw({ weekStartDay: 'mon' }, friday)), ['2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(firstRow(draw({ weekStartDay: 'sun' }, friday)), ['1', '2', '3', '4', '5', '6', '7']);
  let cell = todayCell(draw({ colorToday: '#000000' }, friday));
  assert.deepEqual([cell[1], cell[2], cell[3]], ['#FFFFFF', '#000000', '6'], 'Auto on a weekday: the ink, the date legible over it');
  cell = todayCell(draw({ colorToday: '#000000', colorSunday: '#FF0055' }, sunday));
  assert.equal(cell[1], '#FF0055', 'Auto on a Sunday: the Sunday colour');
  cell = todayCell(draw({ colorToday: '#00AAFF' }, friday));
  assert.equal(cell[1], '#00AAFF', 'a picked colour');
  const bw = pw.screenSvg(c.views[0], 0, settings({ layoutPreset: 'compactCal', colorToday: '#00AAFF', colorSunday: '#FF0055' }),
    plat.computeEnv({ platform: 'diorite' }), {}, 0, sunday).svg;
  assert.equal(todayCell(bw)[1], '#FFFFFF', 'a black-and-white watch draws today in its ink');
  assert.doesNotMatch(bw, /#FF0055/, 'and no weekday colours');
});

test('the clock: the samples\' 15:00 in the time colour and the picked face\'s weight', () => {
  const env = plat.computeEnv({ platform: 'basalt' });
  const c = cycle(settings({ layoutPreset: 'noCal', radarMode: 'off', healthMode: 'off' }), 'basalt');
  const clock = (over) => {
    const svg = pw.screenSvg(c.views[0], 0, settings(Object.assign({ layoutPreset: 'noCal' }, over)), env, {}, 0, new Date()).svg;
    return /<text [^>]*font-size="45" fill="([^"]*)"[^>]*font-weight="(\d+)"[^>]*>15:00<\/text>/.exec(svg);
  };
  assert.deepEqual(clock({ colorTime: '#FFFFFF', timeFont: 'roboto' }).slice(1), ['#FFFFFF', '700']);
  assert.deepEqual(clock({ colorTime: '#FFAA00', timeFont: 'leco' }).slice(1), ['#FFAA00', '300']);
  assert.deepEqual(clock({ timeFont: 'bitham' }).slice(2), ['900']);
});

test('a light theme draws black on white, the status rows print the Status bars tab\'s slots', () => {
  const env = plat.computeEnv({ platform: 'basalt' });
  const S = settings({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off', theme: 'light',
    statusForecastLeft: 'city', statusForecastMid: 'empty', statusForecastRight: 'empty' });
  const html = pw.watchPreview(S, env, {});
  assert.match(html, /<rect width="144" height="168" fill="#FFFFFF"><\/rect>/);
  assert.match(html, /fill="#000000" text-anchor="start" font-weight="700"[^>]*>Berlin<\/text>/, 'the city in the left slot');
});

test('a graph\'s pattern and clip ids carry its band\'s suffix, so two graphs never share one', () => {
  const env = plat.computeEnv({ platform: 'basalt' });
  const html = pw.watchPreview(settings({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'all',
    dayNightShading: true }), env, {});
  const ids = (html.match(/ id="[^"]*"/g) || []).map((m) => m.slice(5, -1));
  assert.ok(ids.length > 0, 'the graphs define patterns');
  ids.forEach((id) => assert.match(id, /-w\d+$/, id + ' carries a band suffix'));
  assert.equal(new Set(ids).size, ids.length, 'no id twice');
  (html.match(/url\(#[^)]*\)/g) || []).forEach((u) => assert.ok(ids.indexOf(u.slice(5, -1)) !== -1, u + ' points at a defined id'));
});
