#!/usr/bin/env node
// Lockstep between the watch's layout engine and the phone's fit check. Reads the lines
// test/c/fit_lockstep_dump.c prints — each custom shape laid out by src/c/windows/layout.c
// in one data state — and checks src/pkjs/view-cycle.js agrees on every one:
//   N <need>  stackNeed of the phone-resolved view (resolveForFit) equals the watch's height;
//   F <0|1>   a fill band: the phone's verdict (need <= avail) equals whether the watch's fill
//             band kept its floor;
//   C <need>  the watch reached the floor: the phone never budgets less than it placed.
// Run by scripts/test-c.sh for both screen families; any disagreement fails the build, so the
// editor's size pickers can never promise a fit the watch does not deliver (or refuse one it
// does).
'use strict';
const fs = require('fs');
const vc = require('../src/pkjs/view-cycle.js');

const MIN_LINES = 40000;   // both families; a truncated or empty dump must not pass
const lines = fs.readFileSync(process.argv[2] || 0, 'utf8').trim().split('\n');
let bad = 0;
const counts = { N: 0, F: 0, C: 0 };
for (const line of lines) {
  const f = line.split(' ');
  const [family, wire, ext, hr, hh] = f.slice(0, 5).map(Number);
  const kind = f[5];
  const value = Number(f[6]);
  counts[kind] = (counts[kind] || 0) + 1;
  const spec = vc.resolveForFit(vc.unpackWire(wire + ext * 65536), hr === 1, hh === 1);
  const n = vc.stackNeed(spec, family);
  let ok;
  if (kind === 'N') { ok = n.need === value; } else if (kind === 'F') { ok = (n.need <= n.avail) === (value === 1); } else { ok = n.need >= value; }
  if (!ok) {
    if (bad < 15) {
      console.log('MISMATCH ' + line + ' → stackNeed ' + n.need + ' of ' + n.avail + ' '
        + JSON.stringify(spec));
    }
    bad++;
  }
}
if (bad) {
  console.log(bad + ' of ' + lines.length + ' shape states disagree');
  process.exit(1);
}
if (lines.length < MIN_LINES) {
  console.log('fit lockstep: only ' + lines.length + ' lines (expected >= ' + MIN_LINES + ')');
  process.exit(1);
}
console.log('fit lockstep OK (' + lines.length + ' shape states: ' + counts.N + ' exact, '
  + counts.F + ' fill verdicts, ' + counts.C + ' at the floor)');
