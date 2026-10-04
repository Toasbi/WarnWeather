'use strict';
// test/config-alert-level-cards.test.js — each weather alert's cards on its default
// levels (settings/alerts-schema.js ALERT_LEVEL_CARDS). They stand as notes under the
// alert<Stem> dialog's intro, in its intro card (the section's introNotes; engine.js
// dialogIntroHtml shows each note whose showWhen holds — owner, 2026-10-04: the notes used
// to ride the levels slider's info text). The cards write the seed numbers out next to the published levels
// they sit on, so nothing derives them: this holds every card to its unit's or scale's
// seed pair (status-thresholds.js seedPair), and its gate to the contract's
// scaleVariant, so that exactly one card shows for every combination of the pickers.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const schema = require('../src/pkjs/settings/schema.js');
const thresholds = require('../src/pkjs/status-thresholds.js');

const ALERT_STEMS = ['Gust', 'Uv', 'Aqi', 'Pollen', 'Wind'];
// The label each variant's numbers carry in the copy ('kph' as the page writes it);
// a unitless kind's numbers stand alone.
const UNIT_LABEL = { kph: 'kph', mph: 'mph', kn: 'kn', us: '', eu: '', '': '' };

const allSections = () => schema.tabs.reduce((acc, t) => acc.concat(t.sections), []);

/**
 * @param {string} stem Alert kind key stem.
 * @returns {Object} The levels slider (range row) of the kind's alert sheet.
 */
function sliderOf(stem) {
  const sheet = allSections().find((s) => s.sheetId === 'alert' + stem);
  assert.ok(sheet, 'alert' + stem + ' exists');
  const range = sheet.items.find((it) => it.type === 'range' && it.messageKey === 'thresh' + stem + 'Warn');
  assert.ok(range, 'alert' + stem + ' carries its levels slider');
  return range;
}

/**
 * @param {string} stem Alert kind key stem.
 * @returns {Object[]} The cards the kind's dialog shows under its intro (introNotes).
 */
function cardsOf(stem) {
  const sheet = allSections().find((s) => s.sheetId === 'alert' + stem);
  assert.ok(sheet && Array.isArray(sheet.introNotes) && sheet.introNotes.length,
    stem + ': the dialog carries its cards as introNotes');
  return sheet.introNotes;
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

test('one card per unit or scale a kind\'s seed varies by, under the dialog\'s intro, not on the slider', () => {
  const variants = (stem) => new Set(COMBOS.map((S) => thresholds.scaleVariant(stem, S))).size;
  ALERT_STEMS.forEach((stem) => {
    const cards = cardsOf(stem);
    assert.equal(cards.length, variants(stem), stem);
    const range = sliderOf(stem);
    assert.equal(range.label, 'Warn · danger', stem + ': the slider names its two values');
    assert.equal(range.joinPrevious, undefined, stem + ': the slider stands off, not joined');
    // The slider's info text is its own scale hint alone: the cards moved to the intro.
    assert.equal(range.hintFrom, undefined, stem + ': the slider resolves no cards');
    // The cards are intro notes, not rows of the sheet: no info box doubles them.
    const sheet = allSections().find((s) => s.sheetId === 'alert' + stem);
    assert.ok(!sheet.items.some((it) => it.type === 'staticText' && it.style === 'info'
      && cards.some((c) => c.text === it.text)), stem + ': no card stands as its own row');
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
    const range = sheet.items.find((it) => it.type === 'range');
    assert.ok(range, stem + ': the goal sheet carries its levels slider');
    assert.equal(range.hintFrom, undefined, stem + ': its slider carries no cards');
    assert.ok(!sheet.introNotes || !sheet.introNotes.length, stem + ': nor its dialog');
  });
});

// Rendered: the card the pickers select reads under the intro, in the dialog's intro card
// above the Shows on card, as the dialog opens. The page's Hide info text mode (Setup ›
// Misc) folds the intro and its card behind the title's '?', like every dialog's intro.
test('the dialog shows the pickers\' card under its intro, in the intro card; Hide info text folds both behind the title\'s \'?\'', () => {
  const { bootGeneratedPage } = require('./helpers/page-harness.js');
  const open = (cfg) => {
    const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, cfg));
    page.clickTab('alerts');
    page.openEditSheet('alertWind');
    return page;
  };
  // The default wind unit is kph: exactly that card shows.
  const kph = cardsOf('Wind').filter((c) => showWhen.isVisible(c, { windUnits: 'kph' }));
  assert.equal(kph.length, 1, 'one kph card');
  const introCard = '<div class="card nohdr dlg-intro"><div class="intro">Shows the wind icon';
  const html = open({}).modal.innerHTML;
  const at = html.indexOf(introCard);
  assert.ok(at !== -1, 'the intro opens the dialog, in a card');
  const note = html.indexOf('<p class="intro-more">' + kph[0].text + '</p>');
  assert.ok(note > at && note < html.indexOf('<span class="ttl">Shows on</span>'),
    'the kph card follows the intro in that card, above the Shows on card');
  assert.equal(html.split(kph[0].text).length - 1, 1, 'once');
  cardsOf('Wind').filter((c) => c !== kph[0])
    .forEach((c) => assert.equal(html.indexOf(c.text), -1, 'and no other unit\'s card'));
  assert.equal(html.indexOf('data-hint-for="threshWindWarn"'), -1, 'the slider carries no info text of its own');

  const page = open({ hideInfoText: true });
  assert.ok(page.modal.innerHTML.indexOf('data-info="d:alertWind"') !== -1, 'the title\'s \'?\'');
  assert.equal(page.modal.innerHTML.indexOf(kph[0].text), -1, 'the card waits behind it with the intro');
  page.toggleInfo('d:alertWind', 'modal');
  assert.ok(page.modal.innerHTML.indexOf(introCard) !== -1 && page.modal.innerHTML.indexOf(kph[0].text) !== -1,
    'and both show once the \'?\' is opened');
});
