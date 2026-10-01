'use strict';
// test/config-alert-level-cards.test.js — each weather alert's cards on its default
// levels (schema.js ALERT_LEVEL_CARDS, after the levels slider in the alert<Stem> sheet).
// The cards write the seed numbers out next to the published levels they sit on, so
// nothing derives them: this holds every card to its unit's or scale's seed pair
// (status-thresholds.js seedPair), and its gate to the contract's scaleVariant, so that
// exactly one card shows for every combination of the pickers.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
const thresholds = require('../src/pkjs/status-thresholds.js');

const ALERT_STEMS = ['Gust', 'Uv', 'Aqi', 'Pollen', 'Wind'];
// The label each variant's numbers carry in the copy ('kph' as the page writes it);
// a unitless kind's numbers stand alone.
const UNIT_LABEL = { kph: 'kph', mph: 'mph', kn: 'kn', us: '', eu: '', '': '' };

/**
 * @param {string} stem Alert kind key stem.
 * @returns {Object[]} The staticText cards of the kind's alert sheet.
 */
function cardsOf(stem) {
  const sheet = schema.tabs.reduce((acc, t) => acc.concat(t.sections), [])
    .find((s) => s.sheetId === 'alert' + stem);
  assert.ok(sheet, 'alert' + stem + ' exists');
  return sheet.items.filter((it) => it.type === 'staticText');
}

/**
 * Whether the copy states a number on its own: not part of a longer number or a
 * decimal, and followed by the unit when it has one.
 * @param {string} text Card text, tags stripped.
 * @param {number} n The number.
 * @param {string} unit Its label ('' for none).
 * @returns {boolean}
 */
function states(text, n, unit) {
  const num = String(n).replace('.', '\\.');
  return new RegExp('(^|[^\\d.])' + num + (unit ? ' ' + unit + '\\b' : '(?![\\d]|\\.\\d)')).test(text);
}

const plain = (html) => html.replace(/<[^>]*>/g, '');

// Every combination of the pickers the variants hang on, absent values included (an
// install that never stored a unit reads the fallbacks).
const COMBOS = [];
[undefined, 'kph', 'mph', 'knots'].forEach((windUnits) =>
  [undefined, 'auto', 'waqi', 'openmeteo'].forEach((aqiSource) =>
    [undefined, 'european', 'us'].forEach((aqiScale) => {
      const S = {};
      if (windUnits !== undefined) { S.windUnits = windUnits; }
      if (aqiSource !== undefined) { S.aqiSource = aqiSource; }
      if (aqiScale !== undefined) { S.aqiScale = aqiScale; }
      COMBOS.push(S);
    })));

test('exactly one card shows per alert for every unit and AQI scale, and it states that variant\'s seed pair', () => {
  ALERT_STEMS.forEach((stem) => {
    const cards = cardsOf(stem);
    COMBOS.forEach((S) => {
      const shown = cards.filter((c) => showWhen.isVisible(c, Object.assign({ env: {} }, S)));
      const what = stem + ' ' + JSON.stringify(S);
      assert.equal(shown.length, 1, what + ': one card');
      const seed = thresholds.seedPair(stem, S);
      const unit = UNIT_LABEL[thresholds.scaleVariant(stem, S)];
      const text = plain(shown[0].text);
      assert.ok(states(text, seed.warn, unit), what + ': states warn ' + seed.warn + ' ' + unit + ' in "' + text + '"');
      assert.ok(states(text, seed.danger, unit),
        what + ': states danger ' + seed.danger + ' ' + unit + ' in "' + text + '"');
      assert.match(text, /By default/, what + ': speaks of the defaults');
    });
  });
});

test('one card per unit or scale a kind\'s seed varies by, each an info box after the slider', () => {
  const variants = (stem) => new Set(COMBOS.map((S) => thresholds.scaleVariant(stem, S))).size;
  ALERT_STEMS.forEach((stem) => {
    const cards = cardsOf(stem);
    assert.equal(cards.length, variants(stem), stem);
    cards.forEach((c) => {
      assert.equal(c.style, 'info', stem + ': the amber info box');
      assert.equal(c.joinPrevious, undefined, stem + ': stands off, not joined to the slider');
    });
  });
});

test('each card carries one reference link, opening outside the page', () => {
  ALERT_STEMS.forEach((stem) => cardsOf(stem).forEach((c) => {
    const links = c.text.match(/<a [^>]*>/g) || [];
    assert.equal(links.length, 1, stem + ': one link');
    assert.match(links[0], /^<a target='_blank' href='https:\/\/[^'\s()]+'>$/, stem + ': ' + links[0]);
    assert.doesNotMatch(c.text, /&(?!amp;)/, stem + ': a bare & is escaped');
  }));
});

test('the copy follows the page\'s words: warn and danger, kph, no "threshold", no "your level"', () => {
  ALERT_STEMS.forEach((stem) => cardsOf(stem).forEach((c) => {
    const text = plain(c.text);
    assert.doesNotMatch(text, /threshold|your level|km\/h/i, stem + ': ' + text);
    assert.doesNotMatch(text, /'/, stem + ': typographic apostrophes');
  }));
});

test('the goal kinds\' levels get no cards', () => {
  const all = schema.tabs.reduce((acc, t) => acc.concat(t.sections), []);
  ['Steps', 'Sleep', 'Distance'].forEach((stem) => {
    const sheet = all.find((s) => s.sheetId === 'thresh' + stem);
    assert.ok(sheet, stem);
    assert.ok(!sheet.items.some((it) => it.type === 'staticText' && it.style === 'info'), stem);
  });
});
