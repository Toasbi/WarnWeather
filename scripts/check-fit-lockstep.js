#!/usr/bin/env node
// Lockstep between the watch's layout engine and the phone's fit check. Reads the lines
// test/c/fit_lockstep_dump.c prints — each custom shape laid out by src/c/windows/layout.c
// in one data state — and checks src/pkjs/view-cycle.js agrees on every one:
//   N <need>  stackNeed of the phone-resolved view (resolveForFit) equals the watch's height;
//   F <0|1>   a fill band: the phone's verdict (need <= avail) equals whether the watch's fill
//             band kept its floor;
//   C <need>  the watch reached the floor: the phone never budgets less than it placed.
//   R ...     every band where the watch placed it equals view-cycle.js stackLayout's band,
//             which the settings page draws its pictures of the watch on (the clock's ink as
//             the dump's metrics give it).
// Run by scripts/test-c.sh for both screen families; any disagreement fails the build, so the
// editor's size pickers can never promise a fit the watch does not deliver (or refuse one it
// does), and the page never draws a band where the watch does not.
'use strict';
const fs = require('fs');
const vc = require('../src/pkjs/view-cycle.js');

const MIN_LINES = 40000;   // both families; a truncated or empty dump must not pass
const MIN_RECTS = 40000;
// The clock ink test/c/fit_lockstep_dump.c lays the views out with (its LayoutMetrics).
const INK = [{ centreOff: 0, inkH: 35 }, { centreOff: 2, inkH: 46 }];
const BANDS = ['T', 'C', 'A', 'B', 'G'];
const lines = fs.readFileSync(process.argv[2] || 0, 'utf8').trim().split('\n');
let bad = 0;
const counts = { N: 0, F: 0, C: 0, R: 0 };
for (const line of lines) {
  const f = line.split(' ');
  const [family, wire, ext, hr, hh] = f.slice(0, 5).map(Number);
  const kind = f[5];
  counts[kind] = (counts[kind] || 0) + 1;
  const spec = vc.resolveForFit(vc.unpackWire(wire + ext * 65536), hr === 1, hh === 1);
  let ok, got;
  if (kind === 'R') {
    const lay = vc.stackLayout(spec, family, INK[family]);
    const at = {};
    lay.bands.forEach((b) => { at[b.band] = b.y + ',' + b.h; });
    got = BANDS.map((b) => at[b] || '-').join(' ');
    ok = got === f.slice(7).join(' ') && Number(f[6]) === (spec.align || 0);
  } else {
    const value = Number(f[6]);
    const n = vc.stackNeed(spec, family);
    got = 'stackNeed ' + n.need + ' of ' + n.avail;
    if (kind === 'N') { ok = n.need === value; } else if (kind === 'F') { ok = (n.need <= n.avail) === (value === 1); } else { ok = n.need >= value; }
  }
  if (!ok) {
    if (bad < 15) { console.log('MISMATCH ' + line + ' → ' + got + ' ' + JSON.stringify(spec)); }
    bad++;
  }
}
if (bad) {
  console.log(bad + ' of ' + lines.length + ' shape states disagree');
  process.exit(1);
}
if (lines.length - counts.R < MIN_LINES || counts.R < MIN_RECTS) {
  console.log('fit lockstep: only ' + (lines.length - counts.R) + ' fit lines and ' + counts.R
    + ' placements (expected >= ' + MIN_LINES + ' and ' + MIN_RECTS + ')');
  process.exit(1);
}
console.log('fit lockstep OK (' + (lines.length - counts.R) + ' shape states: ' + counts.N + ' exact, '
  + counts.F + ' fill verdicts, ' + counts.C + ' at the floor; ' + counts.R + ' placements)');
