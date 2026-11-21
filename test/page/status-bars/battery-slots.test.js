'use strict';
// The two battery slots on the settings page: one Watch battery and one Phone battery in the
// slot lists, each with its Look as the first row of the dialog its slot's Edit button opens,
// like the weather condition's. The phone battery's Look is the slot's own, so each slot has
// a Phone battery dialog of its own and two slots can differ. The Watch battery's Text look
// is set like the temperature slot's: the percentage, the days left or both, with the pair's
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
const statusSlotMigrations = require('../../../src/pkjs/settings/domain/migrations/status-slots.js');
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

test('the watch battery\'s Look leads its dialog in both looks; its slot keeps the picker alone', () => {
  const look = row('batterySlotLook');
  assert.equal(BATTERY.items[0], look, 'the dialog\'s first row, like the weather condition\'s Look');
  assert.equal(look.type, 'segmented');
  assert.equal(look.label, 'Look');
  assert.deepEqual(look.options, [['Icon', 'icon'], ['Text', 'text']]);
  assert.equal(look.defaultValue, 'icon', 'the battery the watch has always drawn');
  assert.equal(look.showWhen, undefined, 'in both looks: it is how the dialog switches them');
  assert.equal(look.joinPrevious, undefined, 'a row of its own');
  assert.deepEqual([look.hint, look.hintByValue], [undefined, undefined],
    'no hint: the picture of the bar above the rows shows what each look draws');
  // The Watch bar's dialog: each slot's picker, and under it nothing but a countdown's date.
  assert.deepEqual(sheet(screens.barSheet('top')).items.slice(0, 8).map((i) => i.messageKey || i.type),
    ['subheader', 'statusTopLeft', 'statusTopLeftCountdown', 'statusTopMid', 'statusTopMidCountdown',
      'statusTopRight', 'statusTopRightCountdown', 'button']);
  // Drawn: the right slot holds the watch battery in its Icon look (basalt's default), and its
  // Edit button is there to switch it.
  const S = PConf.engine.hydrate(schema, {}, BASALT);
  assert.deepEqual([S.statusTopRight, S.batterySlotLook], ['battery', 'icon'], 'premise');
  const bar = PConf.engine.renderEditModal(schema, { S: S, ENV: BASALT, USERDATA: {}, openColor: null,
    openSelect: null, openEdit: screens.barSheet('top'), selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: BASALT }) });
  const right = bar.slice(bar.indexOf('data-select="statusTopRight"'));
  assert.ok(right.slice(0, right.indexOf('</div></div>')).indexOf('data-edit-sheet="threshBatteryPct"') !== -1,
    'the right slot\'s Edit button, in the Icon look');
  assert.equal(bar.indexOf('data-k="batterySlotLook"'), -1, 'no Look row in the bar\'s dialog');
});

test('every slot has a Phone battery dialog of its own: the slot\'s Look, then Bold', () => {
  assert.equal(SLOT_KEYS.length, 21, 'the four bars and bars 4 to 6');
  assert.equal(new Set(SLOT_KEYS.map(catalog.phoneBatterySheet)).size, 21, 'one dialog per slot');
  SLOT_KEYS.forEach((slotKey) => {
    const dialog = sheet(catalog.phoneBatterySheet(slotKey));
    assert.equal(dialog.sheetId, 'threshPhoneBattery' + slotKey.replace(/^status/, ''));
    assert.equal(dialog.title, 'Phone battery slot', slotKey);
    assert.equal(dialog.sheetOnly, true, slotKey + ': opened by its slot\'s Edit button, never a card');
    assert.deepEqual(dialog.showWhen, { env: 'thresholds' }, slotKey + ': no slot dialogs on aplite');
    assert.equal(dialog.pinBlock, 'statusBarsPreview', slotKey + ': the bar pinned above, as over every slot dialog');
    assert.deepEqual(dialog.items.map((i) => i.messageKey), [catalog.phoneBatteryLookKey(slotKey),
      'threshPhoneBatteryBoldMode'], slotKey);
    // The slot's Look: this dialog's alone (no row under the slot's picker writes it).
    const look = dialog.items[0];
    assert.equal(row(catalog.phoneBatteryLookKey(slotKey)), look, slotKey + ': its one row');
    assert.equal(look.messageKey, slotKey + 'PhoneBatteryLook');
    assert.equal(look.type, 'segmented');
    assert.equal(look.label, 'Look');
    assert.deepEqual(look.options, [['Icon + text', 'both'], ['Text', 'text']]);
    assert.equal(look.defaultValue, 'both', 'the phone\'s icon before its charge');
    assert.equal(look.hint, 'For this slot only.', 'what the dialog does not show: Bold below is every slot\'s');
    assert.equal(look.showWhen, undefined, slotKey + ': the dialog opens for its slot alone');
    // Bold: the item's one setting, for every slot and both looks.
    const bold = dialog.items[1];
    assert.deepEqual([bold.label, bold.defaultValue, bold.options], ['Bold', 'off', [['Off', 'off'], ['Always', 'always']]]);
  });
  assert.equal(nodes((node) => node.sheetId === 'threshPhoneBattery').length, 0, 'no dialog shared by every slot');
});

test('the keys the rows write are the catalog\'s: the watch battery\'s list and one Look per slot', () => {
  const sheetKeys = BATTERY.items.map((i) => i.messageKey).filter((key) => !/BoldMode$/.test(key));
  assert.deepEqual(sheetKeys.slice().sort(), catalog.batterySettingKeys().slice().sort());
  const lookRows = nodes((node) => /PhoneBatteryLook$/.test(String(node.messageKey || ''))).map((i) => i.messageKey);
  assert.deepEqual(lookRows.slice().sort(), SLOT_KEYS.map(catalog.phoneBatteryLookKey).sort());
  SLOT_KEYS.forEach((slotKey) => {
    assert.deepEqual(catalog.slotCompanions(slotKey), [{ code: 'countdown', key: slotKey + 'Countdown' },
      { code: 'phoneBattery', key: slotKey + 'PhoneBatteryLook' }]);
  });
});

test('the Watch battery dialog: its Look, what the text shows, the pair\'s rows, then Bold', () => {
  assert.equal(BATTERY.title, 'Watch battery slot');
  assert.deepEqual(BATTERY.items.map((i) => i.messageKey), ['batterySlotLook', 'batterySlotDisplay', 'batterySlotOrder',
    'batterySlotSeparator', 'batterySlotSeparatorCustom', 'batterySlotSeparatorSpaced', 'threshBatteryPctBoldMode']);
  const display = row('batterySlotDisplay');
  assert.equal(display.type, 'segmented');
  assert.equal(display.label, 'Value selection', 'named like the temperature slot\'s');
  assert.deepEqual(display.options, [['Percentage', 'percent'], ['Days left', 'days'], ['Both', 'both']]);
  assert.equal(display.defaultValue, 'percent');
  assert.deepEqual(Object.keys(display.hintByValue), ['days', 'both'], 'the percentage needs no words');
});

test('the hints under Days left and Both say when the percentage shows, then name Muninn on its own line', () => {
  const hints = row('batterySlotDisplay').hintByValue;
  ['days', 'both'].forEach((value) => {
    const hint = hints[value];
    const parts = hint.split('<span style="display:block;margin-top:6px">');
    assert.equal(parts.length, 2, value + ': one line set apart');
    assert.equal(parts[0].indexOf('Muninn'), -1, value + ': the first line is about the watch');
    // "New": after a charge the days from before it stay hidden until a new estimate
    // arrives (status_row.c shows_battery_days).
    assert.match(parts[0], /while the watch charges, your phone is out of reach or there is no new estimate\.$/);
    assert.match(parts[1], /^The days are an estimate from the <a href='https:\/\/apps\.repebble\.com\/muninn-battery-wisdom_[0-9a-f]+'>Muninn app<\/a>, which has to be on your watch\.<\/span>$/);
    // What the mode shows is in the picture of the bar above the rows: the hint does not repeat it.
    assert.equal(hint.indexOf('80%'), -1, value);
    assert.equal(hint.indexOf('Order'), -1, value);
    assert.ok(hint.replace(/<[^>]+>/g, '').length < 190, value + ': short');
  });
  assert.match(hints.days, /^Shows the percentage instead while/);
  assert.match(hints.both, /^Shows the percentage alone while/);
});

test('the dialog\'s rows: the drawn battery\'s Look alone; Text adds Value selection and Bold, Both the pair\'s rows', () => {
  const text = (more) => Object.assign({ batterySlotLook: 'text' }, more);
  assert.deepEqual(shown(BATTERY, {}, BASALT), ['batterySlotLook'], 'the Icon look, the default: nothing else to set');
  assert.deepEqual(shown(BATTERY, { batterySlotLook: 'icon', batterySlotDisplay: 'both', batterySlotSeparator: 'custom' },
    BASALT), ['batterySlotLook'], 'whatever the text is set to');
  assert.deepEqual(shown(BATTERY, text({}), BASALT), ['batterySlotLook', 'batterySlotDisplay', 'threshBatteryPctBoldMode']);
  assert.deepEqual(shown(BATTERY, text({ batterySlotDisplay: 'days' }), BASALT),
    ['batterySlotLook', 'batterySlotDisplay', 'threshBatteryPctBoldMode']);
  assert.deepEqual(shown(BATTERY, text({ batterySlotDisplay: 'both' }), BASALT),
    ['batterySlotLook', 'batterySlotDisplay'].concat(PAIR_ROWS, ['threshBatteryPctBoldMode']));
  assert.deepEqual(shown(BATTERY, text({ batterySlotDisplay: 'both', batterySlotSeparator: 'custom' }), BASALT),
    ['batterySlotLook', 'batterySlotDisplay', 'batterySlotOrder', 'batterySlotSeparator', 'batterySlotSeparatorCustom',
      'batterySlotSeparatorSpaced', 'threshBatteryPctBoldMode']);
});

test('a Pebble app without plugins has no days: the Text look\'s dialog is its Look and Bold', () => {
  ['percent', 'days', 'both'].forEach((display) => {
    assert.deepEqual(shown(BATTERY, { batterySlotLook: 'text', batterySlotDisplay: display, batterySlotSeparator: 'custom' },
      NO_PLUGINS), ['batterySlotLook', 'threshBatteryPctBoldMode'], display);
    assert.deepEqual(shown(BATTERY, { batterySlotDisplay: display }, NO_PLUGINS), ['batterySlotLook'], display + ', Icon look');
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
              { platform: 'basalt' }, now, { watch: watch }).STATUS_LINE_3_UINT8)[2];
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
    { platform: 'basalt' }, now, { phone: phone }).STATUS_LINE_1_UINT8);
  assert.deepEqual([baked[0].icon, baked[2].icon], [catalog.ICONS.PHONE_BATTERY_PLAIN, catalog.ICONS.PHONE_BATTERY]);
  assert.deepEqual([baked[0].text, baked[2].text], ['72%', '72%']);
});

test('the Edit button opens the Watch battery\'s dialog in both looks; the drawn battery badges no bold', () => {
  const sheetOf = PConf.sheetResolvers.get('statusSlotEditSheet');
  const badge = PConf.badgeResolvers.get('thresholdPenState');
  const env = { thresholds: true };
  const args = { messageKey: 'statusTopRight' };
  const S = (more) => Object.assign({ statusTopRight: 'battery' }, more);
  // Its Look is in the dialog, so the dialog is there whatever the Look is.
  assert.equal(sheetOf(S({}), env, args), 'threshBatteryPct', 'the Icon look, the default');
  ['icon', 'text'].forEach((look) => {
    assert.equal(sheetOf(S({ batterySlotLook: look }), env, args), 'threshBatteryPct', look);
    assert.equal(sheetOf(S({ batterySlotLook: look }), { thresholds: false }, args), null, look + ': aplite has no slot dialogs');
  });
  // The drawn battery has no text to print bold: no B, not even when every slot prints bold.
  assert.equal(badge(S({ threshBatteryPctBoldMode: 'always' }), env, args), null);
  assert.equal(badge(S({ statusBoldAll: 'all' }), env, args), null, 'not even under the master row');
  assert.equal(badge(S({ batterySlotLook: 'text', threshBatteryPctBoldMode: 'always' }), env, args).bold, true);
  assert.equal(badge(S({ batterySlotLook: 'text', statusBoldAll: 'all' }), env, args).bold, true);
  assert.equal(badge(S({ batterySlotLook: 'text' }), env, args).bold, false);
  // The phone battery opens its slot's own dialog, in both of its looks.
  SLOT_KEYS.forEach((slotKey) => {
    ['both', 'text'].forEach((look) => {
      const state = {};
      state[slotKey] = 'phoneBattery';
      state[catalog.phoneBatteryLookKey(slotKey)] = look;
      assert.equal(sheetOf(state, env, { messageKey: slotKey }), catalog.phoneBatterySheet(slotKey), slotKey + ', ' + look);
      assert.equal(sheetOf(state, { thresholds: false }, { messageKey: slotKey }), null, slotKey + ' on aplite');
    });
  });
  assert.equal(badge({ statusForecastLeft: 'phoneBattery', threshPhoneBatteryBoldMode: 'always' }, env,
    { messageKey: 'statusForecastLeft' }).bold, true, 'its Bold is badged as every text slot\'s');
});

test('a bar that held the phone battery twice keeps each slot\'s Look, and each slot opens its own dialog', () => {
  // Before 3.3.0 a bar could hold the phone battery with its icon in one slot and without it
  // in another: two items. The merge makes both the one item, the Look telling them apart.
  const blob = { statusForecastLeft: 'phoneBattery', statusForecastRight: 'phoneBatteryPlain' };
  assert.equal(statusSlotMigrations.mergeBatterySlots(blob).changed, true);
  assert.deepEqual([blob.statusForecastLeft, blob.statusForecastRight], ['phoneBattery', 'phoneBattery']);
  const S = PConf.engine.hydrate(schema, blob, BASALT);
  const resolve = PConf.sheetResolvers.get('statusSlotEditSheet');
  const env = { thresholds: true };
  const left = resolve(S, env, { messageKey: 'statusForecastLeft' });
  const right = resolve(S, env, { messageKey: 'statusForecastRight' });
  assert.deepEqual([left, right], ['threshPhoneBatteryForecastLeft', 'threshPhoneBatteryForecastRight']);
  // The bar's dialog draws both Edit buttons, each naming its slot's dialog.
  const cx = (openEdit) => ({ S: S, ENV: BASALT, USERDATA: {}, openColor: null, openSelect: null, openEdit: openEdit,
    selectQuery: '', collapsed: {}, evalCtx: Object.assign({}, S, { env: BASALT }) });
  const bar = PConf.engine.renderEditModal(schema, cx(screens.barSheet('forecast')));
  [left, right].forEach((id) => assert.ok(bar.indexOf('data-edit-sheet="' + id + '"') !== -1, id + ': its Edit button'));
  // Each dialog holds its slot's Look, at what the slot showed: the icon, and the charge alone.
  const look = (id, slotKey, value) => {
    const html = PConf.engine.renderEditModal(schema, cx(id));
    const other = slotKey === 'statusForecastLeft' ? 'statusForecastRight' : 'statusForecastLeft';
    assert.ok(html.indexOf('class="on" data-k="' + slotKey + 'PhoneBatteryLook" data-v="' + value + '"') !== -1,
      id + ': ' + value);
    assert.equal(html.indexOf('data-k="' + other + 'PhoneBatteryLook"'), -1, id + ': not the other slot\'s');
  };
  look(left, 'statusForecastLeft', 'both');
  look(right, 'statusForecastRight', 'text');
  // The picture draws each slot as it is set.
  const slots = preview.barSlots(S, BASALT, 'forecast', false, new Date(2026, 10, 21, 12, 0, 0));
  assert.ok(slots[0].icon, 'left: the phone\'s icon');
  assert.equal(slots[2].icon, null, 'right: the charge alone');
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
