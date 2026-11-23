'use strict';
// The Watch bar's row where the watch lays it out, read from the watch's own C: the strip's band
// (layout.c L.top_status: the window less LAYOUT_PAD_X at each side), inset by its layer
// (top_status_layer.c content_rect: PADDING at the left, and at the right but on emery), then
// the row's STATUS_ROW_MARGIN (status_row.c). The settings page's pictures of the watch lay the
// bar out in the same box (preview-watch.js barRowBox), so a picture cuts or keeps a slot's text
// where the watch does. Fails when the page and the watch disagree again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
const eng = require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js');
require('../../../src/pkjs/page/status-bars/status-slot-icons.js');
const VC = require('../../../src/pkjs/layout/domain/view-cycle.js');
const plat = require('../../../src/pkjs/config-ui/lib/platform.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const pw = require('../../../src/pkjs/page/layout/preview-watch.js');
const WT = require('../../../src/pkjs/page/layout/watch-text.js');

/** @param {string} rel A path under src/c. @returns {string} The file's text. */
const C = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'c', rel), 'utf8');

/**
 * A #define's number in a C text: the n-th definition of the name.
 * @param {string} text The C. @param {string} name The macro. @param {number} [n] Which (0 first).
 * @returns {number}
 */
function defined(text, name, n) {
  const all = [...text.matchAll(new RegExp('#define\\s+' + name + '\\s+(\\d+)', 'g'))];
  assert.ok(all.length > (n || 0), name + ' is defined');
  return Number(all[n || 0][1]);
}

/**
 * The watch's Watch bar row for each screen family, from its C: x0, the row's first column on
 * screen, and cw, its content width.
 * @returns {Array<{x0: number, cw: number}>} [the 144 px watches, emery].
 */
function watchRows() {
  const layout = C('windows/layout.c');
  // emery's block first (#ifdef PBL_PLATFORM_EMERY), the 144 px watches' in its #else.
  const padX = [defined(layout, 'LAYOUT_PAD_X', 1), defined(layout, 'LAYOUT_PAD_X', 0)];
  assert.match(layout, /int content_x = LAYOUT_PAD_X;/);
  assert.match(layout, /int content_w = w - 2 \* LAYOUT_PAD_X;/);
  assert.match(layout, /L\.top_status = GRect\(content_x, content_y, content_w, strip \? strip_h : 0\);/,
    'the strip spans the window less its side pads');
  const strip = C('layers/top_status_layer.c');
  const body = /static GRect content_rect\(void\) \{([\s\S]*?)\n\}/.exec(strip)[1];
  const pad = defined(strip, 'PADDING');
  assert.match(body, /int16_t left = PADDING;/, 'PADDING at the left');
  assert.match(body, /#ifdef PBL_PLATFORM_EMERY\s+int16_t right = 0;\s+#else\s+int16_t right = PADDING;\s+#endif/,
    'flush at the right on emery, PADDING on the 144 px watches');
  assert.match(strip, /status_row_apply\(s_row, content_rect\(\), LAYOUT_TIER_FULL, STATUS_LINE_TOP\);/);
  const margin = defined(C('layers/status_row.c'), 'STATUS_ROW_MARGIN');
  const inset = [{ left: pad, right: pad }, { left: pad, right: 0 }];
  return [144, 200].map((w, f) => ({
    x0: padX[f] + inset[f].left + margin,
    cw: w - 2 * padX[f] - inset[f].left - inset[f].right - 2 * margin
  }));
}

test('the Watch bar\'s row is the watch\'s: 132 px from x 6 on the 144 px watches, 188 px from x 8 on emery', () => {
  const rows = watchRows();
  assert.deepEqual(rows, [{ x0: 6, cw: 132 }, { x0: 8, cw: 188 }], 'what the watch\'s C gives today');
  assert.equal(pw.ROW_MARGIN, defined(C('layers/status_row.c'), 'STATUS_ROW_MARGIN'));
  [0, 1].forEach((f) => {
    const box = pw._barRowBox('top', f, 0, 0);
    assert.deepEqual({ x0: box.x + pw.ROW_MARGIN, cw: box.w - 2 * pw.ROW_MARGIN }, rows[f], 'family ' + f);
  });
});

test('the Pebble Classic and Steel inset their strip as the 144 px watches do while it shows no indicator', () => {
  const strip = C('layers/top_status_layer_aplite.c');
  const body = /static GRect content_rect\(void\) \{([\s\S]*?)\n\}/.exec(strip)[1];
  assert.equal(defined(strip, 'PADDING'), defined(C('layers/top_status_layer.c'), 'PADDING'));
  assert.match(strip, /#define ICON_SLOT_1 GRect\(PADDING, 0, 10, 10\)/);
  assert.match(body, /int16_t left = ICON_SLOT_1\.origin\.x;/, 'PADDING at the left with no indicator');
  assert.match(body, /int16_t right = PADDING;/);
  assert.equal(defined(C('layers/status_row_aplite.c'), 'STATUS_ROW_MARGIN'),
    defined(C('layers/status_row.c'), 'STATUS_ROW_MARGIN'));
});

test('the other bars\' rows span their band: no inset of their own', () => {
  assert.match(C('layers/status_bar.c'), /status_row_apply\(b->row, layer_get_bounds\(b->layer\), s_tier, bar_line\(id\)\);/);
  [0, 1].forEach((f) => {
    const pad = f ? 2 : 0;
    ['forecast', 'health', 'radar', 'bar4'].forEach((bar) => {
      assert.deepEqual(pw._barRowBox(bar, f, 0, 0), { x: pad, y: 0, w: pw.SCREEN[f].w - 2 * pad, h: 0 }, bar + ' ' + f);
    });
  });
});

/**
 * A picture of a fresh install's Default screen with the Watch bar set as given.
 * @param {string} platform Platform. @param {Object} over Settings over the defaults.
 * @returns {string} The picture's markup.
 */
function picture(platform, over) {
  const env = plat.computeEnv({ platform: platform });
  const S = Object.assign(eng.hydrate(schema, {}), { radarMode: 'off', healthMode: 'off', layoutPreset: 'compactCal' },
    over);
  return pw.screenSvg(VC.resolveViewCycle(S, env)[0], 0, S, env, {}, platform === 'emery' ? 1 : 0,
    new Date(2026, 10, 6)).svg;
}

test('the bar pictures print the short form where the watch\'s narrower Watch bar swaps it in', () => {
  // emery: Air quality, the weather condition and the city. In the 188 px the watch has, the
  // condition's full name does not fit beside the other two and the row swaps in its short
  // form (status_row_layout.h status_row_swap_short_forms); in the 192 px the page used to lay
  // the bar out in, "Partly cloudy" printed in full.
  const sb = require('../../../src/pkjs/page/status-bars/preview-status-bars.js');
  const env = plat.computeEnv({ platform: 'emery' });
  const S = { statusTopLeft: 'aqi', statusTopMid: 'condition', statusTopRight: 'city', conditionSlotLook: 'both' };
  const bars = sb.barSlots(S, env, 'top', false, new Date(2026, 10, 6));
  assert.deepEqual(pw.barLabels(S, env, 'top', null, bars), { left: '42', mid: 'PCLDY', right: 'Berlin' });
});

test('the pictures put the Watch bar\'s left slot and right slot where the watch does', () => {
  const rows = watchRows();
  [['basalt', 0, 18], ['emery', 1, 24]].forEach(([platform, f, ch]) => {
    const svg = picture(platform, { statusTopLeft: 'city', citySlotIcon: false, statusTopMid: 'empty',
      statusTopRight: 'battery', batterySlotLook: 'text' });
    const x = (label) => Number(new RegExp('<text x="(\\d+)"[^>]*>' + label + '</text>').exec(svg)[1]);
    assert.equal(x('Berlin'), rows[f].x0, platform + ': the left slot from the row\'s first column');
    assert.equal(x('80%') + WT.width(ch, false, '80%'), rows[f].x0 + rows[f].cw,
      platform + ': the right slot ends on the row\'s last');
  });
});
