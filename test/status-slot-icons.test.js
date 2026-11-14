// test/status-slot-icons.test.js — the settings page's status-slot row glyphs
// (src/pkjs/settings/status-slot-icons.js): 24×24 fragments in currentColor,
// registered into the config-ui icon registry when the engine is loaded, and the one
// lookup both previews draw them through (preview-status-bars.js slotIcon).
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const E = require('../src/pkjs/config-ui/lib/engine.js');
const ICONS = require('../src/pkjs/settings/status-slot-icons.js');

// The six weather glyphs, the Alert settings card's four System info glyphs (also the
// Status slots tab's read-only Alerts rows, by on-demand.js ITEMS icon), and the rest of
// the slot items the watch draws a glyph for.
const IDS = ['rain', 'uv', 'wind', 'gust', 'aqi', 'pollen', 'battery', 'bluetooth', 'quiet', 'snooze',
  'temp', 'dew', 'countdown', 'phoneBattery', 'distance', 'steps', 'sleep', 'hr', 'sun'];

test('every glyph is a 24x24 svg drawn in currentColor', () => {
  IDS.forEach((id) => {
    const svg = ICONS[id];
    assert.equal(typeof svg, 'string', id + ' is exported');
    assert.ok(svg.indexOf('<svg viewBox="0 0 24 24"') === 0, id + ' opens a 24x24 svg');
    assert.ok(/<\/svg>$/.test(svg), id + ' closes it');
    assert.ok(svg.indexOf('currentColor') !== -1, id + ' takes its colour from the row chrome');
    assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(svg), false, id + ' hard-codes no colour');
  });
});

test('every glyph is a Tabler-style outline; rain is the condition slot\'s rain cloud', () => {
  // The rain alert draws the weather condition slot's rain cloud on the watch, in the
  // foreground like every other icon (status_row_icons_load_rain).
  const glyphs = require('../src/pkjs/settings/condition-glyphs.generated.js');
  assert.ok(ICONS.rain.indexOf('<path d="' + glyphs.RAIN + '"/>') !== -1, 'rain is the rain cloud');
  IDS.forEach((id) => {
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
  const OD = require('../src/pkjs/on-demand.js');
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
  const catalog = require('../src/pkjs/status-line-catalog.js');
  const { slotIcon } = require('../src/pkjs/settings/preview-status-bars.js');
  const C = catalog.ICONS, basalt = { platform: 'basalt' };
  const TEXT = [C.NONE, C.PRESSURE, C.PHONE_BATTERY_PLAIN];
  ['empty', 'temp', 'wind', 'gust', 'pressure', 'dew', 'uv', 'aqi', 'pollen', 'sun', 'date', 'week', 'city',
    'countdown', 'steps', 'distance', 'hr', 'sleep', 'batteryPct', 'phoneBattery', 'phoneBatteryPlain'].forEach((code) => {
    const item = catalog.byCode(code);
    assert.ok(item, code + ' is a catalog item');
    if (TEXT.indexOf(item.icon) === -1) {
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
  const { slotIcon } = require('../src/pkjs/settings/preview-status-bars.js');
  const aplite = { platform: 'aplite' };
  ['temp', 'wind', 'gust', 'uv', 'aqi', 'pollen', 'countdown', 'sun'].forEach((code) => {
    assert.equal(slotIcon(code, aplite), ICONS[code], code + ' has a mask on aplite');
  });
  // No dew drops, the battery prints its charge, and health and the phone's battery are not there.
  ['dew', 'battery', 'steps', 'distance', 'sleep', 'hr', 'phoneBattery'].forEach((code) => {
    assert.equal(slotIcon(code, aplite), null, code + ' draws no glyph on aplite');
  });
});
