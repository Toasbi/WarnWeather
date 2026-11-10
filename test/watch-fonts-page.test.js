// test/watch-fonts-page.test.js — the settings page's copy of the watch's text fonts
// (src/pkjs/settings/watch-fonts.generated.js, from scripts/gen-watch-fonts-page.js): the six
// Gothic fonts of the firmware (scripts/text-fonts-system.json) as web fonts, each glyph its
// firmware bitmap, and their advances for watch-text.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const zlib = require('zlib');
const gen = require('../scripts/gen-watch-fonts-page.js');
const WF = require('../src/pkjs/settings/watch-fonts.generated.js');

const SRC = JSON.parse(fs.readFileSync(gen.SRC, 'utf8'));
const NAMES = ['GOTHIC_14', 'GOTHIC_14_BOLD', 'GOTHIC_18', 'GOTHIC_18_BOLD', 'GOTHIC_24', 'GOTHIC_24_BOLD'];

/**
 * A WOFF 1.0 font's tables, inflated.
 * @param {!Buffer} w The WOFF.
 * @returns {!Object<string, !Buffer>} Tables by tag.
 */
function unwoff(w) {
  assert.equal(w.readUInt32BE(0), 0x774F4646, 'a WOFF');
  assert.equal(w.readUInt32BE(4), 0x00010000, 'TrueType outlines');
  const out = {};
  for (let i = 0; i < w.readUInt16BE(12); i++) {
    const at = 44 + 20 * i, tag = w.toString('ascii', at, at + 4);
    const off = w.readUInt32BE(at + 4), comp = w.readUInt32BE(at + 8), orig = w.readUInt32BE(at + 12);
    const data = w.slice(off, off + comp);
    out[tag] = comp < orig ? zlib.inflateSync(data) : data;
    assert.equal(out[tag].length, orig, tag + ': its length');
  }
  return out;
}

/**
 * The fonts a module's css holds, in order: family, weight and WOFF.
 * @param {string} css @font-face rules.
 * @returns {!Array<{family: string, weight: number, woff: !Buffer}>}
 */
function faces(css) {
  const out = [], re = /font-family:(\w+);font-weight:(\d+);[^}]*?base64,([A-Za-z0-9+/=]+)/g;
  let m;
  while ((m = re.exec(css))) { out.push({ family: m[1], weight: Number(m[2]), woff: Buffer.from(m[3], 'base64') }); }
  return out;
}

/**
 * The glyph id a format 4 cmap gives a codepoint.
 * @param {!Buffer} cmap The cmap table (its one (3, 1) subtable at 12).
 * @param {number} cp The codepoint.
 * @returns {number} 0 for none.
 */
function glyphId(cmap, cp) {
  const s = 12, n = cmap.readUInt16BE(s + 6) / 2;
  for (let i = 0; i < n; i++) {
    const end = cmap.readUInt16BE(s + 14 + 2 * i), start = cmap.readUInt16BE(s + 16 + 2 * n + 2 * i);
    if (cp > end) { continue; }
    if (cp < start) { return 0; }
    return (cp + cmap.readInt16BE(s + 16 + 4 * n + 2 * i)) & 0xFFFF;
  }
  return 0;
}

/**
 * The pixels a glyph's outline covers, as "x,y" in line rows (y down from the line's top),
 * each contour a rectangle; a pixel two of them cover is listed twice.
 * @param {!Object<string, !Buffer>} t The font's tables.
 * @param {number} gid The glyph.
 * @param {number} height The font's height.
 * @returns {!Array<string>}
 */
function inked(t, gid, height) {
  const off = t.loca.readUInt32BE(4 * gid), end = t.loca.readUInt32BE(4 * gid + 4), g = t.glyf;
  if (end === off) { return []; }
  const nc = g.readInt16BE(off), ends = [];
  let p = off + 10;
  for (let i = 0; i < nc; i++) { ends.push(g.readUInt16BE(p)); p += 2; }
  p += 2 + g.readUInt16BE(p);
  const count = ends[nc - 1] + 1, flags = [];
  while (flags.length < count) {
    const f = g[p++];
    flags.push(f);
    if (f & 0x08) { for (let r = g[p++]; r > 0; r--) { flags.push(f); } }
  }
  const coords = (short, same) => {
    let v = 0;
    return flags.map((f) => {
      if (f & short) { const d = g[p++]; v += (f & same) ? d : -d; } else if (!(f & same)) { v += g.readInt16BE(p); p += 2; }
      return v;
    });
  };
  const xs = coords(0x02, 0x10), ys = coords(0x04, 0x20), px = gen.PX, out = [];
  let first = 0;
  ends.forEach((last) => {
    assert.equal(last - first, 3, 'each contour a rectangle');
    const cx = xs.slice(first, last + 1), cy = ys.slice(first, last + 1);
    // Clockwise (y up): left edge up, top edge right, as every outer contour of the font runs.
    assert.ok(cx[0] === cx[1] && cy[1] > cy[0] && cy[1] === cy[2] && cx[2] > cx[1], 'clockwise');
    for (let x = Math.min(...cx) / px; x < Math.max(...cx) / px; x++) {
      for (let y = height - Math.max(...cy) / px; y < height - Math.min(...cy) / px; y++) { out.push(x + ',' + y); }
    }
    first = last + 1;
  });
  return out;
}

test('the committed module is what the firmware\'s fonts make now', () => {
  // A re-run of scripts/extract-system-text-fonts.py (an SDK update) or an edit to the
  // generator leaves the page drawing the old fonts until the generator runs too. The fonts are
  // compared inflated: another zlib packs the same tables into other bytes.
  const fresh = gen.build(), committed = fs.readFileSync(gen.OUT, 'utf8');
  const bare = (s) => s.replace(/base64,[A-Za-z0-9+/=]+/g, 'base64,');
  assert.equal(bare(committed), bare(fresh), 'stale: run node scripts/gen-watch-fonts-page.js');
  const tablesOf = (s) => faces(s).map((f) => unwoff(f.woff));
  assert.deepEqual(tablesOf(committed), tablesOf(fresh), 'stale fonts: run node scripts/gen-watch-fonts-page.js');
});

test('six fonts in three families, each its firmware font\'s height and advances', () => {
  const css = faces(WF.css);
  assert.deepEqual(css.map((f) => f.family + ' ' + f.weight), ['WatchGothic14 400', 'WatchGothic14 700',
    'WatchGothic18 400', 'WatchGothic18 700', 'WatchGothic24 400', 'WatchGothic24 700']);
  NAMES.forEach((name) => {
    const f = WF.fonts[name], src = SRC.fonts[name];
    assert.equal(f.height, Number(/\d+/.exec(name)[0]), name + ': the nominal size, line top to baseline');
    assert.equal(f.family, 'WatchGothic' + f.height);
    assert.equal(f.weight, /BOLD/.test(name) ? 700 : 400);
    src.glyphs.forEach((g) => {
      const cp = g[0], adv = cp >= 0x20 && cp - 0x20 < f.dense.length ? f.dense.charCodeAt(cp - 0x20) - 48 : f.extra[cp];
      assert.equal(adv, g[5], name + ' U+' + cp.toString(16) + ': its advance');
    });
    const wild = src.glyphs.find((g) => g[0] === src.wildcard);
    assert.equal(f.missing, wild[5], name + ': a missing character advances as the firmware\'s wildcard');
    assert.equal(f.dense.charAt('A'.charCodeAt(0) - 0x20) !== ' ', true);
  });
  // Bold widens: the same text runs longer in GOTHIC_18_BOLD than in GOTHIC_18.
  const sum = (name, s) => s.split('').reduce((w, c) => w + WF.fonts[name].dense.charCodeAt(c.charCodeAt(0) - 0x20) - 48, 0);
  assert.ok(sum('GOTHIC_18_BOLD', 'Weather') > sum('GOTHIC_18', 'Weather'));
});

test('every glyph of every font draws exactly its firmware bitmap\'s pixels at its advance', () => {
  let checked = 0;
  faces(WF.css).forEach((face, k) => {
    const name = NAMES[k], src = SRC.fonts[name], t = unwoff(face.woff);
    assert.deepEqual(Object.keys(t).sort(), ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
    assert.equal(t.head.readUInt16BE(18), src.height * gen.PX, name + ': an em of the height, PX units a pixel');
    assert.equal(t.head.readUInt16BE(50), 1, name + ': long loca offsets');
    src.glyphs.filter((g) => g[0] !== 0xFFFF).forEach((g) => {
      const at = name + ' U+' + g[0].toString(16);
      const gid = glyphId(t.cmap, g[0]);
      assert.ok(gid > 0, at + ': mapped');
      assert.equal(t.hmtx.readUInt16BE(4 * gid), g[5] * gen.PX, at + ': its advance');
      const want = [];
      gen.pixels(g).forEach((row, y) => row.forEach((on, x) => { if (on) { want.push((g[3] + x) + ',' + (g[4] + y)); } }));
      assert.deepEqual(inked(t, gid, src.height).sort(), want.sort(), at + ': its pixels, each once');
      checked++;
    });
  });
  assert.equal(checked, NAMES.reduce((n, name) => n + SRC.fonts[name].glyphs.filter((g) => g[0] !== 0xFFFF).length, 0));
  assert.ok(checked > 2000, 'all six fonts\' glyphs');
});

test('a bitmap\'s rectangles cover its lit pixels once each', () => {
  const rows = [[1, 1, 0, 1], [1, 1, 0, 1], [0, 1, 1, 1], [0, 0, 0, 0], [1, 0, 0, 1]];
  const rs = gen.rects(rows), seen = {};
  rs.forEach((r) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        assert.equal(seen[x + ',' + y], undefined, 'once');
        seen[x + ',' + y] = true;
      }
    }
  });
  const lit = [];
  rows.forEach((row, y) => row.forEach((on, x) => { if (on) { lit.push(x + ',' + y); } }));
  assert.deepEqual(Object.keys(seen).sort(), lit.sort());
  assert.deepEqual(rs.find((r) => r.x === 0 && r.y === 0), { x: 0, y: 0, w: 2, h: 2 }, 'a run merged into the one under it');
});
