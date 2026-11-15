#!/usr/bin/env node
/**
 * Holds the status icon sizes the watch asks for to the sizes it has drawings at, both ways
 * (scripts/pixel-icons/README.md):
 *
 *   - the watch's: `test/c/status_icon_drawings_test.c --sizes`, which prints the box
 *     status_icon_size.h asks every drawn icon id for at every bar, per family (the rain alert's
 *     buckets by their glyphs' ids, status_rain_glyph);
 *   - the drawings': every size of `resources/pixel-icons.json`, keyed by its family and box, the
 *     drawings gen_watch_icons.js builds.
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
 * The drawn sizes, by watch family and drawing: every size of the drawings file, keyed
 * <family>-<box>. The Pebble Classic and Steel masks (size A) are left out: they are no drawings
 * the tables look up.
 * @param {{icons: !Object<string, {sizes: !Object<string, !Object>}>}} doc resources/pixel-icons.json.
 * @returns {!Object<string, !Object<string, !Set<number>>>} family -> key -> box rows.
 */
function drawnSizes(doc) {
    const out = {};
    Object.keys(doc.icons).forEach((key) => {
        const sizes = doc.icons[key].sizes || {};
        Object.keys(sizes).forEach((id) => {
            const m = gen.SIZE_KEY.exec(id);
            if (!m) return;
            const family = m[1];
            ((out[family] = out[family] || {})[key] = out[family][key] || new Set()).add(Number(m[2]));
        });
    });
    return out;
}

/**
 * Where the two disagree, a line each; none when they agree.
 * @param {!Object<string, !Object<string, !Set<number>>>} watch watchSizes().
 * @param {!Object<string, !Object<string, !Set<number>>>} drawn drawnSizes().
 * @returns {!Array<string>} The differences.
 */
function compare(watch, drawn) {
    const out = [];
    Object.keys(watch).sort().forEach((family) => {
        const asked = watch[family];
        const made = drawn[family] || {};
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
    const drawings = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'pixel-icons.json'), 'utf8'));
    const diffs = compare(watchSizes(fs.readFileSync(file, 'utf8'), idToKey), drawnSizes(drawings));
    if (diffs.length) {
        console.error('The icon sizes the watch asks for and the ones drawn disagree:\n  ' + diffs.join('\n  '));
        process.exit(1);
    }
    console.log('icon sizes: the watch and the drawings agree');
}

if (require.main === module) main();
module.exports = { watchSizes, drawnSizes, compare };
