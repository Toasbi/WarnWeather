// test/radar-sky-preview.test.js
//
// The settings page's radar preview draws the sky rows' sample with its own copy
// of the phone's nearest-level quantiser (preview-radar.js skyLevel): the webview
// bundle does not carry radar-sky.js. These pin the copy to the phone's
// shareToLevelByte as the watch reads it back (chart_stripe_level, mirrored by
// preview-stripe.js levelOfByte), and the sample to the rows' meaning.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const RD = require('../src/pkjs/settings/preview-radar.js');
const PS = require('../src/pkjs/settings/preview-stripe.js');
const radarSky = require('../src/pkjs/weather/radar-sky.js');

/**
 * The level the watch draws for a sky percentage sent the way fixture-weather.js
 * sends it: the phone's quantiser, then chart_stripe_level.
 * @param {*} pct Percent of the full row.
 * @returns {number} Level 0..4.
 */
function watchLevel(pct) {
  return PS.levelOfByte(radarSky.shareToLevelByte(Number(pct) / 100));
}

test('the preview\'s sky quantiser draws the level the watch draws, for every percentage', () => {
  for (let tenths = -100; tenths <= 1500; tenths += 1) {
    const pct = tenths / 10;
    assert.equal(RD.skyLevel(pct), watchLevel(pct), pct + ' %');
  }
  [null, undefined, NaN, 'x', '', '50', Infinity, -Infinity].forEach((pct) => {
    assert.equal(RD.skyLevel(pct), watchLevel(pct), String(pct));
  });
  // The level edges, spelled out: under 12.5 % draws nothing.
  assert.deepEqual([0, 12.4, 12.5, 37.4, 37.5, 62.5, 87.4, 87.5, 100, 130].map(RD.skyLevel),
    [0, 0, 1, 1, 2, 3, 3, 4, 4, 4]);
});

// The radar's 24 slots span preview x 11..196; a quarter hour is three of them.
const PX0 = 11;
const STEP = (196 - 11) / 24;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const svgRects = (svg) => [...svg.matchAll(
  /<rect x="([-0-9.e]+)" y="([-0-9.e]+)" width="([-0-9.e]+)" height="([-0-9.e]+)" fill="([^"]+)"><\/rect>/g)]
  .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5] }));

/**
 * The sample's drawn level per quarter hour and row, read back from the dark
 * colour preview: a cell's full-width rect carries the level's tint (level 4 the
 * row colour itself); no cell is level 0.
 * @returns {{cloud: number[], sun: number[]}} Levels 0..4 per quarter hour.
 */
function drawnLevels() {
  const rects = svgRects(RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor',
    radarMode: 'graph', theme: 'dark', radarSky: true }, { color: true, platform: 'basalt' }));
  const cells = rects.filter((r) => near(r.w, 3 * STEP));
  const cloudY = Math.min(...cells.map((c) => c.y));
  const sunY = Math.max(...cells.map((c) => c.y));
  const read = (y, color) => {
    // chart_stripe.h's tint per level: the background itself at level 1, then a
    // quarter, a half and the full row colour.
    const tints = { [PS.blend('#000000', color, 0)]: 1, [PS.blend('#000000', color, 1)]: 2,
      [PS.blend('#000000', color, 2)]: 3, [color]: 4 };
    const out = [];
    for (let q = 0; q < 8; q += 1) {
      const cell = cells.find((c) => near(c.y, y) && near(c.x, PX0 + q * 3 * STEP));
      out.push(cell ? tints[cell.fill] : 0);
    }
    return out;
  };
  return { cloud: read(cloudY, '#AAAAFF'), sun: read(sunY, '#FFFF00') };
}

test('the preview sample shows thin high cloud under a full sun row, not sun = 100 - cloud', () => {
  const { cloud, sun } = drawnLevels();
  assert.ok(cloud.some((c, q) => c >= 2 && c < 4 && sun[q] === 4),
    'a quarter hour of moderate cloud (a veil of high cloud) under full sun: ' + cloud + ' / ' + sun);
  assert.ok(cloud.some((c) => c === 0), 'a nearly clear quarter hour draws no cloud cell at all');
  assert.ok(cloud.some((c, q) => c === 4 && sun[q] === 0), 'the thunderstorm is overcast and sunless');
});
