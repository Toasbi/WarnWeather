const test = require('node:test');
const assert = require('node:assert/strict');
const color = require('../../lib/color.js');
const platform = require('../../config-ui/lib/platform.js');
const defaults = require('../lib/defaults.js');

const FIXTURE = { tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
  { type: 'select', messageKey: 'mode', defaultValue: 'a', options: [['A','a'],['B','b']] },
  { type: 'toggle', messageKey: 'flag', defaultValue: false },
  { type: 'color',  messageKey: 'tint', defaultValue: 0xFF0055 },
  { type: 'staticText' }
] } ] } ] };

test('color int<->hex round-trips; no padStart trap at 0', () => {
  [0, 0xFFFFFF, 0x0055AA, 0xFF0055].forEach((n) =>
    assert.equal(color.hexToInt(color.intToHex(n)), n, 'round-trip ' + n));
  assert.equal(color.intToHex(0), '#000000');
  assert.equal(color.intToHex(0x0055AA), '#0055AA');
});

test('isColorPlatform: 1-bit set is b&w, others (and unknown) color', () => {
  ['aplite','diorite','flint'].forEach((p) => assert.equal(platform.isColorPlatform(p), false, p));
  ['basalt','emery'].forEach((p) => assert.equal(platform.isColorPlatform(p), true, p));
  assert.equal(platform.isColorPlatform(''), true);
});

test('isHealthPlatform: only aplite lacks health; others (and unknown) have it', () => {
  assert.equal(platform.isHealthPlatform('aplite'), false);
  ['basalt','diorite','emery','flint'].forEach((p) => assert.equal(platform.isHealthPlatform(p), true, p));
  assert.equal(platform.isHealthPlatform(''), true);
});

test('isRadarPlatform: only aplite lacks radar; others (and unknown) have it', () => {
  assert.equal(platform.isRadarPlatform('aplite'), false);
  ['basalt','diorite','emery','flint'].forEach((p) => assert.equal(platform.isRadarPlatform(p), true, p));
  assert.equal(platform.isRadarPlatform(''), true);
});

test('isThemePolarityPlatform: only aplite lacks the light polarity; others (and unknown) have it', () => {
  assert.equal(platform.isThemePolarityPlatform('aplite'), false);
  ['basalt','diorite','emery','flint'].forEach((p) => assert.equal(platform.isThemePolarityPlatform(p), true, p));
  assert.equal(platform.isThemePolarityPlatform(''), true);
});

test('isHrPlatform: emery + diorite only; unknown -> false', () => {
  ['emery', 'diorite'].forEach((p) => assert.equal(platform.isHrPlatform(p), true, p));
  ['basalt', 'aplite', 'flint', ''].forEach((p) => assert.equal(platform.isHrPlatform(p), false, p));
});

test('isThresholdPlatform: everything but aplite; unknown -> true', () => {
  ['basalt', 'diorite', 'emery', 'flint', ''].forEach((p) =>
    assert.equal(platform.isThresholdPlatform(p), true, p));
  assert.equal(platform.isThresholdPlatform('aplite'), false, 'aplite compiles the highlight out');
});

test('isColorBacklightPlatform: emery only; colour SCREEN is not a colour backlight', () => {
  assert.equal(platform.isColorBacklightPlatform('emery'), true);
  // The important negative: basalt has a colour display but a white-only
  // backlight, so env.color must never be mistaken for this fact.
  ['basalt'].forEach((p) =>
    assert.equal(platform.isColorBacklightPlatform(p), false, p + ' has a colour screen, white backlight'));
  ['aplite', 'diorite', 'flint'].forEach((p) =>
    assert.equal(platform.isColorBacklightPlatform(p), false, p));
  assert.equal(platform.isColorBacklightPlatform(''), false, 'unknown watch: fail closed, no LED feature');
});

test('computeEnv from watchInfo', () => {
  assert.deepEqual(platform.computeEnv({ platform: 'flint' }), { color: false, platform: 'flint', health: true, radar: true, themePolarity: true, hr: false, thresholds: true, colorBacklight: false, lineStyles: true, onDemand: true, fineBattery: false, forecastSpan: false, graphStyles: false, extraBars: false });
  assert.deepEqual(platform.computeEnv({ platform: 'aplite' }), { color: false, platform: 'aplite', health: false, radar: false, themePolarity: false, hr: false, thresholds: false, colorBacklight: false, lineStyles: false, onDemand: false, fineBattery: false, forecastSpan: false, graphStyles: false, extraBars: false });
  assert.deepEqual(platform.computeEnv({ platform: 'emery' }), { color: true, platform: 'emery', health: true, radar: true, themePolarity: true, hr: true, thresholds: true, colorBacklight: true, lineStyles: true, onDemand: true, fineBattery: true, forecastSpan: true, graphStyles: true, extraBars: true });
  assert.deepEqual(platform.computeEnv({ platform: 'diorite' }), { color: false, platform: 'diorite', health: true, radar: true, themePolarity: true, hr: true, thresholds: true, colorBacklight: false, lineStyles: true, onDemand: true, fineBattery: false, forecastSpan: false, graphStyles: false, extraBars: false });
  assert.deepEqual(platform.computeEnv(null), { color: true, platform: '', health: true, radar: true, themePolarity: true, hr: false, thresholds: true, colorBacklight: false, lineStyles: true, onDemand: true, fineBattery: false, forecastSpan: false, graphStyles: false, extraBars: false });
});

test('isGraphStylePlatform: emery only, fail closed for an unknown watch', () => {
  assert.equal(platform.isGraphStylePlatform('emery'), true);
  ['basalt', 'diorite', 'flint', 'aplite'].forEach((p) =>
    assert.equal(platform.isGraphStylePlatform(p), false, p));
  assert.equal(platform.isGraphStylePlatform(''), false, 'unknown watch: one graph style');
});

test('isForecastSpanPlatform: emery only, fail closed for an unknown watch', () => {
  assert.equal(platform.isForecastSpanPlatform('emery'), true);
  ['basalt', 'diorite', 'flint', 'aplite'].forEach((p) =>
    assert.equal(platform.isForecastSpanPlatform(p), false, p));
  assert.equal(platform.isForecastSpanPlatform(''), false, 'unknown watch: 24 h only');
});

test('deriveDefaults/deriveColorKeys are schema-driven (colors as ints)', () => {
  assert.deepEqual(defaults.deriveDefaults(FIXTURE), { mode: 'a', flag: false, tint: 0xFF0055 });
  assert.deepEqual(defaults.deriveColorKeys(FIXTURE), ['tint']);
});

test('deriveDefaults never seeds a defaultFrom item, even one that also has a defaultValue', () => {
  // The seed backfill would otherwise pin a key the page leaves absent on purpose
  // (defaultFrom.sticky: false), freezing one watch's default for every watch.
  const SCH = { tabs: [{ sections: [{ items: [
    { type: 'select', messageKey: 'plain', defaultValue: 'a' },
    { type: 'select', messageKey: 'slot', defaultFrom: { resolver: 'x' } },
    { type: 'segmented', messageKey: 'look', defaultValue: 'fill', defaultFrom: { resolver: 'x', sticky: false } }
  ] }] }] };
  assert.deepEqual(defaults.deriveDefaults(SCH), { plain: 'a' });
});
