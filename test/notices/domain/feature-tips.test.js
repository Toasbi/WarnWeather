'use strict';
// The new features the settings page offers to try (notices/domain/feature-tips.js): which
// tips an install is shown, and that every tip is one the page can show and open.
const test = require('node:test');
const assert = require('node:assert/strict');
const featureTips = require('../../../src/pkjs/notices/domain/feature-tips.js');
const { compareSemver } = require('../../../src/pkjs/notices/domain/release-notifications.js');
const batteryDays = require('../../../src/pkjs/status-bars/domain/battery-days.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');

const BASALT = { platform: 'basalt', plugins: true };
const ids = (tips) => tips.map((tip) => tip.id);

/**
 * Every sheet id and tab id the settings page has.
 * @returns {{sheets: string[], tabs: string[]}}
 */
function pageTargets() {
  const sheets = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    if (typeof node.sheetId === 'string') { sheets.push(node.sheetId); }
    Object.keys(node).forEach((k) => walk(node[k]));
  })(schema);
  return { sheets: sheets, tabs: schema.tabs.map((tab) => tab.id) };
}

test('every tip has what the card prints, and a place the page can open', () => {
  const targets = pageTargets();
  assert.ok(featureTips.TIPS.length > 0);
  assert.equal(new Set(featureTips.allIds()).size, featureTips.TIPS.length, 'ids are unique');
  featureTips.TIPS.forEach((tip) => {
    assert.match(tip.id, /^[a-z][A-Za-z0-9]*$/, tip.id);
    assert.match(tip.since, /^\d+\.\d+\.\d+$/, tip.id + ': the release that brought it');
    assert.ok(tip.title && tip.title.length <= 40, tip.id + ': a title that fits one line');
    assert.ok(tip.html && tip.html.replace(/<[^>]+>/g, '').length <= 260, tip.id + ': a how-to short enough to read at a glance');
    assert.equal(/<script|onerror=|javascript:/i.test(tip.html), false, tip.id);
    // Show me opens a dialog or a tab that exists.
    const open = tip.open;
    assert.equal(Boolean(open.sheet) !== Boolean(open.tab), true, tip.id + ': a dialog or a tab, one of them');
    if (open.sheet) { assert.ok(targets.sheets.indexOf(open.sheet) !== -1, tip.id + ': no dialog ' + open.sheet); }
    if (open.tab) { assert.ok(targets.tabs.indexOf(open.tab) !== -1, tip.id + ': no tab ' + open.tab); }
  });
});

test('a newer release\'s tips are above an older one\'s', () => {
  featureTips.TIPS.slice(1).forEach((tip, i) => {
    assert.ok(compareSemver(tip.since, featureTips.TIPS[i].since) <= 0, tip.id + ' (' + tip.since + ') is below a tip of '
      + featureTips.TIPS[i].since);
  });
});

test('an install from before the tips is shown them; one that has seen them is shown none', () => {
  assert.deepEqual(ids(featureTips.pending([], BASALT)), featureTips.allIds().slice(0, featureTips.MAX_SHOWN));
  assert.deepEqual(ids(featureTips.pending(null, BASALT)), ids(featureTips.pending([], BASALT)), 'no list reads as none seen');
  assert.deepEqual(featureTips.pending(featureTips.allIds(), BASALT), []);
  const first = featureTips.allIds()[0];
  assert.equal(ids(featureTips.pending([first], BASALT)).indexOf(first), -1, 'a seen tip is not shown again');
  // An id it no longer knows (a tip dropped since) changes nothing.
  assert.deepEqual(ids(featureTips.pending(['goneSince'], BASALT)), ids(featureTips.pending([], BASALT)));
});

/**
 * @param {string} id A tip's id.
 * @param {?Object} env The page's env.
 * @returns {boolean} Whether an install that has seen every other tip is shown it: the card
 *   shows MAX_SHOWN at once, so the others are kept out of its way.
 */
function shows(id, env) {
  return ids(featureTips.pending(featureTips.allIds().filter((other) => other !== id), env)).indexOf(id) !== -1;
}

test('a tip shows only where its feature can be used', () => {
  const days = (env) => shows('batteryDays', env);
  assert.equal(days({ platform: 'basalt', plugins: true }), true);
  assert.equal(days({ platform: 'emery', plugins: true }), true);
  assert.equal(days({ platform: 'basalt', plugins: false }), false, 'a Pebble app without plugins has no days');
  assert.equal(days({ platform: 'aplite', plugins: true }), false, 'aplite\'s battery slot has no text look');
  assert.equal(days({ platform: 'basalt' }), false, 'plugins unknown: fail closed');
  assert.equal(days(null), false);
  // The watch battery's Icon + text look: every watch with the Look, plugins or not (the
  // percentage is the watch's own reading).
  const iconText = (env) => shows('batteryIconText', env);
  assert.equal(iconText({ platform: 'basalt', plugins: true }), true);
  assert.equal(iconText({ platform: 'basalt', plugins: false }), true, 'no plugin needed');
  assert.equal(iconText({ platform: 'emery', plugins: false }), true);
  assert.equal(iconText({ platform: 'basalt' }), true, 'plugins unknown');
  assert.equal(iconText({}), true, 'a watch the page cannot name shows the Look, so the tip too');
  assert.equal(iconText({ platform: 'aplite', plugins: true }), false, 'aplite\'s battery slot has no Look');
  assert.equal(iconText({ platform: 'aplite', plugins: false }), false);
  assert.equal(iconText(null), false);
  // The Plugin value slot: a Pebble app that reads plugins, and a watch that is not aplite.
  const pluginValue = (env) => shows('pluginValue', env);
  assert.equal(pluginValue({ platform: 'basalt', plugins: true }), true);
  assert.equal(pluginValue({ platform: 'emery', plugins: true }), true);
  assert.equal(pluginValue({ platform: 'basalt', plugins: false }), false, 'a Pebble app without plugins');
  assert.equal(pluginValue({ platform: 'basalt' }), false, 'plugins unknown: fail closed');
  assert.equal(pluginValue({ platform: 'aplite', plugins: true }), false, 'aplite has no such slot');
  assert.equal(pluginValue(null), false);
  // The user's complications and the slot's icon: wherever the Plugin value slot is, whose
  // dialog lists them.
  [{ platform: 'basalt', plugins: true }, { platform: 'emery', plugins: true }, { platform: 'basalt', plugins: false },
    { platform: 'basalt' }, { platform: 'aplite', plugins: true }, null].forEach((env) => {
    assert.equal(shows('complications', env), pluginValue(env), JSON.stringify(env));
    assert.equal(shows('pluginValueIcon', env), pluginValue(env), JSON.stringify(env));
    assert.equal(shows('pluginValues', env), pluginValue(env), JSON.stringify(env));
  });
  // A tip without a rule is for every watch.
  [{ platform: 'aplite', plugins: false }, null, {}].forEach((env) =>
    assert.ok(shows('blackTheme', env), JSON.stringify(env)));
});

test('the card shows a few at once, the rest once those are seen', () => {
  assert.ok(featureTips.MAX_SHOWN >= 1);
  const shown = featureTips.pending([], BASALT);
  assert.ok(shown.length <= featureTips.MAX_SHOWN);
  // Seeing the shown ones brings the next ones, until none are left.
  let seen = [];
  const all = [];
  for (let round = 0; round < featureTips.TIPS.length + 1; round += 1) {
    const next = ids(featureTips.pending(seen, BASALT));
    if (!next.length) { break; }
    assert.ok(next.length <= featureTips.MAX_SHOWN);
    all.push(...next);
    seen = seen.concat(next);
  }
  assert.deepEqual(all, featureTips.allIds(), 'every tip is shown once, in the list\'s order');
});

test('the page gets plain data, and nothing when there is nothing to show', () => {
  assert.equal(featureTips.forPage([]), null);
  assert.equal(featureTips.forPage(null), null);
  const forPage = featureTips.forPage(featureTips.TIPS);
  assert.deepEqual(JSON.parse(JSON.stringify(forPage)), forPage, 'no functions: it rides the page\'s URL as it is');
  forPage.forEach((tip) => {
    assert.deepEqual(Object.keys(tip), ['id', 'title', 'html', 'sheet', 'tab']);
    assert.equal(tip.sheet === null || tip.tab === null, true);
  });
  const days = forPage.find((tip) => tip.id === 'batteryDays');
  assert.equal(days.sheet, 'bar-top', 'the Watch bar\'s dialog, where its right slot is set');
  assert.ok(days.html.indexOf('<a href=\'' + batteryDays.MUNINN_URL + '\'>Muninn app</a>') !== -1);
  assert.equal(forPage.find((tip) => tip.id === 'batteryIconText').sheet, 'bar-top', 'the same dialog');
  assert.equal(forPage.find((tip) => tip.id === 'blackTheme').tab, 'setup');
  assert.equal(forPage.find((tip) => tip.id === 'weatherFrom').sheet, 'weatherSources', 'the Weather dialog');
  assert.equal(forPage.find((tip) => tip.id === 'pluginValue').tab, 'watch', 'the Status bars tab: any bar');
  assert.equal(forPage.find((tip) => tip.id === 'complications').tab, 'watch', 'the same tab');
  assert.equal(forPage.find((tip) => tip.id === 'pluginValueIcon').tab, 'watch', 'the same tab');
  assert.equal(forPage.find((tip) => tip.id === 'pluginValues').tab, 'watch', 'the same tab');
});

test('the complications tip names the page\'s own words: the slot\'s item, and the Plugin row\'s entry', (t) => {
  const tip = featureTips.TIPS.find((x) => x.id === 'complications');
  const page = require('../../../src/pkjs/page/status-bars/plugin-value-page.js');
  const { PREFERENCES } = require('../../../src/pkjs/status-bars/domain/plugin-values.js');
  // The Plugin row's entry for the Preferences plugin, as the phone lists it with the user's
  // complications (plugin-value-list.js listOf).
  global.INJECTED_USERDATA = { plugins: [{ uuid: PREFERENCES, name: 'Preferences', items: [], complications: [] }] };
  t.after(() => { delete global.INJECTED_USERDATA; });
  const entry = page.pluginOptions({}, {}, { slotKey: 'statusTopLeft' })[1][0];
  assert.ok(tip.html.indexOf('Set a slot to ' + catalog.byCode('pluginValue').label + ', tap Edit') !== -1, tip.html);
  assert.ok(tip.html.indexOf('then pick ' + entry + ' and') !== -1, entry + ': ' + tip.html);
  assert.equal(tip.since, '3.5.0');
});

test('the icon tip names the page\'s own words: the Edit button, the Looks with an icon, the icons that turn, the Label and Updates\' new choice', (t) => {
  const tip = featureTips.TIPS.find((x) => x.id === 'pluginValueIcon');
  const page = require('../../../src/pkjs/page/status-bars/plugin-value-page.js');
  global.INJECTED_USERDATA = { plugins: [] };
  t.after(() => { delete global.INJECTED_USERDATA; });
  const options = page.iconOptions({}, {}, { slotKey: 'statusTopLeft' });
  const turns = options.slice(options.findIndex((o) => o[1] === '__hdr_turns') + 1,
    options.findIndex((o) => o[1] === '__hdr_same')).map((o) => o[0]);
  assert.deepEqual(turns, ['Switch', 'Wi-Fi', 'Bluetooth']);
  assert.ok(tip.html.indexOf('A ' + catalog.byCode('pluginValue').label + ' slot') === 0, tip.html);
  const look = row('statusTopLeftPluginValueLook');
  assert.equal(look.optionsFrom.resolver, 'pluginValueLooks');
  const withIcon = page.lookOptions().filter((o) => o[1] !== 'text').map((o) => o[0]);
  assert.deepEqual(withIcon, ['Icon + text', 'Icon']);
  assert.ok(tip.html.indexOf('Edit button and pick ' + withIcon.join(' or ') + ' under ' + look.label + '.') !== -1,
    tip.html);
  assert.ok(tip.html.indexOf(turns.slice(0, 2).join(', ') + ' and ' + turns[2] + ' turn off') !== -1, tip.html);
  assert.ok(tip.html.indexOf('a ' + row('statusTopLeftPluginValueLabel').label + ' such as') !== -1, tip.html);
  const every = row('statusTopLeftPluginValueEvery');
  assert.equal(every.optionsFrom.resolver, 'pluginValueEveries');
  const fifteen = page.everyOptions().find((o) => o[1] === '15');
  assert.ok(fifteen, 'Updates offers 15 minutes');
  assert.ok(tip.html.indexOf('Under ' + every.label + ', you can now pick ' + fifteen[0] + '.') !== -1, tip.html);
  assert.equal(tip.since, '3.5.0');
  assert.deepEqual(featureTips.TIPS.filter((x) => x.since === '3.5.0').map((x) => x.id),
    ['pluginValues', 'pluginValueIcon', 'complications'], 'its release\'s, in the card\'s order');
});

test('the several values tip names the page\'s own words: the item, and the Edit button that opens a slot\'s own dialog', () => {
  const tip = featureTips.TIPS.find((x) => x.id === 'pluginValues');
  const label = catalog.byCode('pluginValue').label;
  assert.ok(tip.html.indexOf('Each ' + label + ' slot now shows a value of its own') === 0, tip.html);
  assert.ok(tip.html.indexOf('Set another slot to ' + label + ' and tap its Edit button') !== -1, tip.html);
  assert.equal(catalog.byCode('pluginValue').repeatsInBar, true, 'one bar can hold several, as the tip says');
  assert.ok(tip.html.indexOf('pick one under ' + row('statusTopLeftPluginValueInstance').label + '.') !== -1, tip.html);
  assert.equal(tip.since, '3.5.0');
});

/**
 * The one schema row that writes a key.
 * @param {string} key Its messageKey.
 * @returns {Object}
 */
function row(key) {
  const found = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    if (node.messageKey === key) { found.push(node); }
    Object.keys(node).forEach((k) => walk(node[k]));
  })(schema);
  assert.equal(found.length, 1, 'one row for ' + key);
  return found[0];
}

test('the two watch battery tips name the page\'s own labels, and say the way to the slot once', () => {
  const html = {};
  featureTips.TIPS.forEach((tip) => { html[tip.id] = tip.html.replace(/<[^>]+>/g, ''); });
  const look = row('batterySlotLook');
  const display = row('batterySlotDisplay');
  const option = (item, value) => item.options.find((o) => o[1] === value)[0];
  // Icon + text: where the slot is and what to pick, in the dialog's words.
  assert.ok(html.batteryIconText.indexOf('Set ' + look.label + ' to ' + option(look, 'both') + '.') !== -1,
    html.batteryIconText);
  // Days left: in either look that prints text, then the Value selection that shows them.
  assert.ok(html.batteryDays.indexOf('set ' + look.label + ' to ' + option(look, 'both') + ' or ' + option(look, 'text') + ',')
    !== -1, html.batteryDays);
  assert.ok(html.batteryDays.indexOf('set ' + display.label + ' to ' + option(display, 'days') + ' or '
    + option(display, 'both') + '.') !== -1, html.batteryDays);
  // The way to the slot is said once, in the tip the card shows first.
  const way = 'In the Watch bar, set the right slot to ' + catalog.byCode('battery').label + ' and tap Edit.';
  assert.ok(html.batteryIconText.indexOf(way) !== -1, html.batteryIconText);
  assert.equal(html.batteryDays.indexOf('set the right slot'), -1, html.batteryDays);
  assert.ok(featureTips.allIds().indexOf('batteryIconText') < featureTips.allIds().indexOf('batteryDays'));
});

test('the Weather from tip names the page\'s own section and row, on every watch', () => {
  const tip = featureTips.TIPS.find((t) => t.id === 'weatherFrom');
  const setup = schema.tabs.find((tab) => tab.id === 'setup');
  const section = setup.sections.find((s) => s.id === 'dataSources');
  const weatherRow = section.items[0];
  assert.equal(weatherRow.sheetId, tip.open.sheet, 'Show me opens the dialog the card\'s first row opens');
  assert.ok(tip.html.indexOf('On the ' + setup.label + ' tab, open ' + weatherRow.label + ' under ' + section.title)
    !== -1, tip.html);
  assert.ok(tip.html.indexOf('tap ' + require('../../../src/pkjs/page/weather/weather-sources-page.js').USE_ANOTHER)
    !== -1, 'the Other sources list\'s last row');
  // Every watch gets it, once the newer tips above it are seen.
  const others = featureTips.allIds().filter((id) => id !== 'weatherFrom');
  [{ platform: 'aplite', plugins: false }, { platform: 'emery', plugins: true }, null].forEach((env) =>
    assert.ok(ids(featureTips.pending(others, env)).indexOf('weatherFrom') !== -1, JSON.stringify(env)));
});

test('the weather model tip names the page\'s own section and rows, on every watch', () => {
  const tip = featureTips.TIPS.find((t) => t.id === 'openMeteoModel');
  const setup = schema.tabs.find((tab) => tab.id === 'setup');
  const section = setup.sections.find((s) => s.id === 'dataSources');
  const weatherRow = section.items[0];
  const dialog = setup.sections.find((s) => s.sheetId === 'weatherSources');
  const model = dialog.items.find((i) => i.messageKey === 'openMeteoModel');
  const other = dialog.items.find((i) => i.type === 'subheader');
  assert.equal(tip.open.sheet, weatherRow.sheetId, 'Show me opens the Weather dialog');
  assert.ok(tip.html.indexOf('On the ' + setup.label + ' tab, open ' + weatherRow.label + ' under ' + section.title)
    !== -1, tip.html);
  assert.ok(tip.html.indexOf('pick one under ' + model.label + '.') !== -1, 'the Model row');
  assert.ok(tip.html.indexOf('under ' + other.text + '.') !== -1, 'the Other sources list');
  assert.equal(tip.when, undefined, 'every watch: the phone fetches');
});
