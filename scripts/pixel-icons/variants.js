#!/usr/bin/env node
/**
 * The versions the watch can draw a size of an icon in (README.md in this folder, "Versions").
 *
 *   pixel  the drawing as it is: level, upright and 45-degree runs (gen_watch_icons.js runs).
 *   half   its 1 px strokes traced into lines, each pixel centre moved halfway towards the
 *          straight line through its stroke: a staircase becomes a gentler slope, which the
 *          watch smooths with a few grey pixels.
 *   slant  the same, moved all the way: straight slanted lines, smoothed the most.
 *   old    the icon the watch drew before the pixel drawings (resources/data/<res>.pdc),
 *          scaled to this size the way the watch scaled it (watch_icons.py old_version); its
 *          lines are kept in resources/pixel-icons.json with the pick.
 *
 * The black and white watches have no grey pixels to smooth a line with: they always draw the
 * pixel version (gen_watch_icons.js).
 *
 *   node scripts/pixel-icons/variants.js <in.json> <out dir>
 * writes a PDC per entry of the JSON list [{name, version, pixels, old}] (build_picker.py's).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PU = 8;   // precise units per pixel (a PDC's precise paths)
const VERSIONS = ['pixel', 'half', 'slant', 'old'];
// How far a pixel centre moves towards its stroke's straight line, per traced version.
const BEND = { half: 0.5, slant: 1 };
// How far (px) a stroke may stray from a straight line and still be drawn as one.
const STRAIGHT_PX = 0.5;

const key = (x, y) => x + ',' + y;

/**
 * The drawing's 1 px strokes as paths through pixel centres: lit pixels are joined to their
 * level and upright neighbours, and to a diagonal one only where no lit pixel already turns
 * that corner. A path runs from an end or a fork to the next one; a closed loop comes back to
 * its first pixel; a pixel alone is a path of one point.
 * @param {!Array<!Array<number>>} px [x, y] of each lit pixel.
 * @returns {!Array<!Array<!Array<number>>>} The paths' points, in a fixed order.
 */
function trace(px) {
    const lit = new Set(px.map(([x, y]) => key(x, y)));
    const has = (x, y) => lit.has(key(x, y));
    const nbrs = (x, y) => {
        const out = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (has(x + dx, y + dy)) out.push([x + dx, y + dy]);
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            if (has(x + dx, y + dy) && !has(x + dx, y) && !has(x, y + dy)) out.push([x + dx, y + dy]);
        }
        return out;
    };
    const edge = (a, b) => { const p = key(...a), q = key(...b); return p < q ? p + '|' + q : q + '|' + p; };
    const seen = new Set();
    const degree = (p) => nbrs(...p).length;
    const walk = (a, b) => {
        const pts = [a, b];
        seen.add(edge(a, b));
        let cur = b;
        while (degree(cur) === 2) {
            const n = nbrs(...cur).find((q) => !seen.has(edge(cur, q)));
            if (!n) break;
            seen.add(edge(cur, n));
            pts.push(n);
            cur = n;
        }
        return pts;
    };
    const order = px.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const out = [];
    for (const p of order) if (degree(p) === 0) out.push([p]);
    for (const p of order) {
        if (degree(p) !== 2) for (const n of nbrs(...p)) if (!seen.has(edge(p, n))) out.push(walk(p, n));
    }
    for (const p of order) for (const n of nbrs(...p)) if (!seen.has(edge(p, n))) out.push(walk(p, n));
    return out;
}

/**
 * A point's distance from the line through a and b (from a, when they are one point).
 * @param {!Array<number>} p @param {!Array<number>} a @param {!Array<number>} b
 * @returns {number}
 */
function distance(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/**
 * The points Ramer-Douglas-Peucker keeps between lo and hi: the corners, where the stroke
 * strays more than STRAIGHT_PX from a straight line.
 * @param {!Array<!Array<number>>} pts A path.
 * @param {number=} lo @param {number=} hi
 * @returns {!Array<number>} Indexes into pts, in order, lo and hi included.
 */
function corners(pts, lo = 0, hi = pts.length - 1) {
    if (hi - lo < 2) return hi > lo ? [lo, hi] : [lo];
    let best = -1, at = lo;
    for (let i = lo + 1; i < hi; i++) {
        const d = distance(pts[i], pts[lo], pts[hi]);
        if (d > best) { best = d; at = i; }
    }
    if (best <= STRAIGHT_PX) return [lo, hi];
    return corners(pts, lo, at).slice(0, -1).concat(corners(pts, at, hi));
}

/**
 * A path with each pixel centre moved t of the way to the straight line between its
 * corners. t 1 keeps the corners alone.
 * @param {!Array<!Array<number>>} pts A path (trace()).
 * @param {number} t 0..1.
 * @returns {!Array<!Array<number>>} Its points, in pixels.
 */
function bend(pts, t) {
    const ks = corners(pts);
    if (t >= 1) return ks.map((i) => pts[i]);
    const out = [pts[ks[0]]];
    for (let j = 1; j < ks.length; j++) {
        const a = pts[ks[j - 1]], b = pts[ks[j]];
        const dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy;
        for (let i = ks[j - 1] + 1; i < ks[j]; i++) {
            const p = pts[i];
            const u = ll ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll : 0;
            out.push([p[0] + t * (a[0] + u * dx - p[0]), p[1] + t * (a[1] + u * dy - p[1])]);
        }
        out.push(b);
    }
    return out;
}

/**
 * A drawing's traced strokes, bent: the half and slant versions' lines.
 * @param {!Array<!Array<number>>} px [x, y] of each lit pixel, the ink at (0, 0).
 * @param {number} t How far each pixel centre moves (BEND).
 * @returns {!Array<!Array<!Array<number>>>} The lines, in pixels; a dot is a line of one point twice.
 */
function bentLines(px, t) {
    return trace(px).map((p) => bend(p, t)).map((p) => (p.length === 1 ? [p[0], p[0]] : p));
}

/**
 * A PDC image of 1 px open precise paths, its points anywhere on the 1/8 px grid (pixel
 * (x, y)'s centre is (x + 1/2, y + 1/2)); svg2pdc.py's layout, as gen_watch_icons.js pdc().
 * @param {!Array<!Array<!Array<number>>>} lines The paths' points, in pixels.
 * @param {number} w The image's width in pixels, its view box.
 * @param {number} h Its height.
 * @returns {!Buffer} The .pdc file.
 */
function pdc(lines, w, h) {
    const cmds = lines.map((pts) => {
        const b = Buffer.alloc(9 + 4 * pts.length);
        b.writeUInt8(3, 0);        // precise path
        b.writeUInt8(0, 1);        // not hidden
        b.writeUInt8(0xFF, 2);     // stroke colour, recoloured on load
        b.writeUInt8(1, 3);        // stroke width
        b.writeUInt8(0x00, 4);     // fill clear
        b.writeUInt16LE(1, 5);     // open
        b.writeUInt16LE(pts.length, 7);
        pts.forEach(([x, y], k) => {
            b.writeInt16LE(Math.round(x * PU + PU / 2), 9 + 4 * k);
            b.writeInt16LE(Math.round(y * PU + PU / 2), 11 + 4 * k);
        });
        return b;
    });
    const head = Buffer.alloc(8);
    head.writeUInt8(1, 0);         // version
    head.writeUInt8(0, 1);
    head.writeInt16LE(w, 2);
    head.writeInt16LE(h, 4);
    head.writeUInt16LE(cmds.length, 6);
    const body = Buffer.concat([head, ...cmds]);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(body.length, 0);
    return Buffer.concat([Buffer.from('PDCI'), size, body]);
}

/**
 * One version of a size as its lines and box.
 * @param {string} version One of VERSIONS other than pixel (gen_watch_icons.js draws that one).
 * @param {!Array<!Array<number>>} px The drawing's lit pixels, the ink at (0, 0).
 * @param {?{lines: !Array, w: number, h: number}} old The old version (watch_icons.py old_version).
 * @returns {{lines: !Array<!Array<!Array<number>>>, w: number, h: number}}
 */
function versionLines(version, px, old) {
    if (version === 'old') {
        if (!old) throw new Error('no old version for this size');
        return { lines: old.lines.map((p) => (p.length === 1 ? [p[0], p[0]] : p)), w: old.w, h: old.h };
    }
    if (!(version in BEND)) throw new Error('unknown version ' + version);
    return { lines: bentLines(px, BEND[version]), w: Math.max(...px.map((p) => p[0])) + 1,
        h: Math.max(...px.map((p) => p[1])) + 1 };
}

/**
 * Write a PDC per entry of a build_picker.py list.
 * @returns {void}
 */
function main() {
    const [src, outDir] = process.argv.slice(2);
    const gen = require('./gen_watch_icons.js');
    const list = JSON.parse(fs.readFileSync(src, 'utf8'));
    fs.mkdirSync(outDir, { recursive: true });
    list.forEach((e) => {
        const px = gen.inkPixels(e.pixels);
        let buf;
        if (e.version === 'pixel') {
            buf = gen.pdc(gen.paths(gen.runs(px)), Math.max(...px.map((p) => p[0])) + 1,
                Math.max(...px.map((p) => p[1])) + 1);
        } else {
            const v = versionLines(e.version, px, e.old);
            buf = pdc(v.lines, v.w, v.h);
        }
        fs.writeFileSync(path.join(outDir, e.name + '.pdc'), buf);
    });
    console.log('variants: wrote ' + list.length + ' drawings to ' + outDir);
}

if (require.main === module) main();
module.exports = { VERSIONS, BEND, trace, corners, bend, bentLines, pdc, versionLines };
