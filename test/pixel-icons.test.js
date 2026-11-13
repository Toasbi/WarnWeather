// test/pixel-icons.test.js — the pixel icons' watch build step (scripts/pixel-icons/
// gen_watch_icons.js; scripts/pixel-icons/README.md): every drawing marked done in
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

test('the generator knows every icon the editor offers, by an id the watch defines', () => {
  const py = fs.readFileSync(path.join(ROOT, 'scripts', 'pixel-icons', 'watch_icons.py'), 'utf8');
  const block = py.slice(py.indexOf('\nICONS = ['), py.indexOf('\n]', py.indexOf('\nICONS = [')));
  const keys = [...block.matchAll(/^\s+\('([A-Z_]+)',/gm)].map(m => m[1]);
  assert.ok(keys.length > 30, 'read the editor\'s icon list');
  assert.deepEqual(Object.keys(gen.ICON_IDS).sort(), keys.sort());
  const headers = ['src/c/appendix/status_line.h', 'src/c/layers/status_row_icons.h']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  for (const id of [].concat(...Object.values(gen.ICON_IDS))) {
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

test('each watch family lists only the drawings built for it', () => {
  const h = gen.header(
    [['STATUS_ICON_COND_SUN', 11, 'RESOURCE_ID_PX_SUN_11', ['basalt']],
      ['STATUS_ICON_COND_SUN', 13, 'RESOURCE_ID_PX_SUN_13', ['basalt', 'emery']],
      ['STATUS_ICON_COND_SUN', 15, 'RESOURCE_ID_PX_SUN_15', ['emery']]],
    [[2, 13, 'RESOURCE_ID_PX_RAIN_13', ['basalt', 'emery']]]);
  const m = h.match(/#if defined\(PBL_PLATFORM_EMERY\)([\s\S]*)#else([\s\S]*)#endif/);
  assert.ok(m, 'one section per watch family');
  const [, emery, others] = m;
  assert.match(emery, /STATUS_PIXEL_ICON_COUNT 2\n/);
  assert.match(emery, /PX_SUN_13/);
  assert.match(emery, /PX_SUN_15/);
  assert.doesNotMatch(emery, /PX_SUN_11/);
  assert.match(others, /STATUS_PIXEL_ICON_COUNT 2\n/);
  assert.match(others, /PX_SUN_11/);
  assert.match(others, /PX_SUN_13/);
  assert.doesNotMatch(others, /PX_SUN_15/);
  for (const part of [emery, others]) {
    assert.match(part, /STATUS_PIXEL_RAIN_COUNT 1\n[^}]*\{ 2, 13, RESOURCE_ID_PX_RAIN_13 \}/);
  }
  const none = gen.header([], []);
  assert.equal(none.match(/COUNT 0\n/g).length, 4, 'no drawings: every table empty');
  assert.equal(none.match(/\{ 0, 0, 0 \}/g).length, 4, 'and still an array C accepts');
});

test('a done icon becomes a resource and a table entry per size, keyed by the size', () => {
  // Drawings that leave their top and bottom rows blank: the watch looks a drawing up by the
  // size it is for, while the image is its ink alone.
  const art = (w, rows) => drawing(w, rows, (x, y) => y > 0 && y < rows - 1 && (x === 3 || y === 2));
  const doc = { icons: {
    RAIN: { done: true, sizes: {
      '15': { platforms: ['emery'], pixels: art(23, 15) },
      '11': { platforms: ['basalt'], pixels: art(19, 11) },
      '13': { platforms: ['basalt', 'emery'], pixels: art(21, 13) },
    } },
    HEAVY_RAIN: { done: true, sizes: { '17': { platforms: ['emery'], pixels: art(25, 17) } } },
    SUN: { done: false, sizes: { '11': { platforms: ['basalt'], pixels: art(19, 11) } } },
    MOON: { done: true, sizes: { '19': { platforms: [], pixels: art(27, 19) } } },
  } };
  const files = gen.outputs(doc);
  const pdcs = Object.keys(files).filter(f => f.endsWith('.pdc'));
  assert.deepEqual(pdcs.map(f => path.basename(f)).sort(),
    ['PX_HEAVY_RAIN_17.pdc', 'PX_RAIN_11.pdc', 'PX_RAIN_13.pdc', 'PX_RAIN_15.pdc'], 'no file for an icon not done');
  assert.ok(pdcs.every(f => path.dirname(f) === gen.DATA_DIR));
  assert.equal(readPdc(files[path.join(gen.DATA_DIR, 'PX_RAIN_11.pdc')]).h, 9, 'the image is the ink');

  const pkgNow = JSON.parse(fs.readFileSync(gen.PACKAGE, 'utf8')).pebble.resources.media;
  const media = JSON.parse(files[gen.PACKAGE]).pebble.resources.media;
  assert.deepEqual(media.filter(m => !/^PX_/.test(m.name)), pkgNow.filter(m => !/^PX_/.test(m.name)),
    'every other resource stays as it is');
  assert.deepEqual(media.filter(m => /^PX_/.test(m.name)).map(m => [m.name, m.file, m.type, m.targetPlatforms]), [
    ['PX_RAIN_11', 'data/PX_RAIN_11.pdc', 'raw', ['basalt', 'diorite', 'flint']],
    ['PX_RAIN_13', 'data/PX_RAIN_13.pdc', 'raw', ['basalt', 'diorite', 'emery', 'flint']],
    ['PX_RAIN_15', 'data/PX_RAIN_15.pdc', 'raw', ['emery']],
    ['PX_HEAVY_RAIN_17', 'data/PX_HEAVY_RAIN_17.pdc', 'raw', ['emery']],
  ], 'one resource per size, on the watches that draw it');

  const h = files[gen.HEADER];
  const [, emery, others] = h.match(/#if defined\(PBL_PLATFORM_EMERY\)([\s\S]*)#else([\s\S]*)#endif/);
  assert.match(others, /\{ STATUS_ICON_COND_RAIN, 11, RESOURCE_ID_PX_RAIN_11 \}/);
  assert.match(others, /\{ 2, 11, RESOURCE_ID_PX_RAIN_11 \}/, 'the rain alert\'s rain bucket');
  assert.match(emery, /\{ STATUS_ICON_COND_RAIN, 15, RESOURCE_ID_PX_RAIN_15 \}/);
  assert.match(emery, /\{ 3, 17, RESOURCE_ID_PX_HEAVY_RAIN_17 \}/, 'the rain alert\'s heavy bucket');
  assert.doesNotMatch(h, /STATUS_ICON_COND_\w+, 17, RESOURCE_ID_PX_HEAVY_RAIN/, 'Heavy rain is the rain alert\'s only');
  assert.doesNotMatch(h, /PX_SUN/);
  assert.equal(files[gen.APLITE_C], fs.readFileSync(gen.APLITE_C, 'utf8'), 'no mask done: the aplite file as it is');
});

test('a done Pebble Classic mask is written as its ink, and a mask that is only ink as it was', () => {
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
  // Every mask marked done as the editor holds it: 16 columns, bit x in column x.
  const doc = { icons: {} };
  for (const key of keys) {
    const pixels = before.masks[key].map(v => drawing(16, 1, x => Boolean((v >> x) & 1))[0]);
    doc.icons[key] = { done: true, sizes: { A: { platforms: ['aplite'], pixels } } };
  }
  const files = gen.outputs(doc);
  assert.equal(Object.keys(files).filter(f => f.endsWith('.pdc')).length, 0, 'a mask is no PDC');
  const out = files[gen.APLITE_C];
  const after = read(out);
  let tight = 0;
  for (const key of keys) {
    const rows = before.masks[key];
    const first = rows.findIndex(Boolean), last = rows.length - 1 - rows.slice().reverse().findIndex(Boolean);
    const lo = Math.min(...rows.filter(Boolean).map(v => 31 - Math.clz32(v & -v)));
    const hi = Math.max(...rows.map(v => 31 - Math.clz32(v)));
    const ink = rows.slice(first, last + 1).map(v => v >> lo);
    assert.deepEqual(after.masks[key], ink, key + ': its ink');
    assert.deepEqual(after.dims[key], [ink.length, hi - lo + 1], key + ': its ink\'s size');
    if (lo === 0 && first === 0 && last === rows.length - 1 && before.dims[key][1] === hi + 1) {
      const line = src.match(new RegExp('static const uint16_t MASK_' + key + '\\[\\][^;]*;'))[0];
      assert.ok(out.includes(line), key + ': written exactly as it was');
      tight++;
    }
  }
  assert.ok(tight > 0, 'some mask is ink alone, so the unchanged case ran');
});
