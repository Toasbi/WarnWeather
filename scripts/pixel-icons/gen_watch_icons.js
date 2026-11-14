#!/usr/bin/env node
/**
 * Build the status icons' pixel drawings into the watch (README.md in this folder).
 *
 *   node scripts/pixel-icons/gen_watch_icons.js           write the files below
 *   node scripts/pixel-icons/gen_watch_icons.js --check   exit 1 if any of them is stale
 *
 * From resources/pixel-icons.json, for every icon (Mark as done is the editor's checkmark alone):
 *   resources/data/PX_<KEY>_<rows>.pdc   each size in the version picked for it (variants.js;
 *                                        the icon picker): by default the pixel drawing as 1 px
 *                                        lines through pixel centres (level, upright and 45-degree
 *                                        runs, joined end to end, and single dots), which the
 *                                        watch draws exactly, smoothing on or off; or its slanted
 *                                        lines, or the old icon or an SVG (svg-icon.js) scaled the
 *                                        old way, or a drawing from the icon creator, smoothed;
 *   resources/data/PX_<KEY>_<rows>_BW.pdc   the pixel drawing again, for the black and white
 *                                        watches (Pebble 2, Pebble 2 Duo), where a size picked in
 *                                        another version: they have no grey pixels to smooth with
 *                                        (a creator drawing's pixels are that drawing as they draw
 *                                        it);
 *   package.template.json                one raw resource per drawing, on the watches that draw
 *                                        it;
 *   src/c/layers/status_pixel_icons.generated.h   which drawing each icon id (and each rain
 *                                        alert bucket) uses at each painted height;
 *   src/c/layers/status_row_aplite.c     the Pebble Classic/Steel bit mask, when the icon has one;
 *   src/pkjs/settings/condition-pixels.generated.js   the weather condition icons' drawings at
 *                                        PAGE_ROWS, for the settings page's list of conditions.
 * The watch draws nothing else: an icon id without a drawing is text only, and a height without
 * one takes the icon's next smaller drawing (status_icon_size.h).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const variants = require('./variants.js');

const ROOT = path.resolve(__dirname, '..', '..');
const PIXELS = path.join(ROOT, 'resources', 'pixel-icons.json');
const DATA_DIR = path.join(ROOT, 'resources', 'data');
const PACKAGE = path.join(ROOT, 'package.template.json');
const HEADER = path.join(ROOT, 'src', 'c', 'layers', 'status_pixel_icons.generated.h');
const APLITE_C = path.join(ROOT, 'src', 'c', 'layers', 'status_row_aplite.c');
const PAGE_PIXELS = path.join(ROOT, 'src', 'pkjs', 'settings', 'condition-pixels.generated.js');
// The size the settings page shows the condition icons at: one every watch with them draws.
const PAGE_ROWS = '13';
const PU = 8;

// The watch's icon ids for each drawing (status_line.h, status_row_icons.h).
const ICON_IDS = {
    SUN: ['STATUS_ICON_COND_SUN'], MOON: ['STATUS_ICON_COND_MOON'],
    SUN_CLOUD: ['STATUS_ICON_COND_SUN_CLOUD'], MOON_CLOUD: ['STATUS_ICON_COND_MOON_CLOUD'],
    CLOUD: ['STATUS_ICON_COND_CLOUD'], FOG: ['STATUS_ICON_COND_FOG'], HAZE: ['STATUS_ICON_COND_HAZE'],
    DRIZZLE: ['STATUS_ICON_COND_DRIZZLE'], RAIN: ['STATUS_ICON_COND_RAIN'], HEAVY_RAIN: [],
    SLEET: ['STATUS_ICON_COND_SLEET'], SNOW: ['STATUS_ICON_COND_SNOW'], HAIL: ['STATUS_ICON_COND_HAIL'],
    THUNDER: ['STATUS_ICON_COND_THUNDER'],
    TEMP: ['STATUS_ICON_TEMP'], DEW: ['STATUS_ICON_DEWPOINT'], UV: ['STATUS_ICON_UV'],
    WIND: ['STATUS_ICON_WIND', 'STATUS_ICON_COND_WIND'], GUST: ['STATUS_ICON_GUST'], AQI: ['STATUS_ICON_AQI'],
    POLLEN: ['STATUS_ICON_POLLEN'], COUNTDOWN: ['STATUS_ICON_COUNTDOWN'],
    PHONE_BATTERY: ['STATUS_ICON_PHONE_BATTERY'], PHONE_BATTERY_CHG: ['STATUS_ICON_PHONE_BATTERY_CHG'],
    STEPS: ['STATUS_ICON_STEPS'], DISTANCE: ['STATUS_ICON_DISTANCE'], SLEEP: ['STATUS_ICON_SLEEP'],
    HEART: ['STATUS_ICON_HR'],
    QUIET: ['STATUS_ROW_ICON_QUIET'], BT: ['STATUS_ROW_ICON_BT'], BT_OFF: ['STATUS_ROW_ICON_BT_OFF'],
};
// The rain alert's buckets (status_on_demand.c item_key, OD_RAIN): light, rain, heavy.
const RAIN_BUCKETS = [[1, 'DRIZZLE'], [2, 'RAIN'], [3, 'HEAVY_RAIN']];
// The watches each platform's resources go to.
const TARGETS = { basalt: ['basalt', 'diorite', 'flint'], emery: ['emery'] };
// The header's watch families (one table each): the Pebble Time 2, the black and white 144 px
// watches (PBL_BW: diorite, flint), and the colour one (basalt). A platform's drawing goes to
// each of its families; a smoothed version to its colour watches alone.
const FAMILIES = { basalt: ['basalt', 'bw'], emery: ['emery'] };
const COLOUR_TARGETS = { basalt: ['basalt'], emery: ['emery'] };

/**
 * The set pixels of '#'/'.' rows, moved so the ink starts at (0, 0).
 * @param {!Array<string>} lines The drawing's rows.
 * @returns {!Array<!Array<number>>} [x, y] of each set pixel; empty for a blank drawing.
 */
function inkPixels(lines) {
    const px = [];
    lines.forEach((s, y) => { for (let x = 0; x < s.length; x++) if (s[x] === '#') px.push([x, y]); });
    if (!px.length) return px;
    const x0 = Math.min(...px.map(p => p[0])), y0 = Math.min(...px.map(p => p[1]));
    return px.map(([x, y]) => [x - x0, y - y0]);
}

/**
 * The pixels as runs: level, upright and 45-degree lines through lit pixels only, chosen greedily
 * (the run that covers the most pixels not yet drawn first), so drawing every run lights exactly
 * these pixels. A pixel no run of two reaches is a dot (both ends the same).
 * @param {!Array<!Array<number>>} px [x, y] of each lit pixel.
 * @returns {!Array<!Array<!Array<number>>>} [[x0, y0], [x1, y1]] per run.
 */
function runs(px) {
    const lit = new Set(px.map(([x, y]) => x + ',' + y));
    const todo = new Set(lit);
    const has = (x, y) => lit.has(x + ',' + y);
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const order = px.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const out = [];
    while (todo.size) {
        let best = null;
        for (const [x, y] of order) {
            if (!todo.has(x + ',' + y)) continue;
            for (const [dx, dy] of dirs) {
                let ax = x, ay = y, bx = x, by = y;
                while (has(ax - dx, ay - dy)) { ax -= dx; ay -= dy; }
                while (has(bx + dx, by + dy)) { bx += dx; by += dy; }
                const len = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) + 1;
                let gain = 0;
                for (let i = 0; i < len; i++) if (todo.has((ax + i * dx) + ',' + (ay + i * dy))) gain++;
                if (!best || gain > best.gain || (gain === best.gain && len > best.len)) {
                    best = { gain, len, ax, ay, dx, dy };
                }
            }
        }
        for (let i = 0; i < best.len; i++) todo.delete((best.ax + i * best.dx) + ',' + (best.ay + i * best.dy));
        out.push([[best.ax, best.ay], [best.ax + (best.len - 1) * best.dx, best.ay + (best.len - 1) * best.dy]]);
    }
    return out;
}

/**
 * The runs joined end to end into open paths: a run that starts where another ends continues it,
 * so the image holds fewer commands (9 bytes each, plus 4 per point) and costs the watch less heap.
 * The pixels stay the same: a path is drawn as its runs, one after another.
 * @param {!Array<!Array<!Array<number>>>} segs runs() of the drawing.
 * @returns {!Array<!Array<!Array<number>>>} The paths' points, [x, y] each.
 */
function paths(segs) {
    const key = (p) => p[0] + ',' + p[1];
    const at = {};
    segs.forEach((s, i) => s.forEach(p => { (at[key(p)] = at[key(p)] || []).push(i); }));
    const used = segs.map(() => false);
    const out = [];
    segs.forEach((seg, i) => {
        if (used[i]) return;
        used[i] = true;
        const pts = seg.slice();
        for (const tail of [true, false]) {
            for (;;) {
                const end = tail ? pts[pts.length - 1] : pts[0];
                const j = at[key(end)].find(q => !used[q]);
                if (j === undefined) break;
                used[j] = true;
                const next = key(segs[j][0]) === key(end) ? segs[j][1] : segs[j][0];
                if (tail) pts.push(next); else pts.unshift(next);
            }
        }
        out.push(pts);
    });
    return out;
}

/**
 * A PDC image of 1 px open precise paths through pixel centres (svg2pdc.py's layout).
 * @param {!Array<!Array<!Array<number>>>} lines The paths' points, [x, y] each (paths()).
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
            b.writeInt16LE(x * PU + PU / 2, 9 + 4 * k);
            b.writeInt16LE(y * PU + PU / 2, 11 + 4 * k);
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
 * Every file this generator owns, as {path: Buffer|string}.
 * @param {!Object=} doc resources/pixel-icons.json's content; the file by default.
 * @returns {!Object<string, (!Buffer|string)>} The files' content by absolute path.
 */
function outputs(doc = JSON.parse(fs.readFileSync(PIXELS, 'utf8'))) {
    const files = {};
    const media = [];
    const table = [];        // [icon id, rows, resource, platforms]
    const rainTable = [];    // [bucket, rows, resource, platforms]
    const masks = {};        // aplite: KEY -> {rows: [uint16], w}
    for (const key of Object.keys(doc.icons)) {
        if (!ICON_IDS[key]) throw new Error('unknown icon ' + key);
        const sizes = doc.icons[key].sizes;
        for (const id of Object.keys(sizes).sort((a, b) => (a === 'A') - (b === 'A') || Number(a) - Number(b))) {
            const s = sizes[id];
            // A Pebble Classic/Steel mask kept as 3.1.1 drew it ('mask': its rows and width, blank
            // columns included), so the text beside it sits where it did.
            if (id === 'A' && s.mask) {
                masks[key] = { rows: s.mask.rows.slice(), w: s.mask.w };
                continue;
            }
            const px = inkPixels(s.pixels);
            if (!px.length) continue;
            const w = Math.max(...px.map(p => p[0])) + 1, h = Math.max(...px.map(p => p[1])) + 1;
            if (id === 'A') {
                if (w > 16) throw new Error(key + ': the Pebble Classic/Steel mask is wider than 16 px');
                const rows = [];
                for (let y = 0; y < h; y++) {
                    let bits = 0;
                    px.forEach(([x, py]) => { if (py === y) bits |= 1 << x; });
                    rows.push(bits);
                }
                masks[key] = { rows, w };
                continue;
            }
            // The size is the painted height the watch looks it up by; the image is the ink alone
            // (a drawing may leave its top or bottom row blank), seated by its ink as the editor
            // seats it.
            const rows = Number(id);
            const plats = s.platforms || ['basalt', 'emery'];
            if (!plats.length) continue;   // a size no watch draws any more
            const version = s.version || 'pixel';
            if (!variants.VERSIONS.includes(version)) throw new Error(key + ' ' + id + ': unknown version ' + version);
            const name = 'PX_' + key + '_' + id;
            const pixel = pdc(paths(runs(px)), w, h);
            // [resource name, its file's content, its watches, its header families]
            const drawn = [];
            if (version === 'pixel') {
                drawn.push([name, pixel, [].concat(...plats.map(p => TARGETS[p] || [])),
                    [].concat(...plats.map(p => FAMILIES[p] || []))]);
            } else if (version === 'old') {
                // The old icon goes to the black and white watches too: they drew it before the
                // pixel drawings, unsmoothed, exactly as these lines draw there.
                const v = variants.versionLines(version, px, s[version]);
                drawn.push([name, variants.pdc(v.lines, v.w, v.h), [].concat(...plats.map(p => TARGETS[p] || [])),
                    [].concat(...plats.map(p => FAMILIES[p] || []))]);
            } else {
                const v = variants.versionLines(version, px, s[version]);
                drawn.push([name, variants.pdc(v.lines, v.w, v.h), [].concat(...plats.map(p => COLOUR_TARGETS[p] || [])),
                    plats.filter(p => FAMILIES[p])]);
                if (plats.includes('basalt')) {
                    drawn.push([name + '_BW', pixel, TARGETS.basalt.filter(t => !COLOUR_TARGETS.basalt.includes(t)), ['bw']]);
                }
            }
            for (const [res, buf, targets, fams] of drawn) {
                files[path.join(DATA_DIR, res + '.pdc')] = buf;
                media.push({ type: 'raw', name: res, file: 'data/' + res + '.pdc', targetPlatforms: targets.sort() });
                ICON_IDS[key].forEach(icon => table.push([icon, rows, 'RESOURCE_ID_' + res, fams]));
                RAIN_BUCKETS.forEach(([bucket, k]) => {
                    if (k === key) rainTable.push([bucket, rows, 'RESOURCE_ID_' + res, fams]);
                });
            }
        }
    }
    // package.template.json: the drawings' resources after every other one, in a fixed order.
    const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
    const res = pkg.pebble.resources;
    res.media = res.media.filter(m => !/^PX_/.test(m.name)).concat(media);
    files[PACKAGE] = JSON.stringify(pkg, null, 2) + '\n';
    files[HEADER] = header(table, rainTable);
    files[APLITE_C] = apliteSource(masks);
    files[PAGE_PIXELS] = pagePixels(doc);
    return files;
}

/**
 * condition-pixels.generated.js: each weather condition icon's pixel drawing at PAGE_ROWS rows,
 * the ink alone, a row per number with bit x for column x, for the settings page's list of the
 * conditions (blocks.js conditionList). ES5, for the page.
 * @param {!Object} doc resources/pixel-icons.json's content.
 * @returns {string} The file.
 */
function pagePixels(doc) {
    const keys = Object.keys(ICON_IDS).filter(k => ICON_IDS[k].some(id => /^STATUS_ICON_COND_/.test(id)));
    // An icon without a drawing at that size (or a blank one) is left out: the page draws its
    // row without an icon.
    const lines = keys.filter((key) => {
        const s = doc.icons[key] && doc.icons[key].sizes[PAGE_ROWS];
        return Boolean(s && inkPixels(s.pixels).length);
    }).map((key) => {
        const px = inkPixels(doc.icons[key].sizes[PAGE_ROWS].pixels);
        const w = Math.max(...px.map(p => p[0])) + 1, h = Math.max(...px.map(p => p[1])) + 1;
        const rows = [];
        for (let y = 0; y < h; y++) rows.push(px.filter(p => p[1] === y).reduce((m, p) => m | (1 << p[0]), 0));
        return '        ' + key + ': {w: ' + w + ', rows: [' + rows.join(', ') + ']}';
    });
    return [
        '// GENERATED by scripts/pixel-icons/gen_watch_icons.js from resources/pixel-icons.json: do not',
        '// edit. The weather condition icons as the watch draws them at ' + PAGE_ROWS + ' px, the ink alone, a',
        '// row per number (bit x lights column x), for the condition slot\'s list of conditions on the',
        '// settings page (blocks.js conditionList).',
        '(function () {',
        '    var PIXELS = {',
        lines.join(',\n'),
        '    };',
        "    if (typeof module !== 'undefined' && module.exports) { module.exports = PIXELS; }",
        "    if (typeof window !== 'undefined') { window.ConditionPixels = PIXELS; }",
        '})();',
        '',
    ].join('\n');
}

/**
 * status_pixel_icons.generated.h: the drawings each watch family looks up. Each family lists only
 * its own, since a resource is built for the watches that draw that size and another family's
 * resource id does not exist there.
 * @param {!Array<!Array>} table [icon id, rows, resource, families] per icon drawing; families
 *     of 'emery', 'basalt' (the colour 144 px watch) and 'bw' (the black and white ones).
 * @param {!Array<!Array>} rainTable [bucket, rows, resource, families] per rain alert drawing.
 * @returns {string} The header.
 */
function header(table, rainTable) {
    const section = (plat) => {
        const mine = (t) => t.filter(e => e[3].includes(plat));
        const rows = (t) => t.length
            ? t.map(([a, b, c]) => '    { ' + a + ', ' + b + ', PX_RES(' + c.replace(/^RESOURCE_ID_/, '') + ') },').join('\n')
            : '    { 0, 0, 0 },   // none yet';
        const icons = mine(table), rain = mine(rainTable);
        return `#define STATUS_PIXEL_ICON_COUNT ${icons.length}
static const StatusPixelIcon s_status_pixel_icons[] = {
${rows(icons)}
};
#define STATUS_PIXEL_RAIN_COUNT ${rain.length}
static const StatusPixelIcon s_status_pixel_rain[] = {
${rows(rain)}
};`;
    };
    return `// GENERATED by scripts/pixel-icons/gen_watch_icons.js from resources/pixel-icons.json: do not
// edit. The status icons drawn pixel by pixel (scripts/pixel-icons/README.md): the drawing each
// icon id uses at each painted height, drawn 1:1 by status_row_icons.c (status_icon_size.h picks
// the height). s_status_pixel_rain: the rain alert's drawings by bucket (1 light, 2 rain, 3 heavy):
// Drizzle, Rain and Heavy rain. Included by status_row_icons.c alone, and by the host test
// test/c/status_icon_drawings_test.c, which defines PX_RES itself.
#pragma once
#include "status_icon_size.h"

#ifndef PX_RES
#define PX_RES(name) RESOURCE_ID_##name
#endif

#if defined(PBL_PLATFORM_EMERY)
// emery: the Pebble Time 2's sizes (13, 15 and 17 rows for a weather icon).
${section('emery')}
#elif defined(PBL_BW)
// The black and white watches (Pebble 2, Pebble 2 Duo): every size's pixel drawing, as they have
// no grey pixels to smooth a slanted line with.
${section('bw')}
#else
${section('basalt')}
#endif
`;
}

/**
 * status_row_aplite.c with the icons' masks (and their sizes) written in. A mask is its ink
 * and nothing more, as the editor's preview shows it.
 * @param {!Object<string, {rows: !Array<number>, w: number}>} masks By icon key.
 * @param {string=} src The file's text; the file by default.
 * @returns {string} The file's new text.
 */
function apliteSource(masks, src = fs.readFileSync(APLITE_C, 'utf8')) {
    for (const key of Object.keys(masks).sort()) {
        const { rows, w } = masks[key];
        const hex = rows.map(v => '0x' + v.toString(16).padStart(3, '0')).join(',');
        const arr = new RegExp('(static const uint16_t MASK_' + key + '\\[\\]\\s*=\\s*)\\{[^}]*\\}');
        if (!arr.test(src)) throw new Error('no MASK_' + key + ' in status_row_aplite.c');
        src = src.replace(arr, '$1{' + hex + '}');
        const dims = new RegExp('(\\{ MASK_' + key + ',)(\\s*\\d+),(\\s*\\d+)( \\})');
        if (!dims.test(src)) throw new Error('no StatusMask for MASK_' + key);
        // Each number as wide as the one it replaces, spaces included, so the table's columns
        // stay aligned ({ MASK_TEMP,   13,  7 }) and a second run writes the same file.
        const fit = (v, old) => ' ' + String(v).padStart(old.length - 1);
        src = src.replace(dims, (_, head, r, c, tail) => head + fit(rows.length, r) + ',' + fit(w, c) + tail);
    }
    return src;
}

/**
 * Write the files, or with --check exit 1 when one of them is stale.
 * @returns {void}
 */
function main() {
    const check = process.argv.includes('--check');
    const files = outputs();
    // Drawings no longer built (a size or an icon taken out of the file) leave resources/data.
    const stale = fs.readdirSync(DATA_DIR).filter(f => /^PX_.*\.pdc$/.test(f))
        .map(f => path.join(DATA_DIR, f)).filter(f => !(f in files));
    const changed = Object.keys(files).filter(f => !fs.existsSync(f)
        || !Buffer.from(files[f]).equals(fs.readFileSync(f)));
    if (check) {
        const all = changed.concat(stale).map(f => path.relative(ROOT, f));
        if (all.length) {
            console.error('Stale, run node scripts/pixel-icons/gen_watch_icons.js:\n  ' + all.join('\n  '));
            process.exit(1);
        }
        return;
    }
    changed.forEach(f => fs.writeFileSync(f, files[f]));
    stale.forEach(f => fs.unlinkSync(f));
    const n = Object.keys(files).filter(f => f.endsWith('.pdc')).length;
    console.log('pixel icons: ' + n + ' drawings; wrote ' + changed.length + ' files, removed ' + stale.length);
}

if (require.main === module) main();
module.exports = { outputs, header, apliteSource, pagePixels, runs, paths, pdc, inkPixels, ICON_IDS, TARGETS,
    PACKAGE, HEADER, APLITE_C, PAGE_PIXELS, DATA_DIR };
