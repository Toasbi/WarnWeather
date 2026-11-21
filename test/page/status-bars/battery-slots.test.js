'use strict';
// The two battery slots on the settings page: one Watch battery and one Phone battery in the
// slot lists, each with a Look row right under the slot that holds it (the phone battery's
// is the slot's own, so two slots can differ), and the Watch battery's text set like the
// temperature slot's in its dialog: the percentage, the days left or both, with the pair's
// order, separator and spaces. The rows that show, the pictures of the bar, the Edit button
// and the reset.
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
const screens = require('../../../src/pkjs/layout/domain/screens.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const { decodeLine } = require('../../helpers/status-line-bytes.js');

const PConf = global.PConf;
const BASALT = Object.assign(platform.computeEnv({ platform: 'basalt' }), { plugins: true, phoneBattery: true });
const NO_PLUGINS = Object.assign({}, BASALT, { plugins: false });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const EDGE = catalog.CAPS.EDGE_TEXT_MAX;
const SLOT_KEYS = catalog.ALL_LINES.reduce((keys, line) => keys.concat(line.slots), []);

/**
 * Every schema node that passes a test, in schema order.
 * @param {function(Object): boolean} wanted The test.
 * @returns {Object[]}
 */
function nodes(wanted) {
  const found = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    if (wanted(node)) { found.push(node); }
    Object.keys(node).forEach((k) => walk(node[k]));
  })(schema);
  return found;
}

/**
 * A dialog of the schema, by its sheet id.
 * @param {string} id e.g. 'threshBatteryPct'.
 * @returns {Object} The section.
 */
function sheet(id) {
  const found = nodes((node) => node.sheetId === id);
  assert.equal(found.length, 1, 'one sheet ' + id);
  return found[0];
}

/**
 * The one schema row that writes a key.
 * @param {string} key Its messageKey.
 * @returns {Object}
 */
function row(key) {
  const found = nodes((node) => node.messageKey === key);
  assert.equal(found.length, 1, 'one row for ' + key);
  return found[0];
}

/**
 * Whether a row shows for some settings on some watch.
 * @param {Object} item The row. @param {Object} S Settings. @param {Object} env Platform env.
 * @returns {boolean}
 */
function visible(item, S, env) {
  return showWhen.isVisible(item, Object.assign({ env: env }, S));
}

/**
 * The rows of a section that show, by their keys, in order.
 * @param {Object} section The section. @param {Object} S Settings. @param {Object} env Platform env.
 * @returns {string[]}
 */
function shown(section, S, env) {
  return section.items.filter((item) => visible(item, S, env)).map((item) => item.messageKey);
}

const BATTERY = sheet('threshBatteryPct');
const PAIR_ROWS = ['batterySlotOrder', 'batterySlotSeparator', 'batterySlotSeparatorSpaced'];

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

test('the watch battery\'s Look sits under its slot, the Watch bar\'s right, while that slot holds it', () => {
  const look = row('batterySlotLook');
  assert.equal(look.type, 'segmented');
  assert.equal(look.label, 'Look');
  assert.deepEqual(look.options, [['Icon', 'icon'], ['Text', 'text']]);
  assert.equal(look.defaultValue, 'icon', 'the battery the watch has always drawn');
  assert.equal(look.joinPrevious, true, 'joined to the slot above, like a countdown\'s date');
  const items = sheet(screens.barSheet('top')).items.map((i) => i.messageKey);
  assert.equal(items[items.indexOf('batterySlotLook') - 3], 'statusTopRight', 'after the slot and its other companions');
  assert.equal(visible(look, { statusTopRight: 'battery' }, BASALT), true);
  assert.equal(visible(look, { statusTopRight: 'battery', batterySlotLook: 'text' }, BASALT), true, 'in both looks');
  assert.equal(visible(look, { statusTopRight: 'aqi', batterySlotLook: 'text' }, BASALT), false, 'another item in the slot');
  assert.equal(visible(look, { statusTopRight: 'phoneBattery' }, BASALT), false, 'the phone battery has its own');
  assert.equal(visible(look, { statusTopRight: 'battery' }, APLITE), false,
    'aplite draws its one battery slot its own way');
});

test('every slot has a phone battery Look of its own, shown while the slot holds the phone battery', () => {
  assert.equal(SLOT_KEYS.length, 21, 'the four bars and bars 4 to 6');
  SLOT_KEYS.forEach((slotKey) => {
    const look = row(catalog.phoneBatteryLookKey(slotKey));
    assert.equal(look.messageKey, slotKey + 'PhoneBatteryLook');
    assert.equal(look.type, 'segmented');
    assert.equal(look.label, 'Look');
    assert.deepEqual(look.options, [['Icon + text', 'both'], ['Text', 'text']]);
    assert.equal(look.defaultValue, 'both', 'the phone\'s icon before its charge');
    assert.equal(look.joinPrevious, true);
    // Radar and Health bars: on a watch that draws them, like their slots.
    const env = Object.assign({}, BASALT, { radar: true, health: true, platform: 'emery' });
    const on = {};
    on[slotKey] = 'phoneBattery';
    const off = {};
    off[slotKey] = 'aqi';
    off[catalog.phoneBatteryLookKey(slotKey)] = 'text';
    assert.equal(visible(look, off, env), false, slotKey + ': another item in the slot');
    // The slot's own gate decides with it (a bar this watch does not have shows neither).
    const slot = row(slotKey);
    assert.equal(visible(look, on, env), visible(slot, on, env), slotKey + ': shown with its slot');
    // Its row follows its slot's in the bar's dialog.
    const bar = nodes((node) => Array.isArray(node.items) && node.items.indexOf(slot) !== -1)[0];
    assert.ok(bar.items.indexOf(look) > bar.items.indexOf(slot), slotKey + ': under its slot');
  });
  // A slot's Look follows that slot alone.
  const leftLook = row('statusForecastLeftPhoneBatteryLook');
  assert.equal(visible(leftLook, { statusForecastLeft: 'phoneBattery' }, BASALT), true);
  assert.equal(visible(leftLook, { statusForecastRight: 'phoneBattery' }, BASALT), false);
});

test('the keys the rows write are the catalog\'s: the watch battery\'s list and one Look per slot', () => {
  const sheetKeys = BATTERY.items.map((i) => i.messageKey).filter((key) => !/BoldMode$/.test(key));
  assert.deepEqual(sheetKeys.concat(['batterySlotLook']).sort(), catalog.batterySettingKeys().slice().sort());
  const lookRows = nodes((node) => /PhoneBatteryLook$/.test(String(node.messageKey || ''))).map((i) => i.messageKey);
  assert.deepEqual(lookRows.slice().sort(), SLOT_KEYS.map(catalog.phoneBatteryLookKey).sort());
  SLOT_KEYS.forEach((slotKey) => {
    assert.deepEqual(catalog.slotCompanions(slotKey), [{ code: 'countdown', key: slotKey + 'Countdown' },
      { code: 'phoneBattery', key: slotKey + 'PhoneBatteryLook' }]);
  });
});

test('the Watch battery dialog sets its text: what it shows, the pair\'s rows, then Bold', () => {
  assert.equal(BATTERY.title, 'Watch battery slot');
  assert.deepEqual(BATTERY.items.map((i) => i.messageKey), ['batterySlotDisplay', 'batterySlotOrder',
    'batterySlotSeparator', 'batterySlotSeparatorCustom', 'batterySlotSeparatorSpaced', 'threshBatteryPctBoldMode']);
  const display = BATTERY.items[0];
  assert.equal(display.type, 'segmented');
  assert.equal(display.label, 'Value selection', 'named like the temperature slot\'s');
  assert.deepEqual(display.options, [['Percentage', 'percent'], ['Days left', 'days'], ['Both', 'both']]);
  assert.equal(display.defaultValue, 'percent');
  assert.deepEqual(Object.keys(display.hintByValue), ['days', 'both'], 'the percentage needs no words');
});

test('the hints under Days left and Both say when the percentage shows, then name Muninn on its own line', () => {
  const hints = BATTERY.items[0].hintByValue;
  ['days', 'both'].forEach((value) => {
    const hint = hints[value];
    const parts = hint.split('<span style="display:block;margin-top:6px">');
    assert.equal(parts.length, 2, value + ': one line set apart');
    assert.equal(parts[0].indexOf('Muninn'), -1, value + ': the first line is about the watch');
    assert.match(parts[0], /while the watch charges, your phone is out of reach or there is no estimate\.$/);
    assert.match(parts[1], /^The days are an estimate from the <a href='https:\/\/apps\.repebble\.com\/muninn-battery-wisdom_[0-9a-f]+'>Muninn app<\/a>, which has to be on your watch\.<\/span>$/);
    // What the mode shows is in the picture of the bar above the rows: the hint does not repeat it.
    assert.equal(hint.indexOf('80%'), -1, value);
    assert.equal(hint.indexOf('Order'), -1, value);
    assert.ok(hint.replace(/<[^>]+>/g, '').length < 190, value + ': short');
  });
  assert.match(hints.days, /^Shows the percentage instead while/);
  assert.match(hints.both, /^Shows the percentage alone while/);
});

test('the dialog\'s rows: Value selection and Bold; Both adds the pair\'s rows, Custom its text field', () => {
  assert.deepEqual(shown(BATTERY, {}, BASALT), ['batterySlotDisplay', 'threshBatteryPctBoldMode']);
  assert.deepEqual(shown(BATTERY, { batterySlotDisplay: 'days' }, BASALT), ['batterySlotDisplay', 'threshBatteryPctBoldMode']);
  assert.deepEqual(shown(BATTERY, { batterySlotDisplay: 'both' }, BASALT),
    ['batterySlotDisplay'].concat(PAIR_ROWS, ['threshBatteryPctBoldMode']));
  assert.deepEqual(shown(BATTERY, { batterySlotDisplay: 'both', batterySlotSeparator: 'custom' }, BASALT),
    ['batterySlotDisplay', 'batterySlotOrder', 'batterySlotSeparator', 'batterySlotSeparatorCustom',
      'batterySlotSeparatorSpaced', 'threshBatteryPctBoldMode']);
});

test('a Pebble app without plugins has no days: the dialog is Bold alone', () => {
  ['percent', 'days', 'both'].forEach((display) => {
    assert.deepEqual(shown(BATTERY, { batterySlotDisplay: display, batterySlotSeparator: 'custom' }, NO_PLUGINS),
      ['threshBatteryPctBoldMode'], display);
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
  const wide = Object.assign({ batterySlotSeparator: 'custom', batterySlotSeparatorCustom: '··' }, base);
  assert.equal(batteryDays.slotText(99, wide, EDGE), MARK + '··99d');
});

test('the Phone battery dialog is Bold, for both of its looks', () => {
  const phone = sheet('threshPhoneBattery');
  assert.equal(phone.title, 'Phone battery slot');
  assert.deepEqual(phone.items.map((i) => i.messageKey), ['threshPhoneBatteryBoldMode']);
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

test('the phone battery\'s picture follows its slot\'s Look: the phone\'s icon, or none', () => {
  assert.equal(preview.sample('phoneBattery', {}, { cap: EDGE, env: BASALT }), '72%');
  assert.ok(preview.slotIcon('phoneBattery', BASALT, {}, 'statusForecastLeft'), 'the phone glyph');
  assert.ok(preview.slotIcon('phoneBattery', BASALT, { statusForecastLeftPhoneBatteryLook: 'both' }, 'statusForecastLeft'));
  assert.equal(preview.slotIcon('phoneBattery', BASALT, { statusForecastLeftPhoneBatteryLook: 'text' }, 'statusForecastLeft'), null);
  assert.ok(preview.slotIcon('phoneBattery', BASALT, { statusForecastLeftPhoneBatteryLook: 'text' }, 'statusForecastRight'),
    'another slot\'s Look says nothing about this one');
  // Two slots of one install, each as it is set, and as the bake packs them.
  const now = new Date(2026, 10, 21, 12, 0, 0);
  const S = { statusForecastLeft: 'phoneBattery', statusForecastRight: 'phoneBattery',
    statusForecastLeftPhoneBatteryLook: 'text', statusForecastRightPhoneBatteryLook: 'both' };
  const slots = preview.barSlots(S, BASALT, 'forecast', false, now);
  assert.deepEqual([slots[0].code, slots[0].text, slots[0].icon, slots[0].drawing], ['phoneBattery', '72%', null, null]);
  assert.equal(slots[2].drawing, 'PHONE_BATTERY');
  assert.ok(slots[2].icon);
  const phone = { supported: true, reading: () => ({ available: true, level: 72 }) };
  const baked = decodeLine(statusLines.buildStatusLines({ CITY: 'Bonn', SUN_EVENTS: [1, 0, 0, 0, 0] }, S,
    { platform: 'basalt' }, now, phone, null).STATUS_LINE_1_UINT8);
  assert.deepEqual([baked[0].icon, baked[2].icon], [catalog.ICONS.PHONE_BATTERY_PLAIN, catalog.ICONS.PHONE_BATTERY]);
  assert.deepEqual([baked[0].text, baked[2].text], ['72%', '72%']);
});

test('the Edit button opens the Watch battery\'s dialog for its text: a drawn battery has none', () => {
  const sheetOf = PConf.sheetResolvers.get('statusSlotEditSheet');
  const badge = PConf.badgeResolvers.get('thresholdPenState');
  const env = { thresholds: true };
  const args = { messageKey: 'statusTopRight' };
  const S = (more) => Object.assign({ statusTopRight: 'battery' }, more);
  assert.equal(sheetOf(S({}), env, args), null, 'the Icon look: nothing to set but the Look under the slot');
  assert.equal(badge(S({ threshBatteryPctBoldMode: 'always' }), env, args), null, 'and nothing to badge');
  assert.equal(badge(S({ statusBoldAll: 'all' }), env, args), null, 'not even under the master row');
  assert.equal(sheetOf(S({ batterySlotLook: 'text' }), env, args), 'threshBatteryPct');
  assert.equal(sheetOf(S({ batterySlotLook: 'text' }), { thresholds: false }, args), null, 'aplite has no slot dialogs');
  assert.equal(badge(S({ batterySlotLook: 'text', threshBatteryPctBoldMode: 'always' }), env, args).bold, true);
  assert.equal(badge(S({ batterySlotLook: 'text', statusBoldAll: 'all' }), env, args).bold, true);
  assert.equal(badge(S({ batterySlotLook: 'text' }), env, args).bold, false);
  // The phone battery prints text in both looks, so its dialog (Bold) is always there.
  const left = { messageKey: 'statusForecastLeft' };
  ['both', 'text'].forEach((look) => {
    assert.equal(sheetOf({ statusForecastLeft: 'phoneBattery', statusForecastLeftPhoneBatteryLook: look }, env, left),
      'threshPhoneBattery', look);
  });
});

test('Reset status bars puts the batteries back: the drawn battery, the percentage, every slot\'s phone icon', () => {
  const defaults = {};
  nodes((node) => typeof node.messageKey === 'string' && /attery/.test(node.messageKey))
    .forEach((item) => { defaults[item.messageKey] = item.defaultValue; });
  const S = { batterySlotLook: 'text', batterySlotDisplay: 'both', batterySlotOrder: 'days',
    batterySlotSeparator: 'custom', batterySlotSeparatorCustom: '~', batterySlotSeparatorSpaced: true,
    statusForecastLeftPhoneBatteryLook: 'text', statusRadarRightPhoneBatteryLook: 'text', holidayCountry: 'DE' };
  const defaultOf = (key) => (Object.prototype.hasOwnProperty.call(defaults, key) ? defaults[key] : undefined);
  assert.equal(PConf.actions.resetStatusSlots(null, S, BASALT, defaultOf), true);
  assert.deepEqual([S.batterySlotLook, S.batterySlotDisplay, S.batterySlotOrder, S.batterySlotSeparator,
    S.batterySlotSeparatorCustom, S.batterySlotSeparatorSpaced],
  ['icon', 'percent', 'percent', 'bar', '', false]);
  catalog.allSlotKeys().forEach((slotKey) => {
    assert.equal(S[catalog.phoneBatteryLookKey(slotKey)], 'both', slotKey);
  });
});

test('a bar that is made or deleted clears its slots\' Looks with them', () => {
  const env = platform.computeEnv({ platform: 'emery' });
  const S = { statusBar4Made: false, statusBar4LeftPhoneBatteryLook: 'text', statusBar4LeftCountdown: '2026-12-24' };
  const bar = screens.makeBar(S, env);
  assert.equal(bar, 'bar4');
  assert.equal(S.statusBar4LeftPhoneBatteryLook, undefined, 'a Look left from an earlier bar 4 is gone');
  assert.equal(S.statusBar4LeftCountdown, undefined);
  S.statusBar4Left = 'phoneBattery';
  S.statusBar4LeftPhoneBatteryLook = 'text';
  const was = screens.unmakeBar(S, 'bar4', env);
  assert.equal(S.statusBar4LeftPhoneBatteryLook, undefined);
  assert.equal(was.statusBar4LeftPhoneBatteryLook, 'text', 'Undo puts it back');
});
