// test/config-provider-key-sheets.test.js — a weather provider that needs a key gets an Edit
// button after the Weather provider dropdown (General tab, Provider settings), and every
// key-related row lives in the sheet it opens: the key field with its Test button and
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
const general = schema.tabs.find((t) => t.id === 'general');
const card = general.sections.find((s) => s.title === 'Provider settings');
const providerRow = card.items.find((i) => i.messageKey === 'provider');
const sheetById = (id) => general.sections.find((s) => s.sheetOnly && s.sheetId === id);

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
 * Tap the open sheet's close button.
 * @param {Object} page bootGeneratedPage handle.
 * @returns {void}
 */
function closeSheet(page) {
  const t = { closest: (sel) => (sel === '[data-select-close]' ? t : null), getAttribute: () => null };
  page.modal.dispatch('click', { target: t });
}

test('the keyed providers are exactly the options whose tag says they need a key', () => {
  const needsKey = providerRow.options.filter((o) => /needs (a free |an? )?key/.test(o[2].desc)).map((o) => o[1]);
  assert.deepEqual(needsKey.sort(), Object.keys(KEYED).sort());
  assert.deepEqual(providerRow.editSheetFrom.resolver, 'keySheet');
  assert.deepEqual(Object.keys(providerRow.editSheetFrom.args.keyed).sort(), Object.keys(KEYED).sort());
  assert.equal(providerRow.hintFrom.resolver, 'keySummaryHint');
  assert.equal(providerRow.hintFrom.args.hints, providerRow.hintByValue,
    'the summary rides under the same "why" copy the row shows, so the two cannot drift');
  // Every key-status resolver on the row reads ONE table.
  [providerRow.editBadgeFrom, providerRow.hintFrom, providerRow.attentionFrom].forEach((from) =>
    assert.equal(from.args.keyed, providerRow.editSheetFrom.args.keyed, from.resolver));
});

test('each key sheet sits right below the card, sheetOnly, gated on its provider, rows and all', () => {
  const at = general.sections.indexOf(card);
  const sheets = general.sections.slice(at + 1, at + 4);
  assert.deepEqual(sheets.map((s) => s.sheetId), Object.keys(KEYED).map((p) => KEYED[p][0]));
  Object.keys(KEYED).forEach((provider) => {
    const [id, title, keys, action] = KEYED[provider];
    const sheet = sheetById(id);
    assert.equal(sheet.sheetOnly, true, id);
    assert.equal(sheet.title, title, id + ' is titled with the provider\'s name');
    assert.deepEqual(sheet.items.map((i) => i.messageKey), keys);
    assert.equal(providerRow.editSheetFrom.args.keyed[provider].sheetId, id);
    assert.equal(providerRow.editSheetFrom.args.keyed[provider].keyField, keys[0]);
    // Section AND item carry the gate: findShownItem judges a key's copies by the item's own.
    [sheet].concat(sheet.items).forEach((it) => assert.deepEqual(it.showWhen, { key: 'provider', eq: provider }));
    const field = sheet.items[0];
    assert.equal(field.type, 'text');
    assert.equal(field.label, 'API key', 'the title names the provider, so the row does not repeat it');
    assert.equal(field.defaultValue, '');
    assert.equal(field.suffixAction, action);
    if (action) { assert.equal(field.suffixLabel, 'Test'); }
  });
  assert.equal(sheetById('providerKeyTomorrowio').items[1].blockBefore, 'tomorrowioBudget',
    'the call-budget read-out rides into the sheet with its guard');
});

test('keySheet: the picked provider\'s key sheet, nothing for a provider without a key', () => {
  const fn = PC.sheetResolvers.get('keySheet');
  const args = Object.assign({ messageKey: 'provider' }, providerRow.editSheetFrom.args);
  Object.keys(KEYED).forEach((p) => assert.equal(fn({ provider: p }, {}, args), KEYED[p][0], p));
  ['dwd', 'metno', 'openmeteo', 'wunderground', 'constructor', '', undefined].forEach((p) =>
    assert.equal(fn({ provider: p }, {}, args), null, String(p)));
});

test('keySummaryHint: the "why" alone while the key is empty, the key\'s summary under it once it is in', () => {
  const fn = PC.hintResolvers.get('keySummaryHint');
  const why = providerRow.hintByValue;
  const args = (value) => Object.assign({ messageKey: 'provider', value }, providerRow.hintFrom.args);
  assert.equal(fn({ owmApiKey: '' }, {}, args('openweathermap')), why.openweathermap,
    'no "Tap Edit" pointer any more: the amber note and the "Add key" button say it');
  assert.equal(fn({}, {}, args('yandex')), why.yandex, 'an unset key is empty');
  assert.equal(fn({ tomorrowioApiKey: '  \n' }, {}, args('tomorrowio')), why.tomorrowio,
    'a blank key is empty (Save trims it to nothing)');
  assert.equal(fn({ owmApiKey: 'abcd1234' }, {}, args('openweathermap')),
    why.openweathermap + '<br>Key ••••1234 · not tested yet');
  assert.equal(fn({ owmApiKey: 'k' }, {}, args('yandex')), why.yandex, 'another provider\'s key does not count');
  ['dwd', 'wunderground', 'constructor'].forEach((p) => assert.equal(fn({}, {}, args(p)), null, p));
});

test('page: Edit after the dropdown opens the provider\'s key sheet; no key rows on the card', () => {
  Object.keys(KEYED).forEach((provider) => {
    const [id, title, keys, action] = KEYED[provider];
    const page = bootGeneratedPage({ provider });
    const body = page.scroll.innerHTML;
    assert.ok(new RegExp('data-select="provider"[^]*?data-edit-sheet="' + id + '"').test(body),
      provider + ': Edit trails the dropdown');
    assert.ok(!new RegExp('data-edit-sheet="' + id + '"[^]*?data-select="provider"').test(body));
    keys.forEach((k) => assert.equal(body.indexOf('data-k="' + k + '"'), -1, k + ' is not on the page'));
    assert.ok(body.indexOf('<span>Add key</span>') !== -1, provider + ': the empty key\'s button reads Add key');
    assert.ok(body.indexOf('Needs an API key. Without one, the watch gets no forecast.') !== -1,
      provider + ': and the amber note says why');

    page.openEditSheet(id);
    const sheet = page.modal.innerHTML;
    assert.ok(sheet.indexOf('>' + title + '</span>') !== -1, 'titled ' + title);
    assert.ok(sheet.indexOf('<div class="lbl">API key</div>') !== -1);
    keys.forEach((k) => assert.ok(sheet.indexOf('data-k="' + k + '"') !== -1, k + ' is in the sheet'));
    if (action) {
      assert.ok(sheet.indexOf('data-action="' + action + '">Test</button>') !== -1, 'the Test button');
      assert.ok(sheet.indexOf('data-action-result="' + keys[0] + '"') !== -1, 'and its verdict line');
    }
  });
});

test('page: a provider without a key shows no Edit button and keeps its plain hint', () => {
  ['dwd', 'metno', 'openmeteo', 'wunderground'].forEach((provider) => {
    const page = bootGeneratedPage({ provider });
    assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="providerKey/, provider);
    assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key|Key ••••/, provider);
    assert.doesNotMatch(page.scroll.innerHTML, /tab-dot/, provider + ': no tab carries a dot');
  });
});

test('page: a key typed in the sheet is stored, drops the pointer and saves trimmed', async () => {
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: '' });
  page.openEditSheet('providerKeyOwm');
  typeInSheet(page, 'owmApiKey', '  abc123 ');
  assert.equal(page.S.owmApiKey, '  abc123 ');
  closeSheet(page);
  assert.equal(page.modal.innerHTML, '', 'the sheet closed');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/, 'the note goes once a key is in');
  assert.ok(page.scroll.innerHTML.indexOf('<span>Edit</span>') !== -1, 'and the button reads Edit again');
  assert.ok(page.scroll.innerHTML.indexOf('Key ••••c123 · not tested yet') !== -1, 'the summary names the key');
  const saved = await page.save();
  assert.equal(saved.owmApiKey, 'abc123', 'Save trims it as before (onbuild.js)');
  assert.equal(saved.provider, 'openweathermap');
});

test('page: the tomorrow.io sheet carries the budget read-out and its guard, which still fits the interval', () => {
  const page = bootGeneratedPage({ provider: 'tomorrowio', tomorrowioApiKey: 'k', fetchIntervalMin: '5',
    sleepNightEnabled: false, radarProvider: 'rainbow', tomorrowioFitBudget: true });
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

test('page: a copy button on a tab still copies (the Radar tab\'s Rainbow key hint)', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarProvider: 'rainbow', radarMode: 'graph', rainbowOwnKey: true });
  const copied = [];
  page.window.navigator.clipboard = { writeText: (text) => { copied.push(text); return { then() {} }; } };
  page.clickTab('radar');
  const url = 'https://developer.rainbow.ai/profile';
  assert.ok(page.scroll.innerHTML.indexOf('data-copy="' + url + '"') !== -1);
  const t = {
    getAttribute: (n) => (n === 'data-copy' ? url : null),
    closest: (sel) => (sel === '[data-copy]' ? t : null)
  };
  page.scroll.dispatch('click', { target: t });
  assert.deepEqual(copied, [url]);
});

test('page: radar-only tomorrow.io keeps its key rows on the Radar tab, and no Edit on the weather row', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'graph' });
  assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="providerKey/);
  page.clickTab('radar');
  const tab = page.scroll.innerHTML;
  assert.ok(tab.indexOf('<div class="lbl">Tomorrow.io API key</div>') !== -1, 'the radar-only key row');
  assert.ok(tab.indexOf('data-action="testTomorrowioKey"') !== -1, 'with its Test button');
  assert.ok(tab.indexOf('data-k="tomorrowioFitBudget"') !== -1, 'and its guard');
});

test('the two tomorrow.io copies stay apart: findShownItem returns the one that shows', () => {
  const ctx = (S) => Object.assign({}, S, { env: {} });
  assert.equal(PC.engine.findShownItem(schema, 'tomorrowioApiKey', ctx({ provider: 'tomorrowio' })).label, 'API key');
  assert.equal(PC.engine.findShownItem(schema, 'tomorrowioApiKey',
    ctx({ provider: 'dwd', radarProvider: 'tomorrowio' })).label, 'Tomorrow.io API key');
});

test('the setup wizard\'s tomorrow.io field (the walk\'s last copy) is still the full key row', () => {
  // wizard.js tomorrowioUpsell renders findItem(schema, 'tomorrowioApiKey'): the LAST item
  // carrying the key in walk order, which is the Radar tab's copy.
  let last = null;
  PC.schemaWalk.eachItem(schema, (it) => { if (it.messageKey === 'tomorrowioApiKey') { last = it; } });
  const weather = sheetById('providerKeyTomorrowio').items[0];
  assert.equal(last.label, 'Tomorrow.io API key', 'it names the provider: the wizard has no sheet title');
  assert.equal(last.suffixAction, 'testTomorrowioKey');
  assert.equal(last.hint, weather.hint, 'the same signup instructions as the key sheet');
});
