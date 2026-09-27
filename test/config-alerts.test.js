'use strict';
// test/config-alerts.test.js — the Status slots tab's Alerts card, end to end on the
// REAL generated settings page (test/helpers/page-harness.js): the rain countdown row
// that moved over from the Radar tab (with its Off option back), the rain look, the
// radar-off note, and the five metric alert rows — a switch with an icon, a live
// levels hint and a pencil to the levels-only sheet, plus a Look row while it is on.
// The schema shape itself is pinned in test/config-schema.test.js; this file checks
// what the page actually renders and does.
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
 * @param {string} needle a string unique to the row (e.g. its data-k)
 * @returns {string} the row's markup ('' when absent)
 */
function rowOf(html, needle) {
  const at = html.indexOf(needle);
  if (at === -1) { return ''; }
  const start = html.lastIndexOf('<div class="row', at);
  const next = html.indexOf('<div class="row', at);
  return html.slice(start, next === -1 ? html.length : next);
}

// A range root + thumb stub for the engine's keyboard-nudge path — the same shape
// test/config-thresholds.test.js drives (range-control.js reads these attributes).
function makeRngRoot(key, lo, hi) {
  const attrs = { 'data-range': key, 'data-lo': String(lo), 'data-hi': String(hi) };
  const styled = () => ({ style: {}, setAttribute() {}, innerHTML: '' });
  const nodes = {
    '[data-zone="warn"]': styled(), '[data-zone="danger"]': styled(),
    '[data-range-thumb=lo]': styled(), '[data-range-thumb=hi]': styled(),
    '.rng-val': styled(), '.rng-fill': styled(),
    '.rng-track': { getBoundingClientRect: () => ({ left: 0, width: 100 }) }
  };
  const root = {
    isConnected: true,
    getAttribute: n => (attrs[n] == null ? null : attrs[n]),
    setAttribute(n, v) { attrs[n] = String(v); },
    querySelector: sel => nodes[sel] || null,
    querySelectorAll: () => [],
    closest: sel => (sel === '.rng' ? root : null)
  };
  return root;
}
function thumbOn(root, which) {
  const th = {
    getAttribute: n => (n === 'data-range-thumb' ? which : null),
    closest: sel => (sel === '[data-range-thumb]' ? th : (sel === '.rng' ? root : null)),
    focus() {}, setPointerCapture() {}, style: {}, setAttribute() {}
  };
  return th;
}

const KINDS = [['Uv', 'UV index', 'uv'], ['Wind', 'Wind speed', 'wind'], ['Gust', 'Wind gusts', 'gust'],
  ['Aqi', 'Air quality', 'aqi'], ['Pollen', 'Pollen', 'pollen']];

test('the Alerts sub-header renders inside the status card, under the Bold row and above the bars', () => {
  const html = watchTab().scroll.innerHTML;
  const alerts = html.indexOf('<div class="subhdr">Alerts</div>');
  assert.ok(alerts !== -1, 'the Alerts sub-header renders');
  assert.ok(html.indexOf('data-k="statusBoldAll"') < alerts, 'below the Bold values row');
  assert.ok(alerts < html.indexOf('<div class="subhdr">Forecast Status Bar</div>'), 'above the first bar');
  assert.ok(html.indexOf('One icon per active alert') > alerts, 'the card intro follows its sub-header');
  // One card: the intro, the Alerts card and the bars share it (no card break between).
  const between = html.slice(html.indexOf('data-k="statusBoldAll"'), alerts);
  assert.equal(between.indexOf('<div class="card'), -1, 'the Alerts card is not a card of its own');
});

test('the rain countdown row: its icon, and an Off option in its sheet', () => {
  const page = watchTab();
  const row = rowOf(page.scroll.innerHTML, 'data-select="rainCountdownHorizon"');
  assert.ok(row.indexOf('<span class="lbl-ico" aria-hidden="true">' + ICONS.rain + '</span>Rain countdown') !== -1,
    'the rain glyph leads the label');
  assert.ok(page.scroll.innerHTML.indexOf('data-k="rainAlertDisplay"') !== -1,
    'the rain look row renders while the countdown is on');
  page.openSelect('rainCountdownHorizon');
  assert.ok(page.modal.innerHTML.indexOf('data-select-pick="0"') !== -1, 'Off is pickable (radar graph mode)');
  page.pickOption('rainCountdownHorizon', '0');
  assert.equal(page.S.rainCountdownHorizon, '0');
  assert.equal(page.scroll.innerHTML.indexOf('data-k="rainAlertDisplay"'), -1,
    'the rain look hides with the countdown Off');
});

test('radarMode Countdown only: Off is inert in the rain countdown sheet', () => {
  const page = watchTab({ radarMode: 'countdown' });
  page.openSelect('rainCountdownHorizon');
  const sheet = page.modal.innerHTML;
  assert.equal(sheet.indexOf('data-select-pick="0"'), -1, 'Off cannot be picked');
  assert.match(sheet, /<button type="button" class="ssel-opt" role="option" aria-selected="false" disabled[^>]*><span>Off<\/span>/,
    'Off stays visible, disabled');
  assert.ok(sheet.indexOf('data-select-pick="30"') !== -1, 'the windows stay pickable');
});

test('entering radarMode Countdown only snaps an Off rain countdown back to 60 min (the live hook)', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarMode: 'graph', rainCountdownHorizon: '0' });
  page.clickTab('radar');
  const t = {
    getAttribute: n => (n === 'data-k' ? 'radarMode' : (n === 'data-v' ? 'countdown' : null)),
    closest: sel => (sel === '[data-v]' ? t : null)
  };
  page.scroll.dispatch('click', { target: t });
  assert.equal(page.S.radarMode, 'countdown');
  assert.equal(page.S.rainCountdownHorizon, '60', 'Off snapped to the default window');
});

test('radar off: the rain rows hide and the radar-off note shows', () => {
  const html = watchTab({ radarMode: 'off' }).scroll.innerHTML;
  assert.equal(html.indexOf('data-select="rainCountdownHorizon"'), -1, 'no rain countdown row');
  assert.equal(html.indexOf('data-k="rainAlertDisplay"'), -1, 'no rain look row');
  assert.ok(html.indexOf('Turn on the rain radar (Radar tab) to get rain alerts.') !== -1, 'the note shows');
  assert.ok(html.indexOf('<div class="subhdr">Alerts</div>') !== -1, 'the metric rows keep the card');
  const on = watchTab().scroll.innerHTML;
  assert.equal(on.indexOf('Turn on the rain radar'), -1, 'no note while the radar runs');
});

test('the five alert rows: icon, live levels hint and pencil on each switch; no Look row while off', () => {
  const html = watchTab().scroll.innerHTML;
  KINDS.forEach(([stem, label, icon]) => {
    const row = rowOf(html, 'data-k="alert' + stem + '" data-toggle="1"');
    assert.ok(row, stem + ': the switch renders');
    assert.ok(row.indexOf('<span class="lbl-ico" aria-hidden="true">' + ICONS[icon] + '</span>' + label) !== -1,
      stem + ': the icon leads the label');
    assert.match(row, new RegExp('data-hint-for="alert' + stem + '">Warn \\d[^<]* · Danger \\d[^<]* · Highlight off<'),
      stem + ': the hint prints the resolved levels');
    assert.ok(row.indexOf('data-edit-sheet="alert' + stem + '"') !== -1, stem + ': the pencil opens its alert sheet');
    assert.equal(html.indexOf('data-k="alert' + stem + 'Display"'), -1, stem + ': no Look row while off');
  });
  // The seeds, in the kind's unit: UV is unitless.
  assert.ok(html.indexOf('>Warn 6 · Danger 8 · Highlight off<') !== -1, 'UV prints its seed pair');
  // Goal kinds are not alerts.
  ['Steps', 'Sleep', 'Distance'].forEach((stem) =>
    assert.equal(html.indexOf('data-k="alert' + stem + '"'), -1, stem + ' has no alert row'));
});

test('flipping an alert on reveals its Look row; the pencil opens the levels-only sheet', () => {
  const page = watchTab();
  page.clickToggle('alertUv');
  assert.strictEqual(page.S.alertUv, true, 'the switch stores');
  const look = rowOf(page.scroll.innerHTML, 'data-k="alertUvDisplay"');
  assert.ok(look.indexOf('<div class="lbl">Look</div>') !== -1, 'the Look row renders');
  assert.ok(look.indexOf('data-v="icon"') !== -1 && look.indexOf('data-v="value"') !== -1, 'Icon / Icon + value');
  assert.equal(page.scroll.innerHTML.indexOf('data-k="alertWindDisplay"'), -1, 'other kinds stay collapsed');
  page.openEditSheet('alertUv');
  assert.ok(page.modal.innerHTML.indexOf('UV index alert') !== -1, 'the alert sheet opened');
  assert.ok(page.modal.innerHTML.indexOf('data-range="threshUvWarn"') !== -1, 'on the UV levels');
});

test('moving the slider in the alert sheet repaints the row hint live', () => {
  const page = watchTab({ threshUvWarn: '6', threshUvDanger: '8' });
  page.openEditSheet('alertUv');
  const th = thumbOn(makeRngRoot('threshUvWarn', 6, 8), 'lo');
  page.modal.dispatch('keydown', { target: th, key: 'ArrowRight', preventDefault() {} });
  assert.equal(page.S.threshUvWarn, '7', 'the warn moved one step');
  assert.ok(page.scroll.innerHTML.indexOf('>Warn 7 · Danger 8 · Highlight off<') !== -1,
    'the card row hint followed the slider');
  assert.ok(page.scroll.hintRepaints >= 1, 'repainted in place, under the open sheet');
});

test('pollen alert rows are DWD-only', () => {
  const dwd = watchTab().scroll.innerHTML;
  assert.ok(dwd.indexOf('data-k="alertPollen"') !== -1, 'shown with DWD');
  const other = watchTab({ provider: 'openmeteo', alertPollen: true }).scroll.innerHTML;
  assert.equal(other.indexOf('data-k="alertPollen"'), -1, 'hidden with another provider');
  assert.equal(other.indexOf('data-k="alertPollenDisplay"'), -1, 'its Look row too, even while on');
});

test('aplite: the whole Alerts sub-section is absent', () => {
  const html = watchTab({ alertUv: true }, 'aplite').scroll.innerHTML;
  assert.equal(html.indexOf('<div class="subhdr">Alerts</div>'), -1, 'no sub-header');
  assert.equal(html.indexOf('One icon per active alert'), -1, 'no intro');
  assert.equal(html.indexOf('rainCountdownHorizon'), -1, 'no rain row');
  assert.equal(html.indexOf('Turn on the rain radar'), -1, 'no radar note');
  KINDS.forEach(([stem]) => assert.equal(html.indexOf('data-k="alert' + stem), -1, stem + ': no rows'));
  assert.ok(html.indexOf('<div class="subhdr">Forecast Status Bar</div>') !== -1, 'the bars still render');
});

test('the card reset button clears the Alerts card on a live page', () => {
  const page = watchTab({ alertUv: true, alertUvDisplay: 'value', rainAlertDisplay: 'icon' });
  const t = {
    getAttribute: n => (n === 'data-action' ? 'resetStatusSlots' : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  page.scroll.dispatch('click', { target: t });
  assert.strictEqual(page.S.alertUv, false);
  assert.equal(page.S.alertUvDisplay, 'icon');
  assert.equal(page.S.rainAlertDisplay, 'text');
  assert.equal(page.scroll.innerHTML.indexOf('data-k="alertUvDisplay"'), -1, 'the Look row folded away');
});
