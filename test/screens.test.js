// test/screens.test.js — the screens as lists (src/pkjs/layout/domain/screens.js): the editor's rules, the
// natural places "+ Add" puts a block, the compile to the custom layout's per-view keys and
// its inverse (checked on the settings page's own watch pictures, page/layout/preview-watch.js),
// the fit check and the modes worked out from the screens.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/page/settings/blocks.js');
const vc = require('../src/pkjs/layout/domain/view-cycle.js');
const M = require('../src/pkjs/layout/domain/screens.js');
const pw = require('../src/pkjs/page/layout/preview-watch.js');
const platformLib = require('../src/pkjs/config-ui/lib/platform.js');

const NOW = new Date(2026, 8, 7, 15, 0);
const BASALT = platformLib.computeEnv({ platform: 'basalt' });
const EMERY = platformLib.computeEnv({ platform: 'emery' });
const APLITE = platformLib.computeEnv({ platform: 'aplite' });

const b = (k, opt) => Object.assign({ k }, opt || {});
// The mockup's three screens: today's default cycle (compactCal, health all, radar graph, swap).
const DEFAULT = [b('strip'), b('cal', { rows: '2' }), b('clock'), b('fcbar'), b('fc', { size: 'fill' })];
const HEALTH = [b('strip'), b('clock'), b('healthbar'), b('health', { size: 'fill' })];
const RADAR = [b('strip'), b('clock'), b('radarbar'), b('radar', { size: 'fill' })];
const kinds = (list) => list.map((x) => x.k);

/**
 * A view as the settings page's watch preview draws it.
 * @param {?Object} spec The compiled view.
 * @param {number} i Its slot.
 * @param {Object} env Platform env.
 * @returns {string} the picture's markup ('null' for a disabled view)
 */
function picture(spec, i, env) {
  return spec ? pw.screenSvg(spec, i, {}, env, {}, env.platform === 'emery' ? 1 : 0, NOW, 'p').svg : 'null';
}

/**
 * Every screen's keys, as the settings store them: the custom layout, the screen count,
 * each screen's view keys (compileKeys).
 * @param {Array<Array<Object>>} screens The screens, the Default first.
 * @returns {Object} key -> value
 */
function compileAll(screens) {
  const keys = { layoutPreset: 'custom', viewCount: String(screens.length) };
  screens.forEach((list, i) => Object.assign(keys, M.compileKeys(list, i)));
  return keys;
}

/**
 * The screens' views, compiled with every seat kind on (the modes follow the screens).
 * @param {Array<Array<Object>>} screens The screens.
 * @returns {Array<?Object>}
 */
function compiled(screens) {
  return vc.screensCycle(compileAll(screens));
}

test('barOfBlock: the bar a row shows, the Watch bar\'s too; none for any other row', () => {
  assert.equal(M.barOfBlock({ k: 'strip' }), 'top');
  assert.equal(M.barOfBlock({ k: 'fcbar' }), 'forecast');
  assert.equal(M.barOfBlock({ k: 'radarbar' }), 'radar');
  assert.equal(M.barOfBlock({ k: 'healthbar' }), 'health');
  assert.equal(M.barOfBlock({ k: 'bar4' }), 'bar4');
  ['cal', 'clock', 'fc', 'radar', 'health'].forEach((k) => assert.equal(M.barOfBlock({ k }), null, k));
  assert.equal(M.barOfBlock(null), null);
});

test('the default screens compile to exactly today\'s default cycle, picture for picture', () => {
  const today = vc.buildViewCycle('compactCal', 'all', 'graph', true);
  const mine = compiled([DEFAULT, HEALTH, RADAR]);
  [BASALT, EMERY].forEach((env) => today.forEach((spec, i) =>
    assert.equal(picture(mine[i], i, env), picture(spec, i, env), env.platform + ' view ' + i)));
});

test('every preset view reads back as a list that compiles to the same picture', () => {
  let n = 0;
  ['fullCal', 'compactCal', 'compactDense', 'noCal', 'weatherOnly'].forEach((preset) =>
    ['off', 'slot', 'status', 'all'].forEach((health) =>
      ['off', 'countdown', 'status', 'graph'].forEach((radar) => [false, true].forEach((swap) => {
        const cycle = vc.buildViewCycle(preset, health, radar, swap);
        const back = compiled(cycle.map((spec) => M.listFromSpec(spec, true)));
        [BASALT, EMERY].forEach((env) => cycle.forEach((spec, i) => {
          n++;
          assert.equal(picture(back[i], i, env), picture(spec, i, env),
            [preset, health, radar, swap, i, env.platform].join(' '));
        }));
      }))));
  assert.ok(n > 500, n + ' views');
});

/**
 * Whether a view draws a graph in its top seat as its last band, with no body: the one shape
 * a list cannot hold, since its last graph row is the bottom graph.
 * @param {?Object} spec The compiled view.
 * @returns {boolean}
 */
function topGraphLast(spec) {
  if (!spec || spec.body !== vc.BODY_NONE || (spec.top !== vc.TOP_RADAR && spec.top !== vc.TOP_GRAPH)) { return false; }
  const list = M.listFromSpec(spec, true);
  return M.isGraph(list[list.length - 1]);
}

test('custom views read back as lists that compile to the same picture', () => {
  // A sweep over the editor's seats: each top, body, row pair, order and the two flags,
  // compiled with every seat kind on, read back, compiled again.
  const tops = [['cal', '2'], ['cal', '3'], ['radar', '3'], ['radar', 'fill'], ['forecast', '3'], ['health', '4'], ['none', '3']];
  const bodies = [['forecast', 'fill'], ['health', '3'], ['radar', 'fill'], ['none', 'fill']];
  const rows = [['off', 'off'], ['weather', 'off'], ['radar', 'health'], ['off', 'weather']];
  let n = 0;
  tops.forEach(([top, ts]) => bodies.forEach(([body, bs]) => rows.forEach(([up, lo]) =>
    ['TACB', 'TCAB', 'CTAB', 'ACBT', 'ABCT'].forEach((order) => [0, 1, 2, 3].forEach((flags) => {
      const S = { viewCount: '2', radarMode: 'graph', healthMode: 'all',
        viewTop1: top, viewTopSize1: ts, viewBody1: body, viewBodySize1: bs, viewUpper1: up,
        viewLower1: lo, viewOrder1: order, viewClockOff1: Boolean(flags & 1), viewStripOff1: Boolean(flags & 2) };
      const spec = vc.buildCustomCycle(S)[1];
      const back = compiled([DEFAULT, M.listFromSpec(spec, !S.viewStripOff1)])[1];
      n++;
      if (topGraphLast(spec)) {
        // Read back, that graph is the bottom one: the same graph in the body seat.
        assert.equal(back.top, vc.TOP_EMPTY, JSON.stringify(S));
        assert.notEqual(back.body, vc.BODY_NONE, JSON.stringify(S));
        return;
      }
      assert.equal(picture(back, 1, BASALT), picture(spec, 1, BASALT), JSON.stringify(S));
    })))));
  assert.ok(n > 2000, n + ' views');
});

test('listFromSpec: the bands in the order the watch draws them, the Watch bar first, the body last', () => {
  // compactCal (no swap): its legacy order T A C B puts the forecast bar above the clock.
  assert.deepEqual(kinds(M.listFromSpec(vc.buildViewCycle('compactCal', 'off', 'off', false)[0], true)),
    ['strip', 'cal', 'fcbar', 'clock', 'fc']);
  // fullCal: T C A B.
  assert.deepEqual(M.listFromSpec(vc.buildViewCycle('fullCal', 'off', 'off', false)[0], true),
    [b('strip'), b('cal', { rows: '3' }), b('clock'), b('fcbar'), b('fc', { size: 'fill' })]);
  // Weather only with the radar graph: no Watch bar, the radar on top, drawn literally.
  assert.deepEqual(M.listFromSpec(vc.buildViewCycle('weatherOnly', 'off', 'graph', false)[0], true),
    [b('radar', { size: '3' }), b('clock'), b('fcbar'), b('fc', { size: 'fill' })]);
  // A disabled view: nothing on it but its Watch bar, as stored.
  assert.deepEqual(M.listFromSpec(null, true), [b('strip')]);
  assert.deepEqual(M.listFromSpec(null, false), []);
});

test('problem: the snap-back rules a move can break', () => {
  assert.equal(M.problem(DEFAULT), '');
  assert.equal(M.problem([b('clock'), b('strip'), b('fc', { size: 'fill' })]), 'The Watch bar stays at the top.');
  assert.equal(M.problem([b('strip'), b('cal', { rows: '2' }), b('fc', { size: '3' }), b('clock')]),
    'With a calendar, the graph stays at the bottom.');
  assert.equal(M.problem([b('strip'), b('fc', { size: '3' }), b('clock'), b('health', { size: '3' }), b('fcbar')]),
    'One graph has to stay at the bottom.');
  // A graph that is not last sits in the top seat, alone there: that keeps the rules.
  assert.equal(M.problem([b('strip'), b('clock'), b('fc', { size: '3' }), b('fcbar')]), '');
});

test('addable: what is missing and has a place, on a watch that draws it', () => {
  assert.deepEqual(M.addable(DEFAULT, BASALT), ['radarbar', 'healthbar'],
    'the calendar holds the top seat and the forecast the bottom: no place for a graph');
  assert.deepEqual(M.addable([b('strip'), b('clock')], BASALT),
    ['cal', 'fcbar', 'radarbar', 'healthbar', 'fc', 'radar', 'health']);
  // Two bars at most; two graphs at most.
  const full = [b('strip'), b('health', { size: '3' }), b('clock'), b('fcbar'), b('healthbar'), b('fc', { size: 'fill' })];
  assert.deepEqual(M.addable(full, BASALT), []);
  // aplite draws neither the radar nor health.
  assert.deepEqual(M.addable([b('strip'), b('clock')], APLITE), ['cal', 'fcbar', 'fc']);
  // An unknown watch is capable.
  assert.ok(M.addable([b('strip'), b('clock')], null).indexOf('radar') >= 0);
});

test('add: each block at its natural place', () => {
  const base = [b('clock'), b('fc', { size: 'fill' })];
  assert.deepEqual(kinds(M.add(base, 'strip')), ['strip', 'clock', 'fc']);
  const withStrip = M.add(base, 'strip');
  assert.deepEqual(M.add(withStrip, 'cal')[1], b('cal', { rows: '2' }), 'the calendar under the Watch bar');
  // The clock after the calendar, or after a graph at the top, else under the Watch bar.
  assert.deepEqual(kinds(M.add([b('strip'), b('cal', { rows: '2' }), b('fc', { size: 'fill' })], 'clock')),
    ['strip', 'cal', 'clock', 'fc']);
  assert.deepEqual(kinds(M.add([b('strip'), b('radar', { size: '3' }), b('fc', { size: 'fill' })], 'clock')),
    ['strip', 'radar', 'clock', 'fc']);
  assert.deepEqual(kinds(M.add([b('strip'), b('fc', { size: 'fill' })], 'clock')), ['strip', 'clock', 'fc'],
    'a lone graph is the bottom one: the clock goes above it');
  // A bar above the bottom graph, or last.
  assert.deepEqual(kinds(M.add(DEFAULT, 'healthbar')), ['strip', 'cal', 'clock', 'fcbar', 'healthbar', 'fc']);
  assert.deepEqual(kinds(M.add([b('strip'), b('clock')], 'fcbar')), ['strip', 'clock', 'fcbar']);
  // A graph at the bottom, filling...
  assert.deepEqual(M.add([b('strip'), b('clock')], 'radar'), [b('strip'), b('clock'), b('radar', { size: 'fill' })]);
  // ...or, with a bottom graph and the top seat free, the upper graph under the Watch bar.
  assert.deepEqual(M.add(HEALTH, 'fc'),
    [b('strip'), b('fc', { size: '3' }), b('clock'), b('healthbar'), b('health', { size: 'fill' })]);
});

test('one fill per screen; the forecast never takes 2 rows on the watch', () => {
  // A filling upper graph gives way to a filling bottom graph.
  assert.deepEqual(M.oneFill([b('strip'), b('fc', { size: 'fill' }), b('clock'), b('health', { size: 'fill' })]),
    [b('strip'), b('fc', { size: '3' }), b('clock'), b('health', { size: 'fill' })]);
  // A move that makes a filling graph the bottom one takes the other's fill.
  assert.deepEqual(M.move([b('strip'), b('clock'), b('health', { size: 'fill' }), b('fcbar'), b('fc', { size: 'fill' })], 2, 4),
    [b('strip'), b('clock'), b('fcbar'), b('fc', { size: '3' }), b('health', { size: 'fill' })]);
  const both = M.setOption([b('strip'), b('fc', { size: 'fill' }), b('clock'), b('health', { size: '3' })], 3, 'size', 'fill');
  assert.equal(both[1].size, '3', 'setting the bottom graph to Fill turns the filling upper into 3 rows');
  assert.equal(both[3].size, 'fill');
  const up = M.setOption(both, 1, 'size', 'fill');
  assert.equal(up[3].size, '3', 'and the other way round');
  // The forecast at 2 rows compiles to 3 (the watch's clamp), so the editor disables it.
  const two = compiled([DEFAULT, [b('strip'), b('clock'), b('fc', { size: '2' })]])[1];
  const three = compiled([DEFAULT, [b('strip'), b('clock'), b('fc', { size: '3' })]])[1];
  assert.equal(vc.packWire(two), vc.packWire(three));
});

test('compileKeys: the per-view keys, the bars in list order, the first order that reads as the list', () => {
  const k = M.compileKeys(DEFAULT, 0);
  assert.deepEqual(k, {
    viewTop0: 'cal', viewTopSize0: '2', viewBody0: 'forecast', viewBodySize0: 'fill',
    viewUpper0: 'weather', viewLower0: 'off', viewStripOff0: false, viewOrder0: 'TCAB',
    viewStyle0: '1'
  }, 'the Default keeps its clock: no viewClockOff0');
  const flick = M.compileKeys([b('healthbar'), b('fc', { size: '3' }), b('fcbar'), b('radar', { size: 'fill' })], 2);
  assert.equal(flick.viewClockOff2, true);
  assert.equal(flick.viewStripOff2, true);
  assert.equal(flick.viewTop2, 'forecast');
  assert.equal(flick.viewBody2, 'radar');
  assert.deepEqual([flick.viewUpper2, flick.viewLower2], ['health', 'weather']);
  assert.equal(flick.viewOrder2, 'CATB', 'A T B (no clock): CATB is the first code reading so');
  assert.equal(M.orderFor('CT'), 'CTAB');
  assert.equal(M.orderFor(''), 'TCAB');
});

test('screensOf: a custom layout as its stored lists, a preset as its cycle', () => {
  const S = Object.assign(compileAll([DEFAULT, HEALTH, RADAR]), { radarMode: 'off', healthMode: 'off' });
  // The modes do not fold the lists: they follow the screens.
  assert.deepEqual(M.screensOf(S, BASALT), [DEFAULT, HEALTH, RADAR]);
  assert.deepEqual(M.screensOf({ layoutPreset: 'fullCal', healthMode: 'all', radarMode: 'off' }, BASALT).map(kinds),
    [['strip', 'cal', 'clock', 'fcbar', 'fc'], ['strip', 'clock', 'healthbar', 'health']]);
  // A flick screen with nothing on it keeps its Watch bar as stored.
  const empty = Object.assign(compileAll([DEFAULT, [b('strip')]]), {});
  assert.deepEqual(M.screensOf(empty, BASALT)[1], [b('strip')]);
  // aplite runs a custom layout as Compact calendar.
  assert.deepEqual(M.screensOf(S, APLITE).map(kinds), [['strip', 'cal', 'fcbar', 'clock', 'fc']]);
});

test('fits: a screen too tall for the watch in some data state is refused', () => {
  assert.equal(M.fits(DEFAULT, 0, 'basalt'), true);
  const tall = [b('strip'), b('radar', { size: '4' }), b('clock'), b('fcbar'), b('healthbar'), b('fc', { size: '4' })];
  assert.equal(M.fits(tall, 1, 'basalt'), false);
  // The Radar bar stays without radar data, so it is budgeted in the radar's calendar fold.
  const bar = [b('strip'), b('radar', { size: 'fill' }), b('clock'), b('radarbar'), b('fc', { size: '4' })];
  assert.equal(M.fits(bar, 1, 'basalt'), false);
  assert.equal(M.fits([b('strip'), b('radar', { size: 'fill' }), b('clock'), b('fc', { size: '4' })], 1, 'basalt'), true);
});

test('deriveModes: the radar and health modes the screens need', () => {
  const S = (screens, over) => Object.assign({}, compileAll(screens), over || {});
  const modes = (s, env) => M.deriveModes(s, env || BASALT);
  assert.deepEqual(modes(S([DEFAULT, HEALTH, RADAR])), { radarMode: 'graph', healthMode: 'all' });
  // The Radar bar alone; the Health bar alone: on a custom layout a bar is what it holds
  // (3.0.0's named bars), so they need the radar or health only for an item that does.
  const bars = [DEFAULT, [b('strip'), b('clock'), b('radarbar'), b('healthbar')]];
  assert.deepEqual(modes(S(bars, { statusTopOnDemandLeftItems: 'bt' })), { radarMode: 'off', healthMode: 'slot' },
    'the Health bar\'s default slots hold steps and sleep; the Radar bar\'s UV, wind and gusts need no radar');
  assert.deepEqual(modes(S(bars, { statusTopOnDemandLeftItems: 'bt', statusHealthLeft: 'temp',
    statusHealthMid: 'empty', statusHealthRight: 'city' })), { radarMode: 'off', healthMode: 'off' },
  'a Health bar holding weather reads no health');
  assert.equal(modes(S(bars, { statusTopOnDemandLeftItems: '', statusRadarOnDemandLeftItems: 'rain' })).radarMode,
    'countdown', 'the rain alert on the shown Radar bar fetches the radar');
  // A preset's cycle is built from the modes, so its bars keep 'status'.
  assert.deepEqual(M.deriveModes({ layoutPreset: 'compactDense', radarMode: 'status', healthMode: 'status' }, BASALT),
    { radarMode: 'status', healthMode: 'status' });
  // Nothing radar on the screens: the rain alert on a shown bar (the Watch bar's left by
  // default) still needs the radar.
  assert.deepEqual(modes(S([DEFAULT], { statusTopOnDemandLeftItems: 'bt,qt,snooze,rain' })),
    { radarMode: 'countdown', healthMode: 'off' });
  assert.deepEqual(modes(S([DEFAULT], { statusTopOnDemandLeftItems: 'bt,qt' })).radarMode, 'off');
  // The rain alert on a bar no screen shows does not count.
  assert.equal(modes(S([DEFAULT], { statusTopOnDemandLeftItems: '', statusRadarOnDemandLeftItems: 'rain' })).radarMode, 'off');
  // Without the Watch bar on any screen, its rain alert shows nowhere.
  const stripless = [[b('cal', { rows: '2' }), b('clock'), b('fcbar'), b('fc', { size: 'fill' })]];
  assert.equal(modes(S(stripless, { statusTopOnDemandLeftItems: 'rain' })).radarMode, 'off');
  // The rain radar off (Setup) wins.
  assert.equal(modes(S([DEFAULT, RADAR], { radarEnabled: false })).radarMode, 'off');
  // A health item in a slot of a shown bar: 'slot'; on a bar no screen shows: 'off'.
  assert.equal(modes(S([DEFAULT], { statusTopLeft: 'steps' })).healthMode, 'slot');
  assert.equal(modes(S([DEFAULT], { statusRadarLeft: 'steps' })).healthMode, 'off');
  // A watch without the radar or health (aplite) needs neither.
  assert.deepEqual(modes({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'all',
    statusTopOnDemandLeftItems: 'rain' }, APLITE), { radarMode: 'off', healthMode: 'off' });
});
