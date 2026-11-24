// test/pixel-icons.test.js — the pixel icons' watch build step (scripts/pixel-icons/
// gen_watch_icons.js, pixel-paths.js; scripts/pixel-icons/README.md): every drawing in
// resources/pixel-icons.json becomes a PDC of 1 px lines through pixel centres in as few bytes as
// the build finds, a resource on the watches that draw that size, an entry in the lookup table of
// each watch family that draws it, and on Pebble Classic and Steel the icon's bit mask in
// status_row_aplite.c.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const gen = require('../scripts/pixel-icons/gen_watch_icons.js');
const pp = require('../scripts/pixel-icons/pixel-paths.js');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'pixel-icons', 'gen_watch_icons.js');
const PIXELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'pixel-icons.json'), 'utf8'));

/**
 * The pixels a list of runs lights, as "x,y" keys. Fails on a run that is not level, upright or
 * at 45 degrees: only those draw the same pixels with antialiasing on or off.
 * @param {!Array<!Array<!Array<number>>>} segs [[x0, y0], [x1, y1]] per run.
 * @returns {!Set<string>} The lit pixels.
 */
function lights(segs) {
  const out = new Set();
  for (const [[x0, y0], [x1, y1]] of segs) {
    const ax = Math.abs(x1 - x0), ay = Math.abs(y1 - y0);
    assert.ok(ax === 0 || ay === 0 || ax === ay, 'a level, upright or 45-degree run');
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    for (let i = 0; i <= Math.max(ax, ay); i++) { out.add((x0 + i * dx) + ',' + (y0 + i * dy)); }
  }
  return out;
}

/**
 * '#'/'.' rows of a w x h drawing.
 * @param {number} w Columns.
 * @param {number} h Rows.
 * @param {function(number, number): boolean} on Whether pixel (x, y) is set.
 * @returns {!Array<string>} The rows.
 */
function drawing(w, h, on) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) { r += on(x, y) ? '#' : '.'; }
    rows.push(r);
  }
  return rows;
}

/**
 * A PDC image's view box, its commands in order, its own paths and its faded pixels' paths, in
 * pixels; fails on anything but 1 px open precise paths through pixel centres, which is all the
 * generator writes: the drawing's own in white ink with no fill, the faded pixels' each marked by
 * its fill and drawn in the dark theme's shade of it.
 * @param {!Buffer} buf A .pdc file.
 * @returns {{w: number, h: number, cmds: !Array<{thirds: number, pts: !Array<!Array<number>>}>,
 *     paths: !Array<!Array<!Array<number>>>, faded: !Object<number, !Array<!Array<!Array<number>>>>}}
 *     The image; `faded` by thirds.
 */
function readPdc(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'PDCI');
  assert.equal(buf.readUInt32LE(4), buf.length - 8, 'the size field');
  assert.equal(buf.readUInt8(8), 1, 'version 1');
  const w = buf.readInt16LE(10), h = buf.readInt16LE(12), n = buf.readUInt16LE(14);
  const cmds = [];
  const paths = [];
  const faded = { 1: [], 2: [] };
  let at = 16;
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt8(at), 3, 'a precise path');
    assert.equal(buf.readUInt8(at + 1), 0, 'not hidden');
    assert.equal(buf.readUInt8(at + 3), 1, '1 px wide');
    assert.equal(buf.readUInt16LE(at + 5), 1, 'open');
    const np = buf.readUInt16LE(at + 7);
    assert.ok(np >= 2, 'a line, or a dot as a line of length 0');
    const pts = [];
    for (let k = 0; k < np; k++) {
      const x = buf.readInt16LE(at + 9 + 4 * k), y = buf.readInt16LE(at + 11 + 4 * k);
      // A faded pixel may be one outside the view box, at -1: its centre at -4.
      assert.ok((x + 8) % 8 === 4 && (y + 8) % 8 === 4, 'on a pixel centre');
      pts.push([(x - 4) / 8, (y - 4) / 8]);
    }
    const stroke = buf.readUInt8(at + 2), fill = buf.readUInt8(at + 4);
    if (fill === 0) {
      assert.equal(stroke, 0xFF, 'the drawing\'s own: white ink');
      paths.push(pts);
    } else {
      assert.ok(fill === 1 || fill === 2, 'a faded pixel\'s fill: no alpha, its thirds');
      assert.equal(stroke, fill === 1 ? 0xD5 : 0xEA, 'drawn in the dark theme\'s shade of it');
      faded[fill].push(pts);
    }
    cmds.push({ thirds: fill, pts });
    at += 9 + 4 * np;
  }
  assert.equal(at, buf.length, 'nothing after the last command');
  return { w, h, cmds, paths, faded };
}

/**
 * What an image's commands paint, drawn in order: each pixel's class, the last command's over it
 * (0 the drawing's own ink, 1 and 2 a faded pixel's thirds).
 * @param {{cmds: !Array<{thirds: number, pts: !Array<!Array<number>>}>}} img readPdc() of a file.
 * @returns {!Map<string, number>} By "x,y".
 */
function paint(img) {
  const out = new Map();
  for (const { thirds, pts } of img.cmds) {
    for (const p of lights(segmentsOf([pts]))) { out.set(p, thirds); }
  }
  return out;
}

/**
 * A drawing's pixels by class, as "x,y" keys: '#' rows its ink (0), its faded rows (1, 2) over it.
 * @param {!Array<!Array<number>>} ink [x, y] of each ink pixel.
 * @param {!Array<!Array<number>>=} faded [x, y, thirds] of each faded pixel.
 * @returns {!Map<string, number>}
 */
function classes(ink, faded = []) {
  const out = new Map(ink.map(([x, y]) => [x + ',' + y, 0]));
  faded.forEach(([x, y, thirds]) => out.set(x + ',' + y, thirds));
  return out;
}

/** A command's bytes in the file: 9, and 4 a point. */
const bytesOf = (paths) => paths.reduce((n, pts) => n + 9 + 4 * pts.length, 0);

/**
 * The runs a path is drawn as: each point to the next.
 * @param {!Array<!Array<!Array<number>>>} paths The paths' points.
 * @returns {!Array<!Array<!Array<number>>>} [[x0, y0], [x1, y1]] per run.
 */
function segmentsOf(paths) {
  const out = [];
  for (const pts of paths) {
    for (let k = 1; k < pts.length; k++) { out.push([pts[k - 1], pts[k]]); }
  }
  return out;
}

/**
 * Check that a drawing's PDC lights exactly its pixels in a view box of its ink, in no more bytes
 * than its runs joined end to end.
 * @param {!Array<string>} rows The drawing.
 * @param {string} what Its name, for the failure message.
 * @returns {void}
 */
function checkDrawing(rows, what) {
  const px = gen.inkPixels(rows);
  const want = new Set(px.map(([x, y]) => x + ',' + y));
  assert.deepEqual(lights(pp.runs(px)), want, what + ': the runs light exactly its pixels');
  assert.deepEqual(lights(pp.runs(px, px, true)), want, what + ': trimmed too');
  const w = Math.max(...px.map(p => p[0])) + 1, h = Math.max(...px.map(p => p[1])) + 1;
  const img = readPdc(gen.pdc(pp.commands(pp.classesOf(px)), w, h));
  assert.deepEqual([img.w, img.h], [w, h], what + ': the view box is its ink');
  assert.deepEqual(paint(img), classes(px), what + ': the PDC lights exactly its pixels, in ink');
  assert.ok(bytesOf(img.paths) <= bytesOf(pp.paths(pp.runs(px))), what + ': no more bytes than its runs joined');
}

test('the generated files match resources/pixel-icons.json', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('the icon catalogue gives every drawing the watch icon ids it serves, ids the watch defines, each once', () => {
  const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'pixel-icons', 'icons.json'), 'utf8')).icons;
  const keys = catalogue.map((i) => i.key);
  assert.ok(keys.length > 30, 'read the catalogue');
  assert.equal(new Set(keys).size, keys.length, 'each key once');
  assert.deepEqual(Object.keys(gen.ICON_IDS), keys, 'the build reads the catalogue');
  const ids = [].concat(...catalogue.map((i) => i.ids));
  assert.equal(new Set(ids).size, ids.length, 'an icon id takes one drawing');
  const headers = ['src/c/appendix/status_line.h', 'src/c/layers/status_icon_size.h']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  for (const id of ids) {
    assert.match(headers, new RegExp('(^\\s*' + id + ' = \\d+,|#define ' + id + ' )', 'm'), id);
  }
});

test('every saved drawing becomes 1 px lines that light exactly its pixels', () => {
  let n = 0;
  for (const [key, icon] of Object.entries(PIXELS.icons)) {
    for (const [size, s] of Object.entries(icon.sizes)) {
      if (size === 'A' || !s.pixels.some(r => r.includes('#'))) { continue; }
      checkDrawing(s.pixels, key + ' ' + size);
      n++;
    }
  }
  assert.ok(n > 0, 'the file has drawings to check');
});

test('rings, diagonals, dots and random scatter become runs that light exactly their pixels', () => {
  checkDrawing(drawing(13, 13, (x, y) => { const d = (x - 6) ** 2 + (y - 6) ** 2; return d >= 20 && d <= 36; }), 'ring');
  checkDrawing(drawing(11, 11, (x, y) => x === y || x === 10 - y), 'X');
  checkDrawing(drawing(9, 9, (x, y) => (x + y) % 2 === 0), 'checkerboard');
  checkDrawing(drawing(9, 9, (x, y) => x % 3 === 0 && y % 3 === 0), 'lone dots');
  checkDrawing(drawing(7, 5, () => true), 'solid block');
  const square = drawing(6, 6, (x, y) => x === 0 || y === 0 || x === 5 || y === 5);
  checkDrawing(square, 'square outline');
  assert.equal(pp.paths(pp.runs(gen.inkPixels(square))).length, 1, 'touching runs join into one path');
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 25; i++) {
    const rows = drawing(17, 17, () => rand() < 0.4);
    rows[0] = '#' + rows[0].slice(1);   // never blank
    checkDrawing(rows, 'scatter ' + i);
  }
});

/**
 * The header's three tables: the Pebble Time 2's, the black and white 144 px watches' and the
 * colour one's.
 * @param {string} h status_pixel_icons.generated.h.
 * @returns {{emery: string, bw: string, colour: string}}
 */
function sections(h) {
  const m = h.match(/#if defined\(PBL_PLATFORM_EMERY\)([\s\S]*)#elif defined\(PBL_BW\)([\s\S]*)#else([\s\S]*)#endif/);
  assert.ok(m, 'one section per watch family');
  return { emery: m[1], bw: m[2], colour: m[3] };
}

test('each watch family lists only the drawings built for it', () => {
  const h = gen.header(
    [['STATUS_ICON_COND_SUN', 11, 'RESOURCE_ID_PX_SUN_11', ['basalt', 'bw']],
      ['STATUS_ICON_COND_SUN', 13, 'RESOURCE_ID_PX_SUN_13', ['basalt', 'emery']],
      ['STATUS_ICON_COND_SUN', 13, 'RESOURCE_ID_PX_SUN_13_BW', ['bw']],
      ['STATUS_ICON_COND_SUN', 15, 'RESOURCE_ID_PX_SUN_15', ['emery']]]);
  const { emery, bw, colour } = sections(h);
  assert.match(emery, /STATUS_PIXEL_ICON_COUNT 2\n/);
  assert.match(emery, /PX_SUN_13\)/);
  assert.match(emery, /PX_SUN_15/);
  assert.doesNotMatch(emery, /PX_SUN_11|_BW/);
  assert.match(colour, /STATUS_PIXEL_ICON_COUNT 2\n/);
  assert.match(colour, /PX_SUN_11/);
  assert.match(colour, /PX_SUN_13\)/);
  assert.doesNotMatch(colour, /PX_SUN_15|_BW/);
  assert.match(bw, /STATUS_PIXEL_ICON_COUNT 2\n/);
  assert.match(bw, /PX_SUN_11/);
  assert.match(bw, /PX_SUN_13_BW\)/, 'the black and white watches: their own drawing of a size');
  assert.doesNotMatch(bw, /PX_SUN_13\)|PX_SUN_15/);
  assert.doesNotMatch(h, /RAIN/, 'one table: the rain alert takes its drawings by id (status_rain_glyph)');
  const none = gen.header([]);
  assert.equal(none.match(/COUNT 0\n/g).length, 3, 'no drawings: every family\'s table empty');
  assert.equal(none.match(/\{ 0, 0, 0 \}/g).length, 3, 'and still an array C accepts');
});

test('every drawing becomes a resource and a table entry per family and box, keyed by them', () => {
  // Drawings that leave their top and bottom rows blank: the watch centres a drawing's box, so
  // the blank rows stay, its seat; only the columns left of the ink fall away.
  const art = (w, rows) => drawing(w, rows, (x, y) => y > 0 && y < rows - 1 && (x === 3 || y === 2));
  const doc = { icons: {
    RAIN: { sizes: {
      'emery-15': { pixels: art(23, 15) },
      'basalt-11': { pixels: art(19, 11) },
      'basalt-13': { pixels: art(21, 13) },
      'emery-13': { pixels: art(21, 13) },
    } },
    HEAVY_RAIN: { sizes: { 'emery-17': { pixels: art(25, 17) } } },
    SUN: { sizes: { 'basalt-11': { pixels: art(19, 11) } } },
  } };
  const files = gen.outputs(doc);
  const pdcs = Object.keys(files).filter(f => f.endsWith('.pdc'));
  assert.deepEqual(pdcs.map(f => path.basename(f)).sort(), ['PX_HEAVY_RAIN_EMERY_17.pdc', 'PX_RAIN_BASALT_11.pdc',
    'PX_RAIN_BASALT_13.pdc', 'PX_RAIN_EMERY_13.pdc', 'PX_RAIN_EMERY_15.pdc', 'PX_SUN_BASALT_11.pdc'], 'every icon\'s sizes');
  assert.ok(pdcs.every(f => path.dirname(f) === gen.DATA_DIR));
  const rain11 = readPdc(files[path.join(gen.DATA_DIR, 'PX_RAIN_BASALT_11.pdc')]);
  assert.deepEqual([rain11.w, rain11.h], [19, 11], 'as wide as its ink, as tall as its box');
  assert.equal(Math.min(...rain11.paths.flat().map(p => p[1])), 1, 'its top row blank: the ink a row down in the box');
  assert.equal(Math.min(...rain11.paths.flat().map(p => p[0])), 0, 'its ink from the first column');

  const pkgNow = JSON.parse(fs.readFileSync(gen.PACKAGE, 'utf8')).pebble.resources.media;
  const media = JSON.parse(files[gen.PACKAGE]).pebble.resources.media;
  assert.deepEqual(media.filter(m => !/^PX_/.test(m.name)), pkgNow.filter(m => !/^PX_/.test(m.name)),
    'every other resource stays as it is');
  assert.deepEqual(media.filter(m => /^PX_/.test(m.name)).map(m => [m.name, m.file, m.type, m.targetPlatforms]), [
    ['PX_RAIN_BASALT_11', 'data/PX_RAIN_BASALT_11.pdc', 'raw', ['basalt', 'diorite', 'flint']],
    ['PX_RAIN_BASALT_13', 'data/PX_RAIN_BASALT_13.pdc', 'raw', ['basalt', 'diorite', 'flint']],
    ['PX_RAIN_EMERY_13', 'data/PX_RAIN_EMERY_13.pdc', 'raw', ['emery']],
    ['PX_RAIN_EMERY_15', 'data/PX_RAIN_EMERY_15.pdc', 'raw', ['emery']],
    ['PX_HEAVY_RAIN_EMERY_17', 'data/PX_HEAVY_RAIN_EMERY_17.pdc', 'raw', ['emery']],
    ['PX_SUN_BASALT_11', 'data/PX_SUN_BASALT_11.pdc', 'raw', ['basalt', 'diorite', 'flint']],
  ], 'one resource per drawing, on its family\'s watches');

  const h = files[gen.HEADER];
  const { emery, bw, colour } = sections(h);
  for (const others of [bw, colour]) {
    assert.match(others, /\{ STATUS_ICON_COND_RAIN, 11, PX_RES\(PX_RAIN_BASALT_11\) \}/, 'the condition icon\'s, and the rain alert\'s rain bucket\'s');
    assert.match(others, /\{ STATUS_ICON_COND_SUN, 11, PX_RES\(PX_SUN_BASALT_11\) \}/);
    assert.doesNotMatch(others, /EMERY/);
  }
  const tables = (t) => t.replace(/^\/\/.*\n/gm, '');
  assert.equal(tables(bw), tables(colour), 'every size in its pixel drawing: both 144 px families draw the same');
  assert.match(emery, /\{ STATUS_ICON_COND_RAIN, 13, PX_RES\(PX_RAIN_EMERY_13\) \}/, 'the Time 2 its own 13 px box');
  assert.match(emery, /\{ STATUS_ICON_COND_RAIN, 15, PX_RES\(PX_RAIN_EMERY_15\) \}/);
  assert.match(emery, /\{ STATUS_ROW_ICON_HEAVY_RAIN, 17, PX_RES\(PX_HEAVY_RAIN_EMERY_17\) \}/, 'the rain alert\'s heavy bucket');
  assert.doesNotMatch(emery, /BASALT/);
  assert.equal(files[gen.APLITE_C], fs.readFileSync(gen.APLITE_C, 'utf8'), 'no mask: the aplite file as it is');

  // A size keyed by anything else, or a box with no middle row, is refused.
  assert.throws(() => gen.outputs({ icons: { SUN: { sizes: { '11': { pixels: art(19, 11) } } } } }), /keyed <basalt\|emery>-<box>/);
  assert.throws(() => gen.outputs({ icons: { SUN: { sizes: { 'chalk-11': { pixels: art(19, 11) } } } } }), /keyed/);
  assert.throws(() => gen.outputs({ icons: { SUN: { sizes: { 'basalt-11': { pixels: art(19, 12) } } } } }), /odd number of rows/);
});

test('a size in another version: its kept lines in the same box; the black and white watches draw old\'s too, and a line drawing\'s pixels', () => {
  // A drawing with a staircase, so its lines differ from its pixel drawing; its box 11 rows, the
  // ink in rows 1 to 9.
  const stairs = drawing(9, 11, (x, y) => y > 0 && y < 10 && (y === Math.floor(x / 2) + 3 || x === 0));
  const old = { lines: [[[0, 1], [6, 4]], [[2, 6]]], w: 7, h: 11 };
  const made = { lines: [[[0, 1], [8, 5], [0, 9]]], w: 9, h: 11 };
  const doc = { icons: {
    SUN: { sizes: {
      'basalt-11': { pixels: stairs, version: 'old', old },
      'basalt-13': { pixels: stairs, version: 'drawing', drawing: made },
      'emery-13': { pixels: stairs, version: 'drawing', drawing: made },
      'emery-15': { pixels: stairs, version: 'old', old },
      'emery-17': { pixels: stairs },
    } },
  } };
  const files = gen.outputs(doc);
  const at = (name) => files[path.join(gen.DATA_DIR, name + '.pdc')];
  const px = gen.boxPixels(stairs), w = Math.max(...px.map(p => p[0])) + 1;
  const own = (lines) => lines.map((pts) => ({ thirds: 0, pts }));
  const pixel = gen.pdc(pp.commands(pp.classesOf(px)), w, 11);
  assert.deepEqual(at('PX_SUN_BASALT_11'), gen.pdc(own([[[0, 1], [6, 4]], [[2, 6], [2, 6]]]), 7, 11), 'old: its kept lines, a dot drawn as a point twice');
  assert.equal(at('PX_SUN_BASALT_11_BW'), undefined, 'old\'s lines go to the black and white watches too: they drew it so before');
  assert.deepEqual(at('PX_SUN_BASALT_13'), gen.pdc(own(made.lines), 9, 11), 'drawing: its kept lines');
  assert.notDeepEqual(at('PX_SUN_BASALT_13'), pixel, 'the drawing is not the pixel drawing');
  assert.deepEqual(at('PX_SUN_BASALT_13_BW'), pixel, 'the black and white watches: its pixels, in the same box');
  assert.equal(at('PX_SUN_EMERY_13_BW'), undefined, 'the Pebble Time 2 needs none');
  assert.deepEqual(at('PX_SUN_EMERY_17'), pixel, 'no version: the pixel drawing');
  const media = JSON.parse(files[gen.PACKAGE]).pebble.resources.media.filter(m => /^PX_/.test(m.name));
  assert.deepEqual(media.map(m => [m.name, m.targetPlatforms]), [
    ['PX_SUN_BASALT_11', ['basalt', 'diorite', 'flint']],
    ['PX_SUN_BASALT_13', ['basalt']], ['PX_SUN_BASALT_13_BW', ['diorite', 'flint']],
    ['PX_SUN_EMERY_13', ['emery']], ['PX_SUN_EMERY_15', ['emery']], ['PX_SUN_EMERY_17', ['emery']],
  ]);
  const { emery, bw, colour } = sections(files[gen.HEADER]);
  assert.match(colour, /\{ STATUS_ICON_COND_SUN, 11, PX_RES\(PX_SUN_BASALT_11\) \}/);
  assert.match(bw, /\{ STATUS_ICON_COND_SUN, 11, PX_RES\(PX_SUN_BASALT_11\) \}/);
  assert.match(colour, /\{ STATUS_ICON_COND_SUN, 13, PX_RES\(PX_SUN_BASALT_13\) \}/);
  assert.match(bw, /\{ STATUS_ICON_COND_SUN, 13, PX_RES\(PX_SUN_BASALT_13_BW\) \}/);
  assert.match(emery, /\{ STATUS_ICON_COND_SUN, 13, PX_RES\(PX_SUN_EMERY_13\) \}/);
  assert.match(emery, /\{ STATUS_ICON_COND_SUN, 15, PX_RES\(PX_SUN_EMERY_15\) \}/);
  assert.doesNotMatch(emery, /_BW/);
  assert.deepEqual(gen.VERSIONS, ['pixel', 'old', 'drawing']);
  for (const [version, message] of [['half', /unknown version half/], ['old', /no old version/], ['drawing', /no drawing version/]]) {
    assert.throws(() => gen.outputs({ icons: { SUN: { sizes: { 'basalt-11': { pixels: stairs, version } } } } }), message);
  }
  // Kept lines that light exact pixels are written as those pixels, in as few bytes: three runs in
  // a row become one.
  const pieces = { lines: [[[0, 1], [1, 1]], [[1, 1], [2, 1]], [[2, 1], [3, 1]]], w: 4, h: 3 };
  const bits = gen.outputs({ icons: { SUN: { sizes: { 'emery-13': { pixels: ['....', '####', '....'], version: 'old', old: pieces } } } } });
  assert.deepEqual(readPdc(bits[path.join(gen.DATA_DIR, 'PX_SUN_EMERY_13.pdc')]).paths, [[[0, 1], [3, 1]]], 'one run');
  // Kept lines in a box of their own would seat apart from the pixels: refused.
  assert.throws(() => gen.outputs({ icons: { SUN: { sizes: { 'basalt-11': { pixels: stairs, version: 'old', old: { ...old, h: 9 } } } } } }),
    /old lines are 9 rows tall, its box 11/);
});

test('a size\'s faded pixels go in the colour watches\' drawing, from the top left of its ink; the black and white watches\' file has none', () => {
  // An L in an 11-row box, its ink in columns 3 to 5 and rows 2 to 6: the view box starts at its
  // ink's left, so the ink's top left is (0, 2) there.
  const ell = drawing(9, 11, (x, y) => y >= 2 && y <= 6 && (x === 3 || (y === 6 && x >= 3 && x <= 5)));
  // Rows over its ink and a pixel round it: a third above and left of the ink and one inside its
  // box, two thirds right of it and on its corner pixel.
  const faded = ['1....', '..1..', '.....', '.....', '.....', '.2..2', '.....'];
  const inBox = { 1: ['-1,1', '1,2'], 2: ['3,6', '0,6'] };
  // Lines level and upright light exact pixels, the L's; a slope of two is smoothed. Both in the
  // L's box, so the same faded rows lie over them.
  const lines = { lines: [[[0, 2], [0, 6], [2, 6]]], w: 3, h: 11 };
  const sloped = { lines: [[[0, 2], [2, 6]]], w: 3, h: 11 };
  const doc = { icons: { SUN: { sizes: {
    'basalt-11': { pixels: ell, faded },
    'basalt-13': { pixels: ell, version: 'drawing', drawing: lines, faded },
    'basalt-15': { pixels: ell, version: 'old', old: lines, faded },
    'basalt-17': { pixels: ell, version: 'old', old: sloped, faded },
    'emery-13': { pixels: ell, version: 'drawing', drawing: sloped, faded },
    'emery-15': { pixels: ell },
  } } } };
  const files = gen.outputs(doc);
  const at = (name) => readPdc(files[path.join(gen.DATA_DIR, name + '.pdc')]);
  const ink = gen.boxPixels(ell);
  const shades = (img) => {
    const out = {};
    img.cmds.filter((c) => c.thirds).forEach((c) => lights(segmentsOf([c.pts])).forEach((p) => { (out[c.thirds] = out[c.thirds] || new Set()).add(p); }));
    return out;
  };
  const want = { 1: new Set(inBox[1]), 2: new Set(inBox[2]) };
  // The pixel drawing, and kept lines that light exact pixels: its ink and faded pixels in the
  // order that costs least, painting each faded pixel's shade over what is under it.
  const inBoxFaded = [].concat(...[1, 2].map((t) => inBox[t].map((p) => p.split(',').map(Number).concat(t))));
  for (const name of ['PX_SUN_BASALT_11', 'PX_SUN_BASALT_13', 'PX_SUN_BASALT_15']) {
    assert.deepEqual(paint(at(name)), classes(ink, inBoxFaded), name + ': its pixels and its faded pixels over them');
  }
  // Smoothed kept lines: as they are, then its faded pixels, which go over them.
  for (const name of ['PX_SUN_BASALT_17', 'PX_SUN_EMERY_13']) {
    const img = at(name);
    assert.deepEqual(img.paths, sloped.lines, name + ': its kept lines');
    assert.equal(img.cmds.findIndex((c) => c.thirds), img.paths.length, name + ': its faded pixels after them');
    assert.deepEqual(shades(img), want, name + ': its thirds where the file puts them');
  }
  // The black and white watches: the drawing without its faded pixels, in a file of its own.
  for (const [name, own] of [['PX_SUN_BASALT_11_BW', 'pixels'], ['PX_SUN_BASALT_13_BW', 'pixels'], ['PX_SUN_BASALT_15_BW', 'pixels'],
    ['PX_SUN_BASALT_17_BW', 'lines']]) {
    const bw = at(name);
    assert.equal(bw.faded[1].length + bw.faded[2].length, 0, name + ': no faded pixel');
    if (own === 'pixels') assert.deepEqual(paint(bw), classes(ink), name + ': its pixels');
    else assert.deepEqual(bw.cmds, sloped.lines.map((pts) => ({ thirds: 0, pts })), name + ': the old icon\'s lines');
  }
  const none = at('PX_SUN_EMERY_15');
  assert.equal(none.faded[1].length + none.faded[2].length, 0, 'a size without faded pixels: none');
  const media = JSON.parse(files[gen.PACKAGE]).pebble.resources.media.filter((m) => /^PX_SUN_BASALT_1[157]/.test(m.name));
  assert.deepEqual(media.map((m) => [m.name, m.targetPlatforms]), [
    ['PX_SUN_BASALT_11', ['basalt']], ['PX_SUN_BASALT_11_BW', ['diorite', 'flint']],
    ['PX_SUN_BASALT_15', ['basalt']], ['PX_SUN_BASALT_15_BW', ['diorite', 'flint']],
    ['PX_SUN_BASALT_17', ['basalt']], ['PX_SUN_BASALT_17_BW', ['diorite', 'flint']],
  ], 'a drawing with faded pixels: the colour watch\'s and the black and white watches\' files apart');
  const { bw, colour } = sections(files[gen.HEADER]);
  assert.match(colour, /\{ STATUS_ICON_COND_SUN, 11, PX_RES\(PX_SUN_BASALT_11\) \}/);
  assert.match(bw, /\{ STATUS_ICON_COND_SUN, 11, PX_RES\(PX_SUN_BASALT_11_BW\) \}/);
  const plain = JSON.parse(gen.outputs({ icons: { SUN: { sizes: { 'basalt-11': { pixels: ell } } } } })[gen.PACKAGE])
    .pebble.resources.media.filter((m) => /^PX_/.test(m.name));
  assert.deepEqual(plain.map((m) => [m.name, m.targetPlatforms]), [['PX_SUN_BASALT_11', ['basalt', 'diorite', 'flint']]],
    'without faded pixels: one file for all three');

  // A shade's pixels in a row join into one line, as the drawing's own do.
  const run = readPdc(gen.pdc(pp.commands(pp.classesOf([], [[0, 1, 1], [1, 2, 1], [2, 3, 1], [4, 1, 2]])), 5, 5));
  assert.equal(run.faded[1].length, 1, 'a 45-degree run of thirds: one line');
  assert.deepEqual(lights(segmentsOf(run.faded[1])), new Set(['0,1', '1,2', '2,3']));
  assert.deepEqual(run.faded[2], [[[4, 1], [4, 1]]], 'a single pixel: a dot');

  const refused = (sizeFaded) => () => gen.outputs({ icons: { SUN: { sizes: { 'basalt-11': { pixels: ell, faded: sizeFaded } } } } });
  assert.throws(refused(faded.slice(1)), /SUN basalt-11: faded is 7 rows of 5 of "\.", "1" and "2", over its ink and a pixel round it/);
  assert.throws(refused(faded.map(r => r + '.')), /7 rows of 5/);
  assert.throws(refused(faded.map(r => r.replace('2', '3'))), /7 rows of 5/);
  assert.throws(refused(faded.map(r => r.replace(/[12]/g, '.'))), /with a faded pixel/);
  assert.throws(refused({ x: 1 }), /7 rows of 5/);
  assert.throws(() => gen.outputs({ icons: { GUST: { sizes: { A: { pixels: ['#'], faded: ['...', '.1.', '...'] } } } } }), /mask has no faded pixels/);
});

test('a drawing\'s commands: its classes in the order that costs least, a path crossing what a later class paints over', () => {
  // An ink row with a faded pixel in its middle: the ink first, one line across it, and the faded
  // pixel on top (34 bytes); the other way round the ink would take two lines (51).
  const row = pp.commands(pp.classesOf([[0, 0], [1, 0], [3, 0], [4, 0]], [[2, 0, 1]]));
  assert.deepEqual(row.map((c) => c.thirds), [0, 1]);
  assert.deepEqual(lights(segmentsOf([row[0].pts])), new Set(['0,0', '1,0', '2,0', '3,0', '4,0']), 'the ink crosses the faded pixel');
  assert.deepEqual(paint({ cmds: row }), classes([[0, 0], [1, 0], [3, 0], [4, 0]], [[2, 0, 1]]));
  // Two faded pixels round an ink pixel: the faded line first, across the ink, and the ink on top.
  const dots = pp.commands(pp.classesOf([[1, 0]], [[0, 0, 2], [2, 0, 2]]));
  assert.deepEqual(dots.map((c) => c.thirds), [2, 0]);
  assert.deepEqual(paint({ cmds: dots }), classes([[1, 0]], [[0, 0, 2], [2, 0, 2]]));
  // A T: its bar and its stem in one path, back over the bar to the stem (25 bytes, not 34).
  const tee = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2], [2, 3]];
  const one = pp.commands(pp.classesOf(tee));
  assert.equal(one.length, 1, 'one path');
  assert.equal(one[0].pts.length, 4, 'four points');
  assert.deepEqual(paint({ cmds: one }), classes(tee));
  // Nothing to draw: no commands.
  assert.deepEqual(pp.commands(pp.classesOf([])), []);
  // Kept lines light exact pixels when every point is a pixel's centre and every run level,
  // upright or at 45 degrees; any other line is smoothed.
  assert.deepEqual(pp.exactPixels([[[0, 0], [2, 2], [2, 3]], [[5, 5], [5, 5]]]), [[0, 0], [1, 1], [2, 2], [2, 3], [5, 5]]);
  assert.equal(pp.exactPixels([[[0, 0], [2, 1]]]), null, 'a slope of a half');
  assert.equal(pp.exactPixels([[[0, 0.5], [2, 0.5]]]), null, 'between two pixels');
  // The check commands() runs on its own result reads runs as the watch draws them.
  assert.deepEqual(pp.painted([{ thirds: 2, pts: [[0, 0], [2, 2]] }]), new Map([['0,0', 2], ['1,1', 2], ['2,2', 2]]));
  assert.throws(() => pp.painted([{ thirds: 0, pts: [[0, 0], [2, 1]] }]), /not level, upright or at 45 degrees/);
});

// The files the watches load, as committed (the first test holds them to the generator): the
// colour watches' paints a drawing's pixels and faded pixels (a kept drawing's lines first, as they
// are, its faded pixels after them); the black and white watches' the drawing without them.
test('every saved drawing\'s files paint exactly its pixels: the colour watches\' with its faded pixels, the black and white watches\' without', () => {
  const media = JSON.parse(fs.readFileSync(gen.PACKAGE, 'utf8')).pebble.resources.media;
  const on = (name) => (media.find((m) => m.name === name) || {}).targetPlatforms;
  const file = (name) => readPdc(fs.readFileSync(path.join(gen.DATA_DIR, name + '.pdc')));
  let n = 0, split = 0;
  for (const [key, icon] of Object.entries(PIXELS.icons)) {
    for (const [id, s] of Object.entries(icon.sizes)) {
      const m = gen.SIZE_KEY.exec(id);
      if (!m) { continue; }
      const what = key + ' ' + id;
      const name = 'PX_' + key + '_' + m[1].toUpperCase() + '_' + m[2];
      const version = s.version || 'pixel';
      const px = gen.boxPixels(s.pixels);
      const kept = version === 'pixel' ? null : gen.keptLines(version, s[version]).lines;
      // Kept lines that light exact pixels are written as those pixels; smoothed ones as they are.
      const lit = kept && pp.exactPixels(kept);
      const faded = gen.fadedInBox(what, s.faded, kept ? kept.flat() : px);
      const colour = file(name);
      if (kept && !lit) {
        assert.deepEqual(colour.paths, kept, what + ': its kept lines');
        assert.equal(colour.cmds.findIndex((c) => c.thirds), faded.length ? kept.length : -1, what + ': its faded pixels after them');
        assert.deepEqual(paint({ cmds: colour.cmds.filter((c) => c.thirds) }), classes([], faded), what + ': its faded pixels');
      } else {
        assert.deepEqual(paint(colour), classes(lit || px, faded), what + ': its pixels and faded pixels');
      }
      if (m[1] === 'basalt') {
        const own = faded.length > 0 || version === 'drawing';
        assert.deepEqual(on(name), own ? ['basalt'] : ['basalt', 'diorite', 'flint'], what + ': the colour watch\'s file');
        const bw = own ? file(name + '_BW') : colour;
        if (own) { assert.deepEqual(on(name + '_BW'), ['diorite', 'flint'], what + ': the black and white watches\' file'); split++; }
        assert.equal(bw.faded[1].length + bw.faded[2].length, 0, what + ': no faded pixel for the black and white watches');
        if (version === 'old' && !lit) assert.deepEqual(bw.paths, kept, what + ': the old icon\'s lines on the black and white watches');
        else assert.deepEqual(paint(bw), classes(version === 'old' ? lit : px), what + ': its pixels on the black and white watches');
      }
      n++;
    }
  }
  assert.ok(n >= 150 && split >= 30, 'premise: every size, and the black and white watches\' own files (' + n + ', ' + split + ')');
});

/**
 * Adds to `lit` the pixels the watch's own 1 px line between two whole pixels lights, in any
 * shade, as "x,y" keys: graphics_line_draw_1px_non_aa, Bresenham's, as the black and white
 * watches draw it, and graphics_line_draw_1px_aa, Wu-Xiang's, as the colour ones do. The icon
 * creator mirrors both (server/domain/drawing/pebble-renderer.ts).
 * @param {!Array<number>} a One end, [x, y].
 * @param {!Array<number>} b The other end.
 * @param {!Set<string>} lit Where the pixels go.
 */
function lineLights(a, b, lit) {
  let [x0, y0, x1, y1] = [a[0], a[1], b[0], b[1]];
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  if (steep) { [x0, y0, x1, y1] = [y0, x0, y1, x1]; }
  if (x0 > x1) { [x0, x1, y0, y1] = [x1, x0, y1, y0]; }
  const ystep = y0 < y1 ? 1 : -1;
  let err = Math.trunc((x1 - x0) / 2);
  for (let x = x0, y = y0; x <= x1; x++) {
    lit.add(steep ? y + ',' + x : x + ',' + y);
    err -= Math.abs(y1 - y0);
    if (err < 0) { y += ystep; err += x1 - x0; }
  }
  // Wu-Xiang's: a level, upright or 45-degree line lights Bresenham's pixels; any other, two
  // pixels a step, each at an opacity of 0 (the line's colour) to 3 (nothing).
  let [x, y, xEnd, yEnd] = a[1] > b[1] ? [b[0], b[1], a[0], a[1]] : [a[0], a[1], b[0], b[1]];
  let dx = Math.abs(xEnd - x), dy = yEnd - y;
  const xi = xEnd < x ? -1 : 1;
  if (dx === 0 || dy === 0 || dx === dy) { return; }
  const plot = (px, py, opacity) => { if (opacity < 3) { lit.add(px + ',' + py); } };
  let acc = 0;
  if (dy > dx) {
    const adj = Math.floor((dx * 65536) / dy) & 0xffff;
    while (--dy) {
      const before = acc;
      acc = (acc + adj) & 0xffff;
      if (acc <= before) { x += xi; }
      y++;
      plot(x, y, acc >> 14);
      plot(x + xi, y, (acc >> 14) ^ 3);
    }
  } else {
    const adj = Math.floor((dy * 65536) / dx) & 0xffff;
    while (--dx) {
      const before = acc;
      acc = (acc + adj) & 0xffff;
      if (acc <= before) { y++; }
      x += xi;
      plot(x, y, acc >> 14);
      plot(x, y + 1, (acc >> 14) ^ 3);
    }
  }
}

// A line drawing's pixels are what the black and white watches draw, the touch-ups they ink
// included (the icon creator's Black and white inks); the colour watches draw its lines and a
// faded pixel at each such touch-up. A touch-up without its faded pixel is not drawn there at
// all: 3.2.5's first moon and thermometer drew half their outline on the colour watches.
test('a line drawing\'s black and white ink is drawn on the colour watches: by its lines, in any shade, or by a faded pixel', () => {
  const undrawn = [];
  for (const [key, icon] of Object.entries(PIXELS.icons)) {
    for (const [id, s] of Object.entries(icon.sizes)) {
      if (s.version !== 'drawing') { continue; }
      const { lines } = gen.keptLines('drawing', s.drawing);
      const lit = new Set();
      lines.forEach((line) => line.slice(1).forEach((p, i) => lineLights(line[i], p, lit)));
      // The faded rows lie over the lines' box and a pixel round it (gen_watch_icons.js fadedInBox).
      const x0 = Math.min(...lines.flat().map((p) => p[0]));
      const y0 = Math.min(...lines.flat().map((p) => p[1]));
      (s.faded || []).forEach((row, y) => [...row].forEach((c, x) => {
        if (c !== '.') { lit.add((x0 + x - 1) + ',' + (y0 + y - 1)); }
      }));
      // The ink's left is the lines' box's left; the rows are the same box's.
      const left = Math.min(...s.pixels.map((row) => row.indexOf('#')).filter((x) => x >= 0));
      let n = 0;
      s.pixels.forEach((row, y) => [...row].forEach((c, x) => {
        if (c === '#' && !lit.has((x - left + x0) + ',' + y)) { n++; }
      }));
      if (n > 0) { undrawn.push(key + ' ' + id + ': ' + n + ' px'); }
    }
  }
  assert.deepEqual(undrawn, [], 'the colour watches draw nothing at these black and white pixels: export the icons from the icon creator again');
});

// The settings page's pictures of the watch draw the status icons from the watch's own drawings
// (status-pixels.generated.js), at each bar's box and seat (preview-watch.js).
test('the settings page has every drawing the watch is built with, its whole box, by watch icon id', () => {
  const page = require('../src/pkjs/settings/status-pixels.generated.js');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'pixel-icons.json'), 'utf8'));
  const condition = require('../src/pkjs/weather/domain/condition.js');
  const glyphs = new Set();
  Object.values(condition.CONDITIONS).forEach((c) => c.glyph.forEach((g) => glyphs.add('STATUS_ICON_' + g)));
  assert.ok(glyphs.size >= 14, 'premise: every condition glyph');
  glyphs.forEach((id) => assert.ok(page.icons[page.ids[id]], id + ': its drawings'));
  let sizes = 0;
  Object.keys(manifest.icons).forEach((key) => Object.keys(manifest.icons[key].sizes).forEach((size) => {
    const p = page.icons[key] && page.icons[key][size];
    const mask = manifest.icons[key].sizes[size].mask;
    if (size === 'A' && mask) { assert.deepEqual(p, { w: mask.w, rows: mask.rows }, key + ': the Classic\'s mask as it is'); return; }
    sizes++;
    // A Classic mask built from its pixels (no kept `mask`) is as tall as its drawing: its box.
    const box = size === 'A' ? manifest.icons[key].sizes[size].pixels.length : Number(size.split('-')[1]);
    assert.ok(p && p.rows.length >= box && (p.rows.length - box) % 2 === 0, key + ' ' + size + ': its whole box');
    assert.ok(p.rows.some((r) => r & 1) && p.rows.every((r) => r < (1 << p.w)), key + ' ' + size + ': as wide as its ink');
    // Its very pixels: the file writes a size that repeats an earlier one as a reference to it.
    const lit = [];
    p.rows.forEach((bits, y) => { for (let x = 0; x < p.w; x++) { if (bits & (1 << x)) { lit.push(x + ',' + y); } } });
    assert.deepEqual(lit.sort(), gen.boxPixels(manifest.icons[key].sizes[size].pixels).map((q) => q.join(',')).sort(),
      key + ' ' + size + ': its pixels');
  }));
  assert.ok(sizes >= 100, 'premise: every size');
});

test('the Pebble Classic mask table reads the same after a second write, whatever a mask\'s height', () => {
  for (const n of [9, 13]) {
    const masks = { GUST: { rows: Array(n).fill(1), w: 1 } };
    const once = gen.apliteSource(masks);
    assert.equal(gen.apliteSource(masks, once), once, n + ' rows: the same file again');
    assert.match(once, new RegExp('\\{ MASK_GUST, +' + n + ', +1 \\}'), n + ' rows: the numbers written');
  }
  const src = fs.readFileSync(gen.APLITE_C, 'utf8');
  const line = (text) => text.split('\n').find((l) => l.includes('{ MASK_GUST,'));
  assert.equal(line(gen.apliteSource({ GUST: { rows: Array(9).fill(1), w: 1 } }, src)).length, line(src).length,
    'the table keeps its columns');
});

test('a Pebble Classic mask is written as wide as its ink and as tall as its box, a mask that is only ink as it was', () => {
  const src = fs.readFileSync(gen.APLITE_C, 'utf8');
  /**
   * The masks and their sizes in an aplite source.
   * @param {string} text status_row_aplite.c.
   * @returns {{masks: !Object<string, !Array<number>>, dims: !Object<string, !Array<number>>}}
   */
  const read = (text) => {
    const masks = {}, dims = {};
    for (const m of text.matchAll(/static const uint16_t MASK_(\w+)\[\]\s*=\s*\{([^}]*)\}/g)) {
      masks[m[1]] = m[2].match(/0x[0-9a-f]+/gi).map(v => parseInt(v, 16));
    }
    for (const m of text.matchAll(/\{ MASK_(\w+),\s*(\d+),\s*(\d+) \}/g)) { dims[m[1]] = [Number(m[2]), Number(m[3])]; }
    return { masks, dims };
  };
  const before = read(src);
  const keys = Object.keys(before.masks);
  assert.deepEqual(keys.sort(), Object.keys(before.dims).sort(), 'every mask has its size');
  assert.ok(keys.length >= 7, 'read the masks');
  // Every mask as the file holds it, two blank columns to its left and a blank row above it.
  const doc = { icons: {} };
  for (const key of keys) {
    const pixels = ['.'.repeat(18)].concat(before.masks[key].map(v => '..' + drawing(16, 1, x => Boolean((v >> x) & 1))[0]));
    doc.icons[key] = { sizes: { A: { pixels } } };
  }
  const files = gen.outputs(doc);
  assert.equal(Object.keys(files).filter(f => f.endsWith('.pdc')).length, 0, 'a mask is no PDC');
  const after = read(files[gen.APLITE_C]);
  for (const key of keys) {
    const rows = before.masks[key];
    const lo = Math.min(...rows.filter(Boolean).map(v => 31 - Math.clz32(v & -v)));
    const hi = Math.max(...rows.map(v => 31 - Math.clz32(v)));
    assert.deepEqual(after.masks[key], [0].concat(rows.map(v => v >> lo)), key + ': the blank row above kept, its seat');
    assert.deepEqual(after.dims[key], [rows.length + 1, hi - lo + 1], key + ': its box\'s rows, its ink\'s columns');
  }
  // Written back as the file holds them: the file again.
  const same = { icons: {} };
  for (const key of keys) same.icons[key] = { sizes: { A: { pixels: before.masks[key].map(v => drawing(before.dims[key][1], 1, x => Boolean((v >> x) & 1))[0]) } } };
  const lines = (text) => text.split('\n').filter((l) => /MASK_/.test(l));
  const tight = keys.filter((key) => before.masks[key].some((v) => v & 1));
  assert.ok(tight.length > 0, 'some mask starts in its first column, so the unchanged case runs');
  const out = lines(gen.outputs(same)[gen.APLITE_C]);
  for (const key of tight) {
    const line = lines(src).find((l) => l.includes('MASK_' + key + '[]'));
    assert.ok(out.includes(line), key + ': written exactly as it was');
  }
});

test('the build refuses a Pebble Classic mask larger than the Classic bars draw', () => {
  const mask = (rows, cols, blank = 0) => ({ icons: { GUST: { sizes: { A: {
    pixels: Array(blank).fill('.'.repeat(cols)).concat(Array(rows).fill('#'.repeat(cols))) } } } } });
  assert.doesNotThrow(() => gen.outputs(mask(13, 16)), '13 rows of 16 columns: the largest');
  assert.doesNotThrow(() => gen.outputs(mask(13, 16, 4)), 'with 4 blank rows to seat it: the tallest box');
  assert.throws(() => gen.outputs(mask(13, 17)), /wider than 16 px/);
  assert.throws(() => gen.outputs(mask(14, 16)), /ink is taller than 13 rows/);
  assert.throws(() => gen.outputs(mask(13, 16, 5)), /box is taller than 17 rows/);
});
