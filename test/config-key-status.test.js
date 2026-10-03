// test/config-key-status.test.js — the key status of a keyed weather provider (OpenWeatherMap,
// Tomorrow.io, Yandex Weather; settings/key-status.js): the key row under the Weather
// provider row (Setup › Weather data: "<Name> API key", its summary "Key ••••1234 · ✓ works"
// or a dimmed "No key"), the amber note while the key is missing, the dot on the tab and the
// Save dialog while it is missing or known to be rejected. The states come from the Test
// button's last result for that exact key and from the provider's last answer to it on the
// phone (userData.keyResults, key-result.js: per source, the key's fingerprint and the
// status). Module first, then the resolvers, then the REAL generated page (page-harness).
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

const PC = global.PConf;
const setup = schema.tabs.find((t) => t.id === 'setup');
const card = setup.sections.find((s) => s.id === 'weatherData');
const providerRow = card.items.find((i) => i.messageKey === 'provider');
const noteItem = card.items[card.items.indexOf(providerRow) + 1];
// The nav row under the note that opens the picked provider's key sheet.
const keyRowItem = card.items[card.items.indexOf(providerRow) + 2];
// The Weather provider picker's table (key-sources.js), which every key-status resolver reads:
// the picker's by its messageKey, the note's and the key row's by args.picker.
const TABLE = require('../src/pkjs/settings/key-sources.js').provider;
const KEYED = TABLE.sources;
const NOTE_ARGS = noteItem.textFrom.args;
const OWM_KEY = 'owm-secret-0123abcd';
const TIO_KEY = 'tio-secret-9876wxyz';

/**
 * The phone's answers to the keys as it stores them (key-result.js), by source id.
 * @param {Object<string, Array>} entries id -> [the key the request carried, the status].
 * @returns {string} The stored JSON (userData.keyResults).
 */
function results(entries) {
  const map = {};
  Object.keys(entries).forEach((id) => { map[id] = { keyHash: fingerprint(entries[id][0]), status: entries[id][1] }; });
  return JSON.stringify(map);
}

/**
 * The row resolvers' args the engine builds (messageKey + shown value merged under the row's).
 * @param {Object} from The row's xxxFrom.
 * @param {string} [value] The shown provider.
 * @returns {Object} Args.
 */
function argsOf(from, value) {
  return Object.assign({ messageKey: 'provider', value }, from.args);
}

/**
 * The summary line for a provider under the live settings.
 * @param {string} provider The provider.
 * @param {Object} S Settings.
 * @returns {string} The line.
 */
function line(provider, S) {
  return keyStatus.summaryLine(KEYED[provider], keyStatus.statusOf(KEYED[provider], provider, S), S);
}

test.beforeEach(() => {
  keyStatus.resetTests();
  delete global.INJECTED_USERDATA;
});
test.after(() => { delete global.INJECTED_USERDATA; });

// --- the fingerprint the phone and the page share -----------------------------------------

test('key fingerprint: FNV-1a of the trimmed key as 8 hex digits, \'\' for no key', () => {
  assert.equal(fingerprint('a'), 'e40c292c');
  assert.equal(fingerprint('foobar'), 'bf9cf968');
  assert.equal(fingerprint('  foobar \n'), 'bf9cf968', 'a pasted key\'s whitespace does not count');
  ['', '   ', null, undefined, 42].forEach((k) => assert.equal(fingerprint(k), '', String(k)));
  assert.notEqual(fingerprint('foobar'), fingerprint('foobaR'), 'one character apart is another key');
});

// --- the table on the row ----------------------------------------------------------------

test('the Weather provider row and its key row read ONE table for every key-status resolver', () => {
  assert.deepEqual(Object.keys(KEYED).sort(), ['openweathermap', 'tomorrowio', 'yandex']);
  // The picker hands its resolver no args: the engine merges the row's messageKey (the
  // picker) in, and key-status.js looks the table up by it.
  assert.deepEqual(providerRow.attentionFrom, { resolver: 'keyAttention' });
  // The picker no longer opens the key sheet itself: the key row under it does.
  assert.equal(providerRow.editSheetFrom, undefined, 'no Edit / "Add key" button on the picker');
  assert.equal(providerRow.editBadgeFrom, undefined);
  assert.equal(providerRow.hintFrom, undefined, 'the picker\'s hint is its own hintByValue copy');
  assert.equal(TABLE.outcome, 'the watch gets no forecast');
  // The key row: a nav row whose sheet, label and summary all come from the same table,
  // named by args.picker (a sheet row has no messageKey).
  assert.equal(keyRowItem.type, 'sheet');
  assert.equal(keyRowItem.indent, true, 'indented under the picker');
  assert.equal(keyRowItem.editSheetFrom.resolver, 'keySheet');
  assert.equal(keyRowItem.labelFrom.resolver, 'keyRowLabel');
  assert.equal(keyRowItem.hintFrom.resolver, 'keyRowSummary');
  [keyRowItem.editSheetFrom, keyRowItem.labelFrom, keyRowItem.hintFrom].forEach((from) =>
    assert.deepEqual(from.args, { picker: 'provider' }, from.resolver + ': the picker\'s table'));
  // The sheet titles are the table's names; the Test flag follows the sheet's key field.
  Object.keys(KEYED).forEach((p) => {
    const sheet = setup.sections.find((s) => s.sheetOnly && s.sheetId === KEYED[p].sheetId);
    assert.equal(sheet.title, KEYED[p].name, p);
    assert.equal(sheet.items[0].messageKey, KEYED[p].keyField, p);
    assert.equal(Boolean(sheet.items[0].suffixAction), KEYED[p].test, p + ': test flag = a Test button');
  });
  // The amber note hugs the row and is all textFrom; a staticText has no messageKey, so its
  // args name the picker.
  assert.equal(noteItem.type, 'staticText');
  assert.equal(noteItem.style, 'info');
  assert.equal(noteItem.joinPrevious, true);
  assert.deepEqual(noteItem.textFrom, { resolver: 'keyMissingNote', args: { picker: 'provider' } });
  assert.equal(noteItem.text, undefined);
});

test('the resolvers find the table by the picker they are handed, and nothing for a picker without one', () => {
  const sheet = PC.sheetResolvers.get('keySheet');
  const note = PC.hintResolvers.get('keyMissingNote');
  const attention = PC.attentionResolvers.get('keyAttention');
  const S = { provider: 'openweathermap', owmApiKey: '', radarProvider: 'rainbowkey', rainbowApiKey: '' };
  assert.equal(sheet(S, {}, { messageKey: 'provider' }), 'providerKeyOwm');
  assert.equal(sheet(S, {}, { messageKey: 'radarProvider' }), 'radarKeyRainbow', 'the Radar picker\'s own table');
  assert.equal(note(S, {}, { picker: 'provider' }), 'Needs an API key. Without one, the watch gets no forecast.');
  assert.equal(note(S, {}, { picker: 'radarProvider' }), 'Needs an API key. Without one, the watch gets no rain radar.');
  assert.equal(attention(S, {}, { messageKey: 'radarProvider' }).body, 'Without one, the watch gets no rain radar.');
  // A row whose picker has no table (or a value its picker's table lacks) shows no key status.
  const other = { aqiSource: 'openweathermap', owmApiKey: '' };
  assert.equal(sheet(other, {}, { messageKey: 'aqiSource' }), null);
  assert.equal(note(other, {}, { picker: 'aqiSource' }), '');
  assert.equal(attention(other, {}, { messageKey: 'aqiSource' }), null);
  ['toString', 'hasOwnProperty'].forEach((k) =>
    assert.equal(sheet({ provider: k }, {}, { messageKey: 'provider' }), null, k + ' is no source'));
  assert.equal(sheet(S, {}, { messageKey: 'constructor' }), null, 'nor is constructor a picker');
});

test('the key row\'s summary, through the engine: the picker named by args.picker, its stored value', () => {
  // As the page resolves it: a sheet row has no messageKey or value, so the resolvers read
  // the picker's table and stored value by args.picker. The picker's own hint stays its
  // hintByValue copy (no resolver).
  const S = { provider: 'openweathermap', owmApiKey: OWM_KEY };
  assert.ok(providerRow.hintByValue.openweathermap, 'the picker has its own copy for the value');
  assert.equal(PC.engine.resolveHint(providerRow, S, {}, 'openweathermap'), undefined,
    'the picker: the static hintByValue answers');
  assert.equal(PC.engine.resolveHint(keyRowItem, S, {}), 'Key ••••abcd · not tested yet');
  assert.equal(PC.engine.resolveHint(keyRowItem, { provider: 'openweathermap', owmApiKey: '' }, {}),
    '<span class="hint-faint">No key</span>', 'a missing key: the dimmed "No key" (the amber note says the rest)');
  assert.equal(PC.engine.resolveHint(keyRowItem, { provider: 'dwd' }, {}), undefined,
    'a provider without a key: no summary (the row is not drawn)');
});

// --- the states ----------------------------------------------------------------------------

test('missing: blank, spaces or unset — no summary line (the note says it)', () => {
  ['', '   ', undefined].forEach((k) => {
    assert.equal(keyStatus.statusOf(KEYED.openweathermap, 'openweathermap', { owmApiKey: k }).state, 'missing');
    assert.equal(line('openweathermap', { owmApiKey: k }), '');
  });
});

test('a key the page knows nothing about: "not tested yet" where there is a Test, nothing where there is none', () => {
  assert.equal(line('openweathermap', { owmApiKey: OWM_KEY }), 'Key ••••abcd · not tested yet');
  assert.equal(line('yandex', { yandexApiKey: ' ydx-5555 ' }), 'Key ••••5555', 'Yandex has no Test button');
  assert.equal(line('openweathermap', { owmApiKey: 'ab' }), 'Key ••••ab · not tested yet', 'a short key shows what it has');
  assert.equal(line('openweathermap', { owmApiKey: 'x<b>&' }), 'Key ••••&lt;b&gt;&amp; · not tested yet',
    'escaped: hints print raw');
});

test('the Test button\'s verdict belongs to the key it tested', () => {
  const S = { owmApiKey: OWM_KEY };
  keyStatus.recordTest('owmApiKey', OWM_KEY, 200);
  assert.equal(line('openweathermap', S), 'Key ••••abcd · ✓ works');
  keyStatus.recordTest('owmApiKey', OWM_KEY, 401);
  assert.equal(line('openweathermap', S), 'Key ••••abcd · ✗ rejected: not valid for One Call 3.0 (401)');
  keyStatus.recordTest('owmApiKey', OWM_KEY, 0);
  keyStatus.recordTest('owmApiKey', OWM_KEY, 500);
  assert.equal(keyStatus.statusOf(KEYED.openweathermap, 'openweathermap', S).state, 'rejected',
    'no answer, or one that says nothing about the key, leaves the last verdict');
  keyStatus.recordTest('owmApiKey', OWM_KEY, 429);
  assert.equal(line('openweathermap', S), 'Key ••••abcd · ✓ works', 'a 429 knows the key: it works, over its allowance');
  assert.equal(line('openweathermap', { owmApiKey: OWM_KEY + 'x' }), 'Key ••••bcdx · not tested yet',
    'a changed key is untested again');
  assert.equal(line('openweathermap', { owmApiKey: '  ' + OWM_KEY + ' ' }), 'Key ••••abcd · ✓ works',
    'the same key with paste whitespace is the same key');
});

test('a refusal\'s short reason: the provider\'s own, else the default', () => {
  const S = { tomorrowioApiKey: TIO_KEY, provider: 'tomorrowio', radarProvider: 'rainbow' };
  keyStatus.recordTest('tomorrowioApiKey', TIO_KEY, 401);
  assert.equal(line('tomorrowio', S), 'Key ••••wxyz · ✗ rejected: invalid key (401)', 'no usage line on a refused key');
  keyStatus.recordTest('tomorrowioApiKey', TIO_KEY, 403);
  assert.equal(line('tomorrowio', S), 'Key ••••wxyz · ✗ rejected: no access to this data (403)');
});

test('the provider\'s last answer on the phone: a refusal or a success for THIS key counts', () => {
  const S = { owmApiKey: OWM_KEY };
  global.INJECTED_USERDATA = { keyResults: results({ openweathermap: [OWM_KEY, 401] }) };
  assert.equal(line('openweathermap', S), 'Key ••••abcd · ✗ rejected: not valid for One Call 3.0 (401)');
  assert.equal(line('openweathermap', { owmApiKey: 'another-key-0000' }), 'Key ••••0000 · not tested yet',
    'a key typed since is not the one refused');
  global.INJECTED_USERDATA = { keyResults: results({ yandex: [OWM_KEY, 401] }) };
  assert.equal(keyStatus.statusOf(KEYED.openweathermap, 'openweathermap', S).state, 'untested',
    'another provider\'s answer, even to the same key');
  global.INJECTED_USERDATA = { keyResults: '{oops' };
  assert.equal(keyStatus.statusOf(KEYED.openweathermap, 'openweathermap', S).state, 'untested', 'unreadable');

  global.INJECTED_USERDATA = { keyResults: results({ openweathermap: [OWM_KEY, 200] }) };
  assert.equal(line('openweathermap', S), 'Key ••••abcd · ✓ works');
  // The update records name no key, so they say nothing about one.
  global.INJECTED_USERDATA = {
    lastFetchSuccess: JSON.stringify({ time: 'x', id: 'openweathermap', name: 'OWM', keyHash: fingerprint(OWM_KEY) }),
    authBackoff: JSON.stringify({ code: 'owm_status_401', since: 1, provider: 'openweathermap', keyHash: fingerprint(OWM_KEY) })
  };
  assert.equal(keyStatus.statusOf(KEYED.openweathermap, 'openweathermap', S).state, 'untested');

  // The phone keeps the newest answer; a test on this page is newer still.
  global.INJECTED_USERDATA = { keyResults: results({ openweathermap: [OWM_KEY, 403] }) };
  assert.equal(line('openweathermap', S), 'Key ••••abcd · ✗ rejected: no access (403)');
  keyStatus.recordTest('owmApiKey', OWM_KEY, 200);
  assert.equal(line('openweathermap', S), 'Key ••••abcd · ✓ works');
});

test('each provider keeps its own last answer: switching to another and back still reads it', () => {
  // One entry per source (key-result.js): a newer answer from Tomorrow.io leaves
  // OpenWeatherMap's standing.
  global.INJECTED_USERDATA = { keyResults: results({ openweathermap: [OWM_KEY, 200], tomorrowio: [TIO_KEY, 401] }) };
  assert.equal(keyStatus.statusOf(KEYED.openweathermap, 'openweathermap', { owmApiKey: OWM_KEY }).state, 'ok');
  assert.equal(keyStatus.statusOf(KEYED.tomorrowio, 'tomorrowio', { tomorrowioApiKey: TIO_KEY }).state, 'rejected');
});

test('Yandex: no Test, so only the last update says something about its key', () => {
  const S = { yandexApiKey: 'ydx-5555' };
  global.INJECTED_USERDATA = { keyResults: results({ yandex: ['ydx-5555', 403] }) };
  assert.equal(line('yandex', S), 'Key ••••5555 · ✗ rejected: no access (403)');
  global.INJECTED_USERDATA = { keyResults: results({ yandex: ['ydx-5555', 200] }) };
  assert.equal(line('yandex', S), 'Key ••••5555 · ✓ works');
});

test('Tomorrow.io adds the calls a day the settings come to', () => {
  const S = { provider: 'tomorrowio', tomorrowioApiKey: TIO_KEY, radarProvider: 'rainbow', radarMode: 'graph',
    fetchIntervalMin: '15', sleepNightEnabled: false, tomorrowioFitBudget: true };
  assert.equal(line('tomorrowio', S), 'Key ••••wxyz · not tested yet · ~96 of 500 calls a day');
  keyStatus.recordTest('tomorrowioApiKey', TIO_KEY, 200);
  assert.equal(line('tomorrowio', Object.assign({}, S, { radarProvider: 'tomorrowio' })),
    'Key ••••wxyz · ✓ works · ~192 of 500 calls a day', 'the radar\'s calls ride the same key');
});

// --- the resolvers -------------------------------------------------------------------------

test('the key row: the picked provider\'s sheet and "<Name> API key"; a dimmed "No key" while it is missing, else the summary line', () => {
  const sheet = PC.sheetResolvers.get('keySheet');
  const label = PC.hintResolvers.get('keyRowLabel');
  const summary = PC.hintResolvers.get('keyRowSummary');
  const args = (from, S) => argsOf(from, S.provider);
  const owm = (k) => ({ provider: 'openweathermap', owmApiKey: k });
  assert.equal(sheet(owm(' '), {}, args(keyRowItem.editSheetFrom, owm(' '))), 'providerKeyOwm');
  assert.equal(label(owm(' '), {}, args(keyRowItem.labelFrom, owm(' '))), 'OpenWeatherMap API key');
  assert.equal(summary(owm(' '), {}, args(keyRowItem.hintFrom, owm(' '))), '<span class="hint-faint">No key</span>',
    'missing: the dimmed "No key"');
  assert.equal(summary(owm(OWM_KEY), {}, args(keyRowItem.hintFrom, owm(OWM_KEY))), 'Key ••••abcd · not tested yet');
  keyStatus.recordTest('owmApiKey', OWM_KEY, 401);
  assert.equal(summary(owm(OWM_KEY), {}, args(keyRowItem.hintFrom, owm(OWM_KEY))),
    'Key ••••abcd · ✗ rejected: not valid for One Call 3.0 (401)', 'the summary line, a refusal and all');
  const ydx = { provider: 'yandex' };
  assert.equal(sheet(ydx, {}, args(keyRowItem.editSheetFrom, ydx)), 'providerKeyYandex');
  assert.equal(label(ydx, {}, args(keyRowItem.labelFrom, ydx)), 'Yandex Weather API key');
  // A provider without a key: no sheet, so the row is not drawn (the page tests below).
  ['dwd', 'wunderground', 'metno', 'openmeteo'].forEach((p) => {
    const S = { provider: p };
    assert.equal(sheet(S, {}, args(keyRowItem.editSheetFrom, S)), null, p + ': no sheet');
    assert.equal(label(S, {}, args(keyRowItem.labelFrom, S)), null, p + ': the row\'s own label');
    assert.equal(summary(S, {}, args(keyRowItem.hintFrom, S)), null, p + ': no summary');
  });
});

test('keyMissingNote: the note while the picked provider\'s key is missing, \'\' otherwise', () => {
  const fn = PC.hintResolvers.get('keyMissingNote');
  const note = 'Needs an API key. Without one, the watch gets no forecast.';
  assert.equal(fn({ provider: 'yandex' }, {}, NOTE_ARGS), note);
  assert.equal(fn({ provider: 'tomorrowio', tomorrowioApiKey: ' \n' }, {}, NOTE_ARGS), note);
  assert.equal(fn({ provider: 'tomorrowio', tomorrowioApiKey: TIO_KEY }, {}, NOTE_ARGS), '');
  assert.equal(fn({ provider: 'dwd' }, {}, NOTE_ARGS), '', 'no key, no note');
  keyStatus.recordTest('tomorrowioApiKey', TIO_KEY, 401);
  assert.equal(fn({ provider: 'tomorrowio', tomorrowioApiKey: TIO_KEY }, {}, NOTE_ARGS), '', 'a rejected key is not missing');
});

test('keyAttention: missing or known-rejected asks; an untested or working key does not', () => {
  const fn = PC.attentionResolvers.get('keyAttention');
  const args = (S) => argsOf(providerRow.attentionFrom, S.provider);
  const missing = { provider: 'openweathermap', owmApiKey: '' };
  assert.deepEqual(fn(missing, {}, args(missing)), {
    note: 'OpenWeatherMap has no API key', title: 'OpenWeatherMap has no API key',
    body: 'Without one, the watch gets no forecast.', actionLabel: 'Add key', sheet: 'providerKeyOwm'
  });
  const tio = { provider: 'tomorrowio', tomorrowioApiKey: TIO_KEY };
  assert.equal(fn(tio, {}, args(tio)), null, 'untested: no dot, no dialog');
  keyStatus.recordTest('tomorrowioApiKey', TIO_KEY, 200);
  assert.equal(fn(tio, {}, args(tio)), null, 'works');
  keyStatus.recordTest('tomorrowioApiKey', TIO_KEY, 401);
  assert.deepEqual(fn(tio, {}, args(tio)), {
    note: 'Tomorrow.io rejected the API key', title: 'Tomorrow.io rejected the API key',
    body: 'Until it accepts a key, the watch gets no forecast.', actionLabel: 'Edit key', sheet: 'providerKeyTomorrowio'
  });
  ['dwd', 'wunderground', 'metno', 'openmeteo'].forEach((p) =>
    assert.equal(fn({ provider: p }, {}, args({ provider: p })), null, p));
});

// --- the real page -----------------------------------------------------------------------

/**
 * The tab bar's button for a tab id.
 * @param {Object} page bootGeneratedPage handle.
 * @param {string} id Tab id.
 * @returns {string} Its markup.
 */
function tabButton(page, id) {
  const m = page.tabs.innerHTML.match(new RegExp('<button class="tab[^"]*" data-tab="' + id + '"[^>]*>.*?</button>'));
  assert.ok(m, id + ' tab rendered');
  return m[0];
}

/**
 * Tap a button inside #modal by its data-confirm / data-select-close attribute.
 * @param {Object} page bootGeneratedPage handle.
 * @param {string} sel Selector the engine's handler asks closest() for.
 * @param {string} [attr] Attribute to answer.
 * @param {string} [value] Its value.
 * @returns {void}
 */
function tapInModal(page, sel, attr, value) {
  const t = { getAttribute: (n) => (n === attr ? value : null), closest: (s) => (s === sel ? t : null) };
  page.modal.dispatch('click', { target: t });
}

/**
 * Give the page's tab bar a layout the engine's tab reveal can measure: a 360 px bar with
 * 18 px side padding, in which Weather rests at 18-90, Graphs sits past the right edge at
 * 520-590 and Setup, the last tab, further right still at 600-660, all shifted by the bar's
 * scrollLeft. Leaves scrollLeft to the test.
 * @param {Object} page bootGeneratedPage handle.
 * @returns {void}
 */
function stubTabBarGeometry(page) {
  const X = { weather: [18, 90], graphs: [520, 590], setup: [600, 660] };
  const onTab = () => (/class="tab on" data-tab="(\w+)"/.exec(page.tabs.innerHTML) || [])[1];
  page.tabs.getBoundingClientRect = () => ({ left: 0, right: 360 });
  page.tabs.querySelector = (sel) => (sel !== '.tab.on' ? null : { getBoundingClientRect: () => ({
    left: (X[onTab()] || [0, 0])[0] - page.tabs.scrollLeft, right: (X[onTab()] || [0, 0])[1] - page.tabs.scrollLeft }) });
  page.window.getComputedStyle = () => ({ paddingLeft: '18px' });
}

/**
 * The Weather data card's key row (the nav row that opens a provider's key sheet).
 * @param {Object} page bootGeneratedPage handle, on the Setup tab.
 * @param {string} sheetId The key sheet it opens.
 * @returns {?string} Its markup, or null when it is not drawn.
 */
function keyRowHtml(page, sheetId) {
  const m = page.scroll.innerHTML.match(new RegExp('<div class="row nav[^"]*" data-edit-sheet="' + sheetId +
    '"[^>]*><div class="lft">[\\s\\S]*?</div></div>'));
  return m ? m[0] : null;
}

test('page: a missing key — the key row reads "No key", the amber note, a dot on the Setup tab', () => {
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: '' }, 'basalt', { dialog: true });
  page.clickTab('setup');
  const body = page.scroll.innerHTML;
  assert.equal(keyRowHtml(page, 'providerKeyOwm'), '<div class="row nav indent" data-edit-sheet="providerKeyOwm" ' +
    'role="button" tabindex="0" style="cursor:pointer"><div class="lft"><div class="lbl">OpenWeatherMap API key</div>' +
    '<div class="hint"><span class="hint-faint">No key</span></div></div>');
  assert.doesNotMatch(body, /class="thr-btn" data-edit-sheet="providerKeyOwm"/, 'no Edit / "Add key" button any more');
  assert.match(body, /<div class="static join info"><div class="info-box">Needs an API key\. Without one, the watch gets no forecast\.<\/div><\/div>/);
  assert.ok(body.indexOf('data-select="provider"') < body.indexOf('Needs an API key') &&
    body.indexOf('Needs an API key') < body.indexOf('data-edit-sheet="providerKeyOwm"'),
    'the picker, its note, then the key row');
  assert.match(tabButton(page, 'setup'), /aria-label="Setup \(OpenWeatherMap has no API key\)">Setup<span class="tab-dot" aria-hidden="true"><\/span>/);
  ['weather', 'watchface', 'watch', 'alerts', 'graphs'].forEach((id) =>
    assert.doesNotMatch(tabButton(page, id), /tab-dot/, id));
});

test('page: a keyless provider draws no key row and no note', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'basalt', { dialog: true });
  page.clickTab('setup');
  assert.ok(page.scroll.innerHTML.indexOf('data-select="provider"') !== -1, 'the picker is there');
  assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="providerKey/, 'no key row');
  assert.doesNotMatch(page.scroll.innerHTML, /API key<\/div>/);
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
});

test('page: Save with a missing key opens the dialog; "Add key" opens the key sheet and saves nothing', async () => {
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: '' }, 'basalt', { dialog: true });
  page.clickTab('graphs');
  page.tapSave();
  const dlg = page.modal.innerHTML;
  assert.ok(page.modal.open, 'the native dialog opened');
  assert.ok(dlg.indexOf('id="cfm-ttl">OpenWeatherMap has no API key</span>') !== -1, dlg);
  assert.ok(dlg.indexOf('<p class="cfm-body">Without one, the watch gets no forecast.</p>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="action">Add key</button>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="save">Save anyway</button>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="action"') < dlg.indexOf('data-confirm="save"'), 'the fix comes first');
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.ok(page.modal.innerHTML.indexOf('data-k="owmApiKey"') !== -1, 'the OpenWeatherMap key sheet is open');
  assert.ok(page.scroll.innerHTML.indexOf('data-edit-sheet="providerKeyOwm"') !== -1, 'over the Setup tab');
  assert.match(tabButton(page, 'setup'), /class="tab on"/);
  assert.equal(await page.saved(), null, 'nothing was saved');
});

test('page: the dialog\'s fix on another tab scrolls the tab bar until that tab shows', () => {
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: '' }, 'basalt', { dialog: true });
  stubTabBarGeometry(page);
  page.tabs.scrollLeft = 0;
  page.clickTab('weather');
  assert.equal(page.tabs.scrollLeft, 0, 'a tab already in view leaves the bar where it is');
  page.clickTab('graphs');
  assert.equal(page.tabs.scrollLeft, 590 - (360 - 18), 'the tap on Graphs scrolled it into view');
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.match(tabButton(page, 'setup'), /class="tab on"/, 'the fix opened on Setup');
  assert.equal(page.tabs.scrollLeft, 660 - (360 - 18), 'and the bar scrolled on until Setup shows (confirmChoice\'s reveal)');
});

test('page: "Save anyway" saves as Save does; the close button saves nothing', async () => {
  const page = bootGeneratedPage({ provider: 'yandex', yandexApiKey: '' }, 'basalt', { dialog: true });
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('Yandex Weather has no API key') !== -1);
  tapInModal(page, '[data-select-close]');
  assert.equal(page.modal.innerHTML, '', 'closed');
  assert.equal(page.modal.open, false);
  assert.equal(await page.saved(), null, 'closing is not saving');
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'save');
  assert.equal(page.modal.innerHTML, '', 'the dialog closes before the save');
  const blob = await page.saved();
  assert.equal(blob.provider, 'yandex');
  assert.equal(blob.yandexApiKey, '');
});

test('page: the dialog hands focus back to Save when it closes unsaved, and nowhere on "Save anyway"', async () => {
  const page = bootGeneratedPage({ provider: 'yandex', yandexApiKey: '' }, 'basalt', { dialog: true });
  const save = page.window.document.getElementById('save');
  const closes = {
    'the close button': () => tapInModal(page, '[data-select-close]'),
    'the backdrop': () => page.modal.dispatch('click', { target: page.modal }),
    'Escape': () => page.modal.dispatch('cancel', { preventDefault: () => {} })
  };
  Object.keys(closes).forEach((how, i) => {
    page.tapSave();
    assert.equal(page.modal.open, true, how + ': the dialog opened');
    closes[how]();
    assert.equal(page.modal.open, false, how + ': closed');
    assert.equal(save.focuses, i + 1, how + ': focus is back on Save');
  });
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'save');
  assert.equal(save.focuses, 3, '"Save anyway" hands focus to nothing: the page is leaving');
  assert.equal((await page.saved()).provider, 'yandex');
});

test('page: a palette left open in the tab body closes under the Save dialog and stays closed', () => {
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: '' }, 'basalt', { dialog: true });
  page.clickTab('watchface');
  page.openAllMore();   // the Time card's colour sits under More options
  const sw = { getAttribute: (n) => (n === 'data-color' ? 'colorTime' : null),
    closest: (sel) => (sel === '[data-color]' ? sw : null) };
  page.scroll.dispatch('click', { target: sw });
  assert.ok(page.scroll.innerHTML.indexOf('class="palette"') !== -1, 'the palette is open');
  page.tapSave();
  assert.equal(page.modal.open, true, 'the dialog opened');
  assert.equal(page.scroll.innerHTML.indexOf('class="palette"'), -1, 'the palette closed under it');
  tapInModal(page, '[data-select-close]');
  assert.equal(page.scroll.innerHTML.indexOf('class="palette"'), -1, 'and does not come back');
});

test('page: the dialog\'s fix on the tab already showing leaves the tab bar; a tap on that tab brings it in', () => {
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: '' }, 'basalt', { dialog: true });
  stubTabBarGeometry(page);   // Setup rests at 600-660 in a 360 px bar with 18 px padding
  page.tabs.scrollLeft = 0;
  page.clickTab('setup');
  page.tabs.scrollLeft = 632;   // the bar swiped sideways: Setup is cut off at the left edge
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.ok(page.modal.innerHTML.indexOf('data-k="owmApiKey"') !== -1, 'the key sheet opened over Setup');
  assert.equal(page.tabs.scrollLeft, 632, 'no tab switched, so the bar stays where it was');
  tapInModal(page, '[data-select-close]');
  page.clickTab('setup');
  assert.equal(page.tabs.scrollLeft, 600 - 18, 'a tap on the half-hidden Setup brings it fully in');
});

test('page: a key the last update was refused with — the summary, the dot and the "rejected" dialog', async () => {
  const userData = { keyResults: results({ openweathermap: [OWM_KEY, 401] }) };
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: OWM_KEY }, 'basalt', { userData, dialog: true });
  page.clickTab('setup');
  assert.match(keyRowHtml(page, 'providerKeyOwm'),
    /<div class="lbl">OpenWeatherMap API key<\/div><div class="hint">Key ••••abcd · ✗ rejected: not valid for One Call 3\.0 \(401\)<\/div>/,
    'the key row\'s summary says it was refused');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/, 'the key is there: no missing-key note');
  assert.match(tabButton(page, 'setup'), /Setup \(OpenWeatherMap rejected the API key\)/);
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('OpenWeatherMap rejected the API key') !== -1);
  assert.ok(page.modal.innerHTML.indexOf('Until it accepts a key, the watch gets no forecast.') !== -1);
  assert.ok(page.modal.innerHTML.indexOf('data-confirm="action">Edit key</button>') !== -1);
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  // A new key typed in the sheet is not the refused one.
  const inp = { value: 'fresh-key-9999', getAttribute: (n) => (n === 'data-k' ? 'owmApiKey' : null),
    closest: (sel) => (sel === 'input[type=text]' ? inp : null) };
  ['focusin', 'input', 'change'].forEach((type) => page.modal.dispatch(type, { target: inp }));
  page.doneDialog();   // Done keeps the typed key (× would put the refused one back)
  assert.match(keyRowHtml(page, 'providerKeyOwm'), /<div class="hint">Key ••••9999 · not tested yet<\/div>/);
  assert.doesNotMatch(tabButton(page, 'setup'), /tab-dot/, 'no dot for an untested key');
  page.tapSave();
  const blob = await page.saved();
  assert.equal(blob.owmApiKey, 'fresh-key-9999', 'an untested key never stops Save');
});

test('page: a key the last update went through with reads "✓ works"', () => {
  const userData = { keyResults: results({ tomorrowio: [TIO_KEY, 200] }) };
  const page = bootGeneratedPage({ provider: 'tomorrowio', tomorrowioApiKey: TIO_KEY, radarProvider: 'rainbow',
    fetchIntervalMin: '15', sleepNightEnabled: false }, 'basalt', { userData });
  page.clickTab('setup');
  assert.match(keyRowHtml(page, 'providerKeyTomorrowio'),
    /<div class="lbl">Tomorrow\.io API key<\/div><div class="hint">Key ••••wxyz · ✓ works · ~96 of 500 calls a day<\/div>/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
});

test('page: the Test button\'s answer reaches the summary once the sheet closes', () => {
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: OWM_KEY });
  const xhrs = [];
  page.window.XMLHttpRequest = function () {
    this.open = () => {};
    this.send = () => {};
    xhrs.push(this);
  };
  const field = { value: OWM_KEY };
  const result = { textContent: '' };
  page.window.document.querySelector = (sel) => (sel === 'input[data-k="owmApiKey"]' ? field
    : sel === '[data-action-result="owmApiKey"]' ? result : null);
  page.clickTab('setup');
  page.openEditSheet('providerKeyOwm');
  tapInModal(page, '[data-action]', 'data-action', 'testOwmKey');
  assert.equal(xhrs.length, 1, 'the Test request went out');
  xhrs[0].status = 401;
  xhrs[0].onload();
  assert.match(result.textContent, /Rejected \(401\)/, 'the verdict line as before');
  page.doneDialog();
  assert.match(keyRowHtml(page, 'providerKeyOwm'), /<div class="hint">Key ••••abcd · ✗ rejected: not valid for One Call 3\.0 \(401\)<\/div>/);
  assert.match(tabButton(page, 'setup'), /tab-dot/);
});

test('page: no <dialog> support — Save saves at once, missing key and all', async () => {
  const page = bootGeneratedPage({ provider: 'openweathermap', owmApiKey: '' });
  page.tapSave();
  assert.equal(page.modal.innerHTML, '', 'no dialog');
  const blob = await page.saved();
  assert.equal(blob.provider, 'openweathermap', 'saved anyway');
});

test('page: a keyless provider, or a working key, saves without a dialog', async () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'basalt', { dialog: true });
  page.tapSave();
  assert.equal(page.modal.innerHTML, '');
  assert.equal((await page.saved()).provider, 'dwd');
});

test('page: aplite shows the same key status (the provider row is on every watch)', () => {
  const page = bootGeneratedPage({ provider: 'yandex', yandexApiKey: '' }, 'aplite', { dialog: true });
  page.clickTab('setup');
  assert.match(keyRowHtml(page, 'providerKeyYandex'),
    /<div class="lbl">Yandex Weather API key<\/div><div class="hint"><span class="hint-faint">No key<\/span><\/div>/);
  assert.ok(page.scroll.innerHTML.indexOf('Needs an API key. Without one, the watch gets no forecast.') !== -1);
  assert.match(tabButton(page, 'setup'), /tab-dot/);
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('Yandex Weather has no API key') !== -1);
});
