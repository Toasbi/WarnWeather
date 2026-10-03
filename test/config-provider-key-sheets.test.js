// test/config-provider-key-sheets.test.js — a weather provider that needs a key gets a key
// row ("<Name> API key") under the Weather provider dropdown (Setup tab, Weather data), and
// every key-related row lives in the sheet it opens: the key field with its Test button and
// verdict line, the hint with its links and, for tomorrow.io, the call-budget read-out and
// guard. The keys, their storage and the Save blob are the ones the card's rows carried.
// Schema shape first, then the resolvers, then the REAL generated page (page-harness).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

const PC = global.PConf;
const setup = schema.tabs.find((t) => t.id === 'setup');
const card = setup.sections.find((s) => s.id === 'weatherData');
const providerRow = card.items.find((i) => i.messageKey === 'provider');
const noteItem = card.items[card.items.indexOf(providerRow) + 1];
// The nav row under the picker (and its amber note) that opens the picked provider's key sheet.
const keyRow = card.items[card.items.indexOf(providerRow) + 2];
const sheetById = (id) => setup.sections.find((s) => s.sheetOnly && s.sheetId === id);

// Provider value -> [sheetId, sheet title, the sheet's rows (messageKey order)].
const KEYED = {
  openweathermap: ['providerKeyOwm', 'OpenWeatherMap', ['owmApiKey'], 'testOwmKey'],
  tomorrowio: ['providerKeyTomorrowio', 'Tomorrow.io', ['tomorrowioApiKey', 'tomorrowioFitBudget'], 'testTomorrowioKey'],
  yandex: ['providerKeyYandex', 'Yandex Weather', ['yandexApiKey'], undefined]
};

/**
 * Type into a text field rendered in the open edit sheet and commit it, the way a browser
 * reports it: focusin, one input (S follows per keystroke), then change (blur/Enter).
 * @param {Object} page bootGeneratedPage handle.
 * @param {string} key The field's messageKey.
 * @param {string} value The typed text.
 * @returns {void}
 */
function typeInSheet(page, key, value) {
  assert.ok(page.modal.innerHTML.indexOf('data-k="' + key + '"') !== -1, key + ' is in the open sheet');
  const inp = {
    value,
    getAttribute: (n) => (n === 'data-k' ? key : null),
    closest: (sel) => (sel === 'input[type=text]' ? inp : null)
  };
  ['focusin', 'input', 'change'].forEach((type) => page.modal.dispatch(type, { target: inp }));
}

/**
 * Open the Graphs tab's Rain radar pane (the radar's picker, key row and key sheets).
 * @param {Object} page bootGeneratedPage handle.
 * @returns {void}
 */
function openRadarPane(page) {
  page.clickTab('graphs');
  page.clickPane('graphs', 'radar');
}

test('the keyed providers are exactly the options whose tag says they need a key', () => {
  const needsKey = providerRow.options.filter((o) => /needs (a free |an? )?key/.test(o[2].desc)).map((o) => o[1]);
  assert.deepEqual(needsKey.sort(), Object.keys(KEYED).sort());
  assert.equal(keyRow.type, 'sheet', 'the key row is a nav row');
  assert.deepEqual(keyRow.editSheetFrom.resolver, 'keySheet');
  assert.deepEqual(Object.keys(keyRow.editSheetFrom.args.keyed).sort(), Object.keys(KEYED).sort());
  assert.equal(keyRow.labelFrom.resolver, 'keyRowLabel');
  assert.equal(keyRow.hintFrom.resolver, 'keyRowSummary');
  // The picker keeps only its "why" copy; the key's summary is the key row's own line.
  ['editSheetFrom', 'editBadgeFrom', 'hintFrom'].forEach((k) =>
    assert.equal(providerRow[k], undefined, 'the picker has no ' + k + ' any more'));
  assert.ok(providerRow.hintByValue && providerRow.hintByValue.openweathermap, 'the picker\'s why copy');
  // Every key-status resolver on the picker, its note and the key row reads ONE table.
  [keyRow.labelFrom, keyRow.hintFrom, providerRow.attentionFrom, noteItem.textFrom].forEach((from) =>
    assert.equal(from.args.keyed, keyRow.editSheetFrom.args.keyed, from.resolver));
});

test('each key sheet sits right below the card, sheetOnly, gated on its provider, rows and all', () => {
  const at = setup.sections.indexOf(card);
  const sheets = setup.sections.slice(at + 1, at + 4);
  assert.deepEqual(sheets.map((s) => s.sheetId), Object.keys(KEYED).map((p) => KEYED[p][0]));
  Object.keys(KEYED).forEach((provider) => {
    const [id, title, keys, action] = KEYED[provider];
    const sheet = sheetById(id);
    assert.equal(sheet.sheetOnly, true, id);
    assert.equal(sheet.title, title, id + ' is titled with the provider\'s name');
    assert.deepEqual(sheet.items.map((i) => i.messageKey), keys);
    assert.equal(keyRow.editSheetFrom.args.keyed[provider].sheetId, id);
    assert.equal(keyRow.editSheetFrom.args.keyed[provider].keyField, keys[0]);
    // Section AND item carry the gate: findShownItem judges a key's copies by the item's own.
    [sheet].concat(sheet.items).forEach((it) => assert.deepEqual(it.showWhen, { key: 'provider', eq: provider }));
    const field = sheet.items[0];
    assert.equal(field.type, 'text');
    assert.equal(field.label, 'API key', 'the title names the provider, so the field does not repeat it');
    assert.equal(field.defaultValue, '');
    assert.equal(field.suffixAction, action);
    if (action) { assert.equal(field.suffixLabel, 'Test'); }
  });
  assert.equal(sheetById('providerKeyTomorrowio').items[1].blockBefore, 'tomorrowioBudget',
    'the call-budget read-out rides into the sheet with its guard');
});

test('keySheet: the picked provider\'s key sheet, nothing for a provider without a key', () => {
  const fn = PC.sheetResolvers.get('keySheet');
  const args = Object.assign({ messageKey: 'provider' }, keyRow.editSheetFrom.args);
  Object.keys(KEYED).forEach((p) => assert.equal(fn({ provider: p }, {}, args), KEYED[p][0], p));
  ['dwd', 'metno', 'openmeteo', 'wunderground', 'constructor', '', undefined].forEach((p) =>
    assert.equal(fn({ provider: p }, {}, args), null, String(p)));
});

test('keyRowLabel / keyRowSummary: "<Name> API key"; a dimmed "No key" while the key is empty, the key\'s summary once it is in', () => {
  const label = PC.hintResolvers.get('keyRowLabel');
  const fn = PC.hintResolvers.get('keyRowSummary');
  const args = (from, value) => Object.assign({ messageKey: 'provider', value }, from.args);
  const NO_KEY = '<span class="hint-faint">No key</span>';
  Object.keys(KEYED).forEach((p) =>
    assert.equal(label({ provider: p }, {}, args(keyRow.labelFrom, p)), KEYED[p][1] + ' API key', p));
  assert.equal(fn({ provider: 'openweathermap', owmApiKey: '' }, {}, args(keyRow.hintFrom, 'openweathermap')), NO_KEY,
    'no "Tap Edit" pointer: the amber note says what is missing');
  assert.equal(fn({ provider: 'yandex' }, {}, args(keyRow.hintFrom, 'yandex')), NO_KEY, 'an unset key is empty');
  assert.equal(fn({ provider: 'tomorrowio', tomorrowioApiKey: '  \n' }, {}, args(keyRow.hintFrom, 'tomorrowio')), NO_KEY,
    'a blank key is empty (Save trims it to nothing)');
  assert.equal(fn({ provider: 'openweathermap', owmApiKey: 'abcd1234' }, {}, args(keyRow.hintFrom, 'openweathermap')),
    'Key ••••1234 · not tested yet');
  assert.equal(fn({ provider: 'yandex', owmApiKey: 'k' }, {}, args(keyRow.hintFrom, 'yandex')), NO_KEY,
    'another provider\'s key does not count');
  ['dwd', 'wunderground', 'constructor'].forEach((p) => {
    assert.equal(fn({ provider: p }, {}, args(keyRow.hintFrom, p)), null, p);
    assert.equal(label({ provider: p }, {}, args(keyRow.labelFrom, p)), null, p);
  });
});

test('page: the key row under the dropdown opens the provider\'s key sheet; no key fields on the card', () => {
  Object.keys(KEYED).forEach((provider) => {
    const [id, title, keys, action] = KEYED[provider];
    const page = bootGeneratedPage({ provider });
    page.clickTab('setup');
    const body = page.scroll.innerHTML;
    assert.ok(new RegExp('data-select="provider"[^]*?data-edit-sheet="' + id + '"').test(body),
      provider + ': the key row trails the dropdown');
    assert.ok(!new RegExp('data-edit-sheet="' + id + '"[^]*?data-select="provider"').test(body));
    keys.forEach((k) => assert.equal(body.indexOf('data-k="' + k + '"'), -1, k + ' is not on the page'));
    assert.ok(body.indexOf('<div class="row nav indent" data-edit-sheet="' + id + '" role="button" tabindex="0" ' +
      'style="cursor:pointer"><div class="lft"><div class="lbl">' + title + ' API key</div>' +
      '<div class="hint"><span class="hint-faint">No key</span></div>') !== -1,
    provider + ': the empty key\'s row reads "No key"');
    assert.ok(body.indexOf('Needs an API key. Without one, the watch gets no forecast.') !== -1,
      provider + ': and the amber note says why');

    page.openEditSheet(id);
    const sheet = page.modal.innerHTML;
    assert.ok(sheet.indexOf('esheet-ttl-' + id + '">' + title + '</span>') !== -1, 'titled ' + title);
    assert.ok(sheet.indexOf('<div class="lbl">API key</div>') !== -1);
    keys.forEach((k) => assert.ok(sheet.indexOf('data-k="' + k + '"') !== -1, k + ' is in the sheet'));
    if (action) {
      assert.ok(sheet.indexOf('data-action="' + action + '">Test</button>') !== -1, 'the Test button');
      assert.ok(sheet.indexOf('data-action-result="' + keys[0] + '"') !== -1, 'and its verdict line');
    }
  });
});

test('page: a provider without a key shows no key row and keeps its plain hint', () => {
  ['dwd', 'metno', 'openmeteo', 'wunderground'].forEach((provider) => {
    const page = bootGeneratedPage({ provider });
    page.clickTab('setup');
    assert.ok(page.scroll.innerHTML.indexOf('data-select="provider"') !== -1, provider + ': the picker is drawn');
    assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="providerKey/, provider);
    assert.doesNotMatch(page.scroll.innerHTML, /API key<\/div>/, provider + ': no key row');
    assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key|Key ••••/, provider);
    assert.doesNotMatch(page.scroll.innerHTML, /tab-dot/, provider + ': no tab carries a dot');
  });
});

test('page: a key typed in the sheet is stored, drops the pointer and saves trimmed', async () => {
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: '' });
  page.clickTab('setup');
  page.openEditSheet('providerKeyOwm');
  typeInSheet(page, 'owmApiKey', '  abc123 ');
  assert.equal(page.S.owmApiKey, '  abc123 ');
  page.doneDialog();   // Done keeps it (× would put the empty key back)
  assert.equal(page.modal.innerHTML, '', 'the sheet closed');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/, 'the note goes once a key is in');
  assert.doesNotMatch(page.scroll.innerHTML, /No key/, 'and the key row no longer reads "No key"');
  assert.ok(page.scroll.innerHTML.indexOf('<div class="lbl">OpenWeatherMap API key</div>' +
    '<div class="hint">Key ••••c123 · not tested yet</div>') !== -1, 'the key row\'s summary names the key');
  const saved = await page.save();
  assert.equal(saved.owmApiKey, 'abc123', 'Save trims it as before (onbuild.js)');
  assert.equal(saved.provider, 'openweathermap');
});

test('page: the tomorrow.io sheet carries the budget read-out and its guard, which still fits the interval', () => {
  const page = bootGeneratedPage({ provider: 'tomorrowio', tomorrowioApiKey: 'k', fetchIntervalMin: '5',
    sleepNightEnabled: false, radarProvider: 'rainbow', tomorrowioFitBudget: true });
  page.clickTab('setup');
  assert.ok(page.scroll.innerHTML.indexOf('data-edit-sheet="providerKeyTomorrowio"') !== -1, 'premise: on the key row\'s tab');
  assert.equal(page.scroll.innerHTML.indexOf('calls/day'), -1, 'no read-out on the page');
  page.openEditSheet('providerKeyTomorrowio');
  assert.ok(page.modal.innerHTML.indexOf('calls/day') !== -1, 'the read-out is in the sheet');
  page.clickModalToggle('tomorrowioFitBudget');
  assert.equal(page.S.tomorrowioFitBudget, false, 'the guard flips from inside the sheet');
  assert.ok(page.modal.innerHTML.indexOf('data-k="tomorrowioFitBudget"') !== -1, 'and the sheet stays open');
});

test('page: the key hint\'s copy button works inside the sheet', () => {
  const page = bootGeneratedPage({ provider: 'tomorrowio' });
  const copied = [];
  page.window.navigator.clipboard = { writeText: (text) => { copied.push(text); return { then() {} }; } };
  page.clickTab('setup');
  page.openEditSheet('providerKeyTomorrowio');
  const url = 'https://app.tomorrow.io/development/keys';
  assert.ok(page.modal.innerHTML.indexOf('data-copy="' + url + '"') !== -1);
  const t = {
    getAttribute: (n) => (n === 'data-copy' ? url : null),
    closest: (sel) => (sel === '[data-copy]' ? t : null)
  };
  page.modal.dispatch('click', { target: t });
  assert.deepEqual(copied, [url]);
  assert.ok(page.modal.innerHTML.length > 0, 'the tap does not close the sheet');
});

test('page: the copy button in the Rain radar pane\'s Tomorrow.io sheet copies too', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'graph' });
  const copied = [];
  page.window.navigator.clipboard = { writeText: (text) => { copied.push(text); return { then() {} }; } };
  openRadarPane(page);
  page.openEditSheet('radarKeyTomorrowio');
  const url = 'https://app.tomorrow.io/development/keys';
  assert.ok(page.modal.innerHTML.indexOf('data-copy="' + url + '"') !== -1);
  const t = {
    getAttribute: (n) => (n === 'data-copy' ? url : null),
    closest: (sel) => (sel === '[data-copy]' ? t : null)
  };
  page.modal.dispatch('click', { target: t });
  assert.deepEqual(copied, [url]);
  assert.ok(page.modal.innerHTML.length > 0, 'the tap does not close the sheet');
});

test('page: radar-only tomorrow.io keeps its key in the Rain radar pane\'s sheet, and no key row under the weather provider', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'graph' });
  page.clickTab('setup');
  assert.ok(page.scroll.innerHTML.indexOf('data-select="provider"') !== -1, 'premise: the weather provider\'s tab');
  assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="providerKey/);
  openRadarPane(page);
  const tab = page.scroll.innerHTML;
  assert.ok(new RegExp('data-select="radarProvider"[^]*?data-edit-sheet="radarKeyTomorrowio"').test(tab),
    'the key row trails the Radar provider dropdown');
  assert.ok(new RegExp('data-edit-sheet="radarKeyTomorrowio"[^>]*><div class="lft"><div class="lbl">Tomorrow\\.io API key</div>')
    .test(tab), 'labelled with the provider\'s name');
  ['tomorrowioApiKey', 'tomorrowioFitBudget'].forEach((k) =>
    assert.equal(tab.indexOf('data-k="' + k + '"'), -1, k + ' is not on the Graphs tab\'s page'));
  page.openEditSheet('radarKeyTomorrowio');
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('esheet-ttl-radarKeyTomorrowio">Tomorrow.io<') !== -1, 'titled Tomorrow.io');
  assert.ok(sheet.indexOf('<div class="lbl">API key</div>') !== -1, 'the title names the provider');
  assert.ok(sheet.indexOf('data-action="testTomorrowioKey">Test</button>') !== -1, 'with its Test button');
  assert.ok(sheet.indexOf('data-action-result="tomorrowioApiKey"') !== -1, 'and its verdict line');
  assert.ok(sheet.indexOf('calls/day') !== -1, 'the call-budget read-out');
  assert.ok(sheet.indexOf('data-k="tomorrowioFitBudget"') !== -1, 'and its guard');
});

test('the two tomorrow.io copies stay apart: findShownItem returns the one that shows', () => {
  const ctx = (S) => Object.assign({}, S, { env: {} });
  const sheetOf = (item) => {
    let found = null;
    PC.schemaWalk.eachItem(schema, (it, sec) => { if (it === item) { found = sec.sheetId; } });
    return found;
  };
  ['tomorrowioApiKey', 'tomorrowioFitBudget'].forEach((key) => {
    assert.equal(sheetOf(PC.engine.findShownItem(schema, key, ctx({ provider: 'tomorrowio' }))),
      'providerKeyTomorrowio', key + ': the weather provider\'s sheet');
    assert.equal(sheetOf(PC.engine.findShownItem(schema, key,
      ctx({ provider: 'tomorrowio', radarProvider: 'tomorrowio', radarMode: 'graph' }))),
    'providerKeyTomorrowio', key + ': both — still the weather provider\'s sheet, the one copy');
    assert.equal(sheetOf(PC.engine.findShownItem(schema, key,
      ctx({ provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'graph' }))),
    'radarKeyTomorrowio', key + ': radar-only — the Rain radar pane\'s sheet');
  });
});

test('the setup wizard\'s tomorrow.io field: any copy of the key row, labelled with the provider\'s name', () => {
  // wizard.js tomorrowioUpsell renders findItem(schema, 'tomorrowioApiKey') — the last copy in
  // walk order, now the Setup tab's weather-provider sheet's (Setup follows Graphs) — under its
  // own label "Tomorrow.io API key" (the wizard has no sheet title naming the provider). Both
  // copies render the same field.
  const copies = [];
  PC.schemaWalk.eachItem(schema, (it) => { if (it.messageKey === 'tomorrowioApiKey') { copies.push(it); } });
  assert.equal(copies.length, 2);
  const strip = (it) => Object.assign({}, it, { showWhen: undefined });
  assert.deepEqual(strip(copies[0]), strip(copies[1]), 'the two copies differ only by their gate');
  assert.equal(copies[1].suffixAction, 'testTomorrowioKey');
});
