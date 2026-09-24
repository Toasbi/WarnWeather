#!/usr/bin/env node
// Lockstep between the watch's layout engine and the phone's fit check: reads the lines
// test/c/fit_lockstep_dump.c prints ("<family> <wire> <ext> <need>" — the block height
// src/c/windows/layout.c gives each unclamped custom shape) and checks that
// src/pkjs/view-cycle.js stackNeed measures every one of them the same. Run by
// scripts/test-c.sh for both screen families; any disagreement fails the build, so the
// editor's size pickers can never promise a fit the watch does not deliver (or refuse one
// it does).
'use strict';
const fs = require('fs');
const vc = require('../src/pkjs/view-cycle.js');

const lines = fs.readFileSync(process.argv[2] || 0, 'utf8').trim().split('\n');
let bad = 0;
for (const line of lines) {
  const [family, wire, ext, need] = line.split(' ').map(Number);
  const spec = vc.unpackWire(wire + ext * 65536);
  const js = vc.stackNeed(spec, family, true).need;
  if (js !== need) {
    if (bad < 15) {
      console.log('MISMATCH family ' + family + ' wire 0x' + wire.toString(16) + ' ext 0x'
        + ext.toString(16) + ': watch ' + need + ', stackNeed ' + js + ' ' + JSON.stringify(spec));
    }
    bad++;
  }
}
if (bad) {
  console.log(bad + ' of ' + lines.length + ' shapes disagree');
  process.exit(1);
}
console.log('fit lockstep OK (' + lines.length + ' shapes)');
