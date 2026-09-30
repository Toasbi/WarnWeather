// test/config-warn-look-save.test.js — the warn look's "absent = the watch's own
// default" contract, end to end: the REAL generated page saves, the phone stores the
// response the way index.js does (parseResponse, saved wholesale) and re-seeds on the
// next boot, and the packer builds CLAY_THRESHOLDS_UINT8 for another watch.
//
// One phone can drive a colour and a B&W watch from a single PKJS store. The look's
// default is per platform (fill on colour, outline on B&W, outline for goal kinds), so
// a save must not store the default it hydrated, or the first watch configured would
// hand its default to the other (thresh<K>WarnLook's defaultFrom is sticky: false).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const thresholds = require('../src/pkjs/status-thresholds.js');
const wire = require('../src/pkjs/status-wire.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');
const { installFakeStorage, COLORS } = require('./helpers/clay-harness.js');

const STEMS = thresholds.KINDS.filter(k => !k.boldOnly).map(k => k.key);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The phone's side of a save and the boot after it: store the page's response the
 * way index.js webviewclosed does, then run the next boot's seed backfill.
 * @param {Object} saved The blob the page navigated back with.
 * @returns {Object} The stored settings, as the packer would read them.
 */
function storeOnPhone(saved) {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  const settings = require('../src/pkjs/settings');
  claySettings.seedDefaults(COLORS);
  claySettings.save(claySettings.fillFromPreserved(
    settings.parseResponse(encodeURIComponent(JSON.stringify(saved)))));
  claySettings.seedDefaults(COLORS);
  return claySettings.read();
}

/**
 * Decode the packed warn look of every paired kind.
 * @param {number[]} blob buildSettingsBlob output.
 * @returns {Object} Kind key stem -> 'none' | 'outline' | 'fill'.
 */
function packedLooks(blob) {
  const names = Object.keys(thresholds.WARN_LOOKS);
  const out = {};
  thresholds.KINDS.forEach((kind, k) => {
    if (kind.boldOnly) { return; }
    const v = (blob[wire.WARN_LOOK_OFFSET + (k >> 2)] >> (2 * (k & 3))) & 3;
    out[kind.key] = names.find(n => thresholds.WARN_LOOKS[n] === v);
  });
  return out;
}

/**
 * Every paired kind's look, from a per-kind rule.
 * @param {function(string): string} lookOf Kind key stem -> look.
 * @returns {Object} Kind key stem -> look.
 */
function looksBy(lookOf) {
  const out = {};
  STEMS.forEach(stem => { out[stem] = lookOf(stem); });
  return out;
}

/**
 * Pick a warn look in the kind's open levels sheet (the engine's [data-v] path).
 * @param {Object} page The page-harness handle, with the sheet open.
 * @param {string} stem Kind key stem.
 * @param {string} look 'none' | 'outline' | 'fill'.
 */
function pickLook(page, stem, look) {
  const key = 'thresh' + stem + 'WarnLook';
  assert.ok(page.modal.innerHTML.indexOf('data-k="' + key + '" data-v="' + look + '"') !== -1,
    key + ' ' + look + ' is rendered in the open sheet');
  const t = {
    getAttribute: n => (n === 'data-k' ? key : (n === 'data-v' ? look : null)),
    closest: sel => (sel === '[data-v]' ? t : null)
  };
  page.modal.dispatch('click', { target: t });
  assert.equal(page.S[key], look);
}

test('a colour-watch save leaves every warn look absent, so a B&W watch packs its outline', async () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  STEMS.forEach(stem => {
    assert.equal(page.S['thresh' + stem + 'WarnLook'], thresholds.isGoalKind(stem) ? 'outline' : 'fill',
      stem + ': the page shows the colour watch\'s default');
  });
  const saved = await page.save();
  STEMS.forEach(stem => {
    assert.ok(!has(saved, 'thresh' + stem + 'WarnLook'), stem + ': the default look is not saved');
  });
  const stored = storeOnPhone(saved);
  STEMS.forEach(stem => {
    assert.ok(!has(stored, 'thresh' + stem + 'WarnLook'), stem + ': still absent after the next boot');
  });
  assert.deepEqual(packedLooks(wire.buildSettingsBlob(stored, { color: false })),
    looksBy(() => 'outline'), 'the B&W watch packs its own default: outline everywhere');
  assert.deepEqual(packedLooks(wire.buildSettingsBlob(stored, { color: true })),
    looksBy(stem => (thresholds.isGoalKind(stem) ? 'outline' : 'fill')),
    'the colour watch keeps fill for its weather kinds');
});

test('a look picked off the default is saved; picking the default back drops it', async () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.clickTab('watch');
  page.openEditSheet('alertUv');
  pickLook(page, 'Uv', 'outline');
  const saved = await page.save();
  assert.equal(saved.threshUvWarnLook, 'outline', 'a pick that differs from the default is saved');
  const stored = storeOnPhone(saved);
  assert.equal(packedLooks(wire.buildSettingsBlob(stored, { color: true })).Uv, 'outline');

  // Back to Fill, and a Wind look a save stored before the key went non-sticky: both
  // equal the colour default, so the save drops them and they resolve per watch again.
  const again = bootGeneratedPage({ provider: 'dwd', threshUvWarnLook: 'outline', threshWindWarnLook: 'fill' },
    'emery');
  again.clickTab('watch');
  again.openEditSheet('alertUv');
  pickLook(again, 'Uv', 'fill');
  const resaved = await again.save();
  assert.ok(!has(resaved, 'threshUvWarnLook'), 'picking the default back is not saved');
  assert.ok(!has(resaved, 'threshWindWarnLook'), 'a stored default is dropped by the next save');
  const bw = packedLooks(wire.buildSettingsBlob(storeOnPhone(resaved), { color: false }));
  assert.equal(bw.Uv, 'outline');
  assert.equal(bw.Wind, 'outline');
});

test('on a B&W watch Fill is the pick and is saved; its default Outline is not', async () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'diorite');
  page.clickTab('watch');
  page.openEditSheet('alertUv');
  assert.equal(page.S.threshUvWarnLook, 'outline', 'the B&W default');
  const plain = await page.save();
  assert.ok(!has(plain, 'threshUvWarnLook'), 'the B&W default is not saved either');
  pickLook(page, 'Uv', 'fill');
  const saved = await page.save();
  assert.equal(saved.threshUvWarnLook, 'fill', 'fill is a pick on a B&W watch');
});
