// test/pixel-icons-creator.test.js — an export of the icon creator (WarnWeatherTools) brought into
// resources/pixel-icons.json: python3 scripts/pixel-icons/import_pixels.py --creator <file>.
// Each size's pixels go into its grid, centred; a drawing is kept as version drawing; a wrong
// size is refused before anything changes. Runs the import on a document in memory, so the
// committed file is never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const python = spawnSync('python3', ['--version']).status === 0;
const skip = python ? false : 'python3 is not installed';

const CROSS = ['.#.', '###', '.#.'];
const RING = { lines: [[[1, 0], [2, 1], [1, 2], [0, 1], [1, 0]]], w: 3, h: 3 };

/**
 * An import on a document, as import_pixels.py would run it, without saving.
 * @param {!Object} doc The pixel icons document to start from.
 * @param {string} call The Python call, on `doc`, with the files in the folder `D`.
 * @param {!Object<string, *>=} files Files to write in that folder first, as JSON.
 * @returns {{status: number, doc: ?Object, n: ?number, said: string, message: string}} The
 *     document after and what the import printed, or the refusal.
 */
function runImport(doc, call, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-'));
  try {
    for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
    const script = [
      'import json, os, sys',
      "sys.path.insert(0, sys.argv[1])",
      'import import_pixels as I',
      'doc = json.loads(sys.argv[2])',
      'D = sys.argv[3]',
      'n = ' + call,
      "print(json.dumps({'n': n, 'doc': doc}))",
    ].join('\n');
    const r = spawnSync('python3', ['-c', script, path.join(ROOT, 'scripts', 'pixel-icons'), JSON.stringify(doc), dir], { encoding: 'utf8' });
    const lines = (r.stdout || '').trim().split('\n');
    const out = r.status === 0 ? JSON.parse(lines.pop()) : null;
    return { status: r.status, doc: out && out.doc, n: out && out.n, said: lines.join('\n'), message: (r.stderr || '').trim() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * An icon creator export imported into a document (--creator).
 * @param {!Object} doc The pixel icons document to start from.
 * @param {!Object} exported The export.
 * @returns {{status: number, doc: ?Object, n: ?number, said: string, message: string}} As runImport.
 */
function importInto(doc, exported) {
  return runImport(doc, 'I.from_creator(doc, os.path.join(D, "export.json"))', { 'export.json': exported });
}

const before = () => ({ format: 1, icons: { SUN: { sizes: {
  '13': { source: 'draft', pixels: Array(13).fill('.'.repeat(19)), version: 'old', old: { lines: [[[0, 0]]], w: 1, h: 1 }, redraw: true },
} } } });

test('a creator drawing goes in centred in the size\'s grid, kept as version drawing', { skip }, () => {
  const r = importInto(before(), { format: 1, icons: { SUN: { sizes: { '13': { pixels: CROSS, drawing: RING } } } } });
  assert.equal(r.status, 0, r.message);
  assert.equal(r.n, 1);
  const size = r.doc.icons.SUN.sizes['13'];
  assert.deepEqual(Object.keys(size).sort(), ['drawing', 'pixels', 'source', 'version'], 'the size\'s old pick and Redraw mark go');
  assert.equal(size.source, 'creator');
  assert.equal(size.version, 'drawing');
  assert.deepEqual(size.drawing, RING);
  assert.equal(size.pixels.length, 13, 'the size\'s rows');
  assert.ok(size.pixels.every((r) => r.length === 19), 'as wide as its grid was');
  // 19 columns: the cross's middle on column 9, the grid's middle.
  assert.deepEqual(size.pixels.slice(5, 8), ['.........#.........', '........###........', '.........#.........'], 'the ink in the middle');
});

test('a pixel drawing from the creator is a plain pixel size', { skip }, () => {
  const r = importInto(before(), { format: 1, icons: { SUN: { sizes: { '11': { pixels: CROSS } } } } });
  assert.equal(r.status, 0, r.message);
  const size = r.doc.icons.SUN.sizes['11'];
  assert.deepEqual(Object.keys(size).sort(), ['pixels', 'source'], 'no version: the pixel drawing');
  assert.deepEqual(size.pixels, ['...', '...', '...', '...', '.#.', '###', '.#.', '...', '...', '...', '...'], 'no grid yet: its own width');
  assert.ok(r.doc.icons.SUN.sizes['13'], 'the other sizes stay');
});

test('a wrong size is refused, and nothing changes', { skip }, () => {
  const wrong = [
    [{ format: 2, icons: {} }, /not an icon creator export/],
    [{ format: 1, icons: { MOONLIGHT: { sizes: { '13': { pixels: CROSS } } } } }, /MOONLIGHT 13: no such icon/],
    [{ format: 1, icons: { SUN: { sizes: { '12': { pixels: CROSS } } } } }, /SUN 12: the icon has no size of 12 rows/],
    [{ format: 1, icons: { SUN: { sizes: { '13': { pixels: ['#.', '#'] } } } } }, /pixels must be/],
    [{ format: 1, icons: { SUN: { sizes: { '13': { pixels: ['...'] } } } } }, /pixels must be/],
    [{ format: 1, icons: { SUN: { sizes: { '13': { pixels: ['#x#'] } } } } }, /pixels must be/],
    [{ format: 1, icons: { SUN: { sizes: { '11': { pixels: Array(12).fill('#') } } } } }, /up to 11 rows/],
    [{ format: 1, icons: { SUN: { sizes: { '13': { pixels: CROSS, drawing: { lines: [[[3, 0]]], w: 3, h: 3 } } } } } }, /lines of whole pixels inside its box/],
    [{ format: 1, icons: { SUN: { sizes: { '13': { pixels: CROSS, drawing: { lines: [[[0.5, 0]]], w: 3, h: 3 } } } } } }, /lines of whole pixels/],
    [{ format: 1, icons: { SUN: { sizes: { '13': { pixels: CROSS, drawing: { lines: [], w: 3, h: 3 } } } } } }, /lines of whole pixels/],
  ];
  for (const [exported, message] of wrong) {
    const r = importInto(before(), exported);
    assert.notEqual(r.status, 0, JSON.stringify(exported));
    assert.match(r.message, message);
  }
  // One good size and one wrong one: the good one is not written either.
  const r = importInto(before(), { format: 1, icons: {
    SUN: { sizes: { '11': { pixels: CROSS } } },
    TEMP: { sizes: { '99': { pixels: CROSS } } },
  } });
  assert.notEqual(r.status, 0);
});

test('a Pebble Classic and Steel mask from the creator goes in as pixels, and its 3.1.1 mask stays behind', { skip }, () => {
  const doc = { format: 1, icons: { TEMP: { sizes: {
    'A': { source: '3.1.1', pixels: Array(13).fill('.'.repeat(16)), platforms: ['aplite'], mask: { rows: [28], w: 7 } },
  } } } };
  const r = importInto(doc, { format: 1, icons: { TEMP: { sizes: { 'A': { pixels: CROSS } } } } });
  assert.equal(r.status, 0, r.message);
  const size = r.doc.icons.TEMP.sizes.A;
  assert.deepEqual(Object.keys(size).sort(), ['pixels', 'source'], 'no kept mask: the build makes it from the pixels');
  assert.equal(size.pixels.length, 13, 'a mask\'s 13 rows');
  assert.ok(size.pixels.every((row) => row.length === 16), 'as wide as its grid was');
  assert.deepEqual(size.pixels.slice(5, 8), ['.......#........', '......###.......', '.......#........']);
});

test('a mask the Pebble Classic and Steel can\'t draw is refused', { skip }, () => {
  const wrong = [
    [{ SUN: { sizes: { 'A': { pixels: CROSS } } } }, /SUN A: the Pebble Classic and Steel draw no mask of this icon/],
    [{ TEMP: { sizes: { 'A': { pixels: ['#'.repeat(17)] } } } }, /16 pixels wide at most/],
    [{ TEMP: { sizes: { 'A': { pixels: Array(14).fill('#') } } } }, /up to 13 rows/],
    [{ TEMP: { sizes: { 'A': { pixels: CROSS, drawing: RING } } } }, /pixels alone, no drawing/],
  ];
  for (const [icons, message] of wrong) {
    const r = importInto(before(), { format: 1, icons });
    assert.notEqual(r.status, 0, JSON.stringify(icons));
    assert.match(r.message, message);
  }
  // 16 pixels wide with blank columns round them in a wider grid: the ink is what counts.
  const r = importInto(before(), { format: 1, icons: { TEMP: { sizes: { 'A': { pixels: ['..' + '#'.repeat(16) + '..'] } } } } });
  assert.equal(r.status, 0, r.message);
});

test('the file keeps each icon\'s sizes alone, every size with the watches that draw it', { skip }, () => {
  const doc = { format: 1, about: 'old', icons: {
    SUN: { done: true, sizes: { '13': { source: 'me', pixels: CROSS } } },
    TEMP: { sizes: { A: { source: '3.1.1', pixels: CROSS, mask: { rows: [2], w: 3 } } } },
    NOT_AN_ICON: { sizes: {} },
  } };
  const r = runImport(doc, '(setattr(I.W, "PIXELS_JSON", os.path.join(D, "out.json")), I.save(doc), json.load(open(os.path.join(D, "out.json"))))[2]');
  assert.equal(r.status, 0, r.message);
  const saved = r.n;
  assert.deepEqual(Object.keys(saved.icons), ['SUN', 'TEMP'], 'icons the catalogue has, in its order');
  assert.deepEqual(Object.keys(saved.icons.SUN), ['sizes'], 'no done mark: nothing reads one');
  assert.deepEqual(saved.icons.SUN.sizes['13'].platforms, ['basalt', 'emery']);
  assert.deepEqual(saved.icons.TEMP.sizes.A.platforms, ['aplite']);
  assert.deepEqual(saved.icons.TEMP.sizes.A.mask, { rows: [2], w: 3 }, 'a kept mask stays until the creator exports the size');
  assert.match(saved.about, /icon creator/);
});

