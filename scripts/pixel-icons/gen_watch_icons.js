#!/usr/bin/env node
/**
 * Build the status icons' pixel drawings into the watch (README.md in this folder).
 *
 *   node scripts/pixel-icons/gen_watch_icons.js           write the files below
 *   node scripts/pixel-icons/gen_watch_icons.js --check   exit 1 if any of them is stale
 *
 * From resources/pixel-icons.json, for every icon, one drawing per watch family and box (a size
 * keyed `<family>-<box>`: basalt for the 144 px watches, emery for the Pebble Time 2; the box is
 * the rows a bar's icon height paints). A drawing is its box: the watch centres it on the text, so
 * its blank rows above and below its ink are its seat, and how tall its ink is, its size.
 *   resources/data/PX_<KEY>_<FAMILY>_<box>.pdc   each drawing in its version (VERSIONS): by
 *                                        default the pixel drawing as 1 px lines through pixel
 *                                        centres (level, upright and 45-degree runs and single
 *                                        dots, in as few bytes as pixel-paths.js finds), which the
 *                                        watch draws exactly, smoothing on or off; or 3.1.1's icon
 *                                        scaled the old way (old), or a drawing in lines (drawing),
 *                                        by their kept lines, written as their pixels where those
 *                                        light exact pixels; its view box as tall as the drawing's
 *                                        box, as wide as its ink; with its faded pixels
 *                                        (FADED_STROKE), which the colour watches shade between the
 *                                        ink and what is behind it;
 *   resources/data/PX_<KEY>_<FAMILY>_<box>_BW.pdc   the drawing for the black and white watches
 *                                        (Pebble 2, Pebble 2 Duo), where theirs differs: without its
 *                                        faded pixels, which they cannot shade, and a line
 *                                        drawing's pixels, as they have no grey pixels to smooth
 *                                        its lines with;
 *   package.template.json                one raw resource per drawing, on its family's watches;
 *   src/c/layers/status_pixel_icons.generated.h   which drawing each icon id uses at each box
 *                                        (the rain alert's too: status_rain_glyph);
 *   src/c/layers/status_row_aplite.c     the Pebble Classic/Steel bit mask, when the icon has one;
 *   src/pkjs/settings/status-pixels.generated.js   every drawing's pixels, in its box, for the
 *                                        settings page's pictures of the watch (its labels draw
 *                                        outlines: src/pkjs/page/weather/condition-icons.js).
 * The watch draws nothing else: an icon id without a drawing is text only, and a box without one
 * takes the icon's next smaller drawing (status_icon_size.h).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { commands, classesOf, exactPixels } = require('./pixel-paths.js');

const ROOT = path.resolve(__dirname, '..', '..');
const PIXELS = path.join(ROOT, 'resources', 'pixel-icons.json');
const DATA_DIR = path.join(ROOT, 'resources', 'data');
const PACKAGE = path.join(ROOT, 'package.template.json');
const HEADER = path.join(ROOT, 'src', 'c', 'layers', 'status_pixel_icons.generated.h');
const APLITE_C = path.join(ROOT, 'src', 'c', 'layers', 'status_row_aplite.c');
const PAGE_PIXELS = path.join(ROOT, 'src', 'pkjs', 'settings', 'status-pixels.generated.js');
// A size's key: its watch family and box, or A for the Pebble Classic and Steel mask.
const SIZE_KEY = /^(basalt|emery)-(\d+)$/;
// The tallest Pebble Classic and Steel mask ink the 14 px text's band draws uncut, and the
// tallest box, its blank rows seating the ink.
const MASK_INK_ROWS = 13;
const MASK_BOX_ROWS = 17;
// The versions a size is built in: its pixel drawing; 3.1.1's icon scaled the old way (old), which
// the black and white watches draw too, as they did before the pixel drawings; or a drawing in
// lines (drawing). The last two keep their lines in the file, under their name.
const VERSIONS = ['pixel', 'old', 'drawing'];
const PU = 8;
// A faded pixel's stroke, by its thirds of the ink. A faded pixel is a 1 px line or dot whose fill
// marks it: a colour with no alpha, which draws nothing, its thirds in the low two bits (0x01,
// 0x02; src/c/layers/faded_pixel.h). Its stroke is the shade the dark theme draws it in, as the
// drawing's own are its white ink; the watch paints both for its theme and for what is behind the
// icon. A pixel drawing's commands come in the order that costs least (pixel-paths.js); a kept
// drawing with a sloped line has its faded pixels after its lines, which they go over.
const FADED_STROKE = { 1: 0xD5, 2: 0xEA };   // GColorDarkGray, GColorLightGray

// The icon catalogue: the watch's icon ids each drawing serves
// (status_line.h, status_row_icons.h), by the icon's key.
const ICONS_JSON = path.join(__dirname, 'icons.json');
const ICON_IDS = Object.fromEntries(JSON.parse(fs.readFileSync(ICONS_JSON, 'utf8')).icons.map((i) => [i.key, i.ids]));
// The watches each platform's resources go to.
const TARGETS = { basalt: ['basalt', 'diorite', 'flint'], emery: ['emery'] };
// The header's watch families (one table each): the Pebble Time 2, the black and white 144 px
// watches (PBL_BW: diorite, flint), and the colour one (basalt). A platform's drawing goes to
// each of its families; where the black and white watches draw it otherwise, to its colour
// watches alone, and theirs (_BW) to them.
const FAMILIES = { basalt: ['basalt', 'bw'], emery: ['emery'] };
const COLOUR_TARGETS = { basalt: ['basalt'], emery: ['emery'] };

/**
 * The set pixels of '#'/'.' rows, moved so the ink starts at (0, 0).
 * @param {!Array<string>} lines The drawing's rows.
 * @returns {!Array<!Array<number>>} [x, y] of each set pixel; empty for a blank drawing.
 */
function inkPixels(lines) {
    const px = boxPixels(lines);
    if (!px.length) return px;
    const y0 = Math.min(...px.map(p => p[1]));
    return px.map(([x, y]) => [x, y - y0]);
}

/**
 * The set pixels of '#'/'.' rows in the drawing's box: moved left so the ink starts at column 0,
 * its rows as they are, so the blank rows above and below the ink stay its seat.
 * @param {!Array<string>} lines The drawing's rows.
 * @returns {!Array<!Array<number>>} [x, y] of each set pixel; empty for a blank drawing.
 */
function boxPixels(lines) {
    const px = [];
    lines.forEach((s, y) => { for (let x = 0; x < s.length; x++) if (s[x] === '#') px.push([x, y]); });
    if (!px.length) return px;
    const x0 = Math.min(...px.map(p => p[0]));
    return px.map(([x, y]) => [x - x0, y]);
}

/**
 * A drawing's rows as numbers, bit x lighting column x.
 * @param {!Array<!Array<number>>} px Its lit pixels, [x, y] (boxPixels).
 * @param {number} h Its rows.
 * @returns {!Array<number>}
 */
function rowBits(px, h) {
    const rows = new Array(h).fill(0);
    px.forEach(([x, y]) => { rows[y] |= 1 << x; });
    return rows;
}

/**
 * A size's kept lines (an old or drawing version's), a dot as a line of one point twice.
 * @param {string} version 'old' or 'drawing'.
 * @param {?{lines: !Array<!Array<!Array<number>>>, w: number, h: number}} kept The lines the file keeps.
 * @returns {{lines: !Array<!Array<!Array<number>>>, w: number, h: number}}
 */
function keptLines(version, kept) {
    if (!kept) throw new Error('no ' + version + ' version for this size');
    return { lines: kept.lines.map((p) => (p.length === 1 ? [p[0], p[0]] : p)), w: kept.w, h: kept.h };
}

/**
 * A size's kept lines, in the same box as its pixels: the box seats both alike.
 * @param {string} where The icon and size, for the error.
 * @param {string} version 'old' or 'drawing'.
 * @param {!Object} s The size's entry.
 * @returns {{lines: !Array<!Array<!Array<number>>>, w: number, h: number}}
 */
function keptInBox(where, version, s) {
    const v = keptLines(version, s[version]);
    if (v.h !== s.pixels.length) throw new Error(where + ': its ' + version + ' lines are ' + v.h + ' rows tall, its box ' + s.pixels.length);
    return v;
}

/**
 * A size's faded pixels in its drawing's view box. The file keeps them as rows over the ink the
 * colour watches draw, its kept lines' or else its pixels', and a pixel round it, where the
 * creator works them out: '1' a third of the ink, '2' two thirds, '.' none.
 * @param {string} where The icon and size, for the error.
 * @param {*} faded The size's `faded` rows; none when undefined.
 * @param {!Array<!Array<number>>} ink The colour watches' ink in the view box: the pixels, or the
 *     kept lines' points, [x, y] each.
 * @returns {!Array<!Array<number>>} [x, y, thirds] each, in the view box.
 */
function fadedInBox(where, faded, ink) {
    if (faded === undefined) return [];
    const xs = ink.map(p => p[0]), ys = ink.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
    if (!Array.isArray(faded) || faded.length !== h + 2
        || !faded.every(r => typeof r === 'string' && r.length === w + 2 && /^[.12]*$/.test(r))
        || !faded.some(r => /[12]/.test(r))) {
        throw new Error(where + ': faded is ' + (h + 2) + ' rows of ' + (w + 2) + ' of ".", "1" and "2", over its ink and a pixel round it, with a faded pixel');
    }
    const out = [];
    faded.forEach((r, y) => [...r].forEach((c, x) => { if (c !== '.') out.push([x0 + x - 1, y0 + y - 1, Number(c)]); }));
    return out;
}

/**
 * A PDC image of 1 px open precise paths, its points in pixels (on the 1/8 px grid), pixel (x, y)'s
 * centre at (x + 1/2, y + 1/2): the commands in their order, the drawing's own in white ink, a faded
 * pixel's in its shade (FADED_STROKE) and marked by its fill.
 * @param {!Array<{thirds: number, pts: !Array<!Array<number>>}>} cmds The commands: thirds 0 for
 *     the drawing's own, 1 or 2 for a faded pixel's (pixel-paths.js commands()), points [x, y].
 * @param {number} w The image's width in pixels, its view box.
 * @param {number} h Its height.
 * @returns {!Buffer} The .pdc file.
 */
function pdc(cmds, w, h) {
    /**
     * One 1 px open path command.
     * @param {{thirds: number, pts: !Array<!Array<number>>}} cmd Its class and points, in pixels.
     * @returns {!Buffer} The command's bytes.
     */
    const command = ({ thirds, pts }) => {
        const b = Buffer.alloc(9 + 4 * pts.length);
        b.writeUInt8(3, 0);        // precise path
        b.writeUInt8(0, 1);        // not hidden
        b.writeUInt8(thirds ? FADED_STROKE[thirds] : 0xFF, 2);   // stroke colour, painted on load
        b.writeUInt8(1, 3);        // stroke width
        b.writeUInt8(thirds, 4);   // fill: none, or a faded pixel's mark
        b.writeUInt16LE(1, 5);     // open
        b.writeUInt16LE(pts.length, 7);
        pts.forEach(([x, y], k) => {
            b.writeInt16LE(Math.round(x * PU + PU / 2), 9 + 4 * k);
            b.writeInt16LE(Math.round(y * PU + PU / 2), 11 + 4 * k);
        });
        return b;
    };
    const head = Buffer.alloc(8);
    head.writeUInt8(1, 0);         // version
    head.writeUInt8(0, 1);
    head.writeInt16LE(w, 2);
    head.writeInt16LE(h, 4);
    head.writeUInt16LE(cmds.length, 6);
    const body = Buffer.concat([head, ...cmds.map(command)]);
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
    const masks = {};        // aplite: KEY -> {rows: [uint16], w}
    for (const key of Object.keys(doc.icons)) {
        if (!ICON_IDS[key]) throw new Error('unknown icon ' + key);
        const sizes = doc.icons[key].sizes;
        for (const id of Object.keys(sizes).sort()) {
            const s = sizes[id];
            if (id === 'A' && s.faded !== undefined) throw new Error(key + ': the Pebble Classic/Steel mask has no faded pixels');
            // A Pebble Classic/Steel mask kept as 3.1.1 drew it ('mask': its rows and width, blank
            // columns included), so the text beside it sits where it did.
            if (id === 'A' && s.mask) {
                masks[key] = { rows: s.mask.rows.slice(), w: s.mask.w };
                continue;
            }
            const px = boxPixels(s.pixels);
            if (!px.length) continue;
            // As wide as the ink, as tall as the box: the box's blank rows are the seat.
            const w = Math.max(...px.map(p => p[0])) + 1, h = s.pixels.length;
            if (id === 'A') {
                const ink = inkPixels(s.pixels);
                if (w > 16) throw new Error(key + ': the Pebble Classic/Steel mask is wider than 16 px');
                if (Math.max(...ink.map(p => p[1])) + 1 > MASK_INK_ROWS) {
                    throw new Error(key + ': the Pebble Classic/Steel mask\'s ink is taller than ' + MASK_INK_ROWS + ' rows');
                }
                if (h > MASK_BOX_ROWS) throw new Error(key + ': the Pebble Classic/Steel mask\'s box is taller than ' + MASK_BOX_ROWS + ' rows');
                masks[key] = { rows: rowBits(px, h), w };
                continue;
            }
            // The box the watch looks it up by: the rows a bar's icon height paints, on one family.
            const m = SIZE_KEY.exec(id);
            if (!m) throw new Error(key + ' ' + id + ': a size is keyed <basalt|emery>-<box>, or A');
            const plat = m[1], rows = Number(m[2]);
            if (h % 2 !== 1) throw new Error(key + ' ' + id + ': a drawing\'s box has an odd number of rows, centred on the text');
            const version = s.version || 'pixel';
            if (!VERSIONS.includes(version)) throw new Error(key + ' ' + id + ': unknown version ' + version);
            const name = 'PX_' + key + '_' + plat.toUpperCase() + '_' + rows;
            const where = key + ' ' + id;
            // The pixels alone: what the black and white watches draw of a pixel or line drawing.
            const pixels = () => pdc(commands(classesOf(px), where), w, h);
            // The colour watches' drawing: the pixel drawing, its faded pixels among its own in
            // the order that costs least; or the old icon's or the line drawing's kept lines. Lines
            // all level, upright or at 45 degrees light exact pixels, smoothing on or off, and are
            // written as those pixels like a pixel drawing; others stay as they are, their faded
            // pixels after them. The black and white watches' (a family's other watches): the
            // drawing without its faded pixels, which they cannot shade; a line drawing's pixels, as
            // they have no grey pixels to smooth its lines with; the old icon's lines as they drew
            // it before the pixel drawings, unsmoothed, exactly as these lines draw there.
            let colour, bw;
            if (version === 'pixel') {
                colour = pdc(commands(classesOf(px, fadedInBox(where, s.faded, px)), where), w, h);
                bw = pixels;
            } else {
                const v = keptInBox(where, version, s);
                const own = v.lines.map((pts) => ({ thirds: 0, pts }));
                const faded = fadedInBox(where, s.faded, v.lines.flat());
                const lit = exactPixels(v.lines);
                colour = lit ? pdc(commands(classesOf(lit, faded), where), v.w, v.h)
                    : pdc(own.concat(commands(classesOf([], faded), where)), v.w, v.h);
                bw = version !== 'old' ? pixels
                    : () => pdc(lit ? commands(classesOf(lit), where) : own, v.w, v.h);
            }
            const others = TARGETS[plat].filter((t) => !COLOUR_TARGETS[plat].includes(t));
            const theirs = others.length ? bw() : colour;
            // [resource name, its file's content, its watches, its header families]: one file when
            // all the family's watches draw the same, else the colour watches' and theirs (_BW).
            const drawn = colour.equals(theirs)
                ? [[name, colour, TARGETS[plat], FAMILIES[plat]]]
                : [[name, colour, COLOUR_TARGETS[plat], [plat]], [name + '_BW', theirs, others, ['bw']]];
            for (const [res, buf, targets, fams] of drawn) {
                files[path.join(DATA_DIR, res + '.pdc')] = buf;
                media.push({ type: 'raw', name: res, file: 'data/' + res + '.pdc', targetPlatforms: targets.slice().sort() });
                ICON_IDS[key].forEach(icon => table.push([icon, rows, 'RESOURCE_ID_' + res, fams]));
            }
        }
    }
    // package.template.json: the drawings' resources after every other one, in a fixed order.
    const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
    const res = pkg.pebble.resources;
    res.media = res.media.filter(m => !/^PX_/.test(m.name)).concat(media);
    files[PACKAGE] = JSON.stringify(pkg, null, 2) + '\n';
    files[HEADER] = header(table);
    files[APLITE_C] = apliteSource(masks);
    files[PAGE_PIXELS] = pagePixels(doc);
    return files;
}

/**
 * status-pixels.generated.js: every drawing's pixels as the settings page draws them, so its
 * pictures of the watch show what the watch draws: per icon key and size
 * (<family>-<box>, A), the drawing's box as wide as its ink, a row per number (bit x lights
 * column x), its blank rows above and below kept (its seat); and the key each status icon id's
 * drawings are under, by the id's name. ES5, for the page.
 *
 * The page opens as one data: URL that Android caps at 2 MiB (settings-url-budget.test.js), and
 * encodeURIComponent turns every space, comma, colon and bracket into three characters. So each
 * icon's drawings are one string of characters it leaves as they are, which the file unpacks:
 * a field per size id of the file's SIZES list, in its order, split by '~' and empty for a size
 * the icon has no drawing at; each its width, '!' and its rows split by '.', or the field number
 * of an earlier size with the same drawing; the numbers in base 36.
 * @param {!Object} doc resources/pixel-icons.json's content.
 * @returns {string} The file.
 */
function pagePixels(doc) {
    const keys = Object.keys(doc.icons).filter((key) => ICON_IDS[key]);
    const sizeIds = [...new Set(keys.flatMap((key) => Object.keys(doc.icons[key].sizes)))].sort();
    const packed = (w, rows) => w.toString(36) + '!' + rows.map(r => r.toString(36)).join('.');
    const icons = keys.map((key) => {
        const first = {};
        const fields = sizeIds.map((id, n) => {
            const s = doc.icons[key].sizes[id];
            if (!s) return '';
            // A size the Classic keeps as 3.1.1 drew it: its mask, blank columns and all.
            let text;
            if (id === 'A' && s.mask) {
                text = packed(s.mask.w, s.mask.rows);
            } else {
                const px = boxPixels(s.pixels);
                if (!px.length) return '';
                const w = Math.max(...px.map(p => p[0])) + 1;
                text = packed(w, rowBits(px, s.pixels.length));
            }
            if (first[text] !== undefined) return first[text].toString(36);
            first[text] = n;
            return text;
        });
        while (fields.length && !fields[fields.length - 1]) fields.pop();
        return '        ' + key + ": '" + fields.join('~') + "'";
    });
    const ids = [];
    Object.keys(ICON_IDS).forEach((key) => ICON_IDS[key].forEach((id) => ids.push('        ' + id + ": '" + key + "'")));
    return [
        '// GENERATED by scripts/pixel-icons/gen_watch_icons.js from resources/pixel-icons.json: do not',
        '// edit. Every status icon drawing as the watch draws it, for the settings page\'s pictures of',
        '// the watch (pixel-icon.js):',
        '// per icon and size (<family>-<box>, or A for the Classic\'s mask), its box as wide as its ink,',
        '// a row per number (bit x lights column x), the blank rows above and below its ink kept, as',
        '// they seat it; and the icon whose drawings each watch icon id takes.',
        '// Packed into characters a URL carries as they are (the page opens as one data: URL): a',
        '// field per size of SIZES, in its order, split by \'~\' and empty where the icon has no drawing;',
        '// each its width, \'!\' and its rows split by \'.\', or the field number of an earlier size with',
        '// the same drawing; in base 36.',
        '(function () {',
        '    var SIZES = [' + sizeIds.map((id) => "'" + id + "'").join(', ') + '];',
        '    var PACKED = {',
        icons.join(',\n'),
        '    };',
        '    var ICONS = {};',
        '    Object.keys(PACKED).forEach(function (key) {',
        '        var sizes = ICONS[key] = {};',
        "        PACKED[key].split('~').forEach(function (field, n) {",
        '            if (!field) { return; }',
        "            var f = field.split('!');",
        '            sizes[SIZES[n]] = f.length < 2 ? sizes[SIZES[parseInt(f[0], 36)]]',
        "                : {w: parseInt(f[0], 36), rows: f[1].split('.').map(function (r) { return parseInt(r, 36); })};",
        '        });',
        '    });',
        '    var IDS = {',
        ids.join(',\n'),
        '    };',
        '    var api = {icons: ICONS, ids: IDS};',
        "    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }",
        "    if (typeof window !== 'undefined') { window.StatusPixels = api; }",
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
 * @returns {string} The header.
 */
function header(table) {
    const section = (plat) => {
        const mine = (t) => t.filter(e => e[3].includes(plat));
        const rows = (t) => t.length
            ? t.map(([a, b, c]) => '    { ' + a + ', ' + b + ', PX_RES(' + c.replace(/^RESOURCE_ID_/, '') + ') },').join('\n')
            : '    { 0, 0, 0 },   // none yet';
        const icons = mine(table);
        return `#define STATUS_PIXEL_ICON_COUNT ${icons.length}
static const StatusPixelIcon s_status_pixel_icons[] = {
${rows(icons)}
};`;
    };
    return `// GENERATED by scripts/pixel-icons/gen_watch_icons.js from resources/pixel-icons.json: do not
// edit. The status icons drawn pixel by pixel (scripts/pixel-icons/README.md): the drawing each
// icon id uses at each box (the rows a bar's icon height paints), drawn 1:1 by status_row_icons.c
// and centred on the text: a drawing carries its size and seat. The rain alert's buckets take
// theirs by id too (status_rain_glyph). Included by
// status_row_icons.c alone, and by the host test
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
 * status_row_aplite.c with the icons' masks (and their sizes) written in. A mask is as wide as
 * its ink and as tall as its box: its blank rows above and below seat it.
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
module.exports = { outputs, header, apliteSource, pagePixels, pdc, keptLines, fadedInBox, inkPixels, boxPixels, VERSIONS, ICON_IDS, TARGETS, COLOUR_TARGETS,
    SIZE_KEY, PACKAGE, HEADER, APLITE_C, PAGE_PIXELS, DATA_DIR };
