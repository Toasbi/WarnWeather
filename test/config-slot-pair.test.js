// test/config-slot-pair.test.js — the rows that shape a two-value status slot.
//
// Temperature and UV each print a PAIR in their "Both" mode (12|10, 3/7). How the pair
// reads is chosen in that kind's slot dialog, under the card's More options (they are
// rarely changed): which value leads, a separator dropdown (four presets labelled by
// example, plus Custom), a custom-separator field the Custom pick reveals, and whether
// spaces flank the separator (one toggle over every preset). UV adds the mark on a max
// that has rolled on to tomorrow's peak, which shows in Day max as well as Both. The
// phone bakes all of it into the slot text (status-pair.js); the watch is not involved.
//
// The contract pinned here: the keys and stored values the formatter reads, each kind's
// default separator (the bar for temperature, the slash for UV) printing exactly what
// an absent key prints, the rows showing only in the modes where they mean something,
// tight joins inside the pair group (the shape every row group revealed by a control
// has), and the reset covering them.
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
  prefix: 'temp', sheetId: 'threshTemp', samples: ['12', '10'], defaultSeparator: 'bar',
  order: [['Temp first', 'actual'], ['Feels like first', 'feels']],
  modes: ['actual', 'feels', 'both'],
  separators: [['12/10', 'slash'], ['12(10)', 'brackets'], ['12·10', 'dot'], ['12|10', 'bar'],
    ['Custom', 'custom']]
}, {
  prefix: 'uv', sheetId: 'threshUv', samples: ['3', '7'], defaultSeparator: 'slash',
  order: [['Now first', 'now'], ['Max first', 'max']],
  modes: ['current', 'max', 'both'],
  separators: [['3/7', 'slash'], ['3(7)', 'brackets'], ['3·7', 'dot'], ['3|7', 'bar'],
    ['Custom', 'custom']]
}];
const MARKS = [['»6', 'raquo'], ['>6', 'gt'], ['+6', 'plus'], ['6*', 'star'], ['No mark', 'none']];

test('each two-value sheet leads with its Value selection group: order, then the separator rows', () => {
  KINDS.forEach((k) => {
    const keys = sheet(k.sheetId).items.map(it => it.messageKey || it.type);
    assert.equal(keys[0], k.prefix + 'SlotDisplay', k.sheetId + ': Value selection leads the sheet');
    assert.equal(item(k.prefix + 'SlotDisplay').label, 'Value selection');
    assert.deepEqual(keys.slice(1, 5),
      [k.prefix + 'SlotOrder', k.prefix + 'SlotSeparator', k.prefix + 'SlotSeparatorCustom',
        k.prefix + 'SlotSeparatorSpaced'],
      k.sheetId + ': order, separator, custom separator, spacing — in that order');
    // The Value selection is a main row; the rows shaping its pair wait under the card's
    // More options (they render after the card's main rows while it is open).
    assert.equal(item(k.prefix + 'SlotDisplay').more, undefined, k.prefix + ': Value selection in view');
    ['SlotOrder', 'SlotSeparator', 'SlotSeparatorCustom', 'SlotSeparatorSpaced'].forEach((suffix) => {
      assert.strictEqual(item(k.prefix + suffix).more, true, k.prefix + suffix + ' rides More options');
    });
  });
  assert.strictEqual(item('uvSlotNextDayMark').more, true, 'the tomorrow mark rides More options too');
  // UV's tomorrow mark closes its Value selection group, and Bold closes the slot's own
  // rows; the highlight group follows as a card of its own: its 'Alert highlighting'
  // header, the switch, then the row leading to UV's alert sheet on the Alerts tab (its
  // levels and colours live there).
  const uvItems = sheet('threshUv').items;
  const uvKeys = uvItems.map(it => it.messageKey || it.type);
  assert.deepEqual(uvKeys.slice(uvKeys.indexOf('uvSlotSeparatorSpaced') + 1),
    ['uvSlotNextDayMark', 'threshUvBoldMode', 'subheader', 'threshUvOn', 'sheet']);
  assert.equal(uvItems[uvKeys.indexOf('subheader')].text, 'Alert highlighting');
  assert.equal(uvItems[uvKeys.indexOf('sheet')].sheetId, 'alertUv');
  // Temp's degree toggle answers to every mode, so it stays after the pair group, and
  // Bold closes the sheet.
  const tempKeys = sheet('threshTemp').items.map(it => it.messageKey);
  assert.deepEqual(tempKeys.slice(tempKeys.indexOf('tempSlotSeparatorSpaced') + 1),
    ['tempSlotUnit', 'threshTempBoldMode']);
});

test('the separator is a dropdown of example-labelled presets plus Custom, each kind\'s default', () => {
  KINDS.forEach((k) => {
    const sep = item(k.prefix + 'SlotSeparator');
    // A dropdown, as the owner asked — not a pill row or a radio list.
    assert.equal(sep.type, 'select', k.prefix + ' separator is a select');
    assert.equal(sep.label, 'Separator');
    assert.equal(sep.defaultValue, k.defaultSeparator, k.prefix + ': the kind\'s default');
    assert.equal(sep.defaultValue, statusPair.defaultSeparator(k.prefix),
      k.prefix + ': the page reads the formatter\'s default');
    assert.deepEqual(sep.options, k.separators, k.prefix + ' separator options');
    // The fit rule, explained for every value but the default, which IS its last step.
    assert.equal(sep.hint, undefined, k.prefix + ': no value-blind hint');
    const [a, b] = k.samples;
    const last = a + statusPair.SEPARATORS[k.defaultSeparator].mid + b;
    k.separators.map(o => o[1]).forEach((value) => {
      const hint = sep.hintByValue[value];
      if (value === k.defaultSeparator) {
        assert.equal(hint, undefined, k.prefix + ': no hint for the default ' + value);
        return;
      }
      assert.match(String(hint), /drops its spaces/, k.prefix + ' ' + value + ': the spaces go first');
      assert.ok(String(hint).indexOf('falls back to ' + last) !== -1,
        k.prefix + ' ' + value + ': names the pair it falls back to, ' + last);
    });
  });
  // Only a day-max pair can still be too wide in its default form.
  assert.equal(item('uvSlotSeparator').hintByValue.bar,
    'When the pair doesn\'t fit, it drops its spaces, then falls back to 3/7, then to the reading alone.');
  assert.equal(item('tempSlotSeparator').hintByValue.slash,
    'When the pair doesn\'t fit, it drops its spaces, then falls back to 12|10.');
});

test('spacing is one toggle over every preset, off by default, its hint on the kind\'s samples', () => {
  const WIDE = 19;
  KINDS.forEach((k) => {
    const spaced = item(k.prefix + 'SlotSeparatorSpaced');
    assert.equal(spaced.type, 'toggle');
    assert.equal(spaced.label, 'Spaces around separator');
    assert.equal(spaced.defaultValue, false, k.prefix + ': off keeps the pair tight');
    const [a, b] = k.samples;
    const mid = statusPair.SEPARATORS[k.defaultSeparator].mid;
    // Two separators' spaced forms, the kind's default first, so the hint cannot read
    // as "switch to a spaced slash" for someone on brackets or the dot. Shown only
    // while the toggle is on: the hint explains the selected value alone.
    assert.equal(spaced.hint, undefined);
    assert.deepEqual(Object.keys(spaced.hintByValue), ['true']);
    assert.equal(spaced.hintByValue.true, 'Adds spaces to any separator: ' + a + ' ' + mid + ' ' +
      b + ', ' + a + ' (' + b + ').');
  });
  assert.equal(item('tempSlotSeparatorSpaced').hintByValue.true,
    'Adds spaces to any separator: 12 | 10, 12 (10).');
  // The hint's promise, read back through the formatter.
  assert.equal(statusPair.formatTempPair('12', '10', { tempSlotSeparatorSpaced: true }, WIDE),
    '12 | 10');
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
  // Empty falls back to the kind's default separator.
  assert.match(String(item('tempSlotSeparatorCustom').hint), /empty prints 12\|10\./);
  assert.match(String(item('uvSlotSeparatorCustom').hint), /empty uses the slash\./);
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
  assert.equal(blob.tempSlotSeparator, 'bar');
  assert.equal(blob.tempSlotSeparatorCustom, '');
  assert.equal(blob.tempSlotSeparatorSpaced, false);
  assert.equal(blob.tempSlotOrder, 'actual');
  assert.equal(blob.uvSlotSeparator, 'slash');
  assert.equal(blob.uvSlotSeparatorCustom, '');
  assert.equal(blob.uvSlotSeparatorSpaced, false);
  assert.equal(blob.uvSlotOrder, 'now');
  assert.equal(blob.uvSlotNextDayMark, 'raquo');
  // A blob without the keys must render exactly like the page's defaults, or saving
  // the page once would change a watchface nobody touched.
  assert.equal(statusPair.formatTempPair('-12', '-10', blob), '-12|-10');
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
// Rows a control reveals join TIGHT (joinPrevious: true): each row drops its divider and
// tightens (.nb) onto the next revealed row, and the group's last row keeps its divider
// to whatever follows. Hidden rows are skipped by the join look-ahead, so a mode that
// reveals nothing leaves the sheet exactly as it was. The pair rows ride the card's
// More options, so they render after the card's main rows: the group joins inside
// itself, but never reaches back across the More fold onto the Value selection or Bold.

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
// Either join (tight nb or loose nbl): the row drops its divider.
const JOINED = /\bnbl?\b/;

/**
 * Boot the real page with a stored state and open a sheet.
 * @param {Object} cfg Stored settings.
 * @param {string} sheetId Sheet to open.
 * @param {boolean} [more] Also open the sheet's More options (where the pair rows sit).
 * @returns {Object} The harness, sheet open.
 */
function openSheet(cfg, sheetId, more) {
  const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, cfg));
  page.clickTab('watch');
  page.openEditSheet(sheetId);
  if (more) { page.openAllMore('modal'); }
  return page;
}

test('Temp in Both: the pair rows join each other tight; the degree keeps its divider', () => {
  // As the dialog opens on default pair rows, they wait folded under More options.
  const folded = openSheet({ tempSlotDisplay: 'both' }, 'threshTemp').modal.innerHTML;
  assert.equal(folded.indexOf('data-k="tempSlotOrder"'), -1, 'the pair rows start folded');
  assert.ok(folded.indexOf('<span class="more-n">3 more</span>') !== -1,
    'the More row counts Order, Separator and Spacing');
  assert.doesNotMatch(rowClass(folded, 'tempSlotDisplay'), JOINED,
    'nothing it reveals is in view, so the display row keeps its divider');

  const html = openSheet({ tempSlotDisplay: 'both' }, 'threshTemp', true).modal.innerHTML;
  assert.doesNotMatch(rowClass(html, 'tempSlotDisplay'), JOINED,
    'the display row keeps its divider: the pair rows sit after the main rows, under More options');
  assert.ok(html.indexOf('data-k="threshTempBoldMode"') < html.indexOf('data-k="tempSlotOrder"'),
    'the pair group follows the main rows');
  assert.doesNotMatch(rowClass(html, 'threshTempBoldMode'), JOINED,
    'Bold keeps its divider: the group opens below it, never joined back across the fold');
  assert.match(rowClass(html, 'tempSlotOrder'), TIGHT, 'Order tightens onto Separator');
  assert.match(rowClass(html, 'tempSlotSeparator'), TIGHT, 'Separator tightens onto Spacing');
  assert.doesNotMatch(rowClass(html, 'tempSlotSeparatorSpaced'), JOINED,
    'Spacing keeps its divider: it closes the pair group');
  assert.doesNotMatch(rowClass(html, 'tempSlotUnit'), JOINED,
    'the degree keeps its divider above Bold, its own row');
  assert.equal(html.indexOf('data-k="tempSlotSeparatorCustom"'), -1, 'no custom field on a preset');
});

test('Temp in Both with Custom: the field sits inside the group and caps at 2', () => {
  const html = openSheet({ tempSlotDisplay: 'both', tempSlotSeparator: 'custom',
    tempSlotSeparatorCustom: ', ' }, 'threshTemp').modal.innerHTML;
  assert.match(rowClass(html, 'tempSlotSeparator'), TIGHT);
  assert.match(rowClass(html, 'tempSlotSeparatorCustom'), TIGHT);
  assert.doesNotMatch(rowClass(html, 'tempSlotSeparatorSpaced'), JOINED, 'the group ends on Spacing');
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

test('UV: the mark shows in Day max, the pair rows join in Both, the highlight group follows', () => {
  const max = openSheet({ uvSlotDisplay: 'max' }, 'threshUv', true).modal.innerHTML;
  assert.equal(max.indexOf('data-select="uvSlotSeparator"'), -1, 'Day max prints no pair');
  assert.ok(max.indexOf('data-select="uvSlotNextDayMark"') !== -1, 'Day max shows the mark');
  assert.doesNotMatch(rowClass(max, 'uvSlotDisplay'), JOINED,
    'the display row keeps its divider: the mark sits under More options, after Bold');
  assert.doesNotMatch(rowClass(max, 'threshUvBoldMode'), JOINED, 'Bold is not joined onto the mark');
  assert.doesNotMatch(rowClass(max, 'uvSlotNextDayMark'), JOINED,
    'the mark closes the card with its divider');

  const both = openSheet({ uvSlotDisplay: 'both' }, 'threshUv', true).modal.innerHTML;
  ['uvSlotOrder', 'uvSlotSeparator', 'uvSlotSeparatorSpaced'].forEach((key) => {
    assert.match(rowClass(both, key), TIGHT, key + ' tightens onto the next row of the group');
  });
  assert.doesNotMatch(rowClass(both, 'uvSlotNextDayMark'), JOINED, 'the mark closes the group');
  assert.doesNotMatch(rowClass(both, 'threshUvBoldMode'), JOINED,
    'Bold keeps its divider: the group opens below it');

  const now = openSheet({ uvSlotDisplay: 'current' }, 'threshUv', true).modal.innerHTML;
  assert.equal(now.indexOf('data-select="uvSlotNextDayMark"'), -1, 'Now prints no max to mark');
  assert.equal(now.indexOf('data-more='), -1, 'nothing left under More options in Now');
  assert.doesNotMatch(rowClass(now, 'uvSlotDisplay'), JOINED, 'Bold follows directly');
  // The highlight group is a card of its own after Bold: its header, the switch, then the
  // row leading to the levels and colours in UV's alert sheet (Alerts tab).
  const card = now.indexOf('<span class="ttl">Alert highlighting</span>');
  assert.ok(card > now.indexOf('data-k="threshUvBoldMode"'), 'the Alert highlighting card follows Bold');
  assert.ok(now.indexOf('data-k="threshUvOn"') > card, 'its switch inside it');
  assert.ok(/<div class="row nav[^"]*" data-edit-sheet="alertUv"[^>]*><div class="lft"><div class="lbl">Alert levels and colors<\/div>/
    .test(now.slice(card)), 'then the row into the alert sheet');
  assert.ok(now.indexOf('data-edit-sheet="alertUv"') > now.indexOf('data-k="threshUvOn"'), 'below the switch');
  assert.ok(now.indexOf('<span class="nav-note">Alerts</span>') > card, 'naming the tab it lives in');
});

test('the separator dropdown opens inside the sheet and a Custom pick reveals the field', () => {
  const page = openSheet({ tempSlotDisplay: 'both' }, 'threshTemp', true);
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
  assert.ok(page.modal.innerHTML.indexOf('id="ssel-list-tempSlotSeparator" class="isel-list"') !== -1,
    'the preset list opens in place, under its row');
  assert.ok(page.modal.innerHTML.indexOf('data-k="tempSlotDisplay"') !== -1, 'the sheet stays drawn around it');
  assert.ok(page.modal.innerHTML.indexOf('12(10)') !== -1, 'labelled by example');
  click('[data-select-pick]', { 'data-k': 'tempSlotSeparator', 'data-select-pick': 'custom' });
  assert.equal(page.S.tempSlotSeparator, 'custom');
  assert.equal(page.modal.innerHTML.indexOf('isel-list'), -1, 'the pick collapses the list');
  assert.ok(page.modal.innerHTML.indexOf('data-k="tempSlotSeparatorCustom"') !== -1,
    'the sheet stays open, with the custom field revealed');
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
    tempSlotSeparator: 'bar', tempSlotSeparatorCustom: '', tempSlotSeparatorSpaced: false,
    tempSlotOrder: 'actual',
    uvSlotSeparator: 'slash', uvSlotSeparatorCustom: '', uvSlotSeparatorSpaced: false,
    uvSlotOrder: 'now', uvSlotNextDayMark: 'raquo'
  });
});
