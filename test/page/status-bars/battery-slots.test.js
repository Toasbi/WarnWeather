'use strict';
// The two battery slots on the settings page: one Watch battery and one Phone battery, each
// with a Look in its dialog, and the Watch battery's text set like the temperature slot's:
// the percentage, the days left or both, with the pair's order, separator and spaces. The
// rows that show, the pictures of the bar, the Edit badge and the reset.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
const showWhen = require('../../../src/pkjs/config-ui/lib/show-when.js');
require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js');
// The slot glyphs the pictures draw (PConf.icons), the phone battery's among them.
require('../../../src/pkjs/page/status-bars/status-slot-icons.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const preview = require('../../../src/pkjs/page/status-bars/preview-status-bars.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const statusLines = require('../../../src/pkjs/status-bars/domain/status-lines.js');
const batteryDays = require('../../../src/pkjs/status-bars/domain/battery-days.js');
const statusPair = require('../../../src/pkjs/status-bars/domain/status-pair.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const { decodeLine } = require('../../helpers/status-line-bytes.js');

const PConf = global.PConf;
const BASALT = Object.assign(platform.computeEnv({ platform: 'basalt' }), { plugins: true, phoneBattery: true });
const NO_PLUGINS = Object.assign({}, BASALT, { plugins: false });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const EDGE = catalog.CAPS.EDGE_TEXT_MAX;

/**
 * A slot dialog of the schema, by its sheet id.
 * @param {string} id e.g. 'threshBatteryPct'.
 * @returns {Object} The section.
 */
function sheet(id) {
  const found = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    if (node.sheetId === id) { found.push(node); }
    Object.keys(node).forEach((k) => walk(node[k]));
  })(schema);
  assert.equal(found.length, 1, 'one sheet ' + id);
  return found[0];
}

/**
 * The rows of a sheet that show for some settings on some watch.
 * @param {Object} section The sheet. @param {Object} S Settings. @param {Object} env Platform env.
 * @returns {string[]} Their keys, in order.
 */
function shown(section, S, env) {
  return section.items.filter((item) => showWhen.isVisible(item, Object.assign({ env: env }, S)))
    .map((item) => item.messageKey);
}

const BATTERY = sheet('threshBatteryPct');
const PAIR_ROWS = ['batterySlotOrder', 'batterySlotSeparator', 'batterySlotSeparatorSpaced'];

test('the Watch battery dialog: its Look first, Bold last, the text\'s rows between', () => {
  assert.equal(BATTERY.title, 'Watch battery slot');
  assert.deepEqual(BATTERY.items.map((i) => i.messageKey), ['batterySlotLook', 'batterySlotDisplay',
    'batterySlotOrder', 'batterySlotSeparator', 'batterySlotSeparatorCustom', 'batterySlotSeparatorSpaced',
    'threshBatteryPctBoldMode']);
  const look = BATTERY.items[0];
  assert.equal(look.type, 'segmented');
  assert.equal(look.label, 'Look');
  assert.deepEqual(look.options, [['Icon', 'icon'], ['Text', 'text']]);
  assert.equal(look.defaultValue, 'icon', 'the battery the watch has always drawn');
  const display = BATTERY.items[1];
  assert.equal(display.type, 'segmented');
  assert.equal(display.label, 'Value selection', 'named like the temperature slot\'s');
  assert.deepEqual(display.options, [['Percentage', 'percent'], ['Days left', 'days'], ['Both', 'both']]);
  assert.equal(display.defaultValue, 'percent');
  assert.deepEqual(Object.keys(display.hintByValue), ['days', 'both'], 'the percentage needs no words');
  Object.keys(display.hintByValue).forEach((value) =>
    assert.ok(display.hintByValue[value].indexOf('Muninn') !== -1, value + ' names where the days come from'));
});

test('every key the dialogs write is in the catalog\'s list, which the reset and the re-bake read', () => {
  const written = BATTERY.items.concat(sheet('threshPhoneBattery').items).map((i) => i.messageKey)
    .filter((key) => !/BoldMode$/.test(key));
  assert.deepEqual(written.slice().sort(), catalog.batterySettingKeys().slice().sort());
});

test('the Icon look shows the Look alone: a drawn battery has no text to set or to print bold', () => {
  [{}, { batterySlotLook: 'icon' }, { batterySlotLook: 'icon', batterySlotDisplay: 'both', batterySlotSeparator: 'custom' }]
    .forEach((S) => assert.deepEqual(shown(BATTERY, S, BASALT), ['batterySlotLook'], JSON.stringify(S)));
});

test('the Text look: Value selection and Bold; Both adds the pair\'s rows, Custom its text field', () => {
  const text = { batterySlotLook: 'text' };
  assert.deepEqual(shown(BATTERY, text, BASALT), ['batterySlotLook', 'batterySlotDisplay', 'threshBatteryPctBoldMode']);
  assert.deepEqual(shown(BATTERY, Object.assign({ batterySlotDisplay: 'days' }, text), BASALT),
    ['batterySlotLook', 'batterySlotDisplay', 'threshBatteryPctBoldMode']);
  const bothRows = shown(BATTERY, Object.assign({ batterySlotDisplay: 'both' }, text), BASALT);
  assert.deepEqual(bothRows, ['batterySlotLook', 'batterySlotDisplay'].concat(PAIR_ROWS, ['threshBatteryPctBoldMode']));
  assert.deepEqual(shown(BATTERY, Object.assign({ batterySlotDisplay: 'both', batterySlotSeparator: 'custom' }, text), BASALT),
    ['batterySlotLook', 'batterySlotDisplay', 'batterySlotOrder', 'batterySlotSeparator', 'batterySlotSeparatorCustom',
      'batterySlotSeparatorSpaced', 'threshBatteryPctBoldMode']);
});

test('a Pebble app without plugins has no days: the Text look shows the percentage and Bold only', () => {
  ['percent', 'days', 'both'].forEach((display) => {
    assert.deepEqual(shown(BATTERY, { batterySlotLook: 'text', batterySlotDisplay: display,
      batterySlotSeparator: 'custom' }, NO_PLUGINS),
    ['batterySlotLook', 'threshBatteryPctBoldMode'], display);
  });
});

test('the pair\'s rows are the temperature slot\'s, on the battery\'s own samples', () => {
  const byKey = {};
  BATTERY.items.forEach((item) => { byKey[item.messageKey] = item; });
  assert.deepEqual(byKey.batterySlotOrder.options, [['Percentage first', 'percent'], ['Days left first', 'days']]);
  assert.equal(byKey.batterySlotOrder.defaultValue, 'percent');
  assert.equal(byKey.batterySlotSeparator.defaultValue, statusPair.defaultSeparator('battery'));
  assert.deepEqual(byKey.batterySlotSeparator.options, [['80%/5d', 'slash'], ['80%(5d)', 'brackets'],
    ['80%·5d', 'dot'], ['80%|5d', 'bar'], ['Custom', 'custom']]);
  assert.equal(byKey.batterySlotSeparatorSpaced.defaultValue, false);
  assert.equal(byKey.batterySlotSeparatorCustom.attributes.maxlength, statusPair.CUSTOM_MAX_CHARS);
  // What each label shows is what the slot prints with that separator.
  byKey.batterySlotSeparator.options.slice(0, 4).forEach(([label, value]) => {
    assert.equal(statusPair.formatBatteryPair('80%', '5d', { batterySlotSeparator: value }, EDGE), label);
  });
  // The fit rule's hint is on Custom alone: no preset can outgrow the slot (battery-days.test.js
  // walks every form), and a custom one only has its spaces to drop.
  assert.deepEqual(Object.keys(byKey.batterySlotSeparator.hintByValue), ['custom']);
  assert.equal(byKey.batterySlotSeparator.hintByValue.custom, 'If the pair doesn\'t fit, the slot drops the spaces.');
});

test('the Separator row\'s hint says all that can happen: only a spaced custom separator is narrowed', () => {
  const MARK = batteryDays.PCT_MARK;
  const base = { batterySlotDisplay: 'both', batterySlotSeparatorSpaced: true };
  Object.keys(statusPair.SEPARATORS).forEach((separator) => {
    [1, 99].forEach((days) => {
      ['percent', 'days'].forEach((order) => {
        const S = Object.assign({ batterySlotSeparator: separator, batterySlotOrder: order }, base);
        const spaced = statusPair.spaceAround(statusPair.SEPARATORS[separator]);
        const text = batteryDays.slotText(days, S, EDGE);
        const first = order === 'days' ? days + 'd' : MARK;
        const second = order === 'days' ? MARK : days + 'd';
        assert.equal(text, first + spaced.mid + second + spaced.end, 'a preset keeps its spaces: ' + JSON.stringify(S));
      });
    });
  });
  // The widest custom separator: its spaces go, the separator stays, never the default.
  const wide = Object.assign({ batterySlotSeparator: 'custom', batterySlotSeparatorCustom: '\u00b7\u00b7' }, base);
  assert.equal(batteryDays.slotText(99, wide, EDGE), MARK + '\u00b7\u00b799d');
});

test('the Phone battery dialog: its Look, then Bold', () => {
  const phone = sheet('threshPhoneBattery');
  assert.equal(phone.title, 'Phone battery slot');
  assert.deepEqual(phone.items.map((i) => i.messageKey), ['phoneBatterySlotLook', 'threshPhoneBatteryBoldMode']);
  assert.deepEqual(phone.items[0].options, [['Icon + text', 'both'], ['Text', 'text']]);
  assert.equal(phone.items[0].defaultValue, 'both');
  assert.deepEqual(shown(phone, { phoneBatterySlotLook: 'text' }, BASALT),
    ['phoneBatterySlotLook', 'threshPhoneBatteryBoldMode'], 'Bold in both looks: both print text');
});

test('the slot lists offer one Watch battery and one Phone battery', () => {
  // The rows one can pick: the group's own heading ("Battery") is none.
  const labels = (slotKey, position, env) => catalog.slotOptions({}, env, { slotKey: slotKey, position: position })
    .filter((o) => !(o[2] && o[2].groupHeader)).map((o) => o[0]);
  const top = labels('statusTopRight', 'right', BASALT);
  assert.ok(top.indexOf('Watch battery') !== -1 && top.indexOf('Phone battery') !== -1);
  assert.equal(top.filter((l) => /battery/i.test(l)).length, 2, top.join(', '));
  const elsewhere = labels('statusForecastLeft', 'left', BASALT);
  assert.deepEqual(elsewhere.filter((l) => /battery/i.test(l)), ['Phone battery'], 'the watch battery keeps its corner');
  assert.deepEqual(labels('statusTopRight', 'right', APLITE).filter((l) => /battery/i.test(l)), ['Watch battery']);
});

test('the picture of the bar: a drawn battery, or its text as the watch prints it', () => {
  const text = (S, env) => preview.sample('battery', S, { cap: EDGE, env: env || BASALT });
  assert.equal(text({}), '', 'the Icon look is the glyph alone');
  assert.equal(text({ batterySlotLook: 'text' }), '80%');
  assert.equal(text({ batterySlotLook: 'text', batterySlotDisplay: 'days' }), '5d');
  assert.equal(text({ batterySlotLook: 'text', batterySlotDisplay: 'both' }), '80%|5d');
  assert.equal(text({ batterySlotLook: 'text', batterySlotDisplay: 'both', batterySlotOrder: 'days',
    batterySlotSeparator: 'brackets', batterySlotSeparatorSpaced: true }), '5d (80%)');
  assert.equal(text({ batterySlotLook: 'icon', batterySlotDisplay: 'both' }), '', 'the Icon look whatever its text is set to');
  // aplite's lean row prints the charge for its one battery slot, whatever the look.
  assert.equal(text({}, APLITE), '80%');
  assert.equal(text({ batterySlotLook: 'text', batterySlotDisplay: 'both' }, APLITE), '80%');
});

test('the picture prints what the bake carries, drawn as the watch draws it', () => {
  const now = new Date(2026, 10, 21, 12, 0, 0);
  const watch = { estimate: () => ({ days: 5, updatedAt: now.getTime() }) };
  ['icon', 'text'].forEach((look) => {
    ['percent', 'days', 'both'].forEach((display) => {
      ['percent', 'days'].forEach((order) => {
        [false, true].forEach((spaced) => {
          ['bar', 'brackets', 'custom'].forEach((separator) => {
            const S = { statusTopRight: 'battery', batterySlotLook: look, batterySlotDisplay: display,
              batterySlotOrder: order, batterySlotSeparator: separator, batterySlotSeparatorCustom: '··',
              batterySlotSeparatorSpaced: spaced };
            const baked = decodeLine(statusLines.buildStatusLines({ CITY: 'Bonn', SUN_EVENTS: [1, 0, 0, 0, 0] }, S,
              { platform: 'basalt' }, now, null, watch).STATUS_LINE_3_UINT8)[2];
            const drawn = baked.kind === catalog.KINDS.LIVE_BATTERY ? '' : batteryDays.drawn(baked.text, '80%');
            const right = preview.barSlots(S, BASALT, 'top', false, now)[2];
            assert.equal(right.code, 'battery');
            assert.equal(right.text, drawn, JSON.stringify(S));
            // The battery itself in the Icon look; in the Text look the text alone, as the
            // watch draws kind 10 with no glyph.
            assert.equal(Boolean(right.icon), look === 'icon', 'its glyph: ' + JSON.stringify(S));
          });
        });
      });
    });
  });
});

test('the phone battery\'s picture: its icon in the Icon + text look, none in the Text look', () => {
  assert.equal(preview.sample('phoneBattery', {}, { cap: EDGE, env: BASALT }), '72%');
  assert.equal(preview.sample('phoneBattery', { phoneBatterySlotLook: 'text' }, { cap: EDGE, env: BASALT }), '72%');
  assert.ok(preview.slotIcon('phoneBattery', BASALT, {}), 'the phone glyph');
  assert.ok(preview.slotIcon('phoneBattery', BASALT, { phoneBatterySlotLook: 'both' }));
  assert.equal(preview.slotIcon('phoneBattery', BASALT, { phoneBatterySlotLook: 'text' }), null);
  const S = { statusForecastLeft: 'phoneBattery', phoneBatterySlotLook: 'text' };
  const left = preview.barSlots(S, BASALT, 'forecast', false, new Date(2026, 10, 21))[0];
  assert.deepEqual([left.code, left.text, left.icon, left.drawing], ['phoneBattery', '72%', null, null]);
  const withIcon = preview.barSlots({ statusForecastLeft: 'phoneBattery' }, BASALT, 'forecast', false, new Date(2026, 10, 21))[0];
  assert.equal(withIcon.drawing, 'PHONE_BATTERY');
});

test('the Edit button opens the Watch battery\'s dialog in both looks, and badges no B on a drawn battery', () => {
  const sheetOf = PConf.sheetResolvers.get('statusSlotEditSheet');
  const badge = PConf.badgeResolvers.get('thresholdPenState');
  const env = { thresholds: true };
  const args = { messageKey: 'statusTopRight' };
  const S = (more) => Object.assign({ statusTopRight: 'battery' }, more);
  assert.equal(sheetOf(S({}), env, args), 'threshBatteryPct', 'the Icon look: the dialog holds its Look');
  assert.equal(sheetOf(S({ batterySlotLook: 'text' }), env, args), 'threshBatteryPct');
  assert.equal(sheetOf(S({}), { thresholds: false }, args), null, 'aplite has no slot dialogs');
  assert.equal(sheetOf({ statusForecastLeft: 'phoneBattery' }, env, { messageKey: 'statusForecastLeft' }),
    'threshPhoneBattery');
  assert.equal(badge(S({ threshBatteryPctBoldMode: 'always' }), env, args).bold, false, 'nothing to print bold');
  assert.equal(badge(S({ statusBoldAll: 'all' }), env, args).bold, false, 'not even under the master row');
  assert.equal(badge(S({ batterySlotLook: 'text', threshBatteryPctBoldMode: 'always' }), env, args).bold, true);
  assert.equal(badge(S({ batterySlotLook: 'text', statusBoldAll: 'all' }), env, args).bold, true);
  assert.equal(badge(S({ batterySlotLook: 'text' }), env, args).bold, false);
});

test('Reset status bars puts both batteries back to their looks and the text to the percentage', () => {
  const defaults = {};
  BATTERY.items.concat(sheet('threshPhoneBattery').items).forEach((item) => { defaults[item.messageKey] = item.defaultValue; });
  const S = { batterySlotLook: 'text', batterySlotDisplay: 'both', batterySlotOrder: 'days',
    batterySlotSeparator: 'custom', batterySlotSeparatorCustom: '~', batterySlotSeparatorSpaced: true,
    phoneBatterySlotLook: 'text', holidayCountry: 'DE' };
  const defaultOf = (key) => (Object.prototype.hasOwnProperty.call(defaults, key) ? defaults[key] : undefined);
  assert.equal(PConf.actions.resetStatusSlots(null, S, BASALT, defaultOf), true);
  assert.deepEqual([S.batterySlotLook, S.batterySlotDisplay, S.batterySlotOrder, S.batterySlotSeparator,
    S.batterySlotSeparatorCustom, S.batterySlotSeparatorSpaced, S.phoneBatterySlotLook],
  ['icon', 'percent', 'percent', 'bar', '', false, 'both']);
});
