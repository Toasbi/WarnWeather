// test/pixel-icons-creator.test.js — an export of the icon creator (WarnWeatherTools) brought into
// resources/pixel-icons.json: python3 scripts/pixel-icons/import_pixels.py --creator <file>.
// Each size's pixels go into its grid, centred; a drawing is kept as version drawing; a wrong
// size is refused before anything changes. Runs from_creator on a document in memory, so the
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
 * from_creator on a document, as import_pixels.py --creator would run it, without saving.
 * @param {!Object} doc The pixel icons document to start from.
 * @param {!Object} exported The creator's export.
 * @returns {{status: number, doc: ?Object, message: string}} The document after, or the refusal.
 */
function importInto(doc, exported) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-'));
  try {
    const file = path.join(dir, 'export.json');
    fs.writeFileSync(file, JSON.stringify(exported));
    const script = [
      'import json, sys',
      "sys.path.insert(0, sys.argv[1])",
      'import import_pixels as I',
      'doc = json.loads(sys.argv[2])',
      'n = I.from_creator(doc, sys.argv[3])',
      "print(json.dumps({'n': n, 'doc': doc}))",
    ].join('\n');
    const r = spawnSync('python3', ['-c', script, path.join(ROOT, 'scripts', 'pixel-icons'), JSON.stringify(doc), file], { encoding: 'utf8' });
    const out = r.status === 0 ? JSON.parse(r.stdout) : null;
    return { status: r.status, doc: out && out.doc, n: out && out.n, message: (r.stderr || '').trim() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const before = () => ({ format: 1, icons: { SUN: { done: true, sizes: {
  '13': { source: 'draft', pixels: Array(13).fill('.'.repeat(19)), version: 'old', old: { lines: [[[0, 0]]], w: 1, h: 1 }, redraw: true },
} } } });

test('a creator drawing goes in centred in the size\'s grid, kept as version drawing', { skip }, () => {
  const r = importInto(before(), { format: 1, icons: { SUN: { sizes: { '13': { pixels: CROSS, drawing: RING } } } } });
  assert.equal(r.status, 0, r.message);
  assert.equal(r.n, 1);
  const size = r.doc.icons.SUN.sizes['13'];
  assert.deepEqual(Object.keys(size).sort(), ['drawing', 'pixels', 'source', 'version'], 'the picker\'s old pick and Redraw mark go');
  assert.equal(size.source, 'creator');
  assert.equal(size.version, 'drawing');
  assert.deepEqual(size.drawing, RING);
  assert.equal(size.pixels.length, 13, 'the size\'s rows');
  assert.ok(size.pixels.every((r) => r.length === 19), 'as wide as its grid was');
  // 19 columns: the cross's middle on column 9, the grid's middle.
  assert.deepEqual(size.pixels.slice(5, 8), ['.........#.........', '........###........', '.........#.........'], 'the ink in the middle');
  assert.equal(r.doc.icons.SUN.done, true, 'the done mark stays');
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
