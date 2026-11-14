// test/pixel-icons-creator.test.js — an export of the icon creator (WarnWeatherTools) brought into
// resources/pixel-icons.json: python3 scripts/pixel-icons/import_pixels.py --creator <file>.
// Each size's pixels go into its grid, centred; a drawing is kept as version drawing; a wrong
// size is refused before anything changes. Also the editor's export (--export), which keeps what
// a size picked. Runs the import on a document in memory, so the committed file is never touched.
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
 * An export file imported into a document: the creator's (--creator) or the editor's (--export).
 * @param {!Object} doc The pixel icons document to start from.
 * @param {!Object} exported The export.
 * @param {string=} fn from_creator (the default) or from_export.
 * @returns {{status: number, doc: ?Object, n: ?number, said: string, message: string}} As runImport.
 */
function importInto(doc, exported, fn = 'from_creator') {
  return runImport(doc, 'I.' + fn + '(doc, os.path.join(D, "export.json"))', { 'export.json': exported });
}

const before = () => ({ format: 1, icons: { SUN: { done: true, sizes: {
  '13': { source: 'draft', pixels: Array(13).fill('.'.repeat(19)), version: 'old', old: { lines: [[[0, 0]]], w: 1, h: 1 }, redraw: true },
} } } });

test('a creator drawing goes in centred in the size\'s grid, kept as version drawing', { skip }, () => {
  const r = importInto(before(), { format: 1, icons: { SUN: { sizes: { '13': { pixels: CROSS, drawing: RING } } } } });
  assert.equal(r.status, 0, r.message);
  assert.equal(r.n, 1);
  const size = r.doc.icons.SUN.sizes['13'];
  assert.deepEqual(Object.keys(size).sort(), ['drawing', 'importedAt', 'pixels', 'source', 'version'], 'the picker\'s old pick and Redraw mark go');
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
  assert.deepEqual(Object.keys(size).sort(), ['importedAt', 'pixels', 'source'], 'no version: the pixel drawing');
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

test('an editor import keeps what a size picked: its version, and a Pebble Classic mask kept from 3.1.1', { skip }, () => {
  const mask = { rows: [2, 7, 2], w: 3 };
  const doc = before();
  doc.icons.SUN.sizes.A = { source: 'draft', pixels: ['#'], mask };
  const r = importInto(doc, { icons: { SUN: { done: true, sizes: {
    '13': { edited: true, source: 'me', pixels: CROSS },
    A: { edited: true, source: 'me', pixels: ['##', '##'] },
  } } } }, 'from_export');
  assert.equal(r.status, 0, r.message);
  const big = r.doc.icons.SUN.sizes['13'];
  assert.deepEqual(big.pixels, CROSS, 'the new pixels');
  assert.equal(big.version, 'old', 'the picked version stays');
  assert.equal(big.redraw, true, 'the Redraw mark stays');
  const classic = r.doc.icons.SUN.sizes.A;
  assert.deepEqual(classic.pixels, ['##', '##'], 'the new pixels wait under the mask');
  assert.deepEqual(classic.mask, mask, 'the mask the watch draws stays');
});

test('a pick or an editor drawing older than the creator\'s export leaves the size as exported', { skip }, () => {
  const imported = importInto(before(), { format: 1, icons: { SUN: { sizes: { '13': { pixels: CROSS, drawing: RING } } } } });
  assert.equal(imported.status, 0, imported.message);
  const exported = imported.doc.icons.SUN.sizes['13'];
  const at = exported.importedAt;
  assert.ok(Number.isInteger(at) && Math.abs(at - Date.now()) < 60000, 'stamped with the time of the import');

  const pickAt = (updatedAt) => runImport(imported.doc, 'I.from_picks(doc, json.load(open(os.path.join(D, "picks.json"))))', {
    'picks.json': [Object.assign({ icon: 'SUN', size: 13, version: 'half', redraw: false }, updatedAt === undefined ? {} : { updatedAt })],
  });
  for (const stale of [at - 1, at, undefined]) {
    const r = pickAt(stale);
    assert.equal(r.status, 0, r.message);
    assert.equal(r.n, 0, 'no pick taken: ' + stale);
    assert.deepEqual(r.doc.icons.SUN.sizes['13'], exported, 'the creator\'s size stays: ' + stale);
    assert.match(r.said, /kept SUN 13 as the icon creator exported it: the picker's pick is older/);
  }
  const picked = pickAt(at + 1);
  assert.equal(picked.n, 1);
  assert.equal(picked.doc.icons.SUN.sizes['13'].version, 'half', 'a pick made after the export is taken');

  const drawnAt = (updatedAt) => importInto(imported.doc, { icons: { SUN: { done: true, sizes: {
    '13': { edited: true, source: 'me', pixels: ['#'], updatedAt },
  } } } }, 'from_export');
  const stale = drawnAt(at - 1);
  assert.deepEqual(stale.doc.icons.SUN.sizes['13'], exported, 'an older drawing changes nothing');
  assert.match(stale.said, /the editor's drawing is older/);
  const drawn = drawnAt(at + 1).doc.icons.SUN.sizes['13'];
  assert.deepEqual(drawn.pixels, ['#'], 'a drawing made after the export is taken');
  assert.equal(drawn.version, 'drawing', 'the size keeps its picked version, as any size does');
  assert.equal(drawn.importedAt, at, 'and the time of the export');
});
