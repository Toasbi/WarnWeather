// The forecast's left axis options (BETA, emery only): src/pkjs/forecast-axis.js, the one
// reading of the four settings for the wire, the bake, the render signature, telemetry, the
// settings gate and the preview; its wire bits held equal to src/c/appendix/config.h.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const forecastAxis = require('../src/pkjs/forecast-axis.js');
const forecastSeries = require('../src/pkjs/forecast-series.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');

const env = (p) => platform.computeEnv(p === null ? null : { platform: p });
const NON_EMERY = ['aplite', 'basalt', 'chalk', 'diorite', 'flint'];
const LINE_KEYS = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];
const DEFAULTS = { line: true, numbers: 'beside', outline: true, scale: false };

test('readers: absent or junk read the shipped defaults', () => {
  [undefined, null, {}].forEach((s) => {
    assert.equal(forecastAxis.lineShown(s), true);
    assert.equal(forecastAxis.numbers(s), 'beside');
    assert.equal(forecastAxis.outline(s), true);
    assert.equal(forecastAxis.scale(s), false);
  });
  const junk = { forecastAxisLine: 0, forecastAxisNumbers: 'left', forecastAxisOutline: 'no',
    forecastAxisScale: 'true' };
  assert.equal(forecastAxis.lineShown(junk), true, 'only an exact false hides the line');
  assert.equal(forecastAxis.numbers(junk), 'beside');
  assert.equal(forecastAxis.outline(junk), true, 'only an exact false drops the outline');
  assert.equal(forecastAxis.scale(junk), false, 'only an exact true turns the scale on');
  const set = { forecastAxisLine: false, forecastAxisNumbers: 'graph', forecastAxisOutline: false,
    forecastAxisScale: true };
  assert.equal(forecastAxis.lineShown(set), false);
  assert.equal(forecastAxis.numbers(set), 'graph');
  assert.equal(forecastAxis.outline(set), false);
  assert.equal(forecastAxis.scale(set), true);
  assert.equal(forecastAxis.numbers({ forecastAxisNumbers: 'off' }), 'off');
  assert.deepEqual(forecastAxis.NUMBERS, ['beside', 'graph', 'off']);
  assert.deepEqual(forecastAxis.KEYS, { line: 'forecastAxisLine', numbers: 'forecastAxisNumbers',
    outline: 'forecastAxisOutline', scale: 'forecastAxisScale' });
});

test('platform predicates: a known emery; the Clay word also carries for an unknown platform', () => {
  assert.equal(forecastAxis.isEmery(env('emery')), true);
  assert.equal(forecastAxis.carried(env('emery')), true);
  NON_EMERY.forEach((p) => {
    assert.equal(forecastAxis.isEmery(env(p)), false, p);
    assert.equal(forecastAxis.carried(env(p)), false, p);
  });
  assert.equal(forecastAxis.isEmery(env(null)), false, 'unknown is not a known emery');
  assert.equal(forecastAxis.carried(env(null)), true, 'unknown is capable on the Clay message');
  assert.equal(forecastAxis.isEmery(null), false);
  assert.equal(forecastAxis.carried(null), true);
});

test('tempAxisLineDrawn: a drawn feels-like or dew point line, lines 3-4 only with line styles', () => {
  const styles = env('emery'), frozen = env('aplite');
  assert.equal(forecastAxis.tempAxisLineDrawn({}, styles), false);
  assert.equal(forecastAxis.tempAxisLineDrawn({ secondaryLine: 'wind', thirdLine: 'uv' }, styles), false);
  LINE_KEYS.forEach((key, i) => {
    ['feels', 'dew'].forEach((metric) => {
      const s = {};
      s[key] = metric;
      assert.equal(forecastAxis.tempAxisLineDrawn(s, styles), true, key + ' ' + metric);
      assert.equal(forecastAxis.tempAxisLineDrawn(s, frozen), i < 2, key + ' ' + metric + ' frozen');
      assert.equal(forecastAxis.tempAxisLineDrawn(s, {}), i < 2, key + ' ' + metric + ' no fact');
    });
  });
  // A repeated pick draws only its earliest copy, which still counts.
  assert.equal(forecastAxis.tempAxisLineDrawn({ secondaryLine: 'dew', thirdLine: 'dew' }, styles), true);
  assert.equal(forecastAxis.tempAxisLineDrawn({ secondaryLine: 'off', fifthLine: 'feels' }, styles), true);
});

test('tempAxisLineDrawn agrees with the bake\'s own gate (forecast-series.js)', () => {
  const states = [{}, { secondaryLine: 'feels' }, { thirdLine: 'dew' }, { fourthLine: 'dew' },
    { fifthLine: 'feels' }, { secondaryLine: 'wind', fifthLine: 'dew' }, { secondaryLine: 'off' },
    { secondaryLine: 'dew', thirdLine: 'dew' }];
  // aplite never draws one (the bake's own extra gate); every other watch, and an unknown
  // one, agrees line for line.
  ['emery', 'basalt', 'diorite', null].forEach((p) => {
    states.forEach((s) => {
      const bake = forecastSeries.tempAxisLineDrawn(s, p ? { platform: p } : null, 'feels')
        || forecastSeries.tempAxisLineDrawn(s, p ? { platform: p } : null, 'dew');
      assert.equal(forecastAxis.tempAxisLineDrawn(s, env(p)), bake, p + ' ' + JSON.stringify(s));
    });
  });
});

test('resolved: the stored options on a known emery, the defaults everywhere else', () => {
  const all = { forecastAxisLine: false, forecastAxisNumbers: 'graph', forecastAxisOutline: false,
    forecastAxisScale: true, secondaryLine: 'dew' };
  NON_EMERY.concat([null]).forEach((p) => {
    assert.deepEqual(forecastAxis.resolved(all, env(p)), DEFAULTS, String(p));
  });
  assert.deepEqual(forecastAxis.resolved({}, env('emery')), DEFAULTS);
  assert.deepEqual(forecastAxis.resolved(all, env('emery')),
    { line: false, numbers: 'graph', outline: false, scale: true });
  // The outline is dormant unless On graph.
  assert.equal(forecastAxis.resolved({ forecastAxisOutline: false }, env('emery')).outline, true);
  assert.equal(forecastAxis.resolved({ forecastAxisOutline: false, forecastAxisNumbers: 'off' },
    env('emery')).outline, true);
  // The scale is dormant with the numbers off or no feels-like / dew point line.
  assert.equal(forecastAxis.resolved({ forecastAxisScale: true }, env('emery')).scale, false);
  assert.equal(forecastAxis.resolved({ forecastAxisScale: true, secondaryLine: 'dew',
    forecastAxisNumbers: 'off' }, env('emery')).scale, false);
  assert.equal(forecastAxis.resolved({ forecastAxisScale: true, secondaryLine: 'dew' }, env('emery')).scale,
    true, 'Beside names the scale too');
});

test('wireBits: the exhaustive table, canonical (a dormant value packs no bit)', () => {
  const B = forecastAxis.BIT;
  let rows = 0;
  [true, false].forEach((line) => {
    forecastAxis.NUMBERS.forEach((nums) => {
      [true, false].forEach((outline) => {
        [true, false].forEach((scale) => {
          [null, 'dew', 'feels'].forEach((metric) => {
            const s = { forecastAxisLine: line, forecastAxisNumbers: nums, forecastAxisOutline: outline,
              forecastAxisScale: scale };
            if (metric) { s.thirdLine = metric; }
            const want = (line ? 0 : B.LINE_OFF)
              | (nums === 'graph' ? B.NUMS_GRAPH : 0)
              | (nums === 'off' ? B.NUMS_OFF : 0)
              | (nums === 'graph' && !outline ? B.OUTLINE_OFF : 0)
              | (scale && nums !== 'off' && metric ? B.SCALE : 0);
            const bits = forecastAxis.wireBits(s, env('emery'));
            assert.equal(bits, want, JSON.stringify(s));
            assert.equal(forecastAxis.wireBits(s, env(null)), want, 'unknown packs like emery');
            assert.equal(bits & 1, 0, 'never bit 0 (Larger graph fonts)');
            assert.ok(bits <= 0x3E, 'at most 0x3E');
            assert.equal(bits & ~forecastAxis.AXIS_MASK, 0, 'inside AXIS_MASK');
            NON_EMERY.forEach((p) => assert.equal(forecastAxis.wireBits(s, env(p)), 0, p));
            rows += 1;
          });
        });
      });
    });
  });
  assert.equal(rows, 2 * 3 * 2 * 2 * 3);
  assert.equal(forecastAxis.wireBits({}, env('emery')), 0, 'all zero exactly at the defaults');
});

test('bakesScale: a known emery with the option stored on, blind to numbers and lines', () => {
  assert.equal(forecastAxis.bakesScale({ forecastAxisScale: true }, env('emery')), true);
  assert.equal(forecastAxis.bakesScale({ forecastAxisScale: true, forecastAxisNumbers: 'off' }, env('emery')),
    true, 'a numbers flip stays Clay-only');
  assert.equal(forecastAxis.bakesScale({}, env('emery')), false);
  NON_EMERY.concat([null]).forEach((p) =>
    assert.equal(forecastAxis.bakesScale({ forecastAxisScale: true }, env(p)), false, String(p)));
});

test('signature: \'scale\' only while the option and a temperature-axis line are on', () => {
  assert.equal(forecastAxis.signature({}), '');
  assert.equal(forecastAxis.signature({ forecastAxisScale: false, secondaryLine: 'dew' }), '');
  assert.equal(forecastAxis.signature({ forecastAxisScale: true }), '');
  assert.equal(forecastAxis.signature({ forecastAxisScale: true, secondaryLine: 'wind' }), '');
  LINE_KEYS.forEach((key) => {
    const s = { forecastAxisScale: true };
    s[key] = 'feels';
    assert.equal(forecastAxis.signature(s), 'scale', key);
  });
  // Numbers, line and outline never sign.
  assert.equal(forecastAxis.signature({ forecastAxisLine: false, forecastAxisNumbers: 'graph',
    forecastAxisOutline: false, secondaryLine: 'dew' }), '');
});

test('the wire bits are one set of numbers on both sides (config.h GRAPH_OPT_*)', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'src', 'c', 'appendix', 'config.h'), 'utf8');
  const def = (name) => {
    const m = new RegExp('#define\\s+' + name + '\\s+(0x[0-9A-Fa-f]+)').exec(h);
    assert.ok(m, 'config.h defines ' + name);
    return Number(m[1]);
  };
  const B = forecastAxis.BIT;
  assert.equal(def('GRAPH_OPT_LARGE_FONT'), B.LARGE_FONT);
  assert.equal(def('GRAPH_OPT_AXIS_LINE_OFF'), B.LINE_OFF);
  assert.equal(def('GRAPH_OPT_NUMS_GRAPH'), B.NUMS_GRAPH);
  assert.equal(def('GRAPH_OPT_NUMS_OFF'), B.NUMS_OFF);
  assert.equal(def('GRAPH_OPT_NUMS_MASK'), B.NUMS_GRAPH | B.NUMS_OFF);
  assert.equal(def('GRAPH_OPT_OUTLINE_OFF'), B.OUTLINE_OFF);
  assert.equal(def('GRAPH_OPT_SCALE_NUMS'), B.SCALE);
  assert.equal(def('GRAPH_OPT_AXIS_MASK'), forecastAxis.AXIS_MASK);
  assert.equal(forecastAxis.AXIS_MASK & B.LARGE_FONT, 0, 'the mask leaves bit 0 to Larger graph fonts');
  assert.ok(forecastAxis.AXIS_MASK < 0x8000, 'below the int16 read\'s sign bit');
  // The decode reads the word through the int16 low half, emery only, stored as sent.
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'c', 'appendix', 'config_wire.c'), 'utf8');
  const emery = c.split('#if defined(PBL_PLATFORM_EMERY)').slice(1)
    .map((block) => block.split('#endif')[0]).join('\n');
  assert.match(emery, /\(uint16_t\)\s*clay_large_graph_font_tuple->value->int16/);
  assert.match(emery, /large_graph_font\s*=\s*\(\s*word\s*&\s*GRAPH_OPT_LARGE_FONT\s*\)\s*!=\s*0/);
  assert.match(emery, /out->forecast_axis\s*=\s*\(uint8_t\)\s*\(\s*word\s*&\s*GRAPH_OPT_AXIS_MASK\s*\)/);
});
