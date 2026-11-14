#!/usr/bin/env node
// Lockstep between the watch's status row layout, the short forms the slots brought swapped
// in, and the settings page's copy. Reads the lines test/c/row_swap_dump.c prints (three
// slots' measures laid out in a row width by src/c/layers/status_row_layout.c
// status_row_swap_short_forms) and checks src/pkjs/settings/preview-watch.js swapShortForms
// swaps the same slots and places every slot where the watch does. Run by scripts/test-c.sh;
// a disagreement fails it, so the Status bars tab's pictures never show a short form where
// the watch draws the whole name, or a slot where the watch doesn't.
'use strict';
const fs = require('fs');
const pw = require('../src/pkjs/settings/preview-watch.js');

const MIN_LINES = 40000;   // a truncated or empty dump must not pass

/**
 * One dump line checked against the page's copy.
 * @param {string} line "<content_w> <slot> <slot> <slot> <swapped> <place> <place> <place>".
 * @returns {?string} What the page gives instead, or null when it agrees.
 */
function check(line) {
  const f = line.trim().split(' ');
  const m = f.slice(1, 4).map((s) => {
    if (s === '-') return null;
    const [iw, tw, sw, aw] = s.split(',').map(Number);
    return { iw, tw, sw, aw };
  });
  const got = pw.swapShortForms(Number(f[0]), m);
  const have = [String(got.swapped)].concat(got.placed.map((p) => (p ? p.x + ',' + p.tw : '-'))).join(' ');
  return have === f.slice(4).join(' ') ? null : have;
}

function main() {
  const lines = fs.readFileSync(process.argv[2] || 0, 'utf8').trim().split('\n');
  if (lines.length < MIN_LINES) {
    console.error('row swap lockstep: ' + lines.length + ' lines, expected at least ' + MIN_LINES);
    process.exit(1);
  }
  const bad = [];
  lines.forEach((line) => {
    const have = check(line);
    if (have !== null) bad.push(line + '\n    page: ' + have);
  });
  if (bad.length) {
    console.error('The settings page lays out ' + bad.length + ' status rows unlike the watch:\n  ' + bad.slice(0, 10).join('\n  '));
    process.exit(1);
  }
  console.log('row swap lockstep: the page lays out ' + lines.length + ' rows as the watch does');
}

if (require.main === module) main();
module.exports = { check };
