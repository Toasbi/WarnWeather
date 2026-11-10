#!/usr/bin/env node
// Build the settings page's copy of the watch's text fonts: the six Gothic fonts
// (scripts/text-fonts-system.json, read out of the SDK's firmware by
// extract-system-text-fonts.py) as web fonts, written to
// src/pkjs/settings/watch-fonts.generated.js with each font's advances.
//
// The page draws its pictures of the watch's screens (preview-watch.js, preview-forecast.js)
// in these fonts: SVG text in the family the watch uses, every glyph its firmware bitmap,
// each lit pixel a square of the outline. One watch pixel is PX font units and the em is the
// font's height, so at font-size = the height, one watch pixel is one unit of the drawing.
// The baseline sits the height below the line's top, where the firmware puts it.
//
// Fonts are WOFF 1.0 (zlib, which every WebView the page runs in reads; Node writes it with
// no other tool), TrueType outlines within, no hinting. Each glyph's pixels go in as
// rectangles: the runs of a row, a run merged with the identical run under it.
//
// Run: node scripts/gen-watch-fonts-page.js   (test/watch-fonts-page.test.js fails while stale)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'text-fonts-system.json');
const OUT = path.join(ROOT, 'src', 'pkjs', 'settings', 'watch-fonts.generated.js');
// Font units per watch pixel.
const PX = 64;
// The page's family per firmware font: a size's regular and bold faces share one family.
const FACES = {
  GOTHIC_14: { family: 'WatchGothic14', weight: 400 },
  GOTHIC_14_BOLD: { family: 'WatchGothic14', weight: 700 },
  GOTHIC_18: { family: 'WatchGothic18', weight: 400 },
  GOTHIC_18_BOLD: { family: 'WatchGothic18', weight: 700 },
  GOTHIC_24: { family: 'WatchGothic24', weight: 400 },
  GOTHIC_24_BOLD: { family: 'WatchGothic24', weight: 700 }
};
// The advances' dense range (a string, one character each), the rest by codepoint.
const DENSE_FROM = 0x20, DENSE_TO = 0x17F;

/**
 * A glyph's pixels from its bitmap.
 * @param {!Array} g [codepoint, width, height, left, top, advance, bitmap base64].
 * @returns {!Array<!Array<number>>} rows of 0/1.
 */
function pixels(g) {
  const w = g[1], h = g[2], bytes = Buffer.from(g[6], 'base64'), rows = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      row.push((bytes[i >> 3] >> (7 - (i & 7))) & 1);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * A bitmap as rectangles: each row's runs, a run merged into the identical run above it.
 * @param {!Array<!Array<number>>} rows The pixels.
 * @returns {!Array<{x: number, y: number, w: number, h: number}>}
 */
function rects(rows) {
  const out = [];
  let open = new Map();
  rows.forEach((row, y) => {
    const next = new Map();
    for (let x = 0; x < row.length;) {
      if (!row[x]) { x++; continue; }
      const s = x;
      while (x < row.length && row[x]) { x++; }
      const key = s + ',' + (x - s), r = open.get(key);
      if (r) { r.h++; next.set(key, r); } else { next.set(key, { x: s, y: y, w: x - s, h: 1 }); }
    }
    open.forEach((r, key) => { if (!next.has(key)) { out.push(r); } });
    open = next;
  });
  open.forEach((r) => out.push(r));
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * One glyph's outline in font units: a clockwise contour per rectangle (y up, from the
 * baseline).
 * @param {!Array} g The glyph.
 * @param {number} height The font's height (line top to baseline, in pixels).
 * @returns {!Array<!Array<!Array<number>>>} Contours of [x, y] points.
 */
function contours(g, height) {
  const left = g[3], top = g[4];
  return rects(pixels(g)).map((r) => {
    const x0 = (left + r.x) * PX, x1 = x0 + r.w * PX;
    const y1 = (height - top - r.y) * PX, y0 = y1 - r.h * PX;
    return [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
  });
}

/** A big-endian byte writer. */
class Out {
  constructor() { this.parts = []; }
  u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v & 0xFF); this.parts.push(b); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(Math.round(v) & 0xFFFF); this.parts.push(b); return this; }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(Math.round(v)); this.parts.push(b); return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); this.parts.push(b); return this; }
  bytes(buf) { this.parts.push(buf); return this; }
  buf() { return Buffer.concat(this.parts); }
}

/**
 * A simple TrueType glyph (glyf entry) from its contours; empty for none.
 * @param {!Array} cs Contours.
 * @returns {{data: !Buffer, box: ?Array<number>, points: number}}
 */
function glyf(cs) {
  if (!cs.length) { return { data: Buffer.alloc(0), box: null, points: 0 }; }
  const pts = [].concat.apply([], cs);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const box = [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
  const o = new Out().i16(cs.length).i16(box[0]).i16(box[1]).i16(box[2]).i16(box[3]);
  let end = -1;
  cs.forEach((c) => { end += c.length; o.u16(end); });
  o.u16(0);   // no instructions
  const flags = [], xb = new Out(), yb = new Out();
  let px = 0, py = 0;
  pts.forEach((p) => {
    let f = 0x01;   // on curve
    const dx = p[0] - px, dy = p[1] - py;
    if (dx === 0) { f |= 0x10; } else if (Math.abs(dx) < 256) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xb.u8(Math.abs(dx)); } else { xb.i16(dx); }
    if (dy === 0) { f |= 0x20; } else if (Math.abs(dy) < 256) { f |= 0x04 | (dy > 0 ? 0x20 : 0); yb.u8(Math.abs(dy)); } else { yb.i16(dy); }
    flags.push(f);
    px = p[0]; py = p[1];
  });
  flags.forEach((f) => o.u8(f));
  o.bytes(xb.buf()).bytes(yb.buf());
  let data = o.buf();
  if (data.length % 4) { data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]); }
  return { data: data, box: box, points: pts.length };
}

/**
 * The name table: the family, its face and the names the font's consumers read.
 * @param {string} family Family name.
 * @param {string} sub 'Regular' | 'Bold'.
 * @returns {!Buffer}
 */
function nameTable(family, sub) {
  const ids = [[1, family], [2, sub], [3, family + '-' + sub + ';WarnWeather'], [4, family + ' ' + sub],
    [5, 'Version 1.000'], [6, family + '-' + sub]];
  const strs = ids.map((n) => {
    const b = Buffer.alloc(n[1].length * 2);
    for (let i = 0; i < n[1].length; i++) { b.writeUInt16BE(n[1].charCodeAt(i), i * 2); }
    return b;
  });
  const o = new Out().u16(0).u16(ids.length).u16(6 + 12 * ids.length);
  let off = 0;
  ids.forEach((n, i) => { o.u16(3).u16(1).u16(0x409).u16(n[0]).u16(strs[i].length).u16(off); off += strs[i].length; });
  strs.forEach((s) => o.bytes(s));
  return o.buf();
}

/**
 * The cmap table: a (3, 1) format 4 subtable, one segment per run of codepoints whose glyph
 * ids run on with them.
 * @param {!Array<number>} cps Codepoints, ascending, glyph id = index + 1.
 * @returns {!Buffer}
 */
function cmapTable(cps) {
  const segs = [];
  cps.forEach((cp, i) => {
    const s = segs[segs.length - 1];
    if (s && cp === s.end + 1) { s.end = cp; } else { segs.push({ start: cp, end: cp, gid: i + 1 }); }
  });
  segs.push({ start: 0xFFFF, end: 0xFFFF, gid: 0 });
  const n = segs.length, pow = Math.pow(2, Math.floor(Math.log2(n)));
  const sub = new Out().u16(4).u16(16 + 8 * n).u16(0).u16(2 * n).u16(2 * pow).u16(Math.log2(pow)).u16(2 * n - 2 * pow);
  segs.forEach((s) => sub.u16(s.end));
  sub.u16(0);
  segs.forEach((s) => sub.u16(s.start));
  segs.forEach((s) => sub.u16(s.start === 0xFFFF ? 1 : (s.gid - s.start) & 0xFFFF));
  segs.forEach(() => sub.u16(0));
  return new Out().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(sub.buf()).buf();
}

/**
 * A table's checksum (uint32 sum of its big-endian words, zero-padded).
 * @param {!Buffer} b The table.
 * @returns {number}
 */
function checksum(b) {
  let sum = 0;
  const p = b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b;
  for (let i = 0; i < p.length; i += 4) { sum = (sum + p.readUInt32BE(i)) >>> 0; }
  return sum;
}

/**
 * One firmware font's TrueType tables.
 * @param {string} name e.g. 'GOTHIC_14_BOLD'.
 * @param {{height: number, glyphs: !Array}} font Its glyphs (the JSON's).
 * @returns {!Object<string, !Buffer>} Tables by tag.
 */
function tables(name, font) {
  const face = FACES[name], bold = face.weight === 700, H = font.height;
  const glyphs = font.glyphs.filter((g) => g[0] !== 0xFFFF);
  const outs = glyphs.map((g) => glyf(contours(g, H)));
  // .notdef: empty, as wide as the wildcard.
  const wild = glyphs.find((g) => g[0] === font.wildcard) || glyphs[0];
  const advs = [wild[5]].concat(glyphs.map((g) => g[5])).map((a) => a * PX);
  const all = [{ data: Buffer.alloc(0), box: null, points: 0 }].concat(outs);
  const boxes = all.map((o) => o.box).filter(Boolean);
  const bbox = [Math.min.apply(null, boxes.map((b) => b[0])), Math.min.apply(null, boxes.map((b) => b[1])),
    Math.max.apply(null, boxes.map((b) => b[2])), Math.max.apply(null, boxes.map((b) => b[3]))];
  const glyfBuf = Buffer.concat(all.map((o) => o.data));
  const loca = new Out();
  let off = 0;
  all.forEach((o) => { loca.u32(off); off += o.data.length; });
  loca.u32(off);
  const hmtx = new Out();
  all.forEach((o, i) => { hmtx.u16(advs[i]).i16(o.box ? o.box[0] : 0); });
  const lsbs = all.filter((o) => o.box).map((o) => o.box[0]);
  const rsbs = all.map((o, i) => (o.box ? advs[i] - o.box[2] : 0)).filter((v, i) => all[i].box);
  const exts = all.filter((o) => o.box).map((o) => o.box[2]);
  const units = H * PX, ascent = units, descent = Math.min(0, bbox[1]);
  const head = new Out().u32(0x00010000).u32(0x00010000).u32(0).u32(0x5F0F3CF5).u16(0x0003).u16(units)
    .u32(0).u32(0).u32(0).u32(0)   // created, modified: none, so a rerun writes the same bytes
    .i16(bbox[0]).i16(bbox[1]).i16(bbox[2]).i16(bbox[3]).u16(bold ? 1 : 0).u16(8).i16(2).i16(1).i16(0).buf();
  const hhea = new Out().u32(0x00010000).i16(ascent).i16(descent).i16(0).u16(Math.max.apply(null, advs))
    .i16(Math.min.apply(null, lsbs)).i16(Math.min.apply(null, rsbs)).i16(Math.max.apply(null, exts))
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(all.length).buf();
  const maxPts = Math.max.apply(null, all.map((o) => o.points));
  const maxCts = Math.max.apply(null, all.map((o) => (o.data.length ? o.data.readInt16BE(0) : 0)));
  const maxp = new Out().u32(0x00010000).u16(all.length).u16(maxPts).u16(maxCts).u16(0).u16(0).u16(2)
    .u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).buf();
  const cps = glyphs.map((g) => g[0]);
  const avg = Math.round(advs.slice(1).reduce((s, a) => s + a, 0) / (advs.length - 1));
  const os2 = new Out().u16(4).i16(avg).u16(face.weight).u16(5).u16(0)
    .i16(units / 5).i16(units / 5).i16(0).i16(units / 10).i16(units / 5).i16(units / 5).i16(0).i16(units / 3)
    .i16(PX).i16(units / 4).i16(0)
    .bytes(Buffer.from([2, 11, 5, 6, 2, 2, 2, 2, 2, 4]))   // PANOSE: a sans
    .u32(0x00000007).u32(0).u32(0).u32(0)                    // Basic Latin, Latin-1, Latin Extended-A
    .bytes(Buffer.from('NONE', 'ascii')).u16(bold ? 0x20 : 0x40)
    .u16(Math.min(cps[0], 0xFFFF)).u16(Math.min(cps[cps.length - 1], 0xFFFF))
    .i16(ascent).i16(descent).i16(0).u16(Math.max(ascent, bbox[3])).u16(Math.max(0, -bbox[1]))
    .u32(0x00000003).u32(0)
    .i16(Math.round(units * 0.5)).i16(Math.round(units * 0.7)).u16(0).u16(0x20).u16(0).buf();
  const post = new Out().u32(0x00030000).u32(0).i16(-PX).i16(PX).u32(0).u32(0).u32(0).u32(0).u32(0).buf();
  return {
    'OS/2': os2, cmap: cmapTable(cps), glyf: glyfBuf, head: head, hhea: hhea, hmtx: hmtx.buf(),
    loca: loca.buf(), maxp: maxp, name: nameTable(face.family, bold ? 'Bold' : 'Regular'), post: post
  };
}

/**
 * The TrueType font of a font's tables (sorted directory, checksums, head's adjustment).
 * @param {!Object<string, !Buffer>} t Tables.
 * @returns {!Buffer}
 */
function sfnt(t) {
  const tags = Object.keys(t).sort(), n = tags.length, pow = Math.pow(2, Math.floor(Math.log2(n)));
  const dir = new Out().u32(0x00010000).u16(n).u16(pow * 16).u16(Math.log2(pow)).u16(n * 16 - pow * 16);
  let off = 12 + 16 * n;
  const body = [];
  tags.forEach((tag) => {
    const b = t[tag];
    dir.bytes(Buffer.from(tag, 'ascii')).u32(checksum(b)).u32(off).u32(b.length);
    const pad = (4 - (b.length % 4)) % 4;
    body.push(b, Buffer.alloc(pad));
    off += b.length + pad;
  });
  const font = Buffer.concat([dir.buf()].concat(body));
  const at = 12 + 16 * tags.indexOf('head');
  font.writeUInt32BE((0xB1B0AFBA - checksum(font)) >>> 0, font.readUInt32BE(at + 8) + 8);
  return font;
}

/**
 * A TrueType font as WOFF 1.0: each table zlib-compressed where that is smaller.
 * @param {!Buffer} font The TrueType font.
 * @returns {!Buffer}
 */
function woff(font) {
  const n = font.readUInt16BE(4), entries = [];
  for (let i = 0; i < n; i++) {
    const at = 12 + 16 * i;
    const tag = font.toString('ascii', at, at + 4), sum = font.readUInt32BE(at + 4);
    const off = font.readUInt32BE(at + 8), len = font.readUInt32BE(at + 12);
    const raw = font.slice(off, off + len), z = zlib.deflateSync(raw, { level: 9 });
    entries.push({ tag: tag, sum: sum, len: len, data: z.length < len ? z : raw });
  }
  let off = 44 + 20 * n;
  const dir = new Out(), body = [];
  entries.forEach((e) => {
    dir.bytes(Buffer.from(e.tag, 'ascii')).u32(off).u32(e.data.length).u32(e.len).u32(e.sum);
    const pad = (4 - (e.data.length % 4)) % 4;
    body.push(e.data, Buffer.alloc(pad));
    off += e.data.length + pad;
  });
  const head = new Out().u32(0x774F4646).u32(0x00010000).u32(off).u16(n).u16(0).u32(font.length)
    .u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0);
  return Buffer.concat([head.buf(), dir.buf()].concat(body));
}

/**
 * One font's advances: the dense range as a string (each character 48 + the advance, a space
 * where the font has no glyph), the rest by codepoint.
 * @param {{glyphs: !Array}} font The JSON's font.
 * @returns {{dense: string, extra: !Object<string, number>}}
 */
function advances(font) {
  const by = {};
  font.glyphs.forEach((g) => { by[g[0]] = g[5]; });
  let dense = '';
  for (let cp = DENSE_FROM; cp <= DENSE_TO; cp++) {
    dense += cp in by ? String.fromCharCode(48 + by[cp]) : ' ';
  }
  const extra = {};
  Object.keys(by).map(Number).filter((cp) => cp > DENSE_TO).forEach((cp) => { extra[cp] = by[cp]; });
  return { dense: dense, extra: extra };
}

/**
 * The generated module's source.
 * @returns {string}
 */
function build() {
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const names = Object.keys(FACES);
  const css = names.map((name) => {
    const face = FACES[name];
    const data = woff(sfnt(tables(name, src.fonts[name]))).toString('base64');
    return '@font-face{font-family:' + face.family + ';font-weight:' + face.weight + ';font-style:normal;'
      + 'src:url(data:font/woff;base64,' + data + ") format('woff')}";
  });
  const fonts = names.map((name) => {
    const f = src.fonts[name], face = FACES[name], a = advances(f);
    const wild = f.glyphs.find((g) => g[0] === f.wildcard);
    return '        ' + name + ': { family: ' + JSON.stringify(face.family) + ', weight: ' + face.weight
      + ', height: ' + f.height + ', missing: ' + (wild ? wild[5] : 0)
      + ',\n            dense: ' + JSON.stringify(a.dense)
      + ',\n            extra: ' + JSON.stringify(a.extra) + ' }';
  });
  return '// GENERATED by scripts/gen-watch-fonts-page.js — do not edit; re-run the script.\n'
    + '// ES5, WebView (+ Node for tests). The watch\'s six Gothic text fonts (Pebble SDK emulator\n'
    + '// firmware, scripts/text-fonts-system.json) as web fonts for the settings page\'s pictures of the\n'
    + '// watch (watch-text.js): each one\'s family and weight, its height (line top to baseline, the\n'
    + '// nominal size), the advance it draws a missing character with, and every glyph\'s advance in\n'
    + '// pixels (dense: 0x' + DENSE_FROM.toString(16) + '..0x' + DENSE_TO.toString(16)
    + ', one character each, 48 + the advance, a space for none; extra: by\n'
    + '// codepoint); css: their @font-face rules, WOFF in data URIs.\n'
    + '(function () {\n'
    + '    var api = {\n'
    + '        fonts: {\n' + fonts.join(',\n') + '\n        },\n'
    + '        css: ' + css.map((c) => JSON.stringify(c)).join('\n            + ') + '\n'
    + '    };\n'
    + "    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }\n"
    + "    if (typeof window !== 'undefined') { window.WatchFonts = api; }\n"
    + '})();\n';
}

if (require.main === module) {
  fs.writeFileSync(OUT, build());
  console.log('wrote', path.relative(ROOT, OUT), fs.statSync(OUT).size, 'bytes');
}

module.exports = { build: build, tables: tables, sfnt: sfnt, woff: woff, rects: rects, pixels: pixels, OUT: OUT, SRC: SRC, PX: PX };
