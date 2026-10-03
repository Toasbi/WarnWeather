// test/config-radar-key-status.test.js — "Rainbow (own key)" on the Radar provider row has the
// key status a keyed weather provider has (settings/key-status.js, RADAR_KEYS): the key row under
// the dropdown ("Rainbow API key"; its summary "Key ••••1234 · ✓ works · ~2,976 of 5,000 calls a
// month", or a dimmed "No key"), the amber note while the key is missing, the dot on the Graphs
// tab (the Rain radar pane holds the row) and the Save dialog while it is missing or known to be
// rejected. Its key never rides a weather update, so
// the evidence is the Test button's answer and the last radar update's verdict
// (userData.radarKeyResult, weather/radar-key-result.js) — never the weather records. Module
// first, then the REAL generated page (page-harness). Radar-only Tomorrow.io gets the same, its
// key shared with the Tomorrow.io weather provider (the section at the end).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const keyStatus = require('../src/pkjs/settings/key-status.js');
const { fingerprint } = require('../src/pkjs/key-fingerprint.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

const graphsTab = schema.tabs.find((t) => t.id === 'graphs');
const radarSec = graphsTab.sections.find((s) => s.id === 'radar');
const radarRow = radarSec.items.find((i) => i.messageKey === 'radarProvider');
// The nav row under the Radar provider picker that opens the picked source's key sheet.
const radarKeyRow = radarSec.items.find((i) => i.type === 'sheet');
const ARGS = radarRow.attentionFrom.args;
const SOURCE = ARGS.keyed.rainbowkey;
const RBW_KEY = 'rbw-secret-0123wxyz';
// The page's state while open: the picker holds the source (onbuild.js folds the stored pair).
const OWN = { radarProvider: 'rainbowkey', radarMode: 'graph', fetchIntervalMin: '15', sleepNightEnabled: false };
// The same, as the phone stores it.
const STORED_OWN = { provider: 'openmeteo', radarProvider: 'rainbow', rainbowOwnKey: true, radarMode: 'graph',
  fetchIntervalMin: '15', sleepNightEnabled: false };

/**
 * A radar verdict record as the phone stores it (radar-key-result.js).
 * @param {string} key The key the request carried.
 * @param {number} status The status that answered it.
 * @param {string} [id] The radar source.
 * @returns {string} The stored JSON.
 */
function radarRecord(key, status, id) {
  return JSON.stringify({ id: id || 'rainbowkey', keyHash: fingerprint(key), status });
}

/**
 * The state of the own key under the live settings and userData.
 * @param {Object} S Settings (the page's shape).
 * @returns {Object} statusOf's answer.
 */
function stateOf(S) {
  return keyStatus.statusOf(SOURCE, 'rainbowkey', S);
}

/**
 * The tab bar button for a tab, as rendered.
 * @param {Object} page The booted page.
 * @param {string} id The tab id.
 * @returns {string} Its markup.
 */
function tabButton(page, id) {
  const m = new RegExp('<button[^>]*data-tab="' + id + '"[^>]*>[\\s\\S]*?</button>').exec(page.tabs.innerHTML);
  assert.ok(m, id + ' tab rendered');
  return m[0];
}

/**
 * Open the Graphs tab's Rain radar pane, where the Radar provider row and its key row live.
 * @param {Object} page The booted page.
 * @returns {void}
 */
function openRadarPane(page) {
  page.clickTab('graphs');
  page.clickPane('graphs', 'radar');
}

/**
 * A key row (the nav row that opens a key sheet), as rendered in the page.
 * @param {Object} page The booted page.
 * @param {string} sheetId The key sheet it opens.
 * @returns {?string} Its markup up to its summary, or null when it is not drawn.
 */
function keyRowHtml(page, sheetId) {
  const m = page.scroll.innerHTML.match(new RegExp('<div class="row nav[^"]*" data-edit-sheet="' + sheetId +
    '"[^>]*><div class="lft">[\\s\\S]*?</div></div>'));
  return m ? m[0] : null;
}

/**
 * The pane of a tab with panes that the page shows now.
 * @param {Object} page The booted page.
 * @returns {?string} Its data-pane value ("graphs:radar"), or null.
 */
function activePane(page) {
  const m = /class="on" aria-selected="true" data-pane="([^"]+)"/.exec(page.scroll.innerHTML);
  return m ? m[1] : null;
}

/**
 * Tap an element inside #modal (a dialog button, the close button).
 * @param {Object} page The booted page.
 * @param {string} sel The selector the engine's handler asks closest() for.
 * @param {string} [attr] The attribute it reads.
 * @param {string} [value] Its value.
 * @returns {void}
 */
function tapInModal(page, sel, attr, value) {
  const t = { getAttribute: (n) => (n === attr ? value : null), closest: (s) => (s === sel ? t : null) };
  page.modal.dispatch('click', { target: t });
}

test.beforeEach(() => {
  keyStatus.resetTests();
  delete global.INJECTED_USERDATA;
});
test.after(() => { delete global.INJECTED_USERDATA; });

// --- the module ----------------------------------------------------------------------------

test('missing, then untested: a key the page knows nothing about', () => {
  assert.deepEqual(stateOf(Object.assign({ rainbowApiKey: '  ' }, OWN)), { state: 'missing' });
  assert.deepEqual(stateOf(Object.assign({ rainbowApiKey: RBW_KEY }, OWN)), { state: 'untested', tail: 'wxyz' });
});

test('the last radar update\'s verdict on THIS key counts: 2xx and 429 work, 401/403 are refused', () => {
  const S = Object.assign({ rainbowApiKey: RBW_KEY }, OWN);
  const at = (record) => { global.INJECTED_USERDATA = { radarKeyResult: record }; return stateOf(S); };
  assert.deepEqual(at(radarRecord(RBW_KEY, 200)), { state: 'ok', tail: 'wxyz' });
  assert.deepEqual(at(radarRecord(RBW_KEY, 429)), { state: 'ok', tail: 'wxyz' }, 'known, over its allowance');
  assert.deepEqual(at(radarRecord(RBW_KEY, 401)), { state: 'rejected', tail: 'wxyz', status: 401 });
  assert.deepEqual(at(radarRecord(RBW_KEY, 403)), { state: 'rejected', tail: 'wxyz', status: 403 });
  assert.equal(at(radarRecord('another-key', 401)).state, 'untested', 'another key\'s verdict');
  assert.equal(at(radarRecord(RBW_KEY, 401, 'tomorrowio')).state, 'untested', 'another source\'s verdict');
  assert.equal(at(radarRecord(RBW_KEY, 500)).state, 'untested', 'a status that says nothing about the key');
  assert.equal(at('not json').state, 'untested', 'an unreadable record');
  assert.equal(at(null).state, 'untested', 'no record');
});

test('the weather update\'s records never speak for the radar key', () => {
  const hash = fingerprint(RBW_KEY);
  global.INJECTED_USERDATA = {
    authBackoff: JSON.stringify({ code: 'status_401', since: 1, provider: 'rainbowkey', keyHash: hash }),
    lastFetchSuccess: JSON.stringify({ id: 'rainbowkey', keyHash: hash })
  };
  assert.equal(stateOf(Object.assign({ rainbowApiKey: RBW_KEY }, OWN)).state, 'untested');
});

test('a Test answer this page open wins over the record, for the key it tested', () => {
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(RBW_KEY, 401) };
  keyStatus.recordTest('rainbowApiKey', RBW_KEY, 200);
  assert.equal(stateOf(Object.assign({ rainbowApiKey: RBW_KEY }, OWN)).state, 'ok');
  assert.equal(stateOf(Object.assign({ rainbowApiKey: 'edited-key' }, OWN)).state, 'untested', 'a key edited since');
  keyStatus.recordTest('rainbowApiKey', RBW_KEY, -1);
  assert.equal(stateOf(Object.assign({ rainbowApiKey: RBW_KEY }, OWN)).state, 'ok',
    'the proxy\'s "couldn\'t check" keeps the last verdict');
});

test('the summary adds the month\'s calls the settings come to, unless the key is refused', () => {
  const S = Object.assign({ rainbowApiKey: RBW_KEY }, OWN);
  assert.equal(keyStatus.summaryLine(SOURCE, stateOf(S), S), 'Key ••••wxyz · not tested yet · ~2,976 of 5,000 calls a month');
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(RBW_KEY, 200) };
  assert.equal(keyStatus.summaryLine(SOURCE, stateOf(S), S), 'Key ••••wxyz · ✓ works · ~2,976 of 5,000 calls a month');
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(RBW_KEY, 401) };
  assert.equal(keyStatus.summaryLine(SOURCE, stateOf(S), S), 'Key ••••wxyz · ✗ rejected: invalid key (401)');
});

test('the Radar provider row and its key row read ONE table', () => {
  assert.equal(radarKeyRow.indent, true, 'the key row sits indented under the picker');
  [radarKeyRow.editSheetFrom, radarKeyRow.labelFrom, radarKeyRow.hintFrom].forEach((from) => {
    assert.equal(from.args.keyed, ARGS.keyed, from.resolver + ': the picker\'s table');
    assert.equal(from.args.messageKey, 'radarProvider', from.resolver);
  });
  assert.deepEqual([radarKeyRow.editSheetFrom.resolver, radarKeyRow.labelFrom.resolver, radarKeyRow.hintFrom.resolver],
    ['keySheet', 'keyRowLabel', 'keyRowSummary']);
  assert.deepEqual(radarKeyRow.showWhen, radarRow.showWhen, 'gone with the picker while the radar is off');
  ['editSheetFrom', 'editBadgeFrom', 'hintFrom'].forEach((k) =>
    assert.equal(radarRow[k], undefined, 'the picker has no ' + k + ' any more: the key row carries the key'));
});

test('the resolvers answer for "Rainbow (own key)" and Tomorrow.io only', () => {
  const args = (value) => Object.assign({ messageKey: 'radarProvider', value }, ARGS);
  ['dwd', 'metno', 'rainbow'].forEach((v) => {
    const S = Object.assign({}, OWN, { radarProvider: v });
    assert.equal(keyStatus.keySheet(S, {}, args(v)), null, v + ': no key row');
    assert.equal(keyStatus.keyRowLabel(S, {}, args(v)), null, v + ': no key row label');
    assert.equal(keyStatus.keyRowSummary(S, {}, args(v)), null, v + ': no key row summary');
    assert.equal(keyStatus.keyMissingNote(S, {}, args(v)), '', v + ': no note');
    assert.equal(keyStatus.keyAttention(S, {}, args(v)), null, v + ': no dot, no dialog');
  });
  const S = Object.assign({ rainbowApiKey: '' }, OWN);
  assert.equal(keyStatus.keySheet(S, {}, args('rainbowkey')), 'radarKeyRainbow');
  assert.equal(keyStatus.keyRowLabel(S, {}, args('rainbowkey')), 'Rainbow API key');
  assert.equal(keyStatus.keyRowSummary(S, {}, args('rainbowkey')), '<span class="hint-faint">No key</span>');
  assert.equal(keyStatus.keyMissingNote(S, {}, args('rainbowkey')), 'Needs an API key. Without one, the watch gets no rain radar.');
  assert.deepEqual(keyStatus.keyAttention(S, {}, args('rainbowkey')), { note: 'Rainbow has no API key',
    title: 'Rainbow has no API key', body: 'Without one, the watch gets no rain radar.', actionLabel: 'Add key',
    sheet: 'radarKeyRainbow' });
});

// --- the real page ----------------------------------------------------------------------------

test('page: "Rainbow (own key)" without a key — the key row reads "No key", the amber note, a dot on the Graphs tab', () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  openRadarPane(page);
  const body = page.scroll.innerHTML;
  assert.equal(keyRowHtml(page, 'radarKeyRainbow'), '<div class="row nav indent" data-edit-sheet="radarKeyRainbow" ' +
    'role="button" tabindex="0" style="cursor:pointer"><div class="lft"><div class="lbl">Rainbow API key</div>' +
    '<div class="hint"><span class="hint-faint">No key</span></div></div>');
  assert.doesNotMatch(body, /class="thr-btn" data-edit-sheet="radarKeyRainbow"/, 'no Edit / "Add key" button any more');
  assert.match(body, /<div class="static join info"><div class="info-box">Needs an API key\. Without one, the watch gets no rain radar\.<\/div><\/div>/);
  assert.ok(body.indexOf('data-select="radarProvider"') < body.indexOf('Needs an API key') &&
    body.indexOf('Needs an API key') < body.indexOf('data-edit-sheet="radarKeyRainbow"'),
    'the picker, its note, then the key row');
  assert.match(tabButton(page, 'graphs'), /aria-label="Graphs \(Rainbow has no API key\)">Graphs<span class="tab-dot" aria-hidden="true"><\/span>/);
  ['weather', 'watchface', 'watch', 'alerts', 'setup'].forEach((id) =>
    assert.doesNotMatch(tabButton(page, id), /tab-dot/, id));
});

test('page: picking the own key with no key brings the note and the dot at once; limited takes them away', () => {
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph' }, 'basalt');
  openRadarPane(page);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbowkey');
  assert.match(page.scroll.innerHTML, /Needs an API key\. Without one, the watch gets no rain radar\./);
  assert.match(keyRowHtml(page, 'radarKeyRainbow'), /Rainbow API key<\/div><div class="hint"><span class="hint-faint">No key</);
  assert.match(tabButton(page, 'graphs'), /tab-dot/);
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbow');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/);
  assert.equal(keyRowHtml(page, 'radarKeyRainbow'), null, 'the shared Rainbow has no key row');
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
});

test('page: Save with no key opens the dialog; "Add key" opens the key sheet on the Graphs tab and saves nothing', async () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  page.tapSave();
  const dlg = page.modal.innerHTML;
  assert.ok(page.modal.open, 'the native dialog opened');
  assert.ok(dlg.indexOf('id="cfm-ttl">Rainbow has no API key</span>') !== -1, dlg);
  assert.ok(dlg.indexOf('<p class="cfm-body">Without one, the watch gets no rain radar.</p>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="action">Add key</button>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="save">Save anyway</button>') !== -1);
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.ok(page.modal.innerHTML.indexOf('data-k="rainbowApiKey"') !== -1, 'the Rainbow key sheet is open');
  assert.ok(page.modal.innerHTML.indexOf('esheet-ttl-radarKeyRainbow">Rainbow<') !== -1, 'titled Rainbow');
  assert.ok(page.modal.innerHTML.indexOf('<span class="dlg-kick">Graphs</span>') !== -1, 'kicked by its tab');
  assert.match(tabButton(page, 'graphs'), /class="tab on"/, 'over the Graphs tab');
  assert.equal(await page.saved(), null, 'nothing was saved');
});

// The Save dialog's fix opens "on the row's tab ... so closing the sheet lands on the row it
// belongs to" (engine.js confirmChoice). The Radar provider row lives in the Graphs tab's Rain
// radar pane, so that pane has to be the one under the sheet — not the tab's default Forecast pane.
test('page: the Save dialog\'s fix opens over the Rain radar pane, so Done lands on the key row', () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.match(tabButton(page, 'graphs'), /class="tab on"/, 'premise: over the Graphs tab');
  assert.equal(activePane(page), 'graphs:radar', 'the pane under the sheet holds the row the fix is for');
  page.doneDialog();
  assert.ok(keyRowHtml(page, 'radarKeyRainbow'), 'closing the sheet lands on the key row');
});

test('page: a key typed into the sheet is untested, needs no dialog and saves as the own key', async () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  openRadarPane(page);
  page.openEditSheet('radarKeyRainbow');
  const inp = { value: RBW_KEY, getAttribute: (n) => (n === 'data-k' ? 'rainbowApiKey' : null),
    closest: (sel) => (sel === 'input[type=text]' ? inp : null) };
  ['focusin', 'input', 'change'].forEach((type) => page.modal.dispatch(type, { target: inp }));
  page.doneDialog();   // Done keeps the key (× would put the empty one back)
  assert.match(keyRowHtml(page, 'radarKeyRainbow'),
    /<div class="lbl">Rainbow API key<\/div><div class="hint">Key ••••wxyz · not tested yet · ~2,976 of 5,000 calls a month<\/div>/);
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  const blob = await page.saved();
  assert.equal(blob.radarProvider, 'rainbow');
  assert.equal(blob.rainbowOwnKey, true);
  assert.equal(blob.rainbowApiKey, RBW_KEY);
});

test('page: "Save anyway" saves the own key without a key, as before', async () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'save');
  const blob = await page.saved();
  assert.equal(blob.radarProvider, 'rainbow');
  assert.equal(blob.rainbowOwnKey, true);
  assert.equal(blob.rainbowApiKey, '');
});

test('page: a key the last radar update was refused with — the summary, the dot and the "rejected" dialog', () => {
  const userData = { radarKeyResult: radarRecord(RBW_KEY, 403) };
  const page = bootGeneratedPage(Object.assign({ rainbowApiKey: RBW_KEY }, STORED_OWN), 'basalt', { userData, dialog: true });
  openRadarPane(page);
  assert.match(keyRowHtml(page, 'radarKeyRainbow'),
    /<div class="lbl">Rainbow API key<\/div><div class="hint">Key ••••wxyz · ✗ rejected: no access \(403\)<\/div>/,
    'the key row\'s summary says it was refused');
  assert.match(tabButton(page, 'graphs'), /Graphs \(Rainbow rejected the API key\)/);
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('Rainbow rejected the API key') !== -1);
  assert.ok(page.modal.innerHTML.indexOf('Until it accepts a key, the watch gets no rain radar.') !== -1);
  assert.ok(page.modal.innerHTML.indexOf('data-confirm="action">Edit key</button>') !== -1);
});

test('page: a key the last radar update went through with reads "✓ works" and saves without a dialog', async () => {
  const userData = { radarKeyResult: radarRecord(RBW_KEY, 200) };
  const page = bootGeneratedPage(Object.assign({ rainbowApiKey: RBW_KEY }, STORED_OWN), 'basalt', { userData, dialog: true });
  openRadarPane(page);
  assert.match(keyRowHtml(page, 'radarKeyRainbow'), /<div class="hint">Key ••••wxyz · ✓ works · ~2,976 of 5,000 calls a month<\/div>/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '', 'no dialog');
  assert.equal((await page.saved()).rainbowOwnKey, true);
});

test('page: the Test button\'s answer (through the proxy\'s envelope) reaches the summary', () => {
  const userData = { rainbowEndpoint: 'https://proxy.example/rainbow' };
  const page = bootGeneratedPage(Object.assign({ rainbowApiKey: RBW_KEY }, STORED_OWN), 'basalt', { userData });
  openRadarPane(page);
  const xhrs = [];
  page.window.XMLHttpRequest = function () {
    this.open = () => {};
    this.send = () => {};
    xhrs.push(this);
  };
  const field = { value: RBW_KEY };
  const result = { textContent: '' };
  page.window.document.querySelector = (sel) => (sel === 'input[data-k="rainbowApiKey"]' ? field
    : sel === '[data-action-result="rainbowApiKey"]' ? result : null);
  page.openEditSheet('radarKeyRainbow');
  tapInModal(page, '[data-action]', 'data-action', 'testRainbowKey');
  assert.equal(xhrs.length, 1, 'the Test request went out');
  xhrs[0].status = 200;
  xhrs[0].responseText = '{"status":401}';
  xhrs[0].onload();
  assert.match(result.textContent, /Rejected \(401\)/, 'the verdict line as before');
  page.doneDialog();
  assert.match(keyRowHtml(page, 'radarKeyRainbow'), /<div class="hint">Key ••••wxyz · ✗ rejected: invalid key \(401\)<\/div>/);
  assert.match(tabButton(page, 'graphs'), /tab-dot/);
});

test('page: radar off — no note, no dot, no dialog, whatever the own key\'s state', async () => {
  const page = bootGeneratedPage(Object.assign({}, STORED_OWN, { radarMode: 'off' }), 'basalt', { dialog: true });
  openRadarPane(page);
  assert.match(page.scroll.innerHTML, /The rain radar is off\./, 'premise: the Rain radar pane, radar off');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key|data-edit-sheet="radarKeyRainbow"/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '');
  const blob = await page.saved();
  assert.equal(blob.rainbowOwnKey, true, 'the pick itself is kept');
});

test('page: a missing weather key and a missing radar key dot both tabs; the dialog asks for the first', () => {
  const page = bootGeneratedPage(Object.assign({}, STORED_OWN, { provider: 'openweathermap', owmApiKey: '' }),
    'basalt', { dialog: true });
  assert.match(tabButton(page, 'setup'), /tab-dot/);
  assert.match(tabButton(page, 'graphs'), /tab-dot/);
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('Rainbow has no API key') !== -1,
    'Graphs comes first: it precedes Setup in the tab bar');
  assert.equal(page.modal.innerHTML.indexOf('OpenWeatherMap has no API key'), -1, 'one dialog, one question');
});

test('page: aplite has no Rain radar pane — no dot and no dialog for a stored own key without a key', async () => {
  const page = bootGeneratedPage(STORED_OWN, 'aplite', { dialog: true });
  page.clickTab('graphs');
  assert.doesNotMatch(page.scroll.innerHTML, /data-pane="graphs:radar"|data-select="radarProvider"/, 'premise: no radar pane');
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '');
  assert.equal((await page.saved()).rainbowOwnKey, true);
});

// --- Tomorrow.io on the radar picker ----------------------------------------------------------
// Radar-only, its key lives in the Graphs tab's own Tomorrow.io sheet (radarKeyTomorrowio) and
// gets everything "Rainbow (own key)" has. Its key is the Tomorrow.io weather provider's key:
// one key, one verdict. While Tomorrow.io is the weather provider too, the Setup tab's
// Tomorrow.io sheet (providerKeyTomorrowio) is the one copy of the key, and the Radar row's
// key row, summary, note, dot and Save dialog all read that key's one state.

const TIO = ARGS.keyed.tomorrowio;
const setupTab = schema.tabs.find((t) => t.id === 'setup');
const WEATHER_ARGS = setupTab.sections.reduce((found, sec) => found
  || (sec.items.find((i) => i.messageKey === 'provider') || {}).attentionFrom, null).args;
const WEATHER_TIO = WEATHER_ARGS.keyed.tomorrowio;
const TIO_KEY = 'tio-secret-0123wxyz';
// A running radar on Tomorrow.io, the weather on DWD (radar-only) or on Tomorrow.io too (both).
const TIO_RADAR_ONLY = { provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'graph', fetchIntervalMin: '15',
  sleepNightEnabled: false, tomorrowioFitBudget: true };
const TIO_BOTH = Object.assign({}, TIO_RADAR_ONLY, { provider: 'tomorrowio' });

/**
 * Type a key into the open sheet's tomorrow.io field and commit it, the way a browser reports it.
 * @param {Object} page The booted page.
 * @param {string} value The typed text.
 * @returns {void}
 */
function typeTioKey(page, value) {
  assert.ok(page.modal.innerHTML.indexOf('data-k="tomorrowioApiKey"') !== -1, 'the key field is in the open sheet');
  const inp = { value, getAttribute: (n) => (n === 'data-k' ? 'tomorrowioApiKey' : null),
    closest: (sel) => (sel === 'input[type=text]' ? inp : null) };
  ['focusin', 'input', 'change'].forEach((type) => page.modal.dispatch(type, { target: inp }));
}

test('Tomorrow.io: radar-only its own sheet; while it is the weather provider too, the Setup tab\'s', () => {
  const args = Object.assign({ messageKey: 'radarProvider', value: 'tomorrowio' }, ARGS);
  const noKey = Object.assign({ tomorrowioApiKey: '' }, TIO_RADAR_ONLY);
  const noKeyBoth = Object.assign({}, noKey, { provider: 'tomorrowio' });
  assert.equal(keyStatus.keySheet(noKey, {}, args), 'radarKeyTomorrowio');
  assert.equal(keyStatus.keySheet(noKeyBoth, {}, args), 'providerKeyTomorrowio');
  assert.equal(keyStatus.sheetOf(TIO, { provider: 'openmeteo' }), 'radarKeyTomorrowio');
  assert.equal(keyStatus.sheetOf(SOURCE, { provider: 'tomorrowio' }), 'radarKeyRainbow', 'Rainbow shares nothing');
  assert.equal(keyStatus.keyRowLabel(noKey, {}, args), 'Tomorrow.io API key');
  assert.equal(keyStatus.keyRowSummary(noKey, {}, args), '<span class="hint-faint">No key</span>');
  assert.equal(keyStatus.keyMissingNote(noKey, {}, args), 'Needs an API key. Without one, the watch gets no rain radar.');
  assert.deepEqual(keyStatus.keyAttention(noKey, {}, args), { note: 'Tomorrow.io has no API key',
    title: 'Tomorrow.io has no API key', body: 'Without one, the watch gets no rain radar.', actionLabel: 'Add key',
    sheet: 'radarKeyTomorrowio' });
  assert.equal(keyStatus.keyAttention(noKeyBoth, {}, args).sheet, 'providerKeyTomorrowio',
    'both: the dialog\'s Add key opens the sheet that holds the key');
});

test('Tomorrow.io: one key, one verdict — the radar row reads exactly the weather provider\'s state', () => {
  const hash = fingerprint(TIO_KEY);
  const S = Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_BOTH);
  const cases = [
    ['missing', Object.assign({}, S, { tomorrowioApiKey: '  ' }), null, null, 'missing'],
    ['untested', S, null, null, 'untested'],
    ['the last weather update went through with it', S,
      { lastFetchSuccess: JSON.stringify({ id: 'tomorrowio', keyHash: hash }) }, null, 'ok'],
    ['the last weather update was refused with it', S,
      { authBackoff: JSON.stringify({ code: 'status_401', since: 1, provider: 'tomorrowio', keyHash: hash }) }, null,
      'rejected'],
    ['another provider\'s success', S, { lastFetchSuccess: JSON.stringify({ id: 'openweathermap', keyHash: hash }) },
      null, 'untested'],
    ['Test: works', S, null, 200, 'ok'],
    ['Test: refused', S, null, 403, 'rejected']
  ];
  cases.forEach(([what, state, userData, tested, expected]) => {
    keyStatus.resetTests();
    if (userData) { global.INJECTED_USERDATA = userData; } else { delete global.INJECTED_USERDATA; }
    if (tested) { keyStatus.recordTest('tomorrowioApiKey', TIO_KEY, tested); }
    // Both, and radar-only: the radar row's state is the weather provider's, word for word.
    [state, Object.assign({}, state, { provider: 'dwd' })].forEach((st) => {
      const radar = keyStatus.statusOf(TIO, 'tomorrowio', st);
      assert.equal(radar.state, expected, what);
      assert.deepEqual(radar, keyStatus.statusOf(WEATHER_TIO, 'tomorrowio', st), what);
      assert.equal(keyStatus.summaryLine(TIO, radar, st), keyStatus.summaryLine(WEATHER_TIO, radar, st), what);
    });
  });
});

test('Tomorrow.io radar-only: the radar\'s own verdict on the key answers when no weather update says anything', () => {
  const hash = fingerprint(TIO_KEY);
  const S = Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_RADAR_ONLY);
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(TIO_KEY, 401, 'tomorrowio') };
  assert.deepEqual(keyStatus.statusOf(TIO, 'tomorrowio', S), { state: 'rejected', tail: 'wxyz', status: 401 });
  assert.equal(keyStatus.statusOf(WEATHER_TIO, 'tomorrowio', S).state, 'untested',
    'the Weather provider row goes by weather updates only');
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(TIO_KEY, 200, 'tomorrowio') };
  assert.deepEqual(keyStatus.statusOf(TIO, 'tomorrowio', S), { state: 'ok', tail: 'wxyz' });
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(TIO_KEY, 401, 'rainbowkey') };
  assert.equal(keyStatus.statusOf(TIO, 'tomorrowio', S).state, 'untested', 'another radar source\'s verdict');
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord('another-key', 401, 'tomorrowio') };
  assert.equal(keyStatus.statusOf(TIO, 'tomorrowio', S).state, 'untested', 'another key\'s verdict');
  // A weather update that says something wins: then the two rows keep one verdict.
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(TIO_KEY, 401, 'tomorrowio'),
    lastFetchSuccess: JSON.stringify({ id: 'tomorrowio', keyHash: hash }) };
  const both = Object.assign({}, S, { provider: 'tomorrowio' });
  assert.equal(keyStatus.statusOf(TIO, 'tomorrowio', both).state, 'ok');
  assert.deepEqual(keyStatus.statusOf(TIO, 'tomorrowio', both), keyStatus.statusOf(WEATHER_TIO, 'tomorrowio', both));
});

test('page: radar-only Tomorrow.io refused by the last radar update — the summary, the dot and the "rejected" dialog', () => {
  const userData = { radarKeyResult: radarRecord(TIO_KEY, 403, 'tomorrowio') };
  const page = bootGeneratedPage(Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_RADAR_ONLY), 'basalt',
    { userData, dialog: true });
  openRadarPane(page);
  assert.match(keyRowHtml(page, 'radarKeyTomorrowio'),
    /<div class="hint">Key ••••wxyz · ✗ rejected: no access to this data \(403\)<\/div>/, 'not "not tested yet"');
  assert.match(tabButton(page, 'graphs'), /Graphs \(Tomorrow\.io rejected the API key\)/);
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('Tomorrow.io rejected the API key') !== -1);
});

test('page: radar-only Tomorrow.io without a key — the key row reads "No key", the amber note, a dot on the Graphs tab only', () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'basalt', { dialog: true });
  page.clickTab('setup');
  assert.ok(page.scroll.innerHTML.indexOf('data-select="provider"') !== -1, 'premise: the Weather provider row\'s tab');
  assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="(providerKey|radarKey)|Needs an API key|Key ••••|No key/,
    'nothing under the Weather provider row (DWD needs no key)');
  openRadarPane(page);
  const body = page.scroll.innerHTML;
  assert.equal(keyRowHtml(page, 'radarKeyTomorrowio'), '<div class="row nav indent" data-edit-sheet="radarKeyTomorrowio" ' +
    'role="button" tabindex="0" style="cursor:pointer"><div class="lft"><div class="lbl">Tomorrow.io API key</div>' +
    '<div class="hint"><span class="hint-faint">No key</span></div></div>');
  assert.match(body, /<div class="static join info"><div class="info-box">Needs an API key\. Without one, the watch gets no rain radar\.<\/div><\/div>/);
  assert.equal(body.indexOf('data-k="tomorrowioApiKey"'), -1, 'the key field left the page for the sheet');
  assert.match(tabButton(page, 'graphs'), /aria-label="Graphs \(Tomorrow\.io has no API key\)">Graphs<span class="tab-dot" aria-hidden="true"><\/span>/);
  ['weather', 'watchface', 'watch', 'alerts', 'setup'].forEach((id) =>
    assert.doesNotMatch(tabButton(page, id), /tab-dot/, id));
});

test('page: picking Tomorrow.io with no key brings the note and the dot at once; Met.no takes them away', () => {
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph' }, 'basalt');
  openRadarPane(page);
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'tomorrowio');
  assert.match(keyRowHtml(page, 'radarKeyTomorrowio'), /Tomorrow\.io API key<\/div><div class="hint"><span class="hint-faint">No key</);
  assert.match(page.scroll.innerHTML, /Needs an API key\. Without one, the watch gets no rain radar\./);
  assert.match(tabButton(page, 'graphs'), /tab-dot/);
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'metno');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key|data-edit-sheet="radarKeyTomorrowio"/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
});

test('page: radar-only Tomorrow.io — Save asks; "Add key" opens its sheet on the Graphs tab and saves nothing', async () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'basalt', { dialog: true });
  page.tapSave();
  const dlg = page.modal.innerHTML;
  assert.ok(page.modal.open, 'the native dialog opened');
  assert.ok(dlg.indexOf('id="cfm-ttl">Tomorrow.io has no API key</span>') !== -1, dlg);
  assert.ok(dlg.indexOf('<p class="cfm-body">Without one, the watch gets no rain radar.</p>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="action">Add key</button>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="save">Save anyway</button>') !== -1);
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.ok(page.modal.innerHTML.indexOf('esheet-ttl-radarKeyTomorrowio">Tomorrow.io<') !== -1, 'the Graphs tab\'s sheet');
  assert.ok(page.modal.innerHTML.indexOf('data-k="tomorrowioApiKey"') !== -1, 'with the key field');
  assert.match(tabButton(page, 'graphs'), /class="tab on"/, 'over the Graphs tab');
  assert.equal(await page.saved(), null, 'nothing was saved');
});

test('page: radar-only Tomorrow.io — "Save anyway" saves without a key, as before', async () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'basalt', { dialog: true });
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'save');
  const blob = await page.saved();
  assert.equal(blob.radarProvider, 'tomorrowio');
  assert.equal(blob.provider, 'dwd');
  assert.equal(blob.tomorrowioApiKey, '');
});

test('page: a key typed into the Rain radar pane\'s Tomorrow.io sheet is untested, needs no dialog and saves trimmed', async () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'basalt', { dialog: true });
  openRadarPane(page);
  page.openEditSheet('radarKeyTomorrowio');
  typeTioKey(page, '  ' + TIO_KEY + ' ');
  page.doneDialog();
  assert.match(keyRowHtml(page, 'radarKeyTomorrowio'),
    /<div class="lbl">Tomorrow\.io API key<\/div><div class="hint">Key ••••wxyz · not tested yet · ~96 of 500 calls a day<\/div>/,
    'the key row\'s summary, with the daily calls the radar comes to');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  const blob = await page.saved();
  assert.equal(blob.tomorrowioApiKey, TIO_KEY, 'Save trims it as before (onbuild.js)');
  assert.equal(blob.radarProvider, 'tomorrowio');
});

test('page: the Test button in the Rain radar pane\'s Tomorrow.io sheet reaches the summary and the dot', () => {
  const page = bootGeneratedPage(Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_RADAR_ONLY), 'basalt');
  openRadarPane(page);
  assert.match(keyRowHtml(page, 'radarKeyTomorrowio'), /<div class="hint">Key ••••wxyz · not tested yet/);
  const xhrs = [];
  page.window.XMLHttpRequest = function () {
    this.open = () => {};
    this.send = () => {};
    xhrs.push(this);
  };
  const field = { value: TIO_KEY };
  const result = { textContent: '' };
  page.window.document.querySelector = (sel) => (sel === 'input[data-k="tomorrowioApiKey"]' ? field
    : sel === '[data-action-result="tomorrowioApiKey"]' ? result : null);
  page.openEditSheet('radarKeyTomorrowio');
  tapInModal(page, '[data-action]', 'data-action', 'testTomorrowioKey');
  assert.equal(xhrs.length, 1, 'the Test request went out');
  xhrs[0].status = 401;
  xhrs[0].onload();
  assert.match(result.textContent, /Rejected \(401\)/, 'the verdict line as before');
  page.doneDialog();
  assert.match(keyRowHtml(page, 'radarKeyTomorrowio'), /<div class="hint">Key ••••wxyz · ✗ rejected: invalid key \(401\)<\/div>/);
  assert.match(tabButton(page, 'graphs'), /Graphs \(Tomorrow\.io rejected the API key\)/);
});

test('page: Tomorrow.io as weather provider AND radar — one key in the Setup tab\'s sheet, both rows agree', () => {
  const page = bootGeneratedPage(TIO_BOTH, 'basalt', { dialog: true });
  // No key: both rows say so, both tabs carry the dot, and both key rows open ONE sheet.
  const noKey = /<div class="lbl">Tomorrow\.io API key<\/div><div class="hint"><span class="hint-faint">No key<\/span><\/div>/;
  page.clickTab('setup');
  assert.match(keyRowHtml(page, 'providerKeyTomorrowio'), noKey, 'the Weather provider\'s key row');
  assert.match(tabButton(page, 'setup'), /Setup \(Tomorrow\.io has no API key\)/);
  assert.match(tabButton(page, 'graphs'), /Graphs \(Tomorrow\.io has no API key\)/);
  openRadarPane(page);
  const radarPane = page.scroll.innerHTML;
  assert.ok(new RegExp('data-select="radarProvider"[^]*?data-edit-sheet="providerKeyTomorrowio"').test(radarPane),
    'the Radar row\'s key row opens the Setup tab\'s Tomorrow.io sheet');
  assert.match(keyRowHtml(page, 'providerKeyTomorrowio'), noKey, 'and reads the same');
  assert.doesNotMatch(radarPane, /radarKeyTomorrowio/, 'the Graphs tab\'s own sheet is closed');
  assert.match(radarPane, /Needs an API key\. Without one, the watch gets no rain radar\./);
  page.openEditSheet('providerKeyTomorrowio');
  assert.ok(page.modal.innerHTML.indexOf('esheet-ttl-providerKeyTomorrowio">Tomorrow.io<') !== -1);
  assert.ok(page.modal.innerHTML.indexOf('<span class="dlg-kick">Graphs</span>') !== -1, 'over the Graphs tab');
  typeTioKey(page, TIO_KEY);
  page.doneDialog();
  // The key is in: the same summary on both rows, no note, no dot.
  const line = '<div class="hint">Key ••••wxyz · not tested yet · ~192 of 500 calls a day</div>';
  assert.ok(keyRowHtml(page, 'providerKeyTomorrowio').indexOf(line) !== -1, 'the Radar row\'s key row');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/);
  page.clickTab('setup');
  assert.ok(keyRowHtml(page, 'providerKeyTomorrowio').indexOf(line) !== -1, 'the Weather provider\'s key row, word for word');
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
});

test('page: both — Save asks once, for the first row in tab order (Graphs), and "Add key" opens the one sheet', async () => {
  const page = bootGeneratedPage(TIO_BOTH, 'basalt', { dialog: true });
  page.clickTab('setup');
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('id="cfm-ttl">Tomorrow.io has no API key</span>') !== -1);
  assert.ok(page.modal.innerHTML.indexOf('Without one, the watch gets no rain radar.') !== -1,
    'the Graphs tab\'s Radar row comes first: Graphs precedes Setup in the tab bar');
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.ok(page.modal.innerHTML.indexOf('esheet-ttl-providerKeyTomorrowio">Tomorrow.io<') !== -1,
    'the one sheet that holds the key');
  assert.match(tabButton(page, 'graphs'), /class="tab on"/, 'over the Graphs tab');
  assert.equal(await page.saved(), null, 'nothing was saved');
});

test('page: both — a refusal on record reads the same on both rows and dots both tabs', () => {
  const userData = { authBackoff: JSON.stringify({ code: 'status_403', since: 1, provider: 'tomorrowio',
    keyHash: fingerprint(TIO_KEY) }) };
  const page = bootGeneratedPage(Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_BOTH), 'basalt', { userData });
  const line = '<div class="hint">Key ••••wxyz · ✗ rejected: no access to this data (403)</div>';
  page.clickTab('setup');
  assert.ok(keyRowHtml(page, 'providerKeyTomorrowio').indexOf(line) !== -1, 'the Weather provider\'s key row');
  openRadarPane(page);
  assert.ok(keyRowHtml(page, 'providerKeyTomorrowio').indexOf(line) !== -1, 'the Radar row\'s key row, word for word');
  assert.match(tabButton(page, 'setup'), /Setup \(Tomorrow\.io rejected the API key\)/);
  assert.match(tabButton(page, 'graphs'), /Graphs \(Tomorrow\.io rejected the API key\)/);
});

test('page: radar off — no Tomorrow.io key row, note, dot or dialog on the Rain radar pane', async () => {
  const page = bootGeneratedPage(Object.assign({}, TIO_RADAR_ONLY, { radarMode: 'off' }), 'basalt', { dialog: true });
  openRadarPane(page);
  assert.match(page.scroll.innerHTML, /The rain radar is off\./, 'premise: the Rain radar pane, radar off');
  assert.doesNotMatch(page.scroll.innerHTML,
    /Needs an API key|data-edit-sheet="(providerKey|radarKey)|data-k="tomorrowioApiKey"/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '');
  assert.equal((await page.saved()).radarProvider, 'tomorrowio', 'the pick itself is kept');
});

test('page: aplite has no Rain radar pane — no dot and no dialog for a radar-only Tomorrow.io without a key', async () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'aplite', { dialog: true });
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '');
  assert.equal((await page.saved()).radarProvider, 'tomorrowio');
});

// --- the note under the Radar provider row: a regional source that cannot see the place ---

test('page: DWD picked while the last update\'s location lies outside its area — the amber note under the row', () => {
  const userData = { radarCoverage: JSON.stringify({ dwd: true, metno: true }) };
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'dwd' }, 'basalt', { userData });
  openRadarPane(page);
  const note = '<div class="static join info"><div class="info-box">DWD radar only covers Germany, and your location '
    + 'is outside it. Rainbow covers the whole world.</div></div>';
  assert.ok(page.scroll.innerHTML.indexOf(note) !== -1, 'the note hugs the row');
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbow');
  assert.doesNotMatch(page.scroll.innerHTML, /only covers/, 'a worldwide source: no note');
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'metno');
  assert.match(page.scroll.innerHTML, /Met\.no radar only covers the Nordic countries, and your location is outside it\./);
});

test('page: DWD picked while it sends no radar data for the place (its second 404 in a row) — the general note', () => {
  const userData = { radarCoverage: JSON.stringify({ dwd: false, metno: true, misses: { dwd: 2 } }) };
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'dwd' }, 'basalt', { userData });
  openRadarPane(page);
  const note = '<div class="static join info"><div class="info-box">DWD sends no radar data for your location '
    + 'right now. Rainbow covers the whole world.</div></div>';
  assert.ok(page.scroll.innerHTML.indexOf(note) !== -1, 'the amber note hugs the row');
  assert.doesNotMatch(page.scroll.innerHTML, /only covers/, 'not the out-of-area one');
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbow');
  assert.doesNotMatch(page.scroll.innerHTML, /sends no radar data/, 'a worldwide source: no note');
});

test('page: one 404 alone puts no note under the DWD row', () => {
  const userData = { radarCoverage: JSON.stringify({ dwd: false, metno: true, misses: { dwd: 1 } }) };
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'dwd' }, 'basalt', { userData });
  openRadarPane(page);
  assert.ok(page.scroll.innerHTML.indexOf('data-select="radarProvider"') !== -1, 'premise: the Radar provider row is drawn');
  assert.doesNotMatch(page.scroll.innerHTML, /sends no radar data|only covers/);
});

test('page: no note while the place is inside, with no record yet, or with radar off', () => {
  const inside = { radarCoverage: JSON.stringify({ dwd: false, metno: true }) };
  const dwd = { provider: 'openmeteo', radarMode: 'graph', radarProvider: 'dwd' };
  [[dwd, inside], [dwd, {}], [Object.assign({}, dwd, { radarMode: 'off' }), { radarCoverage: JSON.stringify({ dwd: true }) }]]
    .forEach(([cfg, userData]) => {
      const page = bootGeneratedPage(cfg, 'basalt', { userData });
      openRadarPane(page);
      assert.doesNotMatch(page.scroll.innerHTML, /only covers/, JSON.stringify([cfg, userData]));
    });
});
