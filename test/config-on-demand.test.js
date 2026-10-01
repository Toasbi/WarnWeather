'use strict';
// test/config-on-demand.test.js — On demand on the settings page, end to end on the
// REAL generated settings page (test/helpers/page-harness.js): each bar's Alerts row on the
// Status slots tab (both sides' ticked items as its live hint, and Edit; a side is on while
// it ticks something), the bar's Alerts sheet with a Left and a Right tick per item, the
// Alert settings card at the top of the General tab with its live texts and item sheets,
// the rain notes, the resets, and the aplite page, which has none of it. The schema shape itself
// is pinned in test/config-schema.test.js; this file checks what the page renders and does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootGeneratedPage } = require('./helpers/page-harness.js');
const ICONS = require('../src/pkjs/settings/status-slot-icons.js');
const OD = require('../src/pkjs/on-demand.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const SCHEMA = require('../src/pkjs/settings/schema.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const onbuild = require('../src/pkjs/settings/onbuild.js');
const PC = global.PConf;

/**
 * Boot the page on the Status slots tab.
 * @param {Object} [cfg] stored settings (provider dwd unless given)
 * @param {string} [platformName] Pebble platform (default basalt)
 * @returns {Object} the page-harness handle
 */
function watchTab(cfg, platformName) {
  const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, cfg || {}), platformName);
  page.clickTab('watch');
  return page;
}

/**
 * Boot the page on the General tab, whose first card is Alert settings.
 * @param {Object} [cfg] stored settings (provider dwd unless given)
 * @param {string} [platformName] Pebble platform (default basalt)
 * @returns {Object} the page-harness handle
 */
function generalTab(cfg, platformName) {
  const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, cfg || {}), platformName);
  page.clickTab('general');
  return page;
}

/**
 * The markup of one row, from its opening `<div class="row` to the next row's.
 * @param {string} html rendered page markup
 * @param {string} needle a string unique to the row (e.g. its data-edit-sheet)
 * @returns {string} the row's markup ('' when absent)
 */
function rowOf(html, needle) {
  const at = html.indexOf(needle);
  if (at === -1) { return ''; }
  const start = html.lastIndexOf('<div class="row', at);
  const next = html.indexOf('<div class="row', at);
  return html.slice(start, next === -1 ? html.length : next);
}

/**
 * Tap one tick in the open Alerts sheet (the engine's [data-check] path): the column's
 * key, and the bar's checklist (its Left list's key) as the tick names it.
 * @param {Object} page the page-harness handle
 * @param {string} key the column's key, e.g. 'statusTopOnDemandRightItems'
 * @param {string} code the option's value
 */
function tick(page, key, code) {
  const attrs = { 'data-k': key, 'data-check': code, 'data-list': key.replace(/Right(Items)$/, 'Left$1') };
  const t = {
    getAttribute: n => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
    closest: sel => (sel === '[data-check]' ? t : null)
  };
  page.modal.dispatch('click', { target: t });
}

/**
 * Pick a segmented or radio option in #scroll (the engine's [data-v] path).
 * @param {Object} page the page-harness handle
 * @param {string} key the control's messageKey
 * @param {string} value the option's value
 */
function pick(page, key, value) {
  const t = {
    getAttribute: n => (n === 'data-k' ? key : (n === 'data-v' ? value : null)),
    closest: sel => (sel === '[data-v]' ? t : null)
  };
  page.scroll.dispatch('click', { target: t });
}

/**
 * Dispatch a [data-action] button in #scroll.
 * @param {Object} page the page-harness handle
 * @param {string} action the action id
 */
function act(page, action) {
  const t = {
    getAttribute: n => (n === 'data-action' ? action : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  page.scroll.dispatch('click', { target: t });
}

/**
 * The hint text of the row holding a needle ('' when the row has none).
 * @param {string} html rendered page markup
 * @param {string} needle a string unique to the row
 * @returns {string} the hint's inner markup
 */
function hintOf(html, needle) {
  const m = /<div class="hint"[^>]*>([\s\S]*?)<\/div>/.exec(rowOf(html, needle));
  return m ? m[1] : '';
}

/**
 * A bar's Alerts row on the Status slots tab, found by its Edit button's sheet.
 * @param {string} html rendered page markup
 * @param {string} sheetId the bar's sheet, e.g. 'odTop'
 * @returns {string} the row's markup ('' when absent)
 */
const barRow = (html, sheetId) => rowOf(html, 'data-edit-sheet="' + sheetId + '"');
/**
 * A bar's Alerts summary (its row's hint).
 * @param {string} html rendered page markup
 * @param {string} sheetId the bar's sheet, e.g. 'odTop'
 * @returns {string} the summary ('' for none)
 */
const barHint = (html, sheetId) => hintOf(html, 'data-edit-sheet="' + sheetId + '"');
/**
 * The ticks of one item's row in the open Alerts sheet, Left then Right.
 * @param {string} sheet the sheet's markup
 * @param {string} code the item's code
 * @returns {string[]} the two tick buttons' opening tags
 */
function ticksOf(sheet, code) {
  const at = sheet.indexOf('data-check="' + code + '"');
  const row = sheet.slice(sheet.lastIndexOf('<div class="row chk-opt', at), sheet.indexOf('</span></div>', at));
  return row.match(/<button[^>]*>/g) || [];
}
/**
 * Which columns tick an item in the open Alerts sheet.
 * @param {string} sheet the sheet's markup
 * @param {string} code the item's code
 * @returns {string} 'left' | 'right' | 'none' | 'both'
 */
function ticked(sheet, code) {
  const on = ticksOf(sheet, code).map((b) => /aria-checked="true"/.test(b));
  return on[0] && on[1] ? 'both' : on[0] ? 'left' : on[1] ? 'right' : 'none';
}
const TOP_SUMMARY = 'Left: Bluetooth, Quiet time, Sleep, Rain · Right: Battery, Wind gusts, UV index, Air quality,'
  + ' Wind speed';

test('each bar ends on one Alerts row: both sides\' ticks as the summary, and Edit', () => {
  const html = watchTab().scroll.innerHTML;
  assert.equal(barHint(html, 'odTop'), TOP_SUMMARY);
  assert.ok(barRow(html, 'odTop').indexOf('<div class="lbl">Alerts</div>') !== -1, 'the row\'s label');
  assert.match(barRow(html, 'odTop'), /^<div class="row[^"]*\bslot\b/, 'a compact row');
  ['odTop', 'odForecast', 'odRadar', 'odHealth'].forEach((id) =>
    assert.ok((html.match(new RegExp('data-edit-sheet="' + id + '"', 'g')) || []).length <= 1, id + ': one row'));
  assert.equal(html.indexOf('Alerts left'), -1, 'no side rows');
  assert.equal(html.indexOf('Alerts right'), -1, 'no side rows');
  assert.equal(html.indexOf('data-edit-sheet="odTopLeft"'), -1, 'no side sheets');
  const fc = barRow(html, 'odForecast');
  assert.ok(fc !== '', 'a bar that ticks nothing still has its Edit button');
  assert.equal(fc.indexOf('class="hint"'), -1, 'nothing ticked: no summary');
  assert.equal(html.indexOf('data-select="statusTopOnDemand'), -1, 'no Enabled/Disabled dropdown');
  assert.ok(html.indexOf('data-edit-sheet="odRadar"') !== -1, 'the radar bar exists by default');
});

test('the Status slots tab: the bars in the owner\'s order, the reset inline in the intro', () => {
  // The owner, 2026-10-01: "1: watch status bar 2 weather 3 health 4 radar" (the page only;
  // the wire keeps its order). The health bar needs a health mode with a status bar.
  const html = watchTab({ healthMode: 'status' }).scroll.innerHTML;
  const at = (title) => html.indexOf('<div class="subhdr">' + title + '</div>');
  const order = ['Watch Status Bar', 'Forecast Status Bar', 'Health Status Bar', 'Radar Status Bar'];
  order.forEach((t) => assert.ok(at(t) !== -1, t + ' renders'));
  assert.deepEqual(order.slice().sort((a, b) => at(a) - at(b)), order, 'Watch, Forecast, Health, Radar');
  // Each bar's Alerts row sits under its own sub-header.
  [['odTop', 'Watch Status Bar', 'Forecast Status Bar'], ['odForecast', 'Forecast Status Bar', 'Health Status Bar'],
    ['odHealth', 'Health Status Bar', 'Radar Status Bar']].forEach(([id, from, to]) => {
    const row = html.indexOf('data-edit-sheet="' + id + '"');
    assert.ok(row > at(from) && row < at(to), id + ' under ' + from);
  });
  assert.ok(html.indexOf('data-edit-sheet="odRadar"') > at('Radar Status Bar'), 'odRadar under the radar bar');
  assert.ok(html.indexOf('Choose what each view shows below. <button type="button" class="txt-link" '
    + 'data-action="resetStatusSlots">Reset status bars to defaults</button></div>') !== -1,
  'the status card\'s reset: an inline text button closing its intro');
  assert.equal(html.indexOf('txt-act-btn'), -1, 'no boxed chip on the tab');
});

test('a side is on as soon as a tick in its column, and off again once its column is empty', () => {
  const page = watchTab();
  page.openEditSheet('odForecast');
  tick(page, 'statusForecastOnDemandRightItems', 'uv');
  tick(page, 'statusForecastOnDemandRightItems', 'battery');
  assert.equal(page.S.statusForecastOnDemandRightItems, 'battery,uv', 'the priority order, not the tap order');
  assert.equal(barHint(page.scroll.innerHTML, 'odForecast'), 'Right: Battery, UV index',
    'the summary repaints behind the sheet');
  assert.equal(OD.sideOf(page.S, 'forecast', 'uv'), 'right', 'the watch shows it there');
  tick(page, 'statusForecastOnDemandLeftItems', 'bt');
  assert.equal(barHint(page.scroll.innerHTML, 'odForecast'), 'Left: Bluetooth · Right: Battery, UV index');
  tick(page, 'statusForecastOnDemandRightItems', 'uv');
  tick(page, 'statusForecastOnDemandRightItems', 'battery');
  assert.equal(page.S.statusForecastOnDemandRightItems, '');
  assert.equal(barHint(page.scroll.innerHTML, 'odForecast'), 'Left: Bluetooth', 'the empty side drops out');
  assert.equal(OD.sideOf(page.S, 'forecast', 'uv'), null);
  tick(page, 'statusForecastOnDemandLeftItems', 'bt');
  assert.equal(barHint(page.scroll.innerHTML, 'odForecast'), '', 'nothing ticked: off, no summary');
});

test('a bar\'s Alerts sheet: the bar\'s name, two sub-headers, a Left and a Right tick per item, no cards', () => {
  const page = watchTab();
  page.openEditSheet('odTop');
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('id="esheet-ttl-odTop">Alerts</span>') !== -1, 'the title');
  assert.ok(sheet.indexOf('<b>Watch Status Bar</b><br>Ticked items show at this bar’s left or right edge only when'
    + ' they reach their warn level or are active right now, each on one side at most.') !== -1,
    'the bar\'s name leads the intro');
  assert.equal(sheet.indexOf('class="card'), -1, 'no cards inside the sheet');
  const order = ['battery', 'bt', 'qt', 'snooze', 'rain', 'gust', 'uv', 'aqi', 'pollen', 'wind']
    .map((c) => sheet.indexOf('data-check="' + c + '"'));
  assert.ok(order.every((at, i) => at !== -1 && (i === 0 || at > order[i - 1])), 'priority order: ' + order);
  const caps = '<span class="chk-caps" aria-hidden="true"><span>Left</span><span>Right</span></span>';
  const sys = sheet.indexOf('<div class="subhdr grp chk-hdr"><span>System info</span>' + caps + '</div>');
  const wx = sheet.indexOf('<div class="subhdr grp chk-hdr"><span>Weather alerts</span>' + caps + '</div>');
  assert.ok(sys !== -1 && sys < order[0], 'System info heads the system items, captioned Left / Right');
  assert.ok(order[3] < wx && wx < order[4], 'Weather alerts heads the weather items, captioned Left / Right');
  // Every row: two ticks, Left writing the left list and Right the right one.
  ['battery', 'bt', 'qt', 'snooze', 'rain', 'gust', 'uv', 'aqi', 'pollen', 'wind'].forEach((code) => {
    const t = ticksOf(sheet, code);
    assert.equal(t.length, 2, code + ': two ticks');
    assert.match(t[0], /data-list="statusTopOnDemandLeftItems" data-k="statusTopOnDemandLeftItems"/, code + ' Left');
    assert.match(t[1], /data-list="statusTopOnDemandLeftItems" data-k="statusTopOnDemandRightItems"/, code + ' Right');
  });
  assert.deepEqual(['battery', 'bt', 'qt', 'snooze', 'rain', 'gust', 'uv', 'aqi', 'pollen', 'wind']
    .map((c) => ticked(sheet, c)),
  ['right', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'none', 'right'], 'the default ticks');
  assert.match(ticksOf(sheet, 'bt')[0], /aria-label="Bluetooth, Left"/);
  assert.equal(sheet.indexOf('ticking moves it here'), -1, 'the columns show the side: no note names one');
  // Each group's rows are joined; the group's last joins the next sub-header loosely.
  const rowCls = (code) => {
    const at = sheet.indexOf('data-check="' + code + '"');
    return /<div class="row chk-opt([^"]*)">/.exec(sheet.slice(sheet.lastIndexOf('<div class="row chk-opt', at)))[1];
  };
  ['battery', 'bt', 'qt', 'rain', 'gust', 'uv', 'aqi', 'pollen'].forEach((code) =>
    assert.equal(rowCls(code), ' nb', code + ' joins the row below it'));
  assert.equal(rowCls('snooze'), ' nbl', 'Sleep closes System info');
  assert.equal(rowCls('wind'), '', 'Wind speed closes the list');
});

test('ticking the other column moves an item; unticking leaves it on no side', () => {
  const page = watchTab();
  page.openEditSheet('odTop');
  // Bluetooth is on the left: ticking Right moves it.
  tick(page, 'statusTopOnDemandRightItems', 'bt');
  assert.equal(page.S.statusTopOnDemandRightItems, 'battery,bt,gust,uv,aqi,wind');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'qt,snooze,rain', 'gone from the left');
  assert.equal(ticked(page.modal.innerHTML, 'bt'), 'right', 'the sheet shows the move');
  assert.equal(barHint(page.scroll.innerHTML, 'odTop'), 'Left: Quiet time, Sleep, Rain · Right: Battery, Bluetooth,'
    + ' Wind gusts, UV index, Air quality, Wind speed', 'the summary follows');
  // And back: Battery is on the right, ticking Left moves it.
  tick(page, 'statusTopOnDemandLeftItems', 'battery');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'battery,qt,snooze,rain');
  assert.equal(page.S.statusTopOnDemandRightItems, 'bt,gust,uv,aqi,wind');
  assert.equal(ticked(page.modal.innerHTML, 'battery'), 'left');
  // Unticking the ticked column leaves the item on neither side.
  tick(page, 'statusTopOnDemandLeftItems', 'battery');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'qt,snooze,rain');
  assert.equal(page.S.statusTopOnDemandRightItems, 'bt,gust,uv,aqi,wind');
  assert.equal(ticked(page.modal.innerHTML, 'battery'), 'none');
  // Pollen (DWD here) ticks from nothing onto the right alone.
  tick(page, 'statusTopOnDemandRightItems', 'pollen');
  assert.equal(page.S.statusTopOnDemandRightItems, 'bt,gust,uv,aqi,pollen,wind');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'qt,snooze,rain', 'the left list is not touched');
});

test('the sheet\'s notes: Rain needs the radar, Pollen needs DWD — ticks kept, taps inert', () => {
  const page = watchTab({ radarMode: 'off', provider: 'openmeteo' });
  page.openEditSheet('odTop');
  const sheet = page.modal.innerHTML;
  const row = (code) => sheet.slice(sheet.lastIndexOf('<div class="row chk-opt', sheet.indexOf('data-check="' + code + '"')),
    sheet.indexOf('</span></div>', sheet.indexOf('data-check="' + code + '"')));
  assert.match(row('rain'), /^<div class="row chk-opt nb off"><span class="lft"><span class="lbl">Rain<\/span><span class="hint">Needs the rain radar \(Radar tab\)<\/span>/);
  assert.match(row('pollen'), /^<div class="row chk-opt nb off"><span class="lft"><span class="lbl">Pollen<\/span><span class="hint">DWD provider only<\/span>/);
  ticksOf(sheet, 'rain').concat(ticksOf(sheet, 'pollen')).forEach((b) =>
    assert.match(b, / disabled aria-disabled="true">$/, 'inert: ' + b));
  assert.equal(ticked(sheet, 'rain'), 'left', 'Rain keeps its tick');
  const t = { getAttribute: n => (n === 'data-k' ? 'statusTopOnDemandLeftItems' : n === 'data-check' ? 'pollen'
    : n === 'data-list' ? 'statusTopOnDemandLeftItems' : n === 'disabled' ? '' : null),
  closest: sel => (sel === '[data-check]' ? t : null) };
  page.modal.dispatch('click', { target: t });
  assert.equal(page.S.statusTopOnDemandLeftItems, 'bt,qt,snooze,rain', 'a gated tap changes nothing');
  // The summary leaves out what cannot show.
  assert.equal(barHint(page.scroll.innerHTML, 'odTop'),
    'Left: Bluetooth, Quiet time, Sleep · Right: Battery, Wind gusts, UV index, Air quality, Wind speed',
    'Rain left out while the radar is off');
});

test('the Alert settings card: its intro and rows with icons and live texts, at the top of the General tab', () => {
  const html = generalTab().scroll.innerHTML;
  const card = html.indexOf('<span class="ttl">Alert settings</span>');
  assert.ok(card !== -1, 'a titled card');
  // The owner, 2026-10-01: "alert settings move to the general settings to the top, below
  // it the theme and location". The notices panel above it draws nothing without notices.
  assert.equal(html.indexOf('<div class="card'), html.lastIndexOf('<div class="card', card), 'the tab\'s first card');
  assert.ok(html.indexOf('data-select="theme"') > card, 'the theme card follows it');
  assert.ok(html.indexOf('data-k="locationMode"') > html.indexOf('data-select="theme"'), 'then the location rows');
  assert.equal(watchTab().scroll.innerHTML.indexOf('<span class="ttl">Alert settings</span>'), -1,
    'no longer on the Status slots tab');
  assert.ok(html.indexOf('An alert shows at the edge of a status bar only when it reaches its warn level or is active'
    + ' right now') > card);
  // The reset is an inline text button closing the intro, like the Telemetry hint's link.
  assert.ok(html.indexOf('Tick them under Alerts on each status bar (Status slots tab), left or right. '
    + '<button type="button" class="txt-link" data-action="resetOnDemand">Reset alert settings to defaults</button></div>')
    > card, 'with its inline reset');
  assert.ok(html.indexOf('<div class="subhdr grp"><span>System info</span></div>') > card);
  assert.ok(html.indexOf('<div class="subhdr grp"><span>Weather alerts</span></div>') > card);
  const row = (needle, icon, label) => {
    const r = rowOf(html, needle);
    assert.ok(r.indexOf('<span class="lbl-ico" aria-hidden="true">' + ICONS[icon] + '</span>' + label) !== -1,
      label + ': the icon leads the label');
    return r;
  };
  // basalt's default top-right slot is the Watch battery glyph, so the item stands in.
  assert.ok(row('data-edit-sheet="odBattery"', 'battery', 'Battery')
    .indexOf('<div class="hint">At 10% or below · Hidden while a battery slot shows the charge</div>') !== -1);
  assert.ok(row('data-edit-sheet="odBluetooth"', 'bluetooth', 'Bluetooth')
    .indexOf('<div class="hint">When disconnected</div>') !== -1);
  const qt = rowOf(html, '>Quiet time</div>');
  assert.ok(qt.indexOf(ICONS.quiet) !== -1 && qt.indexOf('<div class="hint">While Quiet Time is on</div>') !== -1);
  assert.equal(qt.indexOf('data-edit-sheet'), -1, 'Quiet time has no sheet');
  const sleep = rowOf(html, '>Sleep</div>');
  assert.ok(sleep.indexOf(ICONS.snooze) !== -1
    && sleep.indexOf('<div class="hint">During the Battery saver hours, 0:00–7:00</div>') !== -1);
  assert.ok(row('data-edit-sheet="alertRain"', 'rain', 'Rain').indexOf('<div class="hint">Within 60 min · Text</div>') !== -1);
  [['Uv', 'uv', 'UV index', 'Warn 6 · Danger 8'], ['Gust', 'gust', 'Wind gusts', 'Warn 65 kph · Danger 90 kph'],
    ['Pollen', 'pollen', 'Pollen', 'Not in any status bar']].forEach(([stem, icon, label, text]) => {
    const r = row('data-edit-sheet="alert' + stem + '"', icon, label);
    assert.ok(r.indexOf('<div class="hint">' + text + '</div>') !== -1, stem + ': ' + r);
  });
  // Each group is one joined block: no divider between its rows (.nb on every row but
  // the group's last, which gives the next sub-header its line or closes the card).
  const rowCls = (needle) => /^<div class="([^"]*)"/.exec(rowOf(html, needle))[1].split(' ');
  ['data-edit-sheet="odBattery"', 'data-edit-sheet="odBluetooth"', '>Quiet time</div>',
    'data-edit-sheet="alertRain"', 'data-edit-sheet="alertGust"', 'data-edit-sheet="alertUv"',
    'data-edit-sheet="alertAqi"', 'data-edit-sheet="alertPollen"'].forEach((needle) =>
    assert.ok(rowCls(needle).indexOf('nb') !== -1, needle + ' joins the row below'));
  assert.equal(rowCls('>Sleep</div>').indexOf('nb'), -1, 'Sleep closes System info');
  assert.equal(rowCls('data-edit-sheet="alertWind"').indexOf('nb'), -1, 'Wind speed closes the card');
  assert.ok(rowOf(html, 'data-edit-sheet="alertUv"').indexOf('pen-dot') !== -1, 'a placed alert shows its colours');
  assert.equal(rowOf(html, 'data-edit-sheet="alertPollen"').indexOf('pen-dot'), -1, 'an unplaced one none');
});

// --- the live texts, resolver by resolver -------------------------------------------
const hint = (id) => PC.hintResolvers.get(id);
const ENV = { basalt: platform.computeEnv({ platform: 'basalt' }), emery: platform.computeEnv({ platform: 'emery' }) };
// A state as the page holds it: every On demand key hydrated with its default.
const state = (S) => Object.assign({}, OD.DEFAULTS, S);

test('Battery: the warn level on the watch\'s step, the Look, and "Not in any status bar"', () => {
  const t = hint('onDemandBatteryText');
  const empty = { statusTopRight: 'sun' };
  assert.equal(t(state(empty), ENV.basalt), 'At 10% or below');
  assert.equal(t(state(Object.assign({ batteryLowDisplay: 'value' }, empty)), ENV.basalt), 'At 10% or below · Icon + value');
  assert.equal(t(state(Object.assign({ batteryLowLevel: '15' }, empty)), ENV.basalt), 'At 20% or below',
    'a stored 15 reads as the next 10 % step off emery');
  assert.equal(t(state(Object.assign({ batteryLowLevel: '15' }, empty)), ENV.emery), 'At 15% or below');
  assert.equal(t(state(Object.assign({ batteryLowLevel: '25' }, empty)), platform.computeEnv(null)), 'At 30% or below',
    'an unknown watch reads the 10 % steps');
  assert.equal(t(state(Object.assign({ statusTopOnDemandRightItems: 'rain' }, empty)), ENV.basalt), 'Not in any status bar');
});

// W7 (revised 2026-09-30): a bar that shows the watch battery in a slot leaves the item
// out while that slot is visible — the glyph or the percentage, whatever the item's Look.
test('Battery: "Hidden while a battery slot shows the charge" only where the item and a battery slot share a bar', () => {
  const t = hint('onDemandBatteryText');
  const SUFFIX = ' · Hidden while a battery slot shows the charge';
  ['battery', 'batteryPct'].forEach((slot) => ['icon', 'value'].forEach((look) => {
    const S = state({ statusTopRight: slot, batteryLowDisplay: look });
    const want = 'At 10% or below' + (look === 'value' ? ' · Icon + value' : '') + SUFFIX;
    assert.equal(t(S, ENV.basalt), want, slot + ' / ' + look);
    assert.equal(t(S, ENV.emery), want, slot + ' / ' + look + ' on emery');
  }));
  // The phone battery is not the watch battery.
  const phone = Object.assign({ phoneBattery: true }, ENV.basalt);
  assert.equal(t(state({ statusTopRight: 'phoneBattery' }), phone), 'At 10% or below');
  // The item ticked on another bar than the battery slot's: nothing to hide it.
  const elsewhere = state({ statusTopRight: 'battery', statusTopOnDemandRightItems: 'rain',
    statusForecastOnDemandLeftItems: 'battery' });
  assert.equal(t(elsewhere, ENV.basalt), 'At 10% or below');
  // A battery slot the catalog cannot place (the glyph is the top-right corner's alone)
  // resolves to Empty, so it silences nothing.
  assert.equal(t(state({ statusTopRight: 'sun', statusTopLeft: 'battery' }), ENV.basalt), 'At 10% or below');
  // The item on both bars: the top bar's slot silences it.
  assert.equal(t(Object.assign({}, elsewhere, { statusTopOnDemandRightItems: 'battery' }), ENV.basalt),
    'At 10% or below' + SUFFIX);
});

test('Bluetooth, Quiet time and Sleep: their rules, the vibration, the Battery saver', () => {
  const bt = hint('onDemandBluetoothText');
  [['disconnected', 'When disconnected'], ['connected', 'When connected'], ['both', 'Always'], ['none', 'Never']]
    .forEach(([v, text]) => assert.equal(bt(state({ btIcons: v }), ENV.basalt), text, v));
  assert.equal(bt(state({ vibe: true }), ENV.basalt), 'When disconnected · Vibrates on disconnect');
  assert.equal(bt(state({ vibe: true, statusTopOnDemandLeftItems: 'qt' }), ENV.basalt),
    'Not in any status bar · Vibrates on disconnect', 'the vibration does not depend on the tick');
  const qt = hint('onDemandPlainText');
  const args = { code: 'qt', text: 'While Quiet Time is on' };
  assert.equal(qt(state({}), ENV.basalt, args), 'While Quiet Time is on');
  assert.equal(qt(state({ statusTopOnDemandLeftItems: 'bt' }), ENV.basalt, args), 'Not in any status bar');
  const sleep = hint('onDemandSleepText');
  assert.equal(sleep(state({ sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '6' }), ENV.basalt),
    'During the Battery saver hours, 22:00–6:00');
  assert.equal(sleep(state({ sleepNightEnabled: false }), ENV.basalt), 'Battery saver is off (General tab)');
  assert.equal(sleep(state({ statusTopOnDemandLeftItems: 'bt' }), ENV.basalt), 'Not in any status bar');
});

test('the Alerts summary and the sheet\'s options, resolver by resolver', () => {
  const summary = hint('onDemandSummary');
  const args = { bar: 'top' };
  const right = (list, cfg) => state(Object.assign({ statusTopOnDemandLeftItems: '', statusTopOnDemandRightItems: list },
    cfg || {}));
  assert.equal(summary(state({}), ENV.basalt, args), TOP_SUMMARY, 'the defaults');
  assert.equal(summary(right('pollen,wind', { provider: 'dwd' }), ENV.basalt, args), 'Right: Pollen, Wind speed');
  assert.equal(summary(right('pollen,wind', { provider: 'metno' }), ENV.basalt, args),
    'Right: Wind speed', 'Pollen left out off DWD');
  assert.equal(summary(right('rain', { radarMode: 'off' }), ENV.basalt, args),
    'None of the ticked items can show', 'ticked, but nothing that can show');
  assert.equal(summary(right('rain,pollen', { radarMode: 'off', provider: 'metno' }), ENV.basalt, args),
    'None of the ticked items can show', 'every tick blocked');
  assert.equal(summary(state({ statusTopOnDemandLeftItems: 'rain', statusTopOnDemandRightItems: 'uv', radarMode: 'off' }),
    ENV.basalt, args), 'Right: UV index', 'a side with nothing to show drops out');
  assert.equal(summary(state({ statusTopOnDemandLeftItems: 'snooze,bt', statusTopOnDemandRightItems: '' }),
    ENV.basalt, args), 'Left: Bluetooth, Sleep', 'the priority order');
  assert.equal(summary(right(''), ENV.basalt, args), '', 'nothing ticked: both sides off, no hint');
  assert.equal(summary(state({ statusForecastOnDemandRightItems: 'aqi' }), ENV.basalt, { bar: 'forecast' }),
    'Right: Air quality', 'each bar reads its own lists');
  const items = PC.optionsResolvers.get('onDemandItems');
  const opts = items(state({ provider: 'dwd', radarMode: 'graph' }), ENV.basalt);
  assert.deepEqual(opts.map((o) => o[1]), ['', 'battery', 'bt', 'qt', 'snooze', '', 'rain', 'gust', 'uv', 'aqi',
    'pollen', 'wind']);
  assert.deepEqual(opts[0], ['System info', '', { groupHeader: true }]);
  assert.deepEqual(opts[5], ['Weather alerts', '', { groupHeader: true }]);
  assert.deepEqual(opts[1], ['Battery', 'battery'], 'no note names a side');
  assert.deepEqual(opts[10], ['Pollen', 'pollen'], 'DWD: pollen can show');
  const offRadar = items(state({ radarMode: 'off', provider: 'metno' }), ENV.basalt);
  assert.deepEqual(offRadar[6], ['Rain', 'rain', { desc: 'Needs the rain radar (Radar tab)', disabled: true }]);
  assert.deepEqual(offRadar[10], ['Pollen', 'pollen', { desc: 'DWD provider only', disabled: true }]);
});

test('the Battery sheet renders one Warn level slider per platform, a stored 15 at the watch\'s step', () => {
  const at = (platformName) => {
    const page = watchTab({ batteryLowLevel: '15' }, platformName);
    page.openEditSheet('odBattery');
    assert.equal(page.S.batteryLowLevel, '15', platformName + ': shown at its step, not written back');
    return page.modal.innerHTML;
  };
  const basalt = at('basalt');
  assert.equal((basalt.match(/data-range="batteryLowLevel"/g) || []).length, 1, 'one slider');
  assert.match(basalt, /class="rng single" data-range="batteryLowLevel" data-v="20"/, '15 shows as 20');
  assert.match(basalt, /<div class="rng-ends"><span>10%<\/span><span>30%<\/span><\/div>/);
  const emery = at('emery');
  assert.equal((emery.match(/data-range="batteryLowLevel"/g) || []).length, 1, 'one slider');
  assert.match(emery, /class="rng single" data-range="batteryLowLevel" data-v="15"/, 'emery keeps 15');
  assert.match(emery, /<div class="rng-ends"><span>5%<\/span><span>30%<\/span><\/div>/);
});

/**
 * A one-thumb .rng root inside the open Battery sheet, as the range wiring reads it: its
 * data-v, the readout/fill/thumb nodes a move repaints, and a 100 px track from x = 0.
 * @param {number} v the shown value (data-v)
 * @returns {{root: Object, thumb: Object}} the root stub and its thumb
 */
function warnLevelSlider(v) {
  const attrs = { 'data-range': 'batteryLowLevel', 'data-v': String(v) };
  const node = () => ({ style: {}, setAttribute() {}, textContent: '' });
  const nodes = { '.rng-val': node(), '.rng-fill': node(), '[data-range-thumb=v]': node(),
    '.rng-track': { getBoundingClientRect: () => ({ left: 0, width: 100 }) } };
  const root = { isConnected: true, getAttribute: n => (n in attrs ? attrs[n] : null),
    setAttribute(n, val) { attrs[n] = String(val); }, querySelector: sel => nodes[sel] || null };
  const thumb = { getAttribute: n => (n === 'data-range-thumb' ? 'v' : null),
    closest: sel => (sel === '[data-range-thumb]' ? thumb : (sel === '.rng' ? root : null)),
    focus() {}, setPointerCapture() {} };
  return { root, thumb };
}

test('moving the Warn level thumb stores one plain integer on the watch\'s step', () => {
  // The write the snap-up display defers: a moved thumb stores the level as a bare
  // integer string (what on-demand.js batteryLevel parses), on the step of the slider the
  // platform shows — never the dual range's "lo-hi" shape, never an off-grid value.
  [['basalt', '20', 20], ['emery', '15', 15]].forEach(([platformName, nudged, dragged]) => {
    const page = watchTab({ batteryLowLevel: '10' }, platformName);
    page.openEditSheet('odBattery');
    const s = warnLevelSlider(10);
    page.modal.dispatch('keydown', { target: s.thumb, key: 'ArrowRight', preventDefault() {} });
    assert.strictEqual(page.S.batteryLowLevel, nudged, platformName + ': one step up from 10');
    // A drag lands between steps: 48 % of the track is a raw 19.6 on 10..30 and a raw 17
    // on 5..30, which snap to the nearest step, 20 and 15.
    page.S.batteryLowLevel = '30';
    const d = warnLevelSlider(30);
    const off = { closest: () => null };
    page.modal.dispatch('pointerdown', { target: d.thumb, pointerId: 9, preventDefault() {} });
    page.modal.dispatch('pointermove', { target: off, pointerId: 9, clientX: 48 });
    page.modal.dispatch('pointerup', { target: off, pointerId: 9 });
    assert.strictEqual(page.S.batteryLowLevel, String(dragged), platformName + ': a drag snaps to the step');
    assert.equal(d.root.getAttribute('data-v'), String(dragged), platformName + ': the thumb shows it');
  });
});

test('aplite: no On demand rows, card or sheets — the Watch Status Bar keeps its own rows', () => {
  const html = watchTab({}, 'aplite').scroll.innerHTML;
  assert.equal(html.indexOf('OnDemand'), -1, 'no side rows');
  const general = generalTab({}, 'aplite').scroll.innerHTML;
  assert.equal(general.indexOf('<span class="ttl">Alert settings</span>'), -1, 'no card');
  assert.equal(general.indexOf('resetOnDemand'), -1, 'no card reset');
  assert.ok(general.indexOf('data-k="locationMode"') !== -1, 'the General tab opens on its theme + location card');
  ['batteryLowOnly', 'showQt', 'vibe'].forEach((k) =>
    assert.ok(html.indexOf('data-k="' + k + '" data-toggle="1"') !== -1, k + ' row'));
  assert.ok(html.indexOf('data-select="btIcons"') !== -1, 'btIcons row');
  const basalt = watchTab().scroll.innerHTML;
  ['batteryLowOnly', 'showQt'].forEach((k) =>
    assert.equal(basalt.indexOf('data-k="' + k + '"'), -1, k + ': not on a watch with On demand'));
});

test('aplite: the Watch Status Bar\'s bluetooth picker keeps its own title, not the Bluetooth sheet\'s', () => {
  // The Bluetooth sheet's btIcons/vibe copies are gated at item level, so the engine's
  // "shown copy of a key" lookup (the picker title, a trigger relabel) never lands on them
  // on aplite, whose sheet section is hidden.
  const page = watchTab({}, 'aplite');
  page.openSelect('btIcons');
  assert.match(page.modal.innerHTML, /<span class="ssel-modal-ttl" id="ssel-ttl-btIcons">Show icon for bluetooth<\/span>/);
  assert.ok(page.modal.innerHTML.indexOf('aria-label="Show icon for bluetooth options"') !== -1, 'the list label');
  // The evalCtx shape: the settings with env beside them.
  const ctx = (platformName) => ({ provider: 'dwd', env: platform.computeEnv({ platform: platformName }) });
  const labels = {
    aplite: { btIcons: 'Show icon for bluetooth', vibe: 'Vibrate on bluetooth disconnect' },
    basalt: { btIcons: 'Show', vibe: 'Vibrate on disconnect' }
  };
  Object.keys(labels).forEach((p) => ['btIcons', 'vibe'].forEach((k) =>
    assert.equal(PC.engine.findShownItem(SCHEMA, k, ctx(p)).label, labels[p][k], k + ' on ' + p)));
});

test('the card reset reverts the items\' settings; the status card reset reverts the ticks', () => {
  const page = watchTab({ alertUvDisplay: 'value', rainAlertDisplay: 'icon', batteryLowLevel: '30',
    btIcons: 'none', statusTopOnDemandRightItems: 'uv' });
  act(page, 'resetOnDemand');
  assert.equal(page.S.alertUvDisplay, 'icon');
  assert.equal(page.S.rainAlertDisplay, 'text');
  assert.equal(page.S.batteryLowLevel, '10');
  assert.equal(page.S.btIcons, 'disconnected');
  assert.equal(page.S.statusTopOnDemandRightItems, 'uv', 'the ticks are the status card\'s');
  act(page, 'resetStatusSlots');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'bt,qt,snooze,rain');
  assert.equal(page.S.statusTopOnDemandRightItems, 'battery,gust,uv,aqi,wind');
});

const NO_TOP_NOTE = 'Your Default view has no Watch Status Bar, so Alerts won’t show there.';

test('no Watch Status Bar on the Default view and no On demand items on its bars: the card says so', () => {
  const shows = (cfg) => generalTab(cfg).scroll.innerHTML.indexOf(NO_TOP_NOTE) !== -1;
  // Weather only drops the strip in every radar mode but 'Rain alert only'.
  assert.ok(shows({ layoutPreset: 'weatherOnly', radarMode: 'graph' }), 'Weather only, defaults: shown');
  assert.ok(!shows({ layoutPreset: 'weatherOnly', radarMode: 'graph',
    statusForecastOnDemandLeftItems: 'uv' }), 'the forecast bar carries items: hidden');
  assert.ok(shows({ layoutPreset: 'weatherOnly', radarMode: 'graph',
    statusForecastOnDemandLeftItems: '' }), 'nothing ticked does not count');
  assert.ok(!shows({ layoutPreset: 'weatherOnly', radarMode: 'status',
    statusRadarOnDemandRightItems: 'rain' }),
  'radar status: the radar bar is on the Default view and carries items: hidden');
  assert.ok(shows({ layoutPreset: 'weatherOnly', radarMode: 'graph',
    statusRadarOnDemandRightItems: 'rain' }),
  'radar graph: no radar bar on the Default view, so it does not count');
  assert.ok(!shows({ layoutPreset: 'weatherOnly', radarMode: 'countdown' }),
    'Rain alert only keeps the Default view\'s strip: hidden');
  assert.ok(!shows({}), 'defaults: hidden');
  // A custom layout: the Default view's strip switch and the bars its seats hold.
  const custom = { layoutPreset: 'custom', viewStripOff0: true, viewUpper0: 'weather', viewLower0: 'off' };
  assert.ok(shows(custom), 'custom, strip off, forecast bar without items: shown');
  assert.ok(!shows(Object.assign({}, custom, {
    statusForecastOnDemandRightItems: 'bt' })), 'the forecast bar carries items: hidden');
  assert.ok(!shows(Object.assign({}, custom, { viewStripOff0: false })), 'custom with its strip: hidden');
  const health = Object.assign({}, custom, { viewLower0: 'health',
    statusHealthOnDemandLeftItems: 'battery' });
  assert.ok(!shows(Object.assign({ healthMode: 'status' }, health)), 'a health seat carrying items: hidden');
  assert.ok(shows(Object.assign({ healthMode: 'off' }, health)), 'a health seat folded away does not count');
});

const SHEET_NOTE = 'No status bar has Rain ticked under Alerts, so the rain icon won’t show.';
const RADAR_NOTE = '‘Rain alert only’ fetches the radar for the rain icon, but no status bar has Rain ticked under Alerts.';

test('the rain notes: the Rain sheet\'s in any fetching radar mode, the Radar tab\'s in Rain alert only', () => {
  const inSheet = (cfg) => {
    const page = watchTab(cfg);
    page.openEditSheet('alertRain');
    return page.modal.innerHTML.indexOf(SHEET_NOTE) !== -1;
  };
  const onRadarTab = (cfg) => {
    const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, cfg));
    page.clickTab('radar');
    return page.scroll.innerHTML.indexOf(RADAR_NOTE) !== -1;
  };
  const unplaced = { statusTopOnDemandLeftItems: 'bt' };
  ['graph', 'status', 'countdown'].forEach((mode) =>
    assert.ok(inSheet(Object.assign({ radarMode: mode }, unplaced)), 'sheet: ' + mode + ', unplaced: shown'));
  assert.ok(!inSheet(Object.assign({ radarMode: 'off' }, unplaced)), 'sheet: radar off: the card row says it');
  assert.ok(!inSheet({ radarMode: 'graph' }), 'sheet: placed by default: hidden');
  assert.ok(onRadarTab(Object.assign({ radarMode: 'countdown' }, unplaced)), 'radar tab: Rain alert only, unplaced');
  assert.ok(!onRadarTab(Object.assign({ radarMode: 'graph' }, unplaced)), 'radar tab: another mode: hidden');
  assert.ok(!onRadarTab({ radarMode: 'countdown' }), 'radar tab: placed: hidden');
  assert.ok(onRadarTab(Object.assign({ radarMode: 'countdown',
    statusRadarOnDemandLeftItems: 'rain' }, unplaced)), 'the radar bar never shows in this mode: it does not count');
  assert.ok(!onRadarTab(Object.assign({ radarMode: 'countdown', healthMode: 'status',
    statusHealthOnDemandLeftItems: 'rain' }, unplaced)), 'the health bar shows it: hidden');
});

test('the Radar tab carries a copy of the rain window; entering Rain alert only ticks Rain', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarMode: 'graph', statusTopOnDemandLeftItems: 'bt' });
  page.clickTab('radar');
  assert.ok(page.scroll.innerHTML.indexOf('>Rain alert window</div>') !== -1, 'the copy renders');
  pick(page, 'radarMode', 'countdown');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'bt,rain', 'Rain ticked on the Watch Status Bar\'s left');
  const off = bootGeneratedPage({ provider: 'dwd', radarMode: 'graph' });
  off.clickTab('radar');
  pick(off, 'radarMode', 'off');
  assert.equal(off.scroll.innerHTML.indexOf('>Rain alert window</div>'), -1, 'no window while the radar is off');
});

test('the slot pencil sheet points at the Alert settings card for the levels', () => {
  const page = watchTab();
  page.openEditSheet('threshUv');
  // The sheet opens from the Status slots tab; the card is on the General tab.
  assert.ok(page.modal.innerHTML.indexOf('<div class="static join info nbl"><div class="info-box">Alert levels and colors are set in General → Alert settings, under Weather alerts.</div></div>') !== -1,
    'the info-box pointer');
});

test('the page heals the side lists on open: canonical order, unknown codes out, Left wins an overlap', () => {
  const S = { statusTopOnDemandLeftItems: 'snooze,bt,zzz,bt', statusTopOnDemandRightItems: 'bt,battery,rain',
    statusForecastOnDemandLeftItems: 7, statusForecastOnDemandRightItems: '' };
  const writes = [];
  onbuild.onLoad({ env: ENV.basalt, get: (k) => S[k], set: (k, v) => { writes.push(k); S[k] = v; } });
  assert.equal(S.statusTopOnDemandLeftItems, 'bt,snooze');
  assert.equal(S.statusTopOnDemandRightItems, 'battery,rain', 'Bluetooth stays on the left');
  assert.equal(S.statusForecastOnDemandLeftItems, '', 'a non-string list reads its default');
  assert.ok(writes.indexOf('statusForecastOnDemandRightItems') === -1, 'a clean list is not rewritten');
  assert.ok(writes.indexOf('statusRadarOnDemandLeftItems') !== -1 || S.statusRadarOnDemandLeftItems === '',
    'an absent list lands on its default');
});
