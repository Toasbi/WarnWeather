'use strict';
// The new features the settings page offers to try (notices/domain/feature-tips.js): which
// tips an install is shown, and that every tip is one the page can show and open.
const test = require('node:test');
const assert = require('node:assert/strict');
const featureTips = require('../../../src/pkjs/notices/domain/feature-tips.js');
const batteryDays = require('../../../src/pkjs/status-bars/domain/battery-days.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');

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

test('an install from before the tips is shown them; one that has seen them is shown none', () => {
  assert.deepEqual(ids(featureTips.pending([], BASALT)), featureTips.allIds().slice(0, featureTips.MAX_SHOWN));
  assert.deepEqual(ids(featureTips.pending(null, BASALT)), ids(featureTips.pending([], BASALT)), 'no list reads as none seen');
  assert.deepEqual(featureTips.pending(featureTips.allIds(), BASALT), []);
  const first = featureTips.allIds()[0];
  assert.equal(ids(featureTips.pending([first], BASALT)).indexOf(first), -1, 'a seen tip is not shown again');
  // An id it no longer knows (a tip dropped since) changes nothing.
  assert.deepEqual(ids(featureTips.pending(['goneSince'], BASALT)), ids(featureTips.pending([], BASALT)));
});

test('a tip shows only where its feature can be used', () => {
  const days = (env) => ids(featureTips.pending([], env)).indexOf('batteryDays') !== -1;
  assert.equal(days({ platform: 'basalt', plugins: true }), true);
  assert.equal(days({ platform: 'emery', plugins: true }), true);
  assert.equal(days({ platform: 'basalt', plugins: false }), false, 'a Pebble app without plugins has no days');
  assert.equal(days({ platform: 'aplite', plugins: true }), false, 'aplite\'s battery slot has no text look');
  assert.equal(days({ platform: 'basalt' }), false, 'plugins unknown: fail closed');
  assert.equal(days(null), false);
  // A tip without a rule is for every watch.
  [{ platform: 'aplite', plugins: false }, null, {}].forEach((env) =>
    assert.ok(ids(featureTips.pending([], env)).indexOf('blackTheme') !== -1, JSON.stringify(env)));
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
  const forPage = featureTips.forPage(featureTips.pending([], BASALT));
  assert.deepEqual(JSON.parse(JSON.stringify(forPage)), forPage, 'no functions: it rides the page\'s URL as it is');
  forPage.forEach((tip) => {
    assert.deepEqual(Object.keys(tip), ['id', 'title', 'html', 'sheet', 'tab']);
    assert.equal(tip.sheet === null || tip.tab === null, true);
  });
  const days = forPage.find((tip) => tip.id === 'batteryDays');
  assert.equal(days.sheet, 'bar-top', 'the Watch bar\'s dialog, where its right slot is set');
  assert.ok(days.html.indexOf('<a href=\'' + batteryDays.MUNINN_URL + '\'>Muninn app</a>') !== -1);
  assert.equal(forPage.find((tip) => tip.id === 'blackTheme').tab, 'setup');
});
