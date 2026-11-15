// test/page/status-bars/status-slot-icons.test.js — the settings page's status-slot row glyphs
// (src/pkjs/page/status-bars/status-slot-icons.js): 24×24 fragments in currentColor,
// registered into the config-ui icon registry when the engine is loaded, and the one
// lookup both previews draw them through (preview-status-bars.js slotIcon).
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
const E = require('../../../src/pkjs/config-ui/lib/engine.js');
const ICONS = require('../../../src/pkjs/page/status-bars/status-slot-icons.js');

// The six weather glyphs, the Alert settings card's four System info glyphs (also the
// Status slots tab's read-only Alerts rows, by on-demand.js ITEMS icon), and the rest of
// the slot items the watch draws a glyph for.
const IDS = ['rain', 'uv', 'wind', 'gust', 'aqi', 'pollen', 'battery', 'bluetooth', 'quiet', 'snooze',
  'temp', 'dew', 'countdown', 'phoneBattery', 'distance', 'steps', 'sleep', 'hr', 'sun'];

// Every glyph the watch draws from a drawing is that drawing; the three it draws in code are
// 24x24 outlines.
const OUTLINES = ['battery', 'snooze', 'sun'];
const DRAWN = IDS.filter((id) => OUTLINES.indexOf(id) === -1).concat(['condition']);

test('the glyphs the watch draws in code are 24x24 svgs drawn in currentColor', () => {
  OUTLINES.forEach((id) => {
    const svg = ICONS[id];
    assert.equal(typeof svg, 'string', id + ' is exported');
    assert.ok(svg.indexOf('<svg viewBox="0 0 24 24"') === 0, id + ' opens a 24x24 svg');
    assert.ok(/<\/svg>$/.test(svg), id + ' closes it');
    assert.ok(svg.indexOf('currentColor') !== -1, id + ' takes its colour from the row chrome');
    assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(svg), false, id + ' hard-codes no colour');
  });
});

test('every glyph the watch draws from a drawing is that drawing, its ink at the 13-row box', () => {
  // The rain alert draws the weather condition slot's rain cloud on the watch, in the
  // foreground like every other icon; the condition slot's sample (and the city's weather
  // icon) is a partly cloudy afternoon.
  const PixelIcon = require('../../../src/pkjs/page/weather/pixel-icon.js');
  const STATUS = require('../../../src/pkjs/settings/status-pixels.generated.js');
  assert.deepEqual(Object.keys(ICONS.SLOT_KEYS).sort(), DRAWN.slice().sort(), 'a drawing for every drawn glyph');
  assert.equal(ICONS.rain, PixelIcon.svg(PixelIcon.condition('RAIN')), 'rain is the watch\'s rain cloud');
  assert.equal(ICONS.condition, PixelIcon.svg(PixelIcon.condition('SUN_CLOUD')), 'the condition is the watch\'s partly cloudy');
  DRAWN.forEach((id) => {
    const key = ICONS.SLOT_KEYS[id];
    assert.ok(STATUS.icons[key], id + ': ' + key + ' is a drawing');
    assert.equal(ICONS[id], PixelIcon.svg(PixelIcon.label(key)), id + ' is ' + key + '\'s drawing');
    assert.ok(ICONS[id].indexOf('fill="currentColor"') !== -1, id + ' takes its colour from the row chrome');
    assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(ICONS[id]), false, id + ' hard-codes no colour');
  });
});

test('those are Tabler-style outlines', () => {
  OUTLINES.forEach((id) => {
    assert.ok(ICONS[id].indexOf('fill="none" stroke="currentColor" stroke-width="1.8"') !== -1,
      id + ' is an unfilled 1.8 outline');
    assert.ok(ICONS[id].indexOf('stroke-linecap="round" stroke-linejoin="round"') !== -1,
      id + ' has round caps and joins');
  });
});

test('requiring the module with the engine loaded registers every glyph', () => {
  // The module registered at require time above: engine.js had already attached
  // PConf.icons to the shared global, which is exactly the page's load order.
  IDS.forEach((id) => {
    assert.equal(global.PConf.icons.get(id), ICONS[id], id + ' is in PConf.icons');
  });
  const row = E.renderRow({ type: 'toggle', messageKey: 'alertUv', label: 'UV index', icon: 'uv' },
    { value: false });
  assert.ok(row.indexOf('<div class="lbl"><span class="lbl-ico" aria-hidden="true">' + ICONS.uv) !== -1,
    'a row naming the id prints the glyph before its label');
});

test('every Alerts item names a registered glyph (an unknown id would print nothing, silently)', () => {
  // The read-only Alerts rows draw each placed item by on-demand.js ITEMS icon. bt and qt
  // have no glyph of their own name, so the ids are not the codes.
  const OD = require('../../../src/pkjs/status-bars/domain/on-demand.js');
  OD.ITEMS.forEach((item) => {
    assert.ok(IDS.indexOf(item.icon) !== -1, item.code + ': ' + item.icon + ' is one of the glyphs');
    assert.equal(global.PConf.icons.get(item.icon), ICONS[item.icon], item.code + ': registered');
  });
  assert.deepEqual(OD.ITEMS.map((i) => i.icon), ['battery', 'bluetooth', 'quiet', 'snooze', 'rain', 'gust', 'uv',
    'aqi', 'pollen', 'wind']);
});

test('every slot item the watch draws a glyph for has the page copy, and no other item has one', () => {
  // status-line-catalog.js names each item's watch glyph. NONE, PRESSURE and
  // PHONE_BATTERY_PLAIN are text on the watch; everything else, the drawn sun arrow
  // included, is a picture the previews must show too.
  const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
  const { slotIcon } = require('../../../src/pkjs/page/status-bars/preview-status-bars.js');
  const C = catalog.ICONS, basalt = { platform: 'basalt' };
  const TEXT = [C.NONE, C.PRESSURE, C.PHONE_BATTERY_PLAIN];
  ['empty', 'temp', 'wind', 'gust', 'pressure', 'dew', 'uv', 'aqi', 'pollen', 'sun', 'date', 'week', 'city',
    'countdown', 'steps', 'distance', 'hr', 'sleep', 'batteryPct', 'phoneBattery', 'phoneBatteryPlain'].forEach((code) => {
    const item = catalog.byCode(code);
    assert.ok(item, code + ' is a catalog item');
    if (code === 'city') {
      // The city draws the current weather's icon once switched on (citySlotIcon, off by default).
      assert.equal(slotIcon(code, basalt, { citySlotIcon: true }), ICONS.condition, 'city switched on: the weather icon');
      assert.equal(slotIcon(code, basalt), null, 'city by default: text alone, as the watch draws it');
    } else if (TEXT.indexOf(item.icon) === -1) {
      assert.equal(slotIcon(code, basalt), ICONS[code], code + ': the watch draws a glyph, so the preview does');
    } else {
      assert.equal(slotIcon(code, basalt), null, code + ': text on the watch, text in the preview');
    }
  });
  // The watch battery is its own drawn glyph on the bars (preview-watch.js batteryGlyph);
  // its registered outline is the Alerts rows' and the Status bars tab's.
  assert.equal(slotIcon('battery', basalt), ICONS.battery);
});

test('aplite draws only the glyphs of its lean row: the bitmap masks and the sun arrow', () => {
  const { slotIcon } = require('../../../src/pkjs/page/status-bars/preview-status-bars.js');
  const aplite = { platform: 'aplite' };
  ['temp', 'wind', 'gust', 'uv', 'aqi', 'pollen', 'countdown', 'sun'].forEach((code) => {
    assert.equal(slotIcon(code, aplite), ICONS[code], code + ' has a mask on aplite');
  });
  // No dew drops, the battery prints its charge, and health and the phone's battery are not there.
  ['dew', 'battery', 'steps', 'distance', 'sleep', 'hr', 'phoneBattery'].forEach((code) => {
    assert.equal(slotIcon(code, aplite), null, code + ' draws no glyph on aplite');
  });
});

test('each slot item names the drawing the watch pictures draw at a bar\'s box, none for a glyph drawn in code', () => {
  // The watch pictures (preview-watch.js) take the slot's drawing from barSlots and draw it at
  // the bar's box and seat; the rows above draw its label (ICONS).
  const preview = require('../../../src/pkjs/page/status-bars/preview-status-bars.js');
  const basalt = { platform: 'basalt' }, aplite = { platform: 'aplite' };
  const S = { statusForecastLeft: 'uv', statusForecastMid: 'empty', statusForecastRight: 'city', citySlotIcon: true };
  assert.deepEqual(preview.barSlots(S, basalt, 'forecast').map((c) => c.drawing), ['UV', null, 'SUN_CLOUD'],
    'the city draws the weather\'s icon');
  assert.equal(preview.barSlots(Object.assign({}, S, { citySlotIcon: false }), basalt, 'forecast')[2].drawing, null,
    'the city without its icon: none');
  assert.equal(preview.barSlots(S, aplite, 'forecast')[2].drawing, null, 'no weather icon on the Classic');
  assert.equal(preview.barSlots(Object.assign({}, S, { statusForecastLeft: 'sun' }), basalt, 'forecast')[0].drawing, null,
    'the sun arrow is drawn in code');
  const battery = preview.barSlots({ statusTopRight: 'battery' }, basalt, 'top')[2];
  assert.deepEqual([battery.code, battery.drawing], ['battery', null], 'and the battery');
});
