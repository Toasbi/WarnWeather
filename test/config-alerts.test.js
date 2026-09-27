'use strict';
// test/config-alerts.test.js — the Status slots tab's Alerts card, end to end on the
// REAL generated settings page (test/helpers/page-harness.js). The card is its own
// card above the status card: six rows of one shape (icon, label, the alert's live
// state, its colour dots while on, Edit) and a boxed radar-off note. Every alert's
// switch, look and levels live in its sheet; each status bar picks where the icons
// show. The schema shape itself is pinned in test/config-schema.test.js; this file
// checks what the page actually renders and does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootGeneratedPage } = require('./helpers/page-harness.js');
const ICONS = require('../src/pkjs/settings/status-slot-icons.js');

/**
 * Boot the page on the Status slots tab.
 * @param {Object} [cfg] stored settings (provider dwd unless given)
 * @param {string} [platform] Pebble platform (default basalt)
 * @returns {Object} the page-harness handle
 */
function watchTab(cfg, platform) {
  const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, cfg || {}), platform);
  page.clickTab('watch');
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
 * Click a segmented option in #scroll (the engine's [data-v] path).
 * @param {Object} page the page-harness handle
 * @param {string} key the control's messageKey
 * @param {string} value the option's value
 */
function clickOption(page, key, value) {
  const t = {
    getAttribute: n => (n === 'data-k' ? key : (n === 'data-v' ? value : null)),
    closest: sel => (sel === '[data-v]' ? t : null)
  };
  page.scroll.dispatch('click', { target: t });
}

const KINDS = [['Uv', 'UV index', 'uv'], ['Wind', 'Wind speed', 'wind'], ['Gust', 'Wind gusts', 'gust'],
  ['Aqi', 'Air quality', 'aqi'], ['Pollen', 'Pollen', 'pollen']];

test('the Alerts card is a card of its own, opening the tab above the status card', () => {
  const html = watchTab().scroll.innerHTML;
  const alerts = html.indexOf('<div class="card"><button class="cardHdr"><span class="ttl">Alerts</span>');
  assert.ok(alerts !== -1, 'a titled card');
  assert.equal(html.slice(0, alerts).indexOf('<div class="card'), -1, 'the first card on the tab');
  const bold = html.indexOf('data-k="statusBoldAll"');
  assert.ok(html.slice(alerts + 1, bold).indexOf('<div class="card nohdr">') !== -1,
    'the status card (its intro and Bold row) follows as a card of its own');
  assert.ok(html.indexOf('One icon per active alert') > alerts, 'the card intro');
  assert.ok(html.indexOf('data-action="resetAlerts"') > alerts, 'with its own reset chip');
  assert.equal(html.indexOf('<div class="subhdr">Alerts</div>'), -1, 'no longer a status-card sub-header');
});

test('six rows of one shape: icon + label, the live state, Edit — no switch on the card', () => {
  const html = watchTab().scroll.innerHTML;
  const rain = rowOf(html, 'data-edit-sheet="alertRain"');
  assert.ok(rain.indexOf('<span class="lbl-ico" aria-hidden="true">' + ICONS.rain + '</span>Rain</div>') !== -1,
    'the rain glyph leads the label');
  assert.ok(rain.indexOf('<div class="hint">Within 60 min · Text</div>') !== -1, 'rain: on by default');
  assert.equal(rain.indexOf('pen-dot'), -1, 'rain has no colour dots');
  KINDS.forEach(([stem, label, icon]) => {
    const row = rowOf(html, 'data-edit-sheet="alert' + stem + '"');
    assert.ok(row, stem + ': the row renders');
    assert.ok(row.indexOf('<span class="lbl-ico" aria-hidden="true">' + ICONS[icon] + '</span>' + label) !== -1,
      stem + ': the icon leads the label');
    assert.ok(row.indexOf('<div class="hint">Off</div>') !== -1, stem + ': reads Off (default off)');
    assert.equal(row.indexOf('pen-dot'), -1, stem + ': no dots while off');
    assert.ok(row.indexOf('<span>Edit</span>') !== -1, stem + ': the Edit button');
    assert.equal(html.indexOf('data-k="alert' + stem + '"'), -1, stem + ': no switch on the card');
  });
  ['Steps', 'Sleep', 'Distance'].forEach((stem) =>
    assert.equal(html.indexOf('data-edit-sheet="alert' + stem + '"'), -1, stem + ' has no alert row'));
});

test('Edit opens the alert sheet; flipping its switch turns the row live — levels and dots', () => {
  const page = watchTab({ threshUvDangerColor: '#FF0000' });
  page.openEditSheet('alertUv');
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('UV index alert') !== -1, 'the alert sheet opened');
  assert.ok(sheet.indexOf('<div class="subhdr grp"><span>Alert</span><button class="sw" data-k="alertUv"') !== -1,
    'its switch rides the Alert sub-header');
  assert.ok(/<div class="row[^"]*\bdis\b[^"]*">(?:(?!<div class="row)[\s\S])*?data-k="alertUvDisplay"/.test(sheet),
    'the Look is inert while the alert is off');
  assert.ok(sheet.indexOf('data-range="threshUvWarn"') !== -1, 'the levels live in this sheet');
  page.clickModalToggle('alertUv');
  assert.strictEqual(page.S.alertUv, true, 'the switch stores');
  assert.ok(!/<div class="row[^"]*\bdis\b[^"]*">(?:(?!<div class="row)[\s\S])*?data-k="alertUvDisplay"/.test(page.modal.innerHTML),
    'the Look goes live');
  const row = rowOf(page.scroll.innerHTML, 'data-edit-sheet="alertUv"');
  assert.ok(row.indexOf('<div class="hint">Warn 6 · Danger 8 · Highlight off</div>') !== -1,
    'the card row prints the live levels: ' + row);
  assert.ok(row.indexOf('pen-dot ring') !== -1 && row.indexOf('pen-dot fill" style="--th-c:#FF0000"') !== -1,
    'and the alert\'s colour dots');
  page.clickModalToggle('threshUvOn');
  assert.ok(rowOf(page.scroll.innerHTML, 'data-edit-sheet="alertUv"')
    .indexOf('Warn 6 · Danger 8 · Highlight on') !== -1, 'the highlight state follows too');
});

test('the Look reads its hint by value', () => {
  const page = watchTab({ alertWind: true });
  page.openEditSheet('alertWind');
  // The default (icon-only) look carries no hint — nothing to explain, and describing
  // the default look is against the hint style; only the value look gets one.
  assert.ok(page.modal.innerHTML.indexOf('Just the icon.') === -1, 'no hint for the icon look');
  const t = {
    getAttribute: n => (n === 'data-k' ? 'alertWindDisplay' : (n === 'data-v' ? 'value' : null)),
    closest: sel => (sel === '[data-v]' ? t : null)
  };
  page.modal.dispatch('click', { target: t });
  assert.equal(page.S.alertWindDisplay, 'value');
  assert.ok(page.modal.innerHTML.indexOf('The value the alert fires on after the icon. Fewer alerts fit the row.') !== -1);
});

test('the rain sheet: switching it off greys the window and look and the row reads Off', () => {
  const page = watchTab();
  page.openEditSheet('alertRain');
  assert.ok(page.modal.innerHTML.indexOf('<button class="sw on" data-k="alertRain" data-toggle="1" aria-label="Rain alert"><i>') !== -1,
    'the switch is on and live (radar graph mode)');
  page.clickModalToggle('alertRain');
  assert.strictEqual(page.S.alertRain, false);
  const sheet = page.modal.innerHTML;
  assert.ok(/<div class="row[^"]*\bdis\b[^"]*">(?:(?!<div class="row)[\s\S])*?data-select="rainCountdownHorizon"/.test(sheet),
    'the time window goes inert');
  assert.ok(/<div class="row[^"]*\bdis\b[^"]*">(?:(?!<div class="row)[\s\S])*?data-k="rainAlertDisplay"/.test(sheet),
    'the look goes inert');
  assert.ok(rowOf(page.scroll.innerHTML, 'data-edit-sheet="alertRain"').indexOf('<div class="hint">Off</div>') !== -1,
    'the card row reads Off');
});

test('radar mode "Rain alert only": the rain switch is held on — disabled, and a tap changes nothing', () => {
  const page = watchTab({ radarMode: 'countdown' });
  page.openEditSheet('alertRain');
  assert.ok(page.modal.innerHTML.indexOf('data-k="alertRain" data-toggle="1" aria-label="Rain alert" disabled') !== -1,
    'the switch renders disabled');
  assert.ok(page.modal.innerHTML.indexOf('“Rain alert only” keeps it on.') !== -1, 'the intro says why');
  // A tap as the DOM reports it for a disabled button: getAttribute('disabled') is ''.
  const t = {
    getAttribute: n => (n === 'data-k' ? 'alertRain' : (n === 'disabled' ? '' : null)),
    closest: sel => (sel === '[data-toggle]' ? t : null)
  };
  page.modal.dispatch('click', { target: t });
  assert.strictEqual(page.S.alertRain, true, 'the tap is swallowed');
});

test('entering radar mode "Rain alert only" switches the rain alert back on (the live hook)', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarMode: 'graph', alertRain: false });
  page.clickTab('radar');
  clickOption(page, 'radarMode', 'countdown');
  assert.equal(page.S.radarMode, 'countdown');
  assert.strictEqual(page.S.alertRain, true, 'the rain alert is back on');
});

test('radar off: the rain row hides and the radar-off note shows as an info box', () => {
  const html = watchTab({ radarMode: 'off' }).scroll.innerHTML;
  assert.equal(html.indexOf('data-edit-sheet="alertRain"'), -1, 'no rain row');
  assert.ok(html.indexOf('<div class="static info"><div class="info-box">Turn on the rain radar (Radar tab) to get rain alerts.</div></div>') !== -1,
    'the note shows, boxed');
  assert.ok(html.indexOf('data-edit-sheet="alertUv"') !== -1, 'the metric rows keep the card');
  const on = watchTab().scroll.innerHTML;
  assert.equal(on.indexOf('Turn on the rain radar'), -1, 'no note while the radar runs');
});

test('the slot pencil sheet points at the Alerts card instead of holding the levels', () => {
  const page = watchTab();
  page.openEditSheet('threshUv');
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('<div class="static info"><div class="info-box">Alert levels and the highlight switch are set under Alerts on the Status slots tab.</div></div>') !== -1,
    'the info-box pointer');
  assert.equal(sheet.indexOf('Alert levels</span>'), -1, 'no levels group');
  assert.equal(sheet.indexOf('data-range="threshUvWarn"'), -1, 'no slider');
  assert.equal(sheet.indexOf('data-k="threshUvOn"'), -1, 'no highlight switch');
  assert.ok(sheet.indexOf('data-k="threshUvBoldMode"') !== -1, 'the slot rows stay');
  // A goal kind is not an alert: its slot sheet keeps its levels.
  const steps = watchTab({ healthMode: 'status', statusHealthLeft: 'steps' });
  steps.openEditSheet('threshSteps');
  assert.ok(steps.modal.innerHTML.indexOf('data-range="threshStepsWarn"') !== -1, 'Steps keeps its Goals group');
  assert.equal(steps.modal.innerHTML.indexOf('info-box'), -1, 'and no pointer');
});

test('each bar picks where its alerts show: the Watch Status Bar Left, the forecast bar Off', () => {
  const page = watchTab();
  const html = page.scroll.innerHTML;
  const top = rowOf(html, 'data-select="statusTopAlerts"');
  assert.ok(top.indexOf('<span>Left</span>') !== -1, 'the strip defaults to Left');
  assert.ok(top.indexOf('the icons replace this slot, and the middle slot too') !== -1, 'with its hint');
  const forecast = rowOf(html, 'data-select="statusForecastAlerts"');
  assert.ok(forecast.indexOf('<span>Off</span>') !== -1, 'the forecast bar defaults to Off');
  assert.equal(forecast.indexOf('class="hint"'), -1, 'no hint for Off');
  page.openSelect('statusForecastAlerts');
  page.pickOption('statusForecastAlerts', 'middle');
  assert.equal(page.S.statusForecastAlerts, 'middle');
  assert.ok(rowOf(page.scroll.innerHTML, 'data-select="statusForecastAlerts"')
    .indexOf('and the left slot too when they need the room') !== -1, 'Middle borrows the left slot');
  assert.ok(html.indexOf('While an alert is active, the Alerts row replaces the chosen slot') === -1,
    'no separate takeover note: the select\'s own hints explain each placement');
});

test('pollen alert row is DWD-only', () => {
  const dwd = watchTab().scroll.innerHTML;
  assert.ok(dwd.indexOf('data-edit-sheet="alertPollen"') !== -1, 'shown with DWD');
  const other = watchTab({ provider: 'openmeteo', alertPollen: true }).scroll.innerHTML;
  assert.equal(other.indexOf('data-edit-sheet="alertPollen"'), -1, 'hidden with another provider');
});

test('aplite: the whole Alerts card and every placement select are absent', () => {
  const html = watchTab({ alertUv: true }, 'aplite').scroll.innerHTML;
  assert.equal(html.indexOf('<span class="ttl">Alerts</span>'), -1, 'no card');
  assert.equal(html.indexOf('One icon per active alert'), -1, 'no intro');
  assert.equal(html.indexOf('Turn on the rain radar'), -1, 'no radar note');
  assert.equal(html.indexOf('data-edit-sheet="alert'), -1, 'no alert rows');
  assert.equal(html.indexOf('Alerts</div>'), -1, 'no placement select');
  assert.ok(html.indexOf('<div class="subhdr">Forecast Status Bar</div>') !== -1, 'the bars still render');
});

test('the card reset button reverts the alerts on a live page', () => {
  const page = watchTab({ alertUv: true, alertUvDisplay: 'value', alertRain: false, rainAlertDisplay: 'icon',
    statusTopAlerts: 'right' });
  const t = {
    getAttribute: n => (n === 'data-action' ? 'resetAlerts' : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  page.scroll.dispatch('click', { target: t });
  assert.strictEqual(page.S.alertUv, false);
  assert.equal(page.S.alertUvDisplay, 'icon');
  assert.strictEqual(page.S.alertRain, true);
  assert.equal(page.S.rainAlertDisplay, 'text');
  assert.equal(page.S.statusTopAlerts, 'right', 'the placement is the status card\'s');
  assert.ok(rowOf(page.scroll.innerHTML, 'data-edit-sheet="alertUv"').indexOf('<div class="hint">Off</div>') !== -1,
    'the row reads Off again');
});

test('the status card reset reverts every bar\'s placement on a live page', () => {
  const page = watchTab({ statusTopAlerts: 'off', statusForecastAlerts: 'right', alertUv: true });
  const t = {
    getAttribute: n => (n === 'data-action' ? 'resetStatusSlots' : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  page.scroll.dispatch('click', { target: t });
  assert.equal(page.S.statusTopAlerts, 'left');
  assert.equal(page.S.statusForecastAlerts, 'off');
  assert.strictEqual(page.S.alertUv, true, 'the alerts are the Alerts card\'s');
});
