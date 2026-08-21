'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'resources', 'data');

// Walk the PDCI container and every command, delegating per-command checks to the
// caller. Returns nothing; asserts structural validity (magic, size field,
// version, viewbox, precise-path type, points inside the viewbox, no trailing).
function walkPdc(file, viewbox, checkCmd) {
  const buf = fs.readFileSync(path.join(DATA, file));
  assert.strictEqual(buf.toString('ascii', 0, 4), 'PDCI', 'magic');
  assert.strictEqual(buf.readUInt32LE(4), buf.length - 8, 'payload size field');
  assert.strictEqual(buf.readUInt8(8), 1, 'version');
  assert.strictEqual(buf.readInt16LE(10), viewbox, 'viewbox width');
  assert.strictEqual(buf.readInt16LE(12), viewbox, 'viewbox height');
  const nCmds = buf.readUInt16LE(14);
  assert.ok(nCmds >= 1 && nCmds <= 12, 'command count sane');

  let off = 16;
  for (let c = 0; c < nCmds; c++) {
    assert.strictEqual(buf.readUInt8(off), 3, 'precise path');
    if (checkCmd) { checkCmd(buf, off); }
    const nPts = buf.readUInt16LE(off + 7);
    off += 9;
    for (let p = 0; p < nPts; p++) {
      const x = buf.readInt16LE(off) / 8;
      const y = buf.readInt16LE(off + 2) / 8;
      assert.ok(x >= 0 && x <= viewbox && y >= 0 && y <= viewbox,
                `point in viewbox (${x},${y})`);
      off += 4;
    }
  }
  assert.strictEqual(off, buf.length, 'no trailing bytes');
}

// 24x24 outline family: all converted from docs/superpowers/svg/*.svg via
// scripts/svg2pdc.py. Stroke-only line-art — status_row_icons.c recolors the stroke to
// theme_fg() and clears the fill, so the authored stroke *colour* is irrelevant; each
// just needs a non-clear stroke and a clear fill. STATUS_POLLEN is wired as a status-row
// resource and is validated here with the rest of the outline family.
//
// The phone-battery pair is TWO glyphs for ONE catalog item: status-lines.js picks
// STATUS_PHONE_BATTERY_CHG over STATUS_PHONE_BATTERY at bake time while the phone is
// charging (icon ids 17 vs 16). The third phone-battery icon id (18,
// STATUS_ICON_PHONE_BATTERY_PLAIN) deliberately has NO resource — it exists only so the
// no-icon variant gets its own threshold kind instead of falling through to City's — so
// there is no third file to validate here.
const OUTLINE_24 = ['STATUS_TEMP.pdc', 'STATUS_TEMP_SMALL.pdc', 'STATUS_UV.pdc',
                    'STATUS_WIND.pdc', 'STATUS_GUST.pdc', 'STATUS_POLLEN.pdc',
                    'STATUS_DISTANCE.pdc', 'STATUS_AQI.pdc',
                    'STATUS_COUNTDOWN.pdc', 'STATUS_DEW.pdc',
                    'STATUS_PHONE_BATTERY.pdc', 'STATUS_PHONE_BATTERY_CHG.pdc'];

for (const file of OUTLINE_24) {
  test(`${file} is a valid 24x24 outline PDCI`, () => {
    walkPdc(file, 24, (buf, off) => {
      assert.notStrictEqual(buf.readUInt8(off + 2), 0x00, 'stroke color set');
      assert.ok(buf.readUInt8(off + 3) >= 1, 'stroke width >= 1');
      assert.strictEqual(buf.readUInt8(off + 4), 0x00, 'fill clear');
    });
  });
}

// 25x25 health family: hand-authored glyphs (heart/sleep/steps). Unlike the outline
// family these mix fill and stroke commands (the render path clears the fill and recolors
// the stroke, so they still read as outlines on the watch). HEALTH_HEART is the plain
// heart glyph, deliberately without the ECG pulse line. Validate the container +
// geometry only — do not assert stroke/fill specifics.
const HEALTH_25 = ['HEALTH_HEART.pdc', 'HEALTH_SLEEP.pdc', 'HEALTH_STEPS.pdc'];

for (const file of HEALTH_25) {
  test(`${file} is a valid 25x25 health PDCI`, () => {
    walkPdc(file, 25, null);
  });
}

// A PDC on disk that nothing declares never reaches the watch, and the failure is
// silent: RESOURCE_ID_<NAME> simply does not exist and the C build breaks, or worse
// the glyph is declared for aplite and quietly eats the frozen image's last bytes.
// aplite is excluded from EVERY PDC in this project — that exclusion is what keeps
// the aplite image at its ceiling — so the platform list is pinned exactly, not
// merely checked for aplite's absence.
const PDC_PLATFORMS = ['basalt', 'diorite', 'emery', 'flint'];
const MEDIA = require('../package.template.json').pebble.resources.media;

for (const file of [...OUTLINE_24, ...HEALTH_25]) {
  test(`${file} is declared in package.template.json, aplite excluded`, () => {
    const name = file.replace(/\.pdc$/, '');
    const entry = MEDIA.find((m) => m.name === name);
    assert.ok(entry, `${name} is not declared in package.template.json's media`);
    assert.strictEqual(entry.type, 'raw', 'PDCs ship as raw resources');
    assert.strictEqual(entry.file, `data/${file}`, 'file path');
    assert.deepStrictEqual(entry.targetPlatforms, PDC_PLATFORMS,
                           'aplite must stay excluded from every PDC');
  });
}

// Corruption guard. PDCs are binary, and the one way this project has actually broken
// them is a text round-trip: an editor (or any tool that opens the file as UTF-8 and
// saves it back) rewrites every byte >= 0x80 — a PDC is full of them, since a stroke
// colour is 0xFF and any coordinate past 15.875 puts a high byte in its fixed-point
// int16. The damage is invisible in review and does not break the build: waf happily
// packs the mangled bytes and the watch draws garbage. Three cheap invariants catch
// every shape of it, and none of them pins the ART, so regenerating a glyph from its
// SVG (or swapping which SVG feeds which name) needs no edit here.
for (const file of [...OUTLINE_24, ...HEALTH_25]) {
  test(`${file} is byte-intact (survived no UTF-8 round-trip)`, () => {
    const buf = fs.readFileSync(path.join(DATA, file));
    // 1. The replacement character: what a decode-as-UTF-8 turns an invalid high byte
    //    into. Its presence is proof, not suspicion.
    assert.strictEqual(buf.indexOf(Buffer.from([0xEF, 0xBF, 0xBD])), -1,
                       'U+FFFD present — this file was saved through a text editor');
    // 2. The header's own checksum-of-sorts. A latin1->UTF-8 re-encode produces valid
    //    two-byte sequences instead of U+FFFD, so it slips past (1) — but it grows the
    //    file, and the payload size field written at authoring time does not follow.
    assert.strictEqual(buf.readUInt32LE(4), buf.length - 8,
                       'declared payload size no longer matches the bytes on disk');
    // 3. Belt and braces for a mangling that somehow balanced out: every glyph in this
    //    project has high bytes, so zero of them means the file is no longer binary.
    let high = 0;
    for (const b of buf) { if (b >= 0x80) { high += 1; } }
    assert.ok(high > 0, 'no bytes >= 0x80 left — this is not the authored binary');
  });
}
