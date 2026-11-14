// test/preview-watch.test.js — the Watchface tab's watch (page/layout/preview-watch.js): every
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
require('../src/pkjs/page/settings/blocks.js');
require('../src/pkjs/page/status-bars/status-slot-icons.js');
const VC = require('../src/pkjs/layout/domain/view-cycle.js');
const plat = require('../src/pkjs/config-ui/lib/platform.js');
const schema = require('../src/pkjs/page/settings/schema.js');
const pw = require('../src/pkjs/page/layout/preview-watch.js');
const onbuild = require('../src/pkjs/page/settings/onbuild.js');

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
  return (html.match(/class="wpv-v[^"]*"[^>]*aria-label="[^"]*"/g) || []).map((m) => /aria-label="([^"]*)"/.exec(m)[1]);
}

test('every preset\'s views sit where the watch places them, the filling graph running to the screen\'s foot', () => {
  // view-cycle.js stackLayout is the watch's placement: scripts/check-fit-lockstep.js holds it
  // to layout.c for every shape, data state and Position.
  ['basalt', 'emery'].forEach((platform) => {
    const f = platform === 'emery' ? 1 : 0, sc = pw.SCREEN[f];
    ['fullCal', 'compactCal', 'compactDense', 'noCal', 'weatherOnly'].forEach((preset) => {
      const c = cycle(settings({ layoutPreset: preset, radarMode: 'graph', healthMode: 'all' }), platform);
      c.views.forEach((spec, i) => {
        if (!spec) { return; }
        const lay = pw.layoutView(spec, f), at = preset + ' ' + platform + ' view ' + i;
        const placed = VC.stackLayout(spec, f, pw.clockInk(null, f, false));
        assert.equal(lay.strip, spec.stripOff ? 0 : [17, 21][f], at + ': the top bar');
        assert.deepEqual(lay.bands.map((b) => b.band), placed.bands.map((b) => b.band), at + ': the bands, in order');
        lay.bands.forEach((b, j) => {
          const fills = j === lay.bands.length - 1 && b.band === placed.fill;
          assert.equal(b.y, placed.bands[j].y, at + ': band ' + b.band + ' where the watch puts it');
          assert.equal(b.y + b.h, fills ? sc.h : placed.bands[j].y + placed.bands[j].h,
            at + ': band ' + b.band + (fills ? ' fills to the foot' : ' as tall as the watch\'s'));
        });
      });
    });
  });
});

test('the Dense screen: the bar above the clock as far under the calendar as the clock is under it', () => {
  // The rows the watch inks (status_metrics.h's Gothic model, the clock's ink from clock_ink.c):
  // the calendar's last digit row, each bar's cap, the clock's digits. On emery the emulator
  // shows them evenly spaced; the page used to seat the bar 3 rows up on the calendar.
  const S = settings({ layoutPreset: 'custom', viewCount: '1', viewTop0: 'cal', viewTopSize0: '2',
    viewUpper0: 'radar', viewLower0: 'weather', viewBody0: 'forecast', viewBodySize0: 'fill', viewOrder0: 'TACB',
    viewAlign0: 'clock', radarMode: 'graph' });
  [['emery', 1, 24, 18, [8, 8, 8]], ['basalt', 0, 18, 14, [5, 6, 6]]].forEach((p) => {
    const env = plat.computeEnv({ platform: p[0] }), f = p[1], large = p[2], ch = p[3];
    const spec = VC.resolveViewCycle(S, env)[0], ink = pw.clockInk(S, f, false);
    const at = {};
    pw.layoutView(spec, f, ink).bands.forEach((b) => { at[b.band] = b; });
    assert.deepEqual(Object.keys(at), ['T', 'A', 'C', 'B', 'G'], p[0] + ': calendar, bar, clock, bar, graph');
    const cell = at.T.y + at.T.h / 2;   // the calendar's second row
    const calInk = (f ? cell + Math.trunc((at.T.h / 2 - large) / 2) - 5 : cell - 5) + large - 1;
    const capTop = (b) => b.y + VC.statusSeatY(b.h, ch) + ch - (Math.trunc(ch / 2) + 2);
    const capBottom = (b) => capTop(b) + Math.trunc(ch / 2) + 1;
    const clockTop = at.C.y + Math.trunc(at.C.h / 2) + ink.centreOff - Math.trunc(ink.inkH / 2);
    assert.deepEqual([capTop(at.A) - calInk - 1, clockTop - capBottom(at.A) - 1, capTop(at.B) - (clockTop + ink.inkH)],
      p[4], p[0] + ': blank rows calendar | bar | clock | bar');
  });
});

test('each screen is named and spoken band by band, and a tap opens its editor', () => {
  const S = settings({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'all' });
  const env = plat.computeEnv({ platform: 'basalt' });
  const html = pw.watchPreview(S, env, {});
  assert.deepEqual(labels(html), [
    'Edit Default: Watch bar, Calendar (2 rows), Clock, Forecast bar, Forecast',
    'Edit Flick 1: Watch bar, Clock, Health bar, Health graph',
    'Edit Flick 2: Watch bar, Clock, Radar bar, Radar'
  ]);
  // Each is a button that opens its screen's editor (screens-page.js openScreen).
  assert.deepEqual((html.match(/<button type="button" class="wpv-v wpv-btn" data-action="openScreen" data-action-arg="\d"/g)
    || []).map((b) => b.slice(-2, -1)), ['0', '1', '2']);
  assert.match(html, /<\/div><span class="wpv-tap">Tap a screen to edit it<\/span>$/, 'and the pin says so');
  assert.deepEqual(labels(pw.watchPreview(settings({ layoutPreset: 'fullCal', radarMode: 'off', healthMode: 'off' }), env, {})),
    ['Edit Default: Watch bar, Calendar (3 rows), Clock, Forecast bar, Forecast'], 'one view, one screen');
  assert.match(html, /^<div class="wpv n3" role="group" aria-label="Your watch">/);
  // aplite has no screen editor: its one screen is a picture.
  const aplite = plat.computeEnv({ platform: 'aplite' });
  const one = pw.watchPreview(settings({ layoutPreset: 'fullCal', radarMode: 'off', healthMode: 'off' }), aplite, {});
  assert.equal(one.indexOf('data-action="openScreen"'), -1);
  assert.equal(one.indexOf('wpv-tap'), -1);
  assert.match(one, /class="wpv-v" role="img" aria-label="Default: /);
});

test('each view is a card of its own, the screen edge to edge on its own background, pinned bare', () => {
  const env = plat.computeEnv({ platform: 'basalt' });
  const cards = (S) => pw.watchPreview(S, env, {}).match(/<div class="wpv-card" style="background:([^"]*)"><svg class="wpv-scr"/g) || [];
  const dark = cards(settings({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'all' }));
  assert.equal(dark.length, 3, 'three cards');
  dark.forEach((c) => assert.match(c, /background:#000000/, 'a dark watch: black cards'));
  cards(settings({ layoutPreset: 'compactCal', theme: 'light' })).forEach((c) => assert.match(c, /background:#FFFFFF/));
  const watchface = schema.tabs.find((t) => t.id === 'watchface');
  assert.equal(watchface.pinBare, true, 'the tab pins the block without a card of its own');
  const body = eng.renderBody(schema, 'watchface', { S: settings(), ENV: env, USERDATA: {}, collapsed: {},
    evalCtx: Object.assign({}, settings(), { env: env }), schema: schema, moreOpen: {} });
  assert.match(body, /<div class="pin-blk bare"><div class="wpv /);
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
  assert.match(aplite, /viewBox="-9 -9 162 186"/);
  assert.match(pw.watchPreview(S, plat.computeEnv({ platform: 'emery' }), {}), /viewBox="-12 -12 224 252"/);
});

test('the calendar: its week as Start week on says, today in its cell, Auto taking the weekday\'s colour', () => {
  const env = plat.computeEnv({ platform: 'basalt' });
  const c = cycle(settings({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off' }), 'basalt');
  const friday = new Date(2026, 10, 6), sunday = new Date(2026, 10, 8);
  // The strip's left slot emptied (its air quality is a number too): the first numbers drawn are
  // the calendar's.
  const draw = (over, now) => pw.screenSvg(c.views[0], 0,
    settings(Object.assign({ layoutPreset: 'compactCal', statusTopLeft: 'empty' }, over)), env, {}, 0, now).svg;
  // Today's cell: the watch's fill_rect with corner radius 1 (calendar_layer.c), its date on it.
  const todayCell = (svg) => /<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" rx="1" fill="([^"]*)"><\/rect><text[^>]*fill="([^"]*)"[^>]*>(\d+)</.exec(svg);
  // A Monday start puts Friday the 6th fifth in its row; a Sunday start sixth.
  const firstRow = (svg) => (svg.match(/>(\d+)<\/text>/g) || []).slice(0, 7).map((t) => t.replace(/\D/g, ''));
  assert.deepEqual(firstRow(draw({ weekStartDay: 'mon' }, friday)), ['2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(firstRow(draw({ weekStartDay: 'sun' }, friday)), ['1', '2', '3', '4', '5', '6', '7']);
  let cell = todayCell(draw({ colorToday: '#000000' }, friday));
  assert.deepEqual([cell[1], cell[2], cell[3]], ['#FFFFFF', '#000000', '6'], 'Auto on a weekday: the ink, the date legible over it');
  // A picture of the screen shows each colour as the display does (preview-svg.js displayColors):
  // #FF0055 as #E25874, #00AAFF as #4CB4DB; black and white as they are.
  cell = todayCell(draw({ colorToday: '#000000', colorSunday: '#FF0055' }, sunday));
  assert.equal(cell[1], '#E25874', 'Auto on a Sunday: the Sunday colour');
  cell = todayCell(draw({ colorToday: '#00AAFF' }, friday));
  assert.equal(cell[1], '#4CB4DB', 'a picked colour');
  const bw = pw.screenSvg(c.views[0], 0, settings({ layoutPreset: 'compactCal', colorToday: '#00AAFF', colorSunday: '#FF0055' }),
    plat.computeEnv({ platform: 'diorite' }), {}, 0, sunday).svg;
  assert.equal(todayCell(bw)[1], '#FFFFFF', 'a black-and-white watch draws today in its ink');
  assert.doesNotMatch(bw, /#FF0055|#E25874/, 'and no weekday colours');
});

test('the clock: the samples\' 15:00 in the time colour and the picked face\'s weight', () => {
  const env = plat.computeEnv({ platform: 'basalt' });
  const c = cycle(settings({ layoutPreset: 'noCal', radarMode: 'off', healthMode: 'off' }), 'basalt');
  const svg = (over) => pw.screenSvg(c.views[0], 0, settings(Object.assign({ layoutPreset: 'noCal' }, over)), env, {}, 0, new Date()).svg;
  // Roboto and Bitham: the watch's glyph images, tinted (test/clock-glyphs-page.test.js has the
  // seating) in the colour as the screen shows it: #FFAA00 as #F1AA86 (displayColors).
  const tint = (over) => (/<feFlood flood-color="([^"]*)">/.exec(svg(over)) || [])[1];
  assert.equal(tint({ colorTime: '#FFFFFF', timeFont: 'roboto' }), '#FFFFFF');
  assert.equal(tint({ colorTime: '#FFAA00', timeFont: 'bitham' }), '#F1AA86');
  assert.equal((svg({ timeFont: 'bitham' }).match(/<image /g) || []).length, 5);
  // LECO: the watch's system font, tinted the same way.
  assert.equal(tint({ colorTime: '#FFAA00', timeFont: 'leco' }), '#F1AA86');
  assert.equal((svg({ timeFont: 'leco' }).match(/<image /g) || []).length, 5);
  assert.equal(svg({ timeFont: 'leco' }).indexOf('>15:00</text>'), -1, 'no stand-in text');
});

test('a light theme draws black on white, the status rows print the Status bars tab\'s slots', () => {
  const env = plat.computeEnv({ platform: 'basalt' });
  const S = settings({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off', theme: 'light',
    statusForecastLeft: 'city', statusForecastMid: 'empty', statusForecastRight: 'empty' });
  const html = pw.watchPreview(S, env, {});
  assert.match(html, /<rect x="-9" y="-9" width="162" height="186" fill="#FFFFFF"><\/rect>/);
  // In the watch's Gothic 18, regular as status_row.c row_font draws a slot under no threshold.
  assert.match(html, /fill="#000000" font-family="WatchGothic18[^"]*" font-weight="400">Berlin<\/text>/, 'the city in the left slot');
});

// The owner's, 2026-11-14: a side slot's weather condition shows its whole name beside an empty
// or a short middle, and gives way to the middle's text (status_row.c swap_in_short_forms).
test('a side slot\'s weather condition: the whole name beside an empty middle, the short form beside a long one', () => {
  const draw = (platform, mid) => pw.watchPreview(settings({ layoutPreset: 'compactCal', radarMode: 'off',
    healthMode: 'off', statusForecastLeft: 'condition', statusForecastMid: mid, statusForecastRight: 'empty',
    citySlotIcon: true }),
  plat.computeEnv({ platform: platform }), {});
  const shows = (html, text) => html.indexOf('>' + text + '</text>') !== -1;
  ['basalt', 'emery'].forEach((platform) => {
    assert.ok(shows(draw(platform, 'empty'), 'Partly cloudy'), platform + ': the whole name beside an empty middle');
    assert.ok(!shows(draw(platform, 'empty'), 'PCLDY'), platform);
    assert.ok(shows(draw(platform, 'temp'), 'Partly cloudy'), platform + ': and beside a short one');
  });
  // Beside the city's name the 144 px watches have no room for both: the condition gives way,
  // the city stays whole. The Pebble Time 2 holds both.
  const basalt = draw('basalt', 'city');
  assert.ok(shows(basalt, 'PCLDY') && shows(basalt, 'Berlin') && !shows(basalt, 'Partly cloudy'), 'basalt: PCLDY and Berlin');
  const emery = draw('emery', 'city');
  assert.ok(shows(emery, 'Partly cloudy') && shows(emery, 'Berlin'), 'emery: both whole');
});

// The Status bars tab's bar pictures print the text the watch shows: the short form where
// the watch's row swaps it in, not the whole name cut short by the page.
test('the Status bars tab\'s bar pictures print the short form where the watch does', () => {
  const sbp = require('../src/pkjs/page/status-bars/preview-status-bars.js');
  const S = settings({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off',
    statusForecastLeft: 'condition', statusForecastMid: 'city', statusForecastRight: 'empty', citySlotIcon: true });
  const pictures = (platform) => {
    const env = plat.computeEnv({ platform: platform });
    return [sbp.barPicture(S, env, 'forecast', { big: true }), sbp.statusBarsPreview(S, env)];
  };
  pictures('basalt').forEach((html) => {
    assert.ok(html.indexOf('PCLDY') !== -1 && html.indexOf('Berlin') !== -1, 'basalt: PCLDY and Berlin');
    assert.equal(html.indexOf('Partly cloudy'), -1, 'basalt: not the whole name');
  });
  pictures('emery').forEach((html) => {
    assert.ok(html.indexOf('Partly cloudy') !== -1 && html.indexOf('Berlin') !== -1, 'emery: both whole');
  });
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

/**
 * The tab body the engine renders for the Watchface tab.
 * @param {Object} S Settings.
 * @param {!Object} env Platform env.
 * @returns {string} HTML.
 */
function watchfaceBody(S, env) {
  onbuild.onLoad({ env: env, get: (k) => S[k], set: (k, v) => { S[k] = v; }, getInitial: (k) => S[k] });
  return eng.renderBody(schema, 'watchface', { S: S, ENV: env, USERDATA: {}, collapsed: {},
    evalCtx: Object.assign({}, S, { env: env }) });
}

// The Layout card's preset row is a list of names (the owner, 2026-11-06): the pinned watch at
// the top of the tab already draws the views the picked preset gives. Only aplite has the card
// now; every other watch edits its screens.
test('only aplite has a Layout card: its three calendars by name, with no pictures', () => {
  [['basalt', 0], ['emery', 0], ['diorite', 0], ['aplite', 3]].forEach((p) => {
    const env = plat.computeEnv({ platform: p[0] });
    const html = watchfaceBody(settings({ layoutPreset: 'fullCal', radarMode: 'graph', healthMode: 'all' }), env);
    const opts = html.match(/data-k="layoutPreset" data-v="[^"]*"/g) || [];
    assert.equal(opts.length, p[1], p[0] + ': one option per offered preset');
    assert.ok(!/class="pic( on)?" role="radio" aria-checked="(true|false)" data-k="layoutPreset"/.test(html),
      p[0] + ': no picture cards for the presets');
    assert.ok(/class="pic( on)?" role="radio" aria-checked="(true|false)" data-k="timeFont"/.test(html),
      p[0] + ': the Clock font row keeps its pictures');
  });
  assert.equal(global.PConf.pictureResolvers.get('layoutPresetPicture'), undefined, 'no preset picture resolver');
});

test('the calendar marks the holidays the phone holds for the picked country, in the holiday colour', () => {
  const env = plat.computeEnv({ platform: 'basalt' });
  const now = new Date(2026, 10, 6);   // a Friday
  const holidays = { country: 'DE', years: { 2026: [['11-03', null], ['11-11', ['DE-BY']]] } };
  const cal = (over, ud) => {
    const S = settings(Object.assign({ layoutPreset: 'fullCal', radarMode: 'off', healthMode: 'off',
      holidayCountry: 'DE', holidayRegion: 'all', weekStartDay: 'mon', colorUSFederal: '#0055FF' }, over));
    return pw.screenSvg(VC.resolveViewCycle(S, env)[0], 0, S, env, ud === undefined ? { holidays: holidays } : ud, 0, now).svg;
  };
  const day = (svg, n) => (new RegExp('fill="([^"]*)" font-family="[^"]*" font-weight="(\\d+)">' + n + '</text>').exec(svg) || []).slice(1);
  // #0055FF as the screen shows it (displayColors).
  assert.deepEqual(day(cal({}), 3), ['#007DCE', '700'], 'a nationwide holiday: its colour, bold');
  assert.deepEqual(day(cal({}), 11), ['#FFFFFF', '400'], 'a regional one is not the whole country\'s');
  assert.deepEqual(day(cal({ holidayRegion: 'DE-BY' }), 11), ['#007DCE', '700'], 'but is its region\'s');
  assert.deepEqual(day(cal({ holidayCountry: 'AT' }), 3), ['#FFFFFF', '400'], 'another country: nothing held');
  assert.deepEqual(day(cal({ holidaysEnabled: false }), 3), ['#FFFFFF', '400'], 'Holiday highlight off');
  assert.deepEqual(day(cal({}, {}), 3), ['#FFFFFF', '400'], 'nothing cached');
  assert.deepEqual(day(cal({ theme: 'bw' }), 3), ['#FFFFFF', '700'], 'a B/W theme: the ink, still bold');
});

test('each screen sits in a margin of its own ground, so a card\'s round corners clip nothing on it', () => {
  // The owner, 2026-11-06: the corners cut the top bar's edge slots (W45, 19:14). The ground
  // runs on round the screen, about 6 % of its width, and the card is that colour throughout.
  [['basalt', 144, 168, 9], ['emery', 200, 228, 12]].forEach((p) => {
    const env = plat.computeEnv({ platform: p[0] });
    const S = settings({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off', theme: 'light' });
    const svg = pw.screenSvg(VC.resolveViewCycle(S, env)[0], 0, S, env, {}, p[0] === 'emery' ? 1 : 0, new Date()).svg;
    const m = p[3], vb = [-m, -m, p[1] + 2 * m, p[2] + 2 * m].join(' ');
    assert.ok(svg.indexOf('<svg class="wpv-scr" viewBox="' + vb + '"') === 0, p[0] + ': ' + svg.slice(0, 70));
    assert.ok(svg.indexOf('<rect x="' + (-m) + '" y="' + (-m) + '" width="' + (p[1] + 2 * m) + '" height="'
      + (p[2] + 2 * m) + '" fill="#FFFFFF"></rect>') > 0, p[0] + ': the ground fills the margin');
    assert.ok(m / p[1] >= 0.06, p[0] + ': a card 90 px wide keeps over 5 px of it, past a 12 px corner\'s reach');
  });
  const html = pw.watchPreview(settings({ theme: 'light' }), plat.computeEnv({ platform: 'basalt' }), {});
  assert.match(html, /<div class="wpv-card" style="background:#FFFFFF">/, 'the card is the screen\'s white');
});
