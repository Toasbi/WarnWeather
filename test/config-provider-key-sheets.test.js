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
// The Weather provider picker's keyed sources (key-sources.js), which the row's key-status
// resolvers read by its messageKey.
const SOURCES = require('../src/pkjs/settings/key-sources.js').provider.sources;

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
  assert.deepEqual(Object.keys(SOURCES).sort(), Object.keys(KEYED).sort());
  // Every key-status resolver on the row reads ONE table, key-sources.js', by the row's
  // messageKey; the summary rides under the row's own "why" copy, which the engine hands it
  // (staticHint), so the row carries neither the table nor a second copy of the hints.
  assert.deepEqual([providerRow.editSheetFrom, providerRow.editBadgeFrom, providerRow.hintFrom,
    providerRow.attentionFrom], [{ resolver: 'keySheet' }, { resolver: 'keyBadge' }, { resolver: 'keySummaryHint' },
    { resolver: 'keyAttention' }]);
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
    assert.equal(SOURCES[provider].sheetId, id);
    assert.equal(SOURCES[provider].keyField, keys[0]);
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
  // With the args the engine builds for the row: its messageKey (the row adds none).
  const fn = PC.sheetResolvers.get(providerRow.editSheetFrom.resolver);
  const sheet = (S) => fn(S, {}, Object.assign({ messageKey: 'provider' }, providerRow.editSheetFrom.args));
  Object.keys(KEYED).forEach((p) => assert.equal(sheet({ provider: p }), KEYED[p][0], p));
  ['dwd', 'metno', 'openmeteo', 'wunderground', 'constructor', '', undefined].forEach((p) =>
    assert.equal(sheet({ provider: p }), null, String(p)));
});

test('keySummaryHint: the "why" alone while the key is empty, the key\'s summary under it once it is in', () => {
  // Through the engine, as the page resolves it (its args: the row's messageKey, the shown
  // value and the row's static hint for it).
  const hint = (S, value) => PC.engine.resolveHint(providerRow, S, {}, value);
  const why = providerRow.hintByValue;
  assert.equal(hint({ owmApiKey: '' }, 'openweathermap'), why.openweathermap,
    'no "Tap Edit" pointer any more: the amber note and the "Add key" button say it');
  assert.equal(hint({}, 'yandex'), why.yandex, 'an unset key is empty');
  assert.equal(hint({ tomorrowioApiKey: '  \n' }, 'tomorrowio'), why.tomorrowio,
    'a blank key is empty (Save trims it to nothing)');
  assert.equal(hint({ owmApiKey: 'abcd1234' }, 'openweathermap'),
    why.openweathermap + '<br>Key ••••1234 · not tested yet');
  assert.equal(hint({ owmApiKey: 'k' }, 'yandex'), why.yandex, 'another provider\'s key does not count');
  ['dwd', 'wunderground', 'constructor'].forEach((p) =>
    assert.equal(hint({}, p), undefined, p + ': no key, so the row\'s static hint answers'));
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

test('page: the copy button in the Radar tab\'s Tomorrow.io sheet copies too', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'graph' });
  const copied = [];
  page.window.navigator.clipboard = { writeText: (text) => { copied.push(text); return { then() {} }; } };
  page.clickTab('radar');
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

test('page: radar-only tomorrow.io keeps its key in the Radar tab\'s sheet, and no Edit on the weather row', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'graph' });
  assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="providerKey/);
  page.clickTab('radar');
  const tab = page.scroll.innerHTML;
  assert.ok(new RegExp('data-select="radarProvider"[^]*?data-edit-sheet="radarKeyTomorrowio"').test(tab),
    'Edit trails the Radar provider dropdown');
  ['tomorrowioApiKey', 'tomorrowioFitBudget'].forEach((k) =>
    assert.equal(tab.indexOf('data-k="' + k + '"'), -1, k + ' is not on the Radar tab\'s page'));
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
    'radarKeyTomorrowio', key + ': radar-only — the Radar tab\'s sheet');
  });
});

test('the setup wizard\'s tomorrow.io field: any copy of the key row, labelled with the provider\'s name', () => {
  // wizard.js tomorrowioUpsell renders findItem(schema, 'tomorrowioApiKey') — the last copy in
  // walk order, now the Radar tab's sheet's — under its own label "Tomorrow.io API key" (the
  // wizard has no sheet title naming the provider). Both copies render the same field.
  const copies = [];
  PC.schemaWalk.eachItem(schema, (it) => { if (it.messageKey === 'tomorrowioApiKey') { copies.push(it); } });
  assert.equal(copies.length, 2);
  const strip = (it) => Object.assign({}, it, { showWhen: undefined });
  assert.deepEqual(strip(copies[0]), strip(copies[1]), 'the two copies differ only by their gate');
  assert.equal(copies[1].suffixAction, 'testTomorrowioKey');
});
