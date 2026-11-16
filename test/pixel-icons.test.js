// test/pixel-icons.test.js — the pixel icons' watch build step (scripts/pixel-icons/
// gen_watch_icons.js; scripts/pixel-icons/README.md): every drawing in
// resources/pixel-icons.json becomes a PDC of 1 px lines through pixel centres, a resource on the
// watches that draw that size, an entry in the lookup table of each watch family that draws it,
// and on Pebble Classic and Steel the icon's bit mask in status_row_aplite.c.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const gen = require('../scripts/pixel-icons/gen_watch_icons.js');

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
 * A PDC image's view box and its paths, in pixels; fails on anything but 1 px open precise
 * paths through pixel centres, which is all the generator writes.
 * @param {!Buffer} buf A .pdc file.
 * @returns {{w: number, h: number, paths: !Array<!Array<!Array<number>>>}} The image.
 */
function readPdc(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'PDCI');
  assert.equal(buf.readUInt32LE(4), buf.length - 8, 'the size field');
  assert.equal(buf.readUInt8(8), 1, 'version 1');
  const w = buf.readInt16LE(10), h = buf.readInt16LE(12), n = buf.readUInt16LE(14);
  const paths = [];
  let at = 16;
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt8(at), 3, 'a precise path');
    assert.equal(buf.readUInt8(at + 1), 0, 'not hidden');
    assert.equal(buf.readUInt8(at + 3), 1, '1 px wide');
    assert.equal(buf.readUInt8(at + 4), 0, 'no fill');
    assert.equal(buf.readUInt16LE(at + 5), 1, 'open');
    const np = buf.readUInt16LE(at + 7);
    assert.ok(np >= 2, 'a line, or a dot as a line of length 0');
    const pts = [];
    for (let k = 0; k < np; k++) {
      const x = buf.readInt16LE(at + 9 + 4 * k), y = buf.readInt16LE(at + 11 + 4 * k);
      assert.ok(x % 8 === 4 && y % 8 === 4, 'on a pixel centre');
      pts.push([(x - 4) / 8, (y - 4) / 8]);
    }
    paths.push(pts);
    at += 9 + 4 * np;
  }
  assert.equal(at, buf.length, 'nothing after the last command');
  return { w, h, paths };
}

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
 * Check that a drawing's PDC lights exactly its pixels in a view box of its ink.
 * @param {!Array<string>} rows The drawing.
 * @param {string} what Its name, for the failure message.
 * @returns {void}
 */
function checkDrawing(rows, what) {
  const px = gen.inkPixels(rows);
  const want = new Set(px.map(([x, y]) => x + ',' + y));
  assert.deepEqual(lights(gen.runs(px)), want, what + ': the runs light exactly its pixels');
  const w = Math.max(...px.map(p => p[0])) + 1, h = Math.max(...px.map(p => p[1])) + 1;
  const img = readPdc(gen.pdc(gen.paths(gen.runs(px)), w, h));
  assert.deepEqual([img.w, img.h], [w, h], what + ': the view box is its ink');
  assert.deepEqual(lights(segmentsOf(img.paths)), want, what + ': the PDC lights exactly its pixels');
  assert.ok(img.paths.length <= gen.runs(px).length, what + ': no more paths than runs');
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
  assert.equal(gen.paths(gen.runs(gen.inkPixels(square))).length, 1, 'touching runs join into one path');
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
  const pixel = gen.pdc(gen.paths(gen.runs(px)), w, 11);
  assert.deepEqual(at('PX_SUN_BASALT_11'), gen.pdc([[[0, 1], [6, 4]], [[2, 6], [2, 6]]], 7, 11), 'old: its kept lines, a dot drawn as a point twice');
  assert.equal(at('PX_SUN_BASALT_11_BW'), undefined, 'old\'s lines go to the black and white watches too: they drew it so before');
  assert.deepEqual(at('PX_SUN_BASALT_13'), gen.pdc(made.lines, 9, 11), 'drawing: its kept lines');
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
  // Kept lines in a box of their own would seat apart from the pixels: refused.
  assert.throws(() => gen.outputs({ icons: { SUN: { sizes: { 'basalt-11': { pixels: stairs, version: 'old', old: { ...old, h: 9 } } } } } }),
    /old lines are 9 rows tall, its box 11/);
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
