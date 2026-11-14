// test/page/engine/clock-glyphs-page.test.js — the settings page's copy of the watch's clock digits
// (src/pkjs/page/layout/clock-glyphs.generated.js, from scripts/gen-clock-glyphs-page.js) and the
// clock the watch preview draws with them (preview-watch.js clockBand).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js');
const gen = require('../../../scripts/gen-clock-glyphs-page.js');
const GLYPHS = require('../../../src/pkjs/page/layout/clock-glyphs.generated.js');
const vc = require('../../../src/pkjs/layout/domain/view-cycle.js');
const pw = require('../../../src/pkjs/page/layout/preview-watch.js');

test('the committed module is what the watch\'s glyph images and headers make now', () => {
  // A re-run of scripts/gen-clock-glyphs.py (new images, headers) or an edit to clock_ink.c
  // leaves the page drawing the old digits until this script runs too.
  assert.equal(fs.readFileSync(gen.OUT, 'utf8'), gen.build(),
    'stale: run node scripts/gen-clock-glyphs-page.js');
});

test('each glyph is its PNG with the watch\'s metrics; the ClockInk rows match clock_ink.c', () => {
  const png = (face, n, platform) => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'resources/img',
    'clock-' + face + '-' + n + '~' + platform + '.png')).toString('base64');
  assert.deepEqual(GLYPHS.faces[0].roboto.glyphs[0], [24, 2, 28, png('roboto', 0, 'basalt')]);
  assert.deepEqual(GLYPHS.faces[1].bitham.glyphs[10], [8, 3, 14, png('bitham', 10, 'emery')]);
  assert.deepEqual([GLYPHS.faces[0].roboto.inkH, GLYPHS.faces[0].bitham.inkH,
    GLYPHS.faces[1].roboto.inkH, GLYPHS.faces[1].bitham.inkH], [34, 31, 46, 45]);
  assert.deepEqual(GLYPHS.ink[0].roboto, { centreOff: 0, inkH: null, inkHBw: 35 });
  assert.deepEqual(GLYPHS.ink[0].bitham, { centreOff: -2, inkH: null, inkHBw: 31 });
  assert.equal(GLYPHS.ink[1].bitham.centreOff, 2);
});

/**
 * The clock of a no-calendar Default view, drawn by the watch preview.
 * @param {Object} S Settings over the defaults below.
 * @param {Object} env Platform env.
 * @returns {{svg: string, band: {y: number, h: number}}} The screen and its clock band.
 */
function clock(S, env) {
  const st = Object.assign({ layoutPreset: 'noCal', healthMode: 'off', radarMode: 'off' }, S);
  const spec = vc.resolveViewCycle(st, env)[0], f = env.platform === 'emery' ? 1 : 0;
  const band = pw.layoutView(spec, f, pw.clockInk(st, f, env.color === false)).bands.filter((b) => b.band === 'C')[0];
  return { svg: pw.screenSvg(spec, 0, st, env, {}, f, new Date(2026, 8, 7)).svg, band: band };
}

test('Roboto and Bitham are the watch\'s glyphs, seated as time_layer.c seats them', () => {
  const env = { platform: 'basalt', color: true };
  const c = clock({ timeFont: 'roboto', colorTime: '#FFAA00' }, env);
  const set = GLYPHS.faces[0].roboto, idx = [1, 5, 10, 0, 0];
  const advance = idx.reduce((w, i) => w + set.glyphs[i][2], 0);
  let pen = 72 - Math.floor(advance / 2);
  const top = c.band.y + Math.floor(c.band.h / 2) + 0 - Math.floor(34 / 2);
  const images = c.svg.match(/<image [^>]*>/g);
  assert.equal(images.length, 5, '1, 5, :, 0, 0');
  idx.forEach((i, k) => {
    const g = set.glyphs[i];
    assert.ok(images[k].indexOf('x="' + (pen + g[1]) + '" y="' + top + '" width="' + g[0] + '" height="34"') > 0,
      'glyph ' + k + ' at its pen plus its bearing: ' + images[k].slice(0, 80));
    assert.ok(images[k].indexOf('href="data:image/png;base64,' + g[3] + '"') > 0, 'its own image');
    pen += g[2];
  });
  // A picture of the screen shows the time colour as the display does (preview-svg.js displayColors).
  assert.match(c.svg, /<feFlood flood-color="#F1AA86"><\/feFlood><feComposite in2="SourceAlpha" operator="in">/,
    'tinted in the time colour, as the screen shows #FFAA00, through its alpha');
  assert.equal(clock({ timeFont: 'bitham' }, env).svg.match(/<image /g).length, 5, 'Bitham too');
  assert.match(clock({ timeFont: 'roboto' }, { platform: 'emery', color: true }).svg,
    /height="46" preserveAspectRatio="none" href="data:image\/png;base64,/, 'emery takes its own');
});

test('a black-and-white theme or watch cuts every alpha at half', () => {
  const cut = /<feFuncA type="discrete" tableValues="0 0 1 1">/;
  assert.match(clock({ timeFont: 'roboto', theme: 'bw' }, { platform: 'basalt', color: true }).svg, cut);
  const diorite = clock({ timeFont: 'bitham' }, { platform: 'diorite', color: false });
  assert.match(diorite.svg, cut, 'the 1-bit faces of a B/W watch: crisp');
  assert.match(diorite.svg, /flood-color="#FFFFFF"/, 'in the ink');
  assert.doesNotMatch(clock({ timeFont: 'roboto' }, { platform: 'basalt', color: true }).svg, cut);
});

test('the system fonts\' digits ink the rows clock_ink.c measured on the watch', () => {
  // scripts/extract-system-clock-glyphs.py checks this as it reads the firmware; this keeps the
  // committed digits and the C table in step after either changes.
  const S = GLYPHS.system;
  assert.equal(S.LECO_42_NUMBERS.inkH, GLYPHS.ink[0].leco.inkH);
  assert.equal(S.LECO_60_NUMBERS_AM_PM.inkH, GLYPHS.ink[1].leco.inkH);
  assert.equal(S.ROBOTO_BOLD_SUBSET_49.inkH, GLYPHS.ink[0].roboto.inkHBw);
  assert.equal(S.BITHAM_42_MEDIUM_NUMBERS.inkH, GLYPHS.ink[0].bitham.inkHBw);
  Object.keys(S).forEach((name) => assert.equal(S[name].glyphs.length, 11, name + ': 0-9 and the colon'));
});

test('LECO everywhere, and every face on a B/W watch, is the watch\'s system font', () => {
  const uses = (S, env, font) => {
    const c = clock(S, env), set = GLYPHS.system[font], first = set.glyphs[1];   // '1'
    const img = c.svg.match(/<image [^>]*>/g)[0];
    const top = c.band.y + Math.floor(c.band.h / 2) + GLYPHS.ink[env.platform === 'emery' ? 1 : 0][S.timeFont].centreOff
      - Math.floor(set.inkH / 2);
    assert.ok(img.indexOf('base64,' + first[5] + '"') > 0, font + ': its own digits');
    assert.ok(img.indexOf('y="' + (top + first[3] - set.inkTop) + '" width="' + first[0] + '" height="' + first[1] + '"') > 0,
      font + ': the glyph on its own row under the seated ink top: ' + img.slice(0, 90));
  };
  uses({ timeFont: 'leco' }, { platform: 'basalt', color: true }, 'LECO_42_NUMBERS');
  uses({ timeFont: 'leco' }, { platform: 'emery', color: true }, 'LECO_60_NUMBERS_AM_PM');
  uses({ timeFont: 'leco' }, { platform: 'diorite', color: false }, 'LECO_42_NUMBERS');
  uses({ timeFont: 'roboto' }, { platform: 'aplite', color: false, themePolarity: false }, 'ROBOTO_BOLD_SUBSET_49');
  uses({ timeFont: 'bitham' }, { platform: 'diorite', color: false }, 'BITHAM_42_MEDIUM_NUMBERS');
});

test('the Clock font picker draws the time in each face, as the watch would', () => {
  const pic = (value, env) => global.PConf.pictureResolvers.get('timeFontPicture')(
    { timeFont: 'roboto', colorTime: '#FFAA00' }, env, { messageKey: 'timeFont', value: value }, {});
  const basalt = { platform: 'basalt', color: true };
  const faces = ['roboto', 'leco', 'bitham'].map((f) => pic(f, basalt));
  faces.forEach((svg) => {
    assert.match(svg, /^<svg class="wpv-scr" viewBox="-9 -9 162 67"/);
    assert.equal((svg.match(/<image /g) || []).length, 5);
    assert.match(svg, /flood-color="#F1AA86"/, 'in the time colour, as the screen shows #FFAA00');
  });
  assert.equal(new Set(faces).size, 3, 'three different faces');
  assert.match(pic('leco', { platform: 'emery', color: true }), /^<svg class="wpv-scr" viewBox="-12 -12 224 88"/);
});
