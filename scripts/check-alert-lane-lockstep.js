#!/usr/bin/env node
// Lockstep between the watch's weather alert items and the phone's day-max slot on how
// a tomorrow value reads. Reads the lines test/c/alert_lane_dump.c prints — each metric
// entry's text lane as src/c/appendix/alert_set.c alert_set_lane builds it, per day
// code, value and lane-ladder values flag — and checks each against the text the
// phone bakes for the slot (src/pkjs/status-pair.js markNextDay), with the mark the
// day code names (status-thresholds.js ALERT_NEXT_DAY_MARKS, code = index + 1; 0 is
// today's, unmarked):
//   values on    the lane is the slot's text for that value: '»8', '>8', '+8', '8*', '8';
//   values off   (the Icon look, or the ladder dropped the values) the mark alone —
//                markNextDay('') — so a tomorrow alert never reads as today's.
// Run by scripts/test-c.sh; any disagreement, or a mark the dump does not cover, fails
// the build.
'use strict';
const fs = require('fs');
const pair = require('../src/pkjs/status-pair.js');
const th = require('../src/pkjs/status-thresholds.js');

const lines = fs.readFileSync(process.argv[2] || 0, 'utf8').trim().split('\n');
let bad = 0;
const days = new Set();
for (const line of lines) {
  const [day, on, value, hex] = line.split(' ');
  const code = Number(day);
  days.add(code);
  const shown = on === '1' && value !== '-' ? value : '';
  const mark = code === 0 ? null : th.ALERT_NEXT_DAY_MARKS[code - 1];
  let want;
  if (code === 0) {
    want = shown;
  } else if (mark === undefined) {
    want = null;   // a code the phone never sends
  } else {
    want = pair.markNextDay(shown, mark);
  }
  const got = hex === '-' ? '' : Buffer.from(hex, 'hex').toString('utf8');
  if (want !== got) {
    if (bad < 15) {
      console.log('MISMATCH ' + line + ' → watch ' + JSON.stringify(got) + ', slot '
        + JSON.stringify(want) + (mark ? ' (' + mark + ')' : ''));
    }
    bad++;
  }
}
// Every day code the phone can send is covered: today's and each mark's.
for (let code = 0; code <= th.ALERT_NEXT_DAY_MARKS.length; code++) {
  if (!days.has(code)) {
    console.log('alert lane lockstep: day code ' + code + ' ('
      + (code === 0 ? 'today' : th.ALERT_NEXT_DAY_MARKS[code - 1]) + ') missing from the dump');
    bad++;
  }
}
if (bad) {
  console.log(bad + ' alert lane(s) disagree with the slot');
  process.exit(1);
}
console.log('alert lane lockstep OK (' + lines.length + ' lanes, ' + days.size + ' day codes)');
