'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const reel = require('../scripts/gen-reel-fixtures');

test('themesFor follows the capability matrix and sweep order', () => {
  assert.deepStrictEqual(reel.themesFor('emery'), ['dark', 'bw', 'light', 'bw-light']);
  assert.deepStrictEqual(reel.themesFor('basalt'), ['dark', 'bw', 'light', 'bw-light']);
  assert.deepStrictEqual(reel.themesFor('flint'), ['dark', 'light']);
  assert.deepStrictEqual(reel.themesFor('aplite'), []);
});

function generateIntoTmp() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-reel-'));
  const written = reel.generateReelFixtures({ outDir });
  const byName = {};
  for (const p of written) { byName[path.basename(p, '.json')] = JSON.parse(fs.readFileSync(p, 'utf8')); }
  return byName;
}

test('every segment writes a base fixture with minute-0 now and merged clay', () => {
  const byName = generateIntoTmp();
  for (const seg of reel.SEGMENTS) {
    const f = byName['reel-' + seg.id];
    assert.ok(f, 'base fixture for ' + seg.id);
    assert.strictEqual(f.watch.now.minute, 0);
    for (const [k, v] of Object.entries(seg.clay)) {
      assert.deepStrictEqual(f.claySettings[k], v, seg.id + '.' + k);
    }
  }
});

test('per-platform variants write their own fixture with the override applied', () => {
  const byName = generateIntoTmp();
  // status-4 emery variant pins HR; base leaves it unpinned.
  assert.strictEqual(byName['reel-status-4-emery'].claySettings.statusHealthRight, 'hr');
  assert.strictEqual(byName['reel-status-4'].claySettings.statusHealthRight, 'sleep');
  // status-5 aplite variant uses battery in the top-right; base uses steps.
  assert.strictEqual(byName['reel-status-5-aplite'].claySettings.statusTopRight, 'battery');
  assert.strictEqual(byName['reel-status-5'].claySettings.statusTopRight, 'steps');
});

test('light / bw-light theme segments force colorTime black', () => {
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-theme-light'].claySettings.colorTime, '#000000');
  assert.strictEqual(byName['reel-theme-bwlight'].claySettings.colorTime, '#000000');
});

test('fixture slugs are valid FIXTURE slugs', () => {
  for (const seg of reel.SEGMENTS) {
    assert.match(reel.fixtureFor(seg, 'emery'), /^[a-z0-9][a-z0-9-]*$/, seg.id);
  }
});

test('emery manifest: intro + all three captioned chapters in order', () => {
  const m = reel.buildManifest('emery');
  const cards = m.filter((s) => s.kind === 'card').map((s) => s.frame);
  assert.deepStrictEqual(cards, ['card-themes.png', 'card-graph.png', 'card-status.png']);
  const introCount = m.filter((s) => s.group === 'intro').length;
  assert.strictEqual(introCount, 4, 'four intro scenes (1,2,3,5)');
  const themeFrames = m.filter((s) => s.group === 'theme' && s.kind === 'scene').map((s) => s.frame);
  assert.strictEqual(themeFrames.length, 4, 'emery has 4 theme segments');
});

test('aplite manifest: no themes card/segments, no radar/health graph or health status', () => {
  const m = reel.buildManifest('aplite');
  const frames = m.map((s) => s.frame);
  assert.ok(!frames.includes('card-themes.png'), 'no themes card on aplite');
  assert.strictEqual(m.filter((s) => s.group === 'theme' && s.kind === 'scene').length, 0);
  assert.ok(!frames.includes('graph-4.png') && !frames.includes('graph-5.png'), 'no radar/health graph');
  assert.ok(!frames.includes('status-4.png'), 'no health status row');
  // aplite still advertises status: status-1..3 + status-5 (top strip variant).
  assert.ok(frames.includes('status-5.png'), 'aplite gets the status-5 variant');
  assert.ok(frames.includes('card-status.png'), 'status card present on aplite');
});

test('flint manifest: 2 theme segments; no HR anywhere', () => {
  const m = reel.buildManifest('flint');
  assert.strictEqual(m.filter((s) => s.group === 'theme' && s.kind === 'scene').length, 2);
});

test('manifest holds/fades come from TIMING by kind/group', () => {
  const m = reel.buildManifest('emery');
  const intro = m.find((s) => s.group === 'intro');
  const card = m.find((s) => s.kind === 'card');
  const chapter = m.find((s) => s.group === 'graph' && s.kind === 'scene');
  assert.strictEqual(intro.hold, reel.TIMING.intro.hold);
  assert.strictEqual(card.hold, reel.TIMING.card.hold);
  assert.strictEqual(chapter.hold, reel.TIMING.chapter.hold);
});
