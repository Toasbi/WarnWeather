#!/usr/bin/env node
/**
 * Holds the status icon sizes the watch asks for to the sizes the icon scripts make drawings at,
 * both ways (scripts/pixel-icons/README.md):
 *
 *   - the watch's: `test/c/status_icon_drawings_test.c --sizes`, which prints the painted height
 *     status_icon_size.h gives every drawn icon id at every bar, per family (the rain alert's
 *     buckets by their glyphs' ids, status_rain_glyph);
 *   - the scripts': `scripts/pixel-icons/watch_icons.py manifest`, the sizes the icon creator
 *     draws and gen_watch_icons.js builds, per platform.
 *
 * A size the watch asks for with no drawing made draws the icon a size smaller; a drawing made
 * at a size the watch never asks for is a resource every watch of that family carries for
 * nothing. Run by scripts/test-c.sh:
 *
 *   node scripts/check-icon-sizes.js build/host/icon_sizes.txt
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const gen = require('./pixel-icons/gen_watch_icons.js');

/**
 * The watch's sizes, by family and drawing.
 * @param {string} text The --sizes lines: "<family> <icon id> <rows>".
 * @param {!Object<string, string>} idToKey The drawing (catalogue key) each icon id takes.
 * @returns {!Object<string, !Object<string, !Set<number>>>} family -> key -> rows.
 */
function watchSizes(text, idToKey) {
    const out = {};
    text.split('\n').filter((l) => l.trim()).forEach((line) => {
        const [family, name, rows] = line.trim().split(/\s+/);
        const key = idToKey[name];
        if (!key) throw new Error('no drawing for ' + name + ' (' + line + ')');
        ((out[family] = out[family] || {})[key] = out[family][key] || new Set()).add(Number(rows));
    });
    return out;
}

/**
 * The scripts' sizes, by platform and drawing: every bar the manifest lists for a size. The
 * Pebble Classic and Steel masks are left out: they are no drawings the tables look up.
 * @param {{icons: !Array<{id: string, sizes: !Array<{rows: number, key: (string|undefined), uses: !Array<{platform: string}>}>}>}} manifest
 * @returns {!Object<string, !Object<string, !Set<number>>>} platform -> key -> rows.
 */
function scriptSizes(manifest) {
    const out = {};
    manifest.icons.forEach((icon) => icon.sizes.forEach((size) => {
        if (size.key && size.key !== String(size.rows)) return;
        size.uses.forEach((use) => {
            ((out[use.platform] = out[use.platform] || {})[icon.id] = out[use.platform][icon.id] || new Set()).add(size.rows);
        });
    }));
    return out;
}

/**
 * Where the two disagree, a line each; none when they agree.
 * @param {!Object<string, !Object<string, !Set<number>>>} watch watchSizes().
 * @param {!Object<string, !Object<string, !Set<number>>>} scripts scriptSizes().
 * @returns {!Array<string>} The differences.
 */
function compare(watch, scripts) {
    const out = [];
    Object.keys(watch).sort().forEach((family) => {
        const asked = watch[family];
        const made = scripts[family] || {};
        [...new Set([...Object.keys(asked), ...Object.keys(made)])].sort().forEach((key) => {
            const a = asked[key] || new Set();
            const m = made[key] || new Set();
            [...a].filter((r) => !m.has(r)).sort((x, y) => x - y).forEach((r) => {
                out.push(family + ' ' + key + ': the watch asks for ' + r + ' rows, and no drawing is made at it');
            });
            [...m].filter((r) => !a.has(r)).sort((x, y) => x - y).forEach((r) => {
                out.push(family + ' ' + key + ': a drawing is made at ' + r + ' rows, which the watch never asks for');
            });
        });
    });
    return out;
}

function main() {
    const file = process.argv[2];
    if (!file) throw new Error('usage: check-icon-sizes.js <the --sizes output>');
    const idToKey = {};
    Object.entries(gen.ICON_IDS).forEach(([key, ids]) => ids.forEach((id) => { idToKey[id] = key; }));
    const manifest = JSON.parse(execFileSync('python3', [path.join(ROOT, 'scripts', 'pixel-icons', 'watch_icons.py'), 'manifest']).toString());
    const diffs = compare(watchSizes(fs.readFileSync(file, 'utf8'), idToKey), scriptSizes(manifest));
    if (diffs.length) {
        console.error('The icon sizes the watch asks for and the ones drawn disagree:\n  ' + diffs.join('\n  '));
        process.exit(1);
    }
    console.log('icon sizes: the watch and the drawings agree');
}

if (require.main === module) main();
module.exports = { watchSizes, scriptSizes, compare };
