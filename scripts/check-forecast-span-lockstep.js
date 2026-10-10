#!/usr/bin/env node
// Lockstep between the watch's long span and the settings page's label on how many whole
// hours a feed shows. Reads the lines test/c/forecast_span_dump.c prints — the whole hours
// src/c/appendix/forecast_span.h forecast_span_whole counts for every feed the long class lays
// out on every plot width — and checks each against src/pkjs/forecast-span-hours.js
// wholeHours, the count the Time span row's long option is labelled with. The dump's range is
// checked too, so a shrunken loop cannot pass:
//   N_MIN   the long class's first feed: forecast-span.js DAY_WIDE_HOURS + 1;
//   N_MAX   emery's FORECAST_MAX_ENTRIES: hourly-window.js MAX_FORECAST_HOURS;
//   W_MAX   the whole screen: forecast-span-hours.js SCREEN_W;
//   W_MIN   below every plot the page computes (test/forecast-span-hours.test.js);
// and one line per (W, n) of that grid, in order.
// Run by scripts/test-c.sh; any disagreement fails the build.
'use strict';
const fs = require('fs');
const spanHours = require('../src/pkjs/forecast-span-hours.js');
const forecastSpan = require('../src/pkjs/forecast-span.js');
const hourlyWindow = require('../src/pkjs/weather/hourly-window.js');

const lines = fs.readFileSync(process.argv[2] || 0, 'utf8').trim().split('\n');
const head = /^W_MIN (\d+) W_MAX (\d+) N_MIN (\d+) N_MAX (\d+)$/.exec(lines.shift());
if (!head) {
  console.log('forecast span lockstep: the dump has no W_MIN / W_MAX / N_MIN / N_MAX header');
  process.exit(1);
}
const [wMin, wMax, nMin, nMax] = head.slice(1).map(Number);
let bad = 0;
const expect = (ok, what) => {
  if (!ok) { console.log('forecast span lockstep: ' + what); bad++; }
};
expect(nMin === forecastSpan.DAY_WIDE_HOURS + 1, 'N_MIN ' + nMin + ', want '
  + (forecastSpan.DAY_WIDE_HOURS + 1));
expect(nMax === hourlyWindow.MAX_FORECAST_HOURS, 'N_MAX ' + nMax + ', want '
  + hourlyWindow.MAX_FORECAST_HOURS);
expect(wMax === spanHours.SCREEN_W, 'W_MAX ' + wMax + ', want ' + spanHours.SCREEN_W);
expect(wMin < wMax, 'W_MIN ' + wMin + ' is not below W_MAX');
const cells = (wMax - wMin + 1) * (nMax - nMin + 1);
expect(lines.length === cells, lines.length + ' lines, want ' + cells);
let k = 0;
for (let w = wMin; w <= wMax; w++) {
  for (let n = nMin; n <= nMax; n++, k++) {
    const line = lines[k];
    const [lw, ln, whole] = (line || '').split(' ').map(Number);
    if (lw !== w || ln !== n) {
      expect(false, 'line ' + (k + 2) + ' is ' + JSON.stringify(line) + ', want W ' + w + ' n ' + n);
      continue;
    }
    const want = spanHours.wholeHours(n, w);
    if (whole !== want) {
      if (bad < 15) { console.log('MISMATCH ' + line + ' → watch ' + whole + ', page ' + want); }
      bad++;
    }
  }
}
if (bad) {
  console.log(bad + ' forecast span cell(s) disagree');
  process.exit(1);
}
console.log('forecast span lockstep OK (' + cells + ' cells: W ' + wMin + '..' + wMax + ' x n '
  + nMin + '..' + nMax + ')');
