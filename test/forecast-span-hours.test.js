'use strict';

// The long time span's label (src/pkjs/forecast-span-hours.js): the whole hours the watch shows
// for the provider's feed and the layout. The count is the watch's rule
// (src/c/appendix/forecast_span.h forecast_span_whole). The full parity runs under
// scripts/test-c.sh, not here: test/c/forecast_span_dump.c prints the watch's count for every
// n 27..68 on every plot width 145..200 and scripts/check-forecast-span-lockstep.js holds
// wholeHours to each. Here, every plot width the page computes is held inside that range, and
// the geometry constants are pinned against the C sources they name.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const spanHours = require('../src/pkjs/forecast-span-hours.js');
const forecastAxis = require('../src/pkjs/forecast-axis.js');
const hourlyWindow = require('../src/pkjs/weather/hourly-window.js');
const schema = require('../src/pkjs/settings/schema.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const { cDefine } = require('./helpers/c-source.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const C_TEST = read('test/c/forecast_span_test.c');
const DUMP = read('test/c/forecast_span_dump.c');
const SPAN_H = read('src/c/appendix/forecast_span.h');

// emery's settings-page env (config-ui platform.js computeEnv): health and custom layouts.
const EMERY = platform.computeEnv({ platform: 'emery' });
// A custom layout of one view, the health graph in the top band over the forecast body: the
// two share the screen, so the forecast keeps the health labels' strip with the numbers On
// graph or Off (forecast_layer.c graph_left, bottom_view_other_consumer_shown).
const SHARED_VIEW = {
  layoutPreset: 'custom', healthMode: 'all', viewCount: '1', viewTop0: 'health', viewBody0: 'forecast'
};

// The lockstep's plot widths (test/c/forecast_span_dump.c W_MIN .. W_MAX) and emery's screen.
const W_MIN = cDefine(DUMP, 'W_MIN');
const W_MAX = cDefine(DUMP, 'W_MAX');
const SCREEN_W = cDefine(C_TEST, 'EMERY_SCREEN_W');

test('the lockstep covers every plot width the page computes', () => {
  // Each numbers place and font, with and without the health graph, and with it beside the
  // forecast.
  ['axis', 'graph', 'off'].forEach((numbers) => [true, false].forEach((largeGraphFont) => {
    [{}, { healthMode: 'all' }, SHARED_VIEW].forEach((layout) => {
      const s = Object.assign({ forecastAxisNumbers: numbers, largeGraphFont: largeGraphFont }, layout);
      const w = spanHours.plotWidth(s, EMERY);
      assert.ok(w >= W_MIN && w <= W_MAX, JSON.stringify(s) + ': W ' + w + ' is in the lockstep');
    });
  }));
});

test('the geometry is the watch\'s', () => {
  assert.equal(spanHours.FULL_HOURS, hourlyWindow.MAX_FORECAST_HOURS);
  assert.equal(spanHours.SCREEN_W, SCREEN_W);
  assert.equal(spanHours.LAYER_W, cDefine(C_TEST, 'EMERY_W'));
  const bottomViewH = read('src/c/appendix/bottom_view.h');
  assert.equal(spanHours.STRIP_MIN_W, cDefine(bottomViewH, 'BOTTOM_VIEW_LABEL_STRIP_MIN_W'));
  assert.equal(spanHours.STRIP_GAP, cDefine(bottomViewH, 'BOTTOM_VIEW_LABEL_GAP'));
  assert.equal(spanHours.LABEL_PAD, cDefine(read('src/c/layers/forecast_layer.c'), 'TEMP_LABEL_PAD'));
  // The hi/lo labels' font: GOTHIC_24 with Larger graph fonts, else GOTHIC_18; GOTHIC_18's
  // digit advance is the one the hour labels use with Larger graph fonts.
  assert.match(read('src/c/appendix/bottom_view.c'),
    /config_large_graph_font\(\) \? FONT_KEY_GOTHIC_24\s*: FONT_KEY_GOTHIC_18/);
  assert.match(SPAN_H, /#define FORECAST_LABEL_ADVANCE\(large\) \(\(large\) \? 7 : 6\)/);
  assert.equal(spanHours.DIGIT_W.small, 7);
  assert.equal(spanHours.DIGIT_W.large, 9);
  // The health graph's step mark: one decimal ("0.5", "1.5"), reported with no pad, into a
  // strip that is the wider of the two graphs' claims. Its '.' is 4 px in GOTHIC_24 and 3 px in
  // GOTHIC_18: emery's default screen (FX-s3-f48-axis, the health graph in the cycle) draws its
  // forecast plot from graph_left 24 (strip 22 = 9 + 4 + 9, wider than the hi/lo labels' 20), and
  // without Larger graph fonts from 19 (strip 17 = 7 + 3 + 7, wider than 16).
  const healthC = read('src/c/layers/health_graph_layer.c');
  assert.match(healthC, /snprintf\(out, out_sz, "%d\.%d", whole, frac\)/);
  assert.match(healthC, /bottom_view_report_label_w\(BOTTOM_VIEW_SRC_HEALTH, max_w\);/);
  const bottomViewC = read('src/c/appendix/bottom_view.c');
  assert.match(bottomViewC, /s_reported_w\[BOTTOM_VIEW_SRC_FORECAST\] > w\) w = /);
  assert.match(bottomViewC, /s_reported_w\[BOTTOM_VIEW_SRC_HEALTH\]\s+> w\) w = /);
  assert.equal(spanHours.DOT_W.large, 4);
  assert.equal(spanHours.DOT_W.small, 3);
  // A forecast with no left axis keeps the shared strip while the other graph is on its screen.
  assert.match(read('src/c/layers/forecast_layer.c'),
    /graph_left = \(axis_on \|\| bottom_view_other_consumer_shown\(layer\)\)\s*\? bottom_view_graph_inset\(\) : screen_left;/);
  // The long class's pitch.
  assert.equal(spanHours.SLOT_ONE, 1 << cDefine(read('src/c/appendix/slot_x.h'), 'SLOT_X_Q'));
  assert.equal(spanHours.PITCH_MIN, cDefine(SPAN_H, 'FORECAST_SPAN_LONG_PITCH_MIN'));
  assert.equal(spanHours.PITCH_MAX, cDefine(SPAN_H, 'FORECAST_SPAN_LONG_PITCH_MAX'));
  assert.equal(spanHours.PAD_FROM, cDefine(SPAN_H, 'FORECAST_SPAN_LONG_PAD_FROM'));
});

test('plotWidth: the whole screen with no left axis, else the layer less a two-digit label strip', () => {
  assert.equal(spanHours.plotWidth({ largeGraphFont: true }), 176, 'GOTHIC_24: 2 * 9 + 2 = 20, gap 2');
  assert.equal(spanHours.plotWidth({ largeGraphFont: false }), 180, 'GOTHIC_18: 2 * 7 + 2 = 16, gap 2');
  assert.equal(spanHours.plotWidth({ forecastAxisNumbers: 'axis', largeGraphFont: true }), 176);
  ['graph', 'off'].forEach((numbers) => [true, false].forEach((large) => {
    assert.equal(spanHours.plotWidth({ forecastAxisNumbers: numbers, largeGraphFont: large }), 200,
      numbers + ' ' + large);
  }));
  // The betas' 'beside' and junk read as On axis (forecast-axis.js numbers).
  assert.equal(spanHours.plotWidth({ forecastAxisNumbers: 'beside', largeGraphFont: true }), 176);
  assert.equal(forecastAxis.numbers({ forecastAxisNumbers: 'beside' }), forecastAxis.AXIS);
  assert.equal(spanHours.plotWidth(null), 180, 'nothing stored: no Larger graph fonts, On axis');
});

test('plotWidth: the health graph\'s step mark widens the shared strip On axis', () => {
  // Health Status + Graph (the default) puts the health graph in every preset's cycle: its
  // "0.5" mark (22 px / 17 px) is wider than the two-digit hi/lo label (20 px / 16 px).
  assert.equal(spanHours.plotWidth({ largeGraphFont: true, healthMode: 'all' }, EMERY), 174);
  assert.equal(spanHours.plotWidth({ largeGraphFont: false, healthMode: 'all' }, EMERY), 179);
  // The other Health modes compile no graph view (view-cycle.js), so no claim.
  ['off', 'slot', 'status'].forEach((healthMode) => [[true, 176], [false, 180]].forEach(([large, w]) => {
    assert.equal(spanHours.plotWidth({ largeGraphFont: large, healthMode: healthMode }, EMERY), w,
      healthMode + ' ' + large);
  }));
  // Every preset carries it, Weather only too.
  ['fullCal', 'compactCal', 'compactDense', 'noCal', 'weatherOnly'].forEach((layoutPreset) => {
    const s = { layoutPreset: layoutPreset, healthMode: 'all', largeGraphFont: false };
    assert.deepEqual(spanHours.healthGraph(s, EMERY), { shown: true, beside: false }, layoutPreset);
    assert.equal(spanHours.plotWidth(s, EMERY), 179, layoutPreset);
  });
  // A watch without health never draws it; no env (or no health fact) reads as capable.
  const noHealth = Object.assign({}, EMERY, { health: false });
  assert.equal(spanHours.plotWidth({ largeGraphFont: false, healthMode: 'all' }, noHealth), 180);
  assert.equal(spanHours.plotWidth({ largeGraphFont: false, healthMode: 'all' }), 179);
  assert.equal(spanHours.plotWidth({ largeGraphFont: false, healthMode: 'all' }, { platform: 'emery' }), 179);
  // With no left axis a forecast alone on its view spans the screen, the health graph elsewhere.
  ['graph', 'off'].forEach((numbers) => [true, false].forEach((large) => {
    assert.equal(spanHours.plotWidth({ forecastAxisNumbers: numbers, largeGraphFont: large,
      healthMode: 'all' }, EMERY), 200, numbers + ' ' + large);
  }));
});

test('plotWidth: a custom view seating the health graph beside the forecast keeps its strip', () => {
  ['graph', 'off'].forEach((numbers) => {
    // Either band order: the health graph on top of the forecast, or under it.
    [SHARED_VIEW, Object.assign({}, SHARED_VIEW, { viewTop0: 'forecast', viewBody0: 'health' })]
      .forEach((layout) => {
        const s = (large) => Object.assign({ forecastAxisNumbers: numbers, largeGraphFont: large }, layout);
        assert.deepEqual(spanHours.healthGraph(s(true), EMERY), { shown: true, beside: true });
        assert.equal(spanHours.plotWidth(s(true), EMERY), 174, numbers + ' G24');
        assert.equal(spanHours.plotWidth(s(false), EMERY), 179, numbers + ' G18');
        assert.equal(spanHours.longHours(Object.assign({ provider: 'dwd' }, s(true)), EMERY), 58);
        assert.equal(spanHours.longHours(Object.assign({ provider: 'dwd' }, s(false)), EMERY), 59);
        // Without Status + Graph the compiler folds the health seat away: the screen again.
        assert.equal(spanHours.plotWidth(Object.assign(s(true), { healthMode: 'status' }), EMERY), 200);
        // A watch without health: the screen again.
        assert.equal(spanHours.plotWidth(s(true), Object.assign({}, EMERY, { health: false })), 200);
      });
    // On axis the strip is the same on every view.
    assert.equal(spanHours.plotWidth(Object.assign({ largeGraphFont: true }, SHARED_VIEW), EMERY), 174);
  });
  // The views can disagree; the label takes the forecast's first view in the cycle, the
  // Default view when it shows the forecast (the view the watch returns to). The
  // custom-two-graphs fixture: the Default view's forecast alone (the whole screen), views 2
  // and 3 beside the health graph (the strip).
  const two = JSON.parse(read('fixtures/custom-two-graphs.json')).claySettings;
  assert.deepEqual([two.viewTop0, two.viewBody0, two.viewTop1, two.viewBody1, two.viewTop2, two.viewBody2],
    ['cal2', 'forecast', 'health', 'forecast', 'forecast', 'health']);
  const off = Object.assign({}, two, { forecastAxisNumbers: 'off', largeGraphFont: true });
  assert.deepEqual(spanHours.healthGraph(off, EMERY), { shown: true, beside: false });
  assert.equal(spanHours.plotWidth(off, EMERY), 200);
  assert.equal(spanHours.longHours(off, EMERY), 66);
  // Its Default view without the forecast: the first view that shows it is the shared one.
  const noFirst = Object.assign({}, off, { viewBody0: 'none' });
  assert.deepEqual(spanHours.healthGraph(noFirst, EMERY), { shown: true, beside: true });
  assert.equal(spanHours.longHours(noFirst, EMERY), 58);
  // On axis every view keeps the strip: the fixture's own font (GOTHIC_18), 59.
  assert.equal(spanHours.longHours(two, EMERY), 59);
  // A disabled flick view (null in the cycle: nothing left on it) is skipped: the first view
  // that shows the forecast is then the third, the forecast's graph top over the health body.
  const gap = Object.assign({}, noFirst, { viewClockOff1: true, viewStripOff1: true, viewTop1: 'none',
    viewBody1: 'none', viewUpper1: 'off', viewLower1: 'off' });
  const cycle = require('../src/pkjs/view-cycle.js').resolveViewCycle(gap, EMERY);
  assert.equal(cycle[1], null, 'the emptied flick view compiles to a disabled slot');
  assert.deepEqual(spanHours.healthGraph(gap, EMERY), { shown: true, beside: true });
  assert.equal(spanHours.longHours(gap, EMERY), 58);
});

test('feedHours: OpenWeatherMap 48, Weather Underground 49, every other provider the full 68', () => {
  const providerItem = schema.tabs.reduce((acc, t) => acc.concat(...t.sections.map((s) => s.items)), [])
    .find((it) => it.messageKey === 'provider');
  const ids = providerItem.options.map((o) => o[1]);
  assert.deepEqual(ids.slice().sort(),
    ['dwd', 'metno', 'openmeteo', 'openweathermap', 'tomorrowio', 'wunderground', 'yandex']);
  Object.keys(spanHours.PROVIDER_HOURS).forEach((id) => assert.ok(ids.includes(id), id + ' is a provider'));
  const want = { openweathermap: 48, wunderground: 49 };
  ids.forEach((id) => assert.equal(spanHours.feedHours({ provider: id }), want[id] || 68, id));
  // The short feeds' sources: WU's 48-hour endpoint plus the hour in progress the anchor
  // prepends; OWM's One Call 3.0 hourly list (48 hours: test/openweathermap.test.js sends 48
  // at the long span).
  assert.match(read('src/pkjs/weather/wunderground.js'), /\/forecast\/hourly\/48hour\.json/);
  assert.match(read('src/pkjs/weather/openweathermap.js'), /data\/3\.0\/onecall/);
  // Unknown, absent and inherited ids read as the full feed.
  [{ provider: 'nope' }, { provider: 'toString' }, { provider: '__proto__' }, {}, null, undefined,
    { provider: 48 }].forEach((s) => assert.equal(spanHours.feedHours(s), 68, JSON.stringify(s)));
});

test('longHours and spanOptions: the label for each provider and layout', () => {
  const FULL = ['dwd', 'metno', 'openmeteo', 'tomorrowio', 'yandex', 'nope', undefined];
  const layouts = [
    // [settings, a full feed's label]
    [{ largeGraphFont: true, healthMode: 'all' }, 58],                  // the default layout
    [{ largeGraphFont: true }, 58],                                     // no health graph
    [{ largeGraphFont: true, forecastAxisNumbers: 'axis' }, 58],
    [{ largeGraphFont: false, healthMode: 'all' }, 59],                 // GOTHIC_18, health mark
    [{ largeGraphFont: false }, 60],                                    // GOTHIC_18 labels
    [{ largeGraphFont: false, healthMode: 'status' }, 60],
    [{ largeGraphFont: true, forecastAxisNumbers: 'graph' }, 66],
    [{ largeGraphFont: true, forecastAxisNumbers: 'off' }, 66],
    [{ largeGraphFont: true, forecastAxisNumbers: 'off', healthMode: 'all' }, 66],
    [{ largeGraphFont: false, forecastAxisNumbers: 'off' }, 66],
    [Object.assign({ largeGraphFont: true, forecastAxisNumbers: 'off' }, SHARED_VIEW), 58],
    [Object.assign({ largeGraphFont: false, forecastAxisNumbers: 'graph' }, SHARED_VIEW), 59]
  ];
  layouts.forEach(([layout, full]) => {
    FULL.forEach((provider) => {
      const s = Object.assign({ provider: provider }, layout);
      assert.equal(spanHours.longHours(s, EMERY), full, JSON.stringify(s));
      assert.deepEqual(spanHours.spanOptions(s, EMERY),
        [['12 h', '12'], ['24 h', '24'], [full + ' h', '48']]);
    });
    // The short feeds fill every layout: 47 and 48 whole hours.
    assert.equal(spanHours.longHours(Object.assign({ provider: 'openweathermap' }, layout), EMERY), 47);
    assert.equal(spanHours.longHours(Object.assign({ provider: 'wunderground' }, layout), EMERY), 48);
  });
  assert.deepEqual(spanHours.spanOptions({ provider: 'openweathermap', largeGraphFont: true }),
    [['12 h', '12'], ['24 h', '24'], ['47 h', '48']]);
  assert.deepEqual(spanHours.spanOptions({ provider: 'wunderground', largeGraphFont: true }),
    [['12 h', '12'], ['24 h', '24'], ['48 h', '48']]);
});
