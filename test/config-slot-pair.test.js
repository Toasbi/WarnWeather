// test/config-slot-pair.test.js — the rows that shape a two-value status slot.
//
// Temperature and UV each print a PAIR in their "Both" mode (12/10, 3/7). How the pair
// reads is chosen on that kind's Edit sheet, right under its display pills: a separator
// dropdown (four presets labelled by example, plus Custom), a custom-separator field the
// Custom pick reveals, whether spaces flank the separator (one toggle over every preset),
// and which value leads. UV adds the mark on a max that has rolled
// on to tomorrow's peak, which shows in Day max as well as Both. The phone bakes all of
// it into the slot text (status-pair.js); the watch is not involved.
//
// The contract pinned here: the keys and stored values the formatter reads, defaults
// that print exactly what the slot printed before these rows existed, the rows showing
// only in the modes where they mean something, tight joins onto the display row (the
// shape every row group revealed by a control has), and the reset covering them.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const schema = require('../src/pkjs/settings/schema.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
const statusPair = require('../src/pkjs/status-pair.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

const PC = global.PConf;
const ENV = { thresholds: true, color: true, health: true, platform: 'basalt' };

/**
 * @param {string} sheetId e.g. 'threshTemp'
 * @returns {Object} The sheetOnly section with that id.
 */
function sheet(sheetId) {
  const s = schema.tabs.find(t => t.id === 'watch').sections.find(x => x.sheetId === sheetId);
  assert.ok(s, 'no sheet ' + sheetId);
  return s;
}

/**
 * @param {string} key messageKey
 * @returns {Object} The one schema item carrying it.
 */
function item(key) {
  const found = [];
  schema.tabs.forEach(t => t.sections.forEach(s => s.items.forEach((it) => {
    if (it.messageKey === key) { found.push(it); }
  })));
  assert.equal(found.length, 1, key + ' must be declared exactly once');
  return found[0];
}

// The two kinds, side by side. `samples` are the numbers the option labels are built
// on, leading value first; `order` is the order row's [label, value] list, default first.
const KINDS = [{
  prefix: 'temp', sheetId: 'threshTemp', samples: ['12', '10'],
  order: [['Temp first', 'actual'], ['Feels like first', 'feels']],
  modes: ['actual', 'feels', 'both'],
  separators: [['12/10', 'slash'], ['12(10)', 'brackets'], ['12·10', 'dot'], ['12|10', 'bar'],
    ['Custom', 'custom']]
}, {
  prefix: 'uv', sheetId: 'threshUv', samples: ['3', '7'],
  order: [['Now first', 'now'], ['Max first', 'max']],
  modes: ['current', 'max', 'both'],
  separators: [['3/7', 'slash'], ['3(7)', 'brackets'], ['3·7', 'dot'], ['3|7', 'bar'],
    ['Custom', 'custom']]
}];
const MARKS = [['»6', 'raquo'], ['>6', 'gt'], ['+6', 'plus'], ['6*', 'star'], ['No mark', 'none']];

test('each two-value sheet carries its pair rows right under the display pills', () => {
  KINDS.forEach((k) => {
    const keys = sheet(k.sheetId).items.map(it => it.messageKey);
    const at = keys.indexOf(k.prefix + 'SlotDisplay');
    assert.ok(at > 0, k.sheetId + ' has its display pills below Bold');
    assert.deepEqual(keys.slice(at + 1, at + 5),
      [k.prefix + 'SlotSeparator', k.prefix + 'SlotSeparatorCustom',
        k.prefix + 'SlotSeparatorSpaced', k.prefix + 'SlotOrder'],
      k.sheetId + ': separator, custom separator, spacing, order — in that order');
  });
  // UV's tomorrow mark closes its display group, still above the Thresholds header.
  const uvKeys = sheet('threshUv').items.map(it => it.messageKey || it.type);
  assert.equal(uvKeys[uvKeys.indexOf('uvSlotOrder') + 1], 'uvSlotNextDayMark');
  assert.equal(uvKeys[uvKeys.indexOf('uvSlotNextDayMark') + 1], 'subheader');
  // Temp's degree toggle answers to every mode, so it stays after the pair group.
  const tempKeys = sheet('threshTemp').items.map(it => it.messageKey);
  assert.equal(tempKeys[tempKeys.indexOf('tempSlotOrder') + 1], 'tempSlotUnit');
});

test('the separator is a dropdown of example-labelled presets plus Custom, slash by default', () => {
  KINDS.forEach((k) => {
    const sep = item(k.prefix + 'SlotSeparator');
    // A dropdown, as the owner asked — not a pill row or a radio list.
    assert.equal(sep.type, 'select', k.prefix + ' separator is a select');
    assert.equal(sep.label, 'Separator');
    assert.equal(sep.defaultValue, 'slash', k.prefix + ': the slash the slot has always printed');
    assert.deepEqual(sep.options, k.separators, k.prefix + ' separator options');
    // The fit rule is invisible otherwise: '-12 / -10' is 9 bytes of an edge slot's 8.
    assert.match(String(sep.hint), /left or right slot/, k.prefix + ' hint names the narrow slots');
    assert.match(String(sep.hint), /drops its spaces/, k.prefix + ' hint says the spaces go first');
    assert.match(String(sep.hint), /slash/, k.prefix + ' hint says what it falls back to');
  });
});

test('spacing is one toggle over every preset, off by default, its hint on the kind\'s samples', () => {
  const WIDE = 19;
  KINDS.forEach((k) => {
    const spaced = item(k.prefix + 'SlotSeparatorSpaced');
    assert.equal(spaced.type, 'toggle');
    assert.equal(spaced.label, 'Spaces around separator');
    assert.equal(spaced.defaultValue, false, k.prefix + ': off keeps the 12/10 the slot always printed');
    const [a, b] = k.samples;
    // Two separators' spaced forms, so the hint cannot read as "switch to a spaced
    // slash" for someone on brackets or the dot.
    assert.equal(spaced.hint, 'Adds spaces to any separator: ' + a + ' / ' + b + ', ' +
      a + ' (' + b + ').');
  });
  // The hint's promise, read back through the formatter.
  assert.equal(statusPair.formatTempPair('12', '10', { tempSlotSeparatorSpaced: true }, WIDE),
    '12 / 10');
  assert.equal(statusPair.formatPeak('uv', { now: 3, peak: 7, nextDay: false },
    { uvSlotSeparatorSpaced: true }, WIDE), '3 / 7');
});

test('every separator label is exactly what the slot prints for its sample pair', () => {
  // The labels are built from the formatter's own table; this reads them back through
  // the formatter's public functions, at the middle slot's wide cap so no preset falls
  // back, and fails if a label ever promises something the watch would not show.
  const WIDE = 19;
  item('tempSlotSeparator').options.filter(o => o[1] !== 'custom').forEach((o) => {
    assert.equal(statusPair.formatTempPair('12', '10', { tempSlotSeparator: o[1] }, WIDE), o[0],
      'temp ' + o[1]);
    assert.equal(statusPair.formatTempPair('12', '10', { tempSlotSeparator: o[1],
      tempSlotSeparatorSpaced: false }, WIDE), o[0], 'the labels are the tight forms: ' + o[1]);
  });
  item('uvSlotSeparator').options.filter(o => o[1] !== 'custom').forEach((o) => {
    assert.equal(statusPair.formatPeak('uv', { now: 3, peak: 7, nextDay: false },
      { uvSlotSeparator: o[1] }, WIDE), o[0], 'uv ' + o[1]);
  });
  item('uvSlotNextDayMark').options.forEach((o) => {
    assert.equal(statusPair.formatPeak('uv', { now: null, peak: 6, nextDay: true },
      { uvSlotNextDayMark: o[1] }), o[1] === 'none' ? '6' : o[0], 'mark ' + o[1]);
  });
});

test('the custom separator is a 2-character text field that explains what survives', () => {
  KINDS.forEach((k) => {
    const custom = item(k.prefix + 'SlotSeparatorCustom');
    assert.equal(custom.type, 'text');
    assert.equal(custom.label, 'Custom separator');
    assert.equal(custom.defaultValue, '');
    // The engine lands attributes.maxlength on the <input> verbatim (soft UI cap); the
    // formatter re-applies the same limit after dropping what the font can't draw.
    assert.equal(custom.attributes.maxlength, 2, k.prefix + ' custom separator caps at 2');
    assert.equal(custom.attributes.maxlength, statusPair.CUSTOM_MAX_CHARS,
      'the UI cap is the formatter\'s cap');
    const hint = String(custom.hint);
    assert.match(hint, /2 characters/, 'hint states the length');
    assert.match(hint, /spaces/i, 'hint says spaces count');
    assert.match(hint, /ASCII/, 'hint names what the font draws');
    assert.match(hint, /Latin-1/, 'hint names what the font draws');
  });
});

test('the order pills keep the order the slot has always printed as the default', () => {
  KINDS.forEach((k) => {
    const order = item(k.prefix + 'SlotOrder');
    assert.equal(order.type, 'segmented');
    assert.equal(order.label, 'Order');
    assert.deepEqual(order.options, k.order, k.prefix + ' order options');
    assert.equal(order.defaultValue, k.order[0][1], k.prefix + ' order default');
  });
});

test('the UV tomorrow mark is a dropdown whose default is the » the slot always printed', () => {
  const mark = item('uvSlotNextDayMark');
  assert.equal(mark.type, 'select');
  assert.equal(mark.label, 'Tomorrow\'s peak mark');
  assert.equal(mark.defaultValue, 'raquo');
  assert.deepEqual(mark.options, MARKS);
});

test('the new rows carry no onChange hook and never mute', () => {
  // The formatter sanitises the custom text authoritatively, and nothing here couples
  // to another key the way Both couples to the degree (tempUnitExclusive).
  ['tempSlotSeparator', 'tempSlotSeparatorCustom', 'tempSlotSeparatorSpaced', 'tempSlotOrder',
    'uvSlotSeparator', 'uvSlotSeparatorCustom', 'uvSlotSeparatorSpaced', 'uvSlotOrder',
    'uvSlotNextDayMark'].forEach((key) => {
    assert.equal(item(key).onChange, undefined, key + ' has no hook');
    assert.equal(item(key).disabledWhen, undefined, key + ' is never muted');
  });
});

test('the pair rows show only in Both; the custom field only on a Custom pick', () => {
  const SEPARATOR_STATES = [undefined, 'slash', 'brackets', 'dot', 'bar', 'custom'];
  KINDS.forEach((k) => {
    k.modes.concat([undefined]).forEach((mode) => {
      SEPARATOR_STATES.forEach((sep) => {
        const ctx = { env: ENV };
        ctx[k.prefix + 'SlotDisplay'] = mode;
        ctx[k.prefix + 'SlotSeparator'] = sep;
        const both = mode === 'both';
        const what = k.prefix + ' mode=' + mode + ' sep=' + sep;
        assert.equal(showWhen.isVisible(item(k.prefix + 'SlotSeparator'), ctx), both,
          what + ': separator');
        assert.equal(showWhen.isVisible(item(k.prefix + 'SlotSeparatorSpaced'), ctx), both,
          what + ': spacing, over every separator the custom one included');
        assert.equal(showWhen.isVisible(item(k.prefix + 'SlotOrder'), ctx), both,
          what + ': order');
        assert.equal(showWhen.isVisible(item(k.prefix + 'SlotSeparatorCustom'), ctx),
          both && sep === 'custom', what + ': custom separator');
      });
    });
  });
  // An absent display key is the default mode, which prints one value: nothing to shape.
  const S = PC.engine.hydrate(schema, {}, ENV);
  const ctx = Object.assign({}, S, { env: ENV });
  ['tempSlotSeparator', 'tempSlotSeparatorSpaced', 'tempSlotOrder', 'uvSlotSeparator',
    'uvSlotSeparatorSpaced', 'uvSlotOrder', 'uvSlotNextDayMark']
    .forEach(key => assert.equal(showWhen.isVisible(item(key), ctx), false,
      key + ' hides on a fresh install'));
});

test('the tomorrow mark shows in Day max and Both — the two modes that print a max', () => {
  ['current', 'max', 'both', undefined].forEach((mode) => {
    assert.equal(showWhen.isVisible(item('uvSlotNextDayMark'), { uvSlotDisplay: mode, env: ENV }),
      mode === 'max' || mode === 'both', 'mode ' + mode);
  });
});

test('the degree toggle stays on the Temp sheet in every mode', () => {
  ['actual', 'feels', 'both'].forEach((mode) => {
    assert.equal(showWhen.isVisible(item('tempSlotUnit'), { tempSlotDisplay: mode, env: ENV }),
      true, 'mode ' + mode);
  });
});

test('fresh defaults ride the save blob and print exactly what an absent key prints', () => {
  const blob = PC.engine.serialize(schema, PC.engine.hydrate(schema, {}, ENV));
  assert.equal(blob.tempSlotSeparator, 'slash');
  assert.equal(blob.tempSlotSeparatorCustom, '');
  assert.equal(blob.tempSlotSeparatorSpaced, false);
  assert.equal(blob.tempSlotOrder, 'actual');
  assert.equal(blob.uvSlotSeparator, 'slash');
  assert.equal(blob.uvSlotSeparatorCustom, '');
  assert.equal(blob.uvSlotSeparatorSpaced, false);
  assert.equal(blob.uvSlotOrder, 'now');
  assert.equal(blob.uvSlotNextDayMark, 'raquo');
  // A blob saved before these rows existed has none of the keys; the page's defaults
  // must render it byte for byte the same, or saving the page once would change a
  // watchface nobody touched.
  assert.equal(statusPair.formatTempPair('-12', '-10', blob), '-12/-10');
  assert.equal(statusPair.formatTempPair('-12', '-10', blob),
    statusPair.formatTempPair('-12', '-10', {}));
  [{ now: 3, peak: 7, nextDay: false }, { now: 11, peak: 12, nextDay: true },
    { now: null, peak: 6, nextDay: true }].forEach((uv) => {
    assert.equal(statusPair.formatPeak('uv', uv, blob), statusPair.formatPeak('uv', uv, {}),
      JSON.stringify(uv));
  });
  assert.equal(statusPair.formatPeak('uv', { now: 11, peak: 12, nextDay: true }, blob), '11/»12');
});

// --- rendered spacing ---------------------------------------------------------
// Rows a control reveals join it TIGHT (joinPrevious: true), the Nighttime card's
// Theme switching shape: the control's row drops its divider and tightens (.nb) onto
// the first revealed row, and the group's last row keeps its divider to whatever
// follows. Hidden rows are skipped by the join look-ahead, so a mode that reveals
// nothing leaves the sheet exactly as it was.

/**
 * Class attribute of the row holding a control (data-k for pills/toggles/text,
 * data-select for a dropdown trigger).
 * @param {string} html Rendered sheet HTML.
 * @param {string} key messageKey of the control.
 * @returns {string} The row's opening tag up to (not including) '>'.
 */
function rowClass(html, key) {
  let at = html.indexOf('data-k="' + key + '"');
  if (at === -1) { at = html.indexOf('data-select="' + key + '"'); }
  assert.ok(at !== -1, key + ' rendered');
  const open = html.lastIndexOf('<div class="row', at);
  return html.slice(open, html.indexOf('>', open));
}
const TIGHT = /\bnb\b/;
const LOOSE = /\bnbl\b/;

/**
 * Boot the real page with a stored state and open a sheet.
 * @param {Object} cfg Stored settings.
 * @param {string} sheetId Sheet to open.
 * @returns {Object} The harness, sheet open.
 */
function openSheet(cfg, sheetId) {
  const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, cfg));
  page.clickTab('watch');
  page.openEditSheet(sheetId);
  return page;
}

test('Temp in Both: the pair rows join the display row tight; the degree keeps its divider', () => {
  const html = openSheet({ tempSlotDisplay: 'both' }, 'threshTemp').modal.innerHTML;
  assert.match(rowClass(html, 'tempSlotDisplay'), TIGHT, 'display row tightens onto Separator');
  assert.match(rowClass(html, 'tempSlotSeparator'), TIGHT, 'Separator tightens onto Spacing');
  assert.match(rowClass(html, 'tempSlotSeparatorSpaced'), TIGHT, 'Spacing tightens onto Order');
  assert.doesNotMatch(rowClass(html, 'tempSlotOrder'), /\bnbl?\b/,
    'Order keeps its divider: the degree row is not part of the pair group');
  assert.equal(html.indexOf('data-k="tempSlotSeparatorCustom"'), -1, 'no custom field on a preset');
});

test('Temp in Both with Custom: the field sits inside the group and caps at 2', () => {
  const html = openSheet({ tempSlotDisplay: 'both', tempSlotSeparator: 'custom',
    tempSlotSeparatorCustom: ', ' }, 'threshTemp').modal.innerHTML;
  assert.match(rowClass(html, 'tempSlotSeparator'), TIGHT);
  assert.match(rowClass(html, 'tempSlotSeparatorCustom'), TIGHT);
  assert.match(rowClass(html, 'tempSlotSeparatorSpaced'), TIGHT);
  assert.match(html, /data-k="tempSlotSeparatorCustom" value=", "[^>]*maxlength="2"/,
    'the stored text is shown untrimmed, capped at 2');
});

test('Temp outside Both: no pair rows, and the sheet spaces exactly as before', () => {
  ['actual', 'feels'].forEach((mode) => {
    const html = openSheet({ tempSlotDisplay: mode, tempSlotSeparator: 'custom' },
      'threshTemp').modal.innerHTML;
    ['tempSlotSeparator', 'tempSlotSeparatorCustom', 'tempSlotSeparatorSpaced',
      'tempSlotOrder'].forEach((key) => {
      assert.equal(html.indexOf('data-k="' + key + '"'), -1, mode + ': ' + key + ' hidden');
      assert.equal(html.indexOf('data-select="' + key + '"'), -1, mode + ': ' + key + ' hidden');
    });
    assert.doesNotMatch(rowClass(html, 'tempSlotDisplay'), /\bnbl?\b/,
      mode + ': the divider under the display row is back');
  });
});

test('UV: the mark joins in Day max, the pair rows join in Both, the Thresholds header follows', () => {
  const max = openSheet({ uvSlotDisplay: 'max' }, 'threshUv').modal.innerHTML;
  assert.equal(max.indexOf('data-select="uvSlotSeparator"'), -1, 'Day max prints no pair');
  assert.match(rowClass(max, 'uvSlotDisplay'), TIGHT, 'display row tightens onto the mark');
  assert.match(rowClass(max, 'uvSlotNextDayMark'), LOOSE, 'the header draws its own line');

  const both = openSheet({ uvSlotDisplay: 'both' }, 'threshUv').modal.innerHTML;
  ['uvSlotDisplay', 'uvSlotSeparator', 'uvSlotSeparatorSpaced', 'uvSlotOrder'].forEach((key) => {
    assert.match(rowClass(both, key), TIGHT, key + ' tightens onto the next row of the group');
  });
  assert.match(rowClass(both, 'uvSlotNextDayMark'), LOOSE);

  const now = openSheet({ uvSlotDisplay: 'current' }, 'threshUv').modal.innerHTML;
  assert.equal(now.indexOf('data-select="uvSlotNextDayMark"'), -1, 'Now prints no max to mark');
  assert.match(rowClass(now, 'uvSlotDisplay'), LOOSE, 'as before: the header follows directly');
});

test('the separator dropdown opens inside the sheet and a Custom pick reveals the field', () => {
  const page = openSheet({ tempSlotDisplay: 'both' }, 'threshTemp');
  /**
   * @param {string} selector The one selector the target answers to.
   * @param {Object} attrs getAttribute table.
   */
  function click(selector, attrs) {
    const node = {
      getAttribute: n => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
      closest: sel => (sel === selector ? node : null)
    };
    page.modal.dispatch('click', { target: node });
  }
  click('[data-select]', { 'data-select': 'tempSlotSeparator' });
  assert.ok(page.modal.innerHTML.indexOf('data-ssel-list="tempSlotSeparator"') !== -1,
    'the preset list opens');
  assert.ok(page.modal.innerHTML.indexOf('12(10)') !== -1, 'labelled by example');
  click('[data-select-pick]', { 'data-k': 'tempSlotSeparator', 'data-select-pick': 'custom' });
  assert.equal(page.S.tempSlotSeparator, 'custom');
  assert.ok(page.modal.innerHTML.indexOf('data-k="tempSlotSeparatorCustom"') !== -1,
    'back on the sheet, with the custom field revealed');
  // Leaving Both hides the rows but keeps what they hold (hidden rows still serialize),
  // so coming back to Both finds the same custom separator.
  click('[data-v]', { 'data-k': 'tempSlotDisplay', 'data-v': 'actual' });
  assert.equal(page.modal.innerHTML.indexOf('tempSlotSeparatorCustom'), -1);
  assert.equal(page.S.tempSlotSeparator, 'custom', 'the stored pick survives');
});

test('picking Both still clears the degree, and the pair rows leave the degree alone', () => {
  const page = openSheet({ tempSlotDisplay: 'actual', tempSlotUnit: true }, 'threshTemp');
  const node = (attrs) => {
    const n = {
      getAttribute: k => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
      closest: sel => (sel === '[data-v]' ? n : null)
    };
    return n;
  };
  page.modal.dispatch('click', { target: node({ 'data-k': 'tempSlotDisplay', 'data-v': 'both' }) });
  assert.equal(page.S.tempSlotUnit, false, 'Both clears the degree (tempUnitExclusive)');
  page.modal.dispatch('click', { target: node({ 'data-k': 'tempSlotOrder', 'data-v': 'feels' }) });
  assert.equal(page.S.tempSlotOrder, 'feels');
  assert.equal(page.S.tempSlotDisplay, 'both', 'the order pick does not leave Both');
  assert.equal(page.S.tempSlotUnit, false);
});

test('Reset status bars puts every pair row and the tomorrow mark back to its default', () => {
  const byKey = {};
  schema.tabs.forEach(t => t.sections.forEach(s => s.items.forEach((it) => {
    if (it.messageKey) { byKey[it.messageKey] = it; }
  })));
  const defaultOf = key => PC.engine.resolveDefaultFrom(byKey[key], ENV);
  const S = {
    tempSlotSeparator: 'custom', tempSlotSeparatorCustom: '~', tempSlotSeparatorSpaced: true,
    tempSlotOrder: 'feels',
    uvSlotSeparator: 'bar', uvSlotSeparatorCustom: 'x', uvSlotSeparatorSpaced: true,
    uvSlotOrder: 'max', uvSlotNextDayMark: 'star'
  };
  assert.equal(PC.actions.resetStatusSlots(null, S, ENV, defaultOf), true);
  assert.deepEqual({
    tempSlotSeparator: S.tempSlotSeparator, tempSlotSeparatorCustom: S.tempSlotSeparatorCustom,
    tempSlotSeparatorSpaced: S.tempSlotSeparatorSpaced,
    tempSlotOrder: S.tempSlotOrder, uvSlotSeparator: S.uvSlotSeparator,
    uvSlotSeparatorCustom: S.uvSlotSeparatorCustom,
    uvSlotSeparatorSpaced: S.uvSlotSeparatorSpaced, uvSlotOrder: S.uvSlotOrder,
    uvSlotNextDayMark: S.uvSlotNextDayMark
  }, {
    tempSlotSeparator: 'slash', tempSlotSeparatorCustom: '', tempSlotSeparatorSpaced: false,
    tempSlotOrder: 'actual',
    uvSlotSeparator: 'slash', uvSlotSeparatorCustom: '', uvSlotSeparatorSpaced: false,
    uvSlotOrder: 'now', uvSlotNextDayMark: 'raquo'
  });
});
