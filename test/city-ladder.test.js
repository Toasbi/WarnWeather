'use strict';

// The city's word ladder on the phone (src/pkjs/city-ladder.js) and where the bake
// uses it (status-lines.js packLine, edge slots only). The watch walks the same
// ladder (src/c/appendix/status_short_text.h); the vectors both are held to live in
// the C test (test/c/status_short_text_test.c, CITY_VECTORS) and are parsed from it
// here, the date-format-contract pattern, so neither side can drift alone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cityLadder = require('../src/pkjs/city-ladder.js');
const statusLines = require('../src/pkjs/status-lines.js');
const catalog = require('../src/pkjs/status-line-catalog.js');
const platformLib = require('../src/pkjs/config-ui/lib/platform.js');

/**
 * The CITY_VECTORS rows of the C test: each is the name, then its abbreviated forms.
 * @returns {string[][]} one array per row
 */
function cVectors() {
  const src = fs.readFileSync(path.join(__dirname, 'c', 'status_short_text_test.c'), 'utf8');
  const table = /CITY_VECTORS\[\]\[\d+\] = \{([\s\S]*?)\n\};/.exec(src);
  assert.ok(table, 'CITY_VECTORS found in status_short_text_test.c');
  const rows = [];
  table[1].split('\n').forEach((line) => {
    if (!/^\s*\{/.test(line)) { return; }
    assert.match(line, /NULL \},$/, 'one row per line, NULL-terminated: ' + line);
    rows.push([...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => {
      assert.ok(!m[1].includes('\\'), 'plain UTF-8, no escapes: ' + m[1]);
      return m[1];
    }));
  });
  return rows;
}

test('the ladder matches the watch\'s, vector for vector', () => {
  const rows = cVectors();
  assert.ok(rows.length >= 10, 'the table has its rows');
  const names = rows.map((r) => r[0]);
  // The spec's cases (§8 phase 4) are all in the table.
  ['New York', 'Bad Berleburg', 'Frankfurt am Main', 'Berlin', 'Bad Königshofen',
    'Wien 22 Donaustadt', 'Halle-Neustadt Süd'].forEach((name) => {
    assert.ok(names.includes(name), name + ' is a vector');
  });
  rows.forEach((row) => {
    assert.deepEqual(cityLadder.members(row[0]), row, row[0]);
  });
});

test('an edge city takes the first form that fits the cap', () => {
  assert.equal(cityLadder.fit('Bad Soden', 8), 'B. Soden');
  assert.equal(cityLadder.fit('New York', 8), 'New York');
  assert.equal(cityLadder.fit('Bad Tölz', 8), 'B. Tölz');
  // Nothing fits: the last form, which packLine then cuts at the cap.
  assert.equal(cityLadder.fit('Bad Berleburg', 8), 'B. Berleburg');
  assert.equal(cityLadder.fit('Berlin-Charlottenburg', 8), 'Berlin-Charlottenburg');
  assert.equal(cityLadder.fit('--', 8), '--');
  assert.deepEqual(cityLadder.members(undefined), ['']);
});

test('every word is ranked, however many there are (the watch has no word cap)', () => {
  // Eleven words: the ten two-letter ones go first, so only the eleventh, the longest,
  // stays whole — status_short_text_test.c pins the same last form on the watch.
  const forms = cityLadder.members('Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kkk');
  assert.equal(forms.length, 11);
  assert.equal(forms[forms.length - 1], 'A. B. C. D. E. F. G. H. I. J. Kkk');
});

// --- the bake ------------------------------------------------------------------

function decodeLine(bytes) {
  const slots = [];
  let off = 0;
  for (let i = 0; i < 3; i++) {
    const len = bytes[off + 2];
    slots.push({ kind: bytes[off], icon: bytes[off + 1], len,
      text: Buffer.from(bytes.slice(off + 3, off + 3 + len)).toString('utf8') });
    off += 3 + len;
  }
  assert.equal(off, bytes.length, 'no trailing bytes');
  return slots;
}

const TOP = catalog.LINES.filter((l) => l.id === 'top')[0];

function settings(extra) {
  return Object.assign({
    temperatureUnits: 'c', axisTimeFormat: '24h', timeShowAmPm: false,
    timeLeadingZero: false, healthMode: 'all', radarProvider: 'disabled'
  }, extra);
}

/**
 * The top line's three slots with City left and right and in the middle.
 * @param {string} city The payload's city.
 * @param {string} platform The watch platform ('' = unknown).
 * @returns {Object[]} the decoded slots
 */
function bakeTop(city, platform) {
  const env = platformLib.computeEnv(platform ? { platform } : null);
  return decodeLine(statusLines.packLine(TOP, { CITY: city },
    settings({ statusTopLeft: 'city', statusTopMid: 'city', statusTopRight: 'city' }), env));
}

test('an edge city that fits the cap only as a ladder form is sent as that form', () => {
  ['basalt', 'diorite', 'emery', 'flint', ''].forEach((platform) => {
    const slots = bakeTop('Bad Soden', platform);
    assert.equal(slots[0].kind, catalog.KINDS.TEXT);
    assert.equal(slots[0].text, 'B. Soden', platform + ' left');
    assert.equal(slots[2].text, 'B. Soden', platform + ' right');
    // The middle's 19 bytes hold the whole name: untouched.
    assert.equal(slots[1].text, 'Bad Soden', platform + ' middle');
    // None fits: the last form is cut at the cap.
    assert.equal(bakeTop('Bad Berleburg', platform)[0].text, 'B. Berle');
    // A name that fits keeps its every byte.
    assert.equal(bakeTop('New York', platform)[0].text, 'New York');
  });
});

test('a middle city too long for its cap is cut as before, never laddered', () => {
  // 24 bytes over the middle's 19: the ladder's first form that fits would be
  // 'B. S. a. Taunus N.' (18 B), but only an edge slot walks it (W12) — the middle
  // keeps its plain cut, and the watch shortens it from there.
  const city = 'Bad Soden am Taunus Nord';
  const plain = Buffer.from(statusLines.utf8Truncate(
    statusLines.utf8Encode(city), catalog.CAPS.MID_TEXT_MAX)).toString('utf8');
  assert.equal(plain, 'Bad Soden am Taunus');
  ['basalt', 'diorite', 'emery', 'flint', ''].forEach((platform) => {
    const slots = bakeTop(city, platform);
    assert.equal(slots[1].text, plain, platform + ' middle');
    assert.equal(slots[0].text, 'B. S. a.', platform + ' left');
  });
});

test('a known aplite bakes its edge cities byte for byte as before', () => {
  const plain = (city) => Buffer.from(statusLines.utf8Truncate(
    statusLines.utf8Encode(city), catalog.CAPS.EDGE_TEXT_MAX)).toString('utf8');
  ['Bad Soden', 'Bad Berleburg', 'New York', 'Frankfurt am Main', 'Bad Tölz'].forEach((city) => {
    const slots = bakeTop(city, 'aplite');
    assert.equal(slots[0].text, plain(city), city);
    assert.equal(slots[2].text, plain(city), city);
  });
  assert.equal(bakeTop('Bad Soden', 'aplite')[0].text, 'Bad Sode');
});
