'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const { eachItem } = require('../src/pkjs/config-ui/lib/schema-walk.js');
// The two color defaults are owned by the contract module (status-thresholds.js),
// which also reads these settings back at pack time — assert against the exported
// constants rather than re-inlining the hex a third time.
const thresholds = require('../src/pkjs/status-thresholds.js');
const wire = require('../src/pkjs/status-wire.js');
const catalog = require('../src/pkjs/status-line-catalog.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const B = require('../src/pkjs/settings/blocks.js');
const onbuild = require('../src/pkjs/settings/onbuild.js');
const PC = global.PConf;

function itemsByKey() {
  const map = {};
  eachItem(schema, it => {
    if (!it.messageKey) { return; }
    (map[it.messageKey] = map[it.messageKey] || []).push(it);
  });
  return map;
}

const STEMS = ['Aqi', 'Pollen', 'Wind', 'Gust', 'Steps', 'Sleep', 'Distance', 'Uv'];
const HEALTH_STEMS = ['Steps', 'Sleep', 'Distance'];
// The alert kinds: their levels group lives ONLY in the kind's alert sheet in the On
// demand card, alert<Stem> (their slot sheet points there); the goal kinds' in their
// slot sheet.
const ALERT_STEMS = ['Gust', 'Uv', 'Aqi', 'Pollen', 'Wind'];

/**
 * The sheet a kind's levels group lives in: alert<Stem> for an alert kind,
 * thresh<Stem> for a goal kind.
 * @param {string} stem Kind key stem.
 * @returns {string} The sheetId.
 */
function levelsSheetId(stem) {
  return (ALERT_STEMS.includes(stem) ? 'alert' : 'thresh') + stem;
}

/**
 * A levels-group key occurs exactly once, in its kind's levels sheet.
 * @param {Object[]} its itemsByKey() entry.
 * @param {string} stem Kind key stem.
 * @param {string} key The messageKey, for messages.
 */
function assertGroupItem(its, stem, key) {
  assert.ok(its && its.length === 1,
    key + ': expected exactly one occurrence, got ' + (its ? its.length : 0));
  let home = null;
  schema.tabs.forEach(t => (t.sections || []).forEach(sec => {
    if ((sec.items || []).indexOf(its[0]) !== -1) { home = sec.sheetId; }
  }));
  assert.equal(home, levelsSheetId(stem), key + ' lives in its kind\'s levels sheet');
}
const ENV = { thresholds: true, color: true, health: true };

// The engine hands actions its stored-shape schema-default resolver as the 4th
// argument (defaultAsStored); direct calls here rebuild the same thing from the
// real schema so the assertions stay end-to-end honest.
const SCHEMA_DEFAULT_OF = (key) => {
  const its = itemsByKey()[key];
  return its ? PC.engine.resolveDefaultFrom(its[0], ENV) : undefined;
};

test('every threshold kind has toggle + slider + hidden companions wired up', () => {
  const map = itemsByKey();
  STEMS.forEach(stem => {
    const on = map['thresh' + stem + 'On'];
    const alert = ALERT_STEMS.includes(stem);
    if (alert) {
      // A weather kind's highlight switch is the SLOT sheet's 'Alert highlighting' row: one
      // occurrence, in thresh<Stem>, not in the alert sheet's levels group.
      assert.ok(on && on.length === 1, 'thresh' + stem + 'On: exactly one occurrence');
      let home = null;
      schema.tabs.forEach(t => (t.sections || []).forEach(sec => {
        if ((sec.items || []).indexOf(on[0]) !== -1) { home = sec.sheetId; }
      }));
      assert.equal(home, 'thresh' + stem, 'thresh' + stem + 'On lives in the slot sheet');
    } else {
      assertGroupItem(on, stem, 'thresh' + stem + 'On');
    }
    assert.equal(on[0].type, 'toggle');
    assert.equal(on[0].defaultValue, false);
    // Plain stored state: switching it writes no numbers (a blank pair IS the seed).
    assert.equal(on[0].onChange, undefined);

    const warn = map['thresh' + stem + 'Warn'];
    assertGroupItem(warn, stem, 'thresh' + stem + 'Warn');
    assert.equal(warn[0].type, 'range');
    assert.equal(warn[0].defaultValue, '');
    assert.equal(warn[0].dangerKey, 'thresh' + stem + 'Danger');
    assert.equal(warn[0].maxKey, 'thresh' + stem + 'Max');
    // The chips' words ride the args, in the group's voice.
    assert.deepEqual(warn[0].rangeFrom, { resolver: 'thresholdRange', args: { keyStem: stem,
      chips: alert ? { warn: 'Warn', danger: 'Danger' } : { warn: 'Close', danger: 'Goal' } } });
    // The slider is ALWAYS live: the warn level also sets when the alert icon shows,
    // whether or not the highlight is on — so no gate, not even a mute.
    assert.equal(warn[0].disabledWhen, undefined,
      'thresh' + stem + 'Warn slider must stay editable while the highlight is off');
    // A goal kind's highlight-only rows still disable (not hide) on the toggle; a
    // weather kind's are always live — they style its alert icon too, which the
    // slot's Highlight switch does not touch.
    ['WarnLook', 'WarnColor', 'DangerColor'].forEach(which => {
      const it = map['thresh' + stem + which];
      assertGroupItem(it, stem, 'thresh' + stem + which);
      assert.deepEqual(it[0].disabledWhen, alert ? undefined : { not: { key: 'thresh' + stem + 'On' } },
        'thresh' + stem + which + (alert ? ' is always live' : ' must disable (not hide) on its toggle'));
    });
    // The warn look: none / outline / fill, its default resolved per platform by the
    // contract (weather fill on colour, outline on B&W; goal outline) — never seeded,
    // and never saved while it holds that default (sticky: false).
    const look = map['thresh' + stem + 'WarnLook'][0];
    assert.deepEqual(look.options.map(o => o[1]), ['none', 'outline', 'fill']);
    assert.deepEqual(look.defaultFrom,
      { resolver: 'warnLookDefault', args: { keyStem: stem }, sticky: false });
    assert.equal(look.defaultValue, undefined, 'defaultFrom only');
    assert.equal(PC.engine.resolveDefaultFrom(look, { color: true }), alert ? 'fill' : 'outline',
      stem + ' colour default');
    assert.equal(PC.engine.resolveDefaultFrom(look, { color: false }), 'outline', stem + ' B&W default');
    assert.equal(map['thresh' + stem + 'WarnOutlineOn'], undefined, 'the old toggle is gone');
    assert.equal(on[0].label, alert ? 'Alert highlighting' : 'Goals', 'the toggle\'s label');
    // The reset button moved onto the group's sub-header — see "the group header
    // owns the title and the reset action" below.

    // Companion storage rows: hydrated + serialized, never drawn.
    ['Danger', 'Max'].forEach(which => {
      const it = map['thresh' + stem + which];
      assertGroupItem(it, stem, 'thresh' + stem + which);
      assert.equal(it[0].type, 'hidden');
      assert.equal(it[0].defaultValue, '');
    });
  });
});

// Collect every {key:'theme', ...} leaf in a showWhen tree, so the assertion below
// pins the gate's SHAPE. A substring check for 'bw' would also pass for the
// inverted gate {key:'theme', in:['bw','bw-light']} — pickers ONLY on B&W.
function themeLeaves(pred, out) {
  out = out || [];
  if (!pred || typeof pred !== 'object') { return out; }
  if (Array.isArray(pred)) { pred.forEach(p => themeLeaves(p, out)); return out; }
  if (pred.key === 'theme') { out.push(pred); }
  ['all', 'any'].forEach(comb => { if (pred[comb]) { themeLeaves(pred[comb], out); } });
  if (pred.not) { themeLeaves(pred.not, out); }
  return out;
}

test('threshold color pickers are COLOR + bw-theme gated (goal kinds: + toggle), auto (unset) defaults', () => {
  const map = itemsByKey();
  STEMS.forEach(stem => {
    const warn = map['thresh' + stem + 'WarnColor'][0];
    const danger = map['thresh' + stem + 'DangerColor'][0];
    [warn, danger].forEach(it => {
      assert.equal(it.type, 'color');
      assert.deepEqual(it.capabilities, ['COLOR']);
      const leaves = themeLeaves(it.showWhen);
      assert.equal(leaves.length, 1, it.messageKey + ' has exactly one theme gate');
      // nin (not eq/in): the picker shows on every theme EXCEPT the two B&W ones.
      assert.deepEqual(leaves[0], {key: 'theme', nin: ['bw', 'bw-light']},
        it.messageKey + ' must be hidden on B&W themes only');
      const alert = ALERT_STEMS.includes(stem);
      assert.deepEqual(it.disabledWhen, alert ? undefined : { not: { key: 'thresh' + stem + 'On' } },
        it.messageKey + (alert ? ' is always live (it styles the alert icon too)'
          : ' must disable (not hide) while the highlight is off'));
      // Weather kinds hydrate '' (auto -> onLoad derives the theme fg, the packer
      // resolves it the same way). Goal kinds hydrate the green celebration
      // default. Whether warn draws a box is the warn look, not the colour.
      const goal = ['Steps', 'Sleep', 'Distance'].indexOf(stem) >= 0;
      assert.equal(it.defaultValue, goal ? '#55FF00' : '',
        it.messageKey + ' default');
    });
  });
});

// Health thresholds are inert wherever a health item can't reach a status slot:
// no health sensors (aplite) or healthMode 'off'. 'slot' mode DOES put health in the
// ordinary bars, so it must keep them — the same rule statusLineCatalog.itemAvailable
// applies to the items themselves. Asserted behaviorally through the real evaluator.
test('health-kind threshold rows are hidden on health-less platforms and with health off', () => {
  const map = itemsByKey();
  const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
  HEALTH_STEMS.forEach(stem => {
    ['On', 'Warn'].forEach(which => {
      const it = map['thresh' + stem + which][0];
      assert.ok(JSON.stringify(it.showWhen).includes('"env":"health"'),
        'thresh' + stem + which + ' must be env-health gated');
      // threshXOn: true so the slider's own toggle gate can't mask the health gate.
      const ctx = mode => Object.assign(
        { env: { health: true, color: true } },
        { healthMode: mode, ['thresh' + stem + 'On']: true });
      assert.equal(showWhen.isVisible(it, ctx('off')), false,
        it.messageKey + ' hidden when health is off');
      ['slot', 'status', 'all'].forEach(mode => {
        assert.equal(showWhen.isVisible(it, ctx(mode)), true,
          it.messageKey + ' shown in healthMode ' + mode);
      });
      const noSensors = Object.assign({ env: { health: false, color: true } },
        { healthMode: 'all', ['thresh' + stem + 'On']: true });
      assert.equal(showWhen.isVisible(it, noSensors), false,
        it.messageKey + ' hidden without health sensors');
    });
  });
});

// Defaults ship disabled: every kind starts with its highlight toggle off and both
// levels blank (= the kind's seed, resolved live — no invented numbers stored), so
// kindConfig() reports it disabled until the user switches it on. The blank pair
// alone would resolve ordered; the stored toggle is what keeps the bit clear.
test('shipped defaults leave every kind disabled', () => {
  const map = itemsByKey();
  const S = {};
  STEMS.forEach(stem => {
    S['thresh' + stem + 'On'] = map['thresh' + stem + 'On'][0].defaultValue;
    assert.strictEqual(S['thresh' + stem + 'On'], false, stem + ' toggle ships off');
    S['thresh' + stem + 'Warn'] = map['thresh' + stem + 'Warn'][0].defaultValue;
    S['thresh' + stem + 'Danger'] = map['thresh' + stem + 'Danger'][0].defaultValue;
  });
  thresholds.KINDS.forEach((kind, index) => {
    // boldOnly kinds have no pair at all — kindConfig only owes them a boldMode,
    // so 'disabled' is asserted as falsy rather than strictly false.
    assert.ok(!thresholds.kindConfig(S, index).enabled,
      kind.key + ' must ship disabled');
  });
});

// --- the range resolver (blocks.js thresholdRange) --------------------------

test('resolver direction is above for every kind (the axis is retired)', () => {
  thresholds.KINDS.forEach(kind => {
    if (kind.boldOnly) { return; }   // level-less kinds have no slider to configure
    const cfg = B.thresholdRangeCfg({}, ENV, { keyStem: kind.key });
    assert.equal(cfg.dir, 'above', kind.key + ': every value rises toward its pair');
    // Seeds must form a valid ordered pair — enabling a kind must highlight
    // immediately, not silently store an unordered pair.
    assert.ok(cfg.seedDanger >= cfg.seedWarn, kind.key + ' seeds must be ordered');
    assert.ok(cfg.seedWarn >= cfg.min && cfg.seedWarn <= cfg.max
      && cfg.seedDanger >= cfg.min && cfg.seedDanger <= cfg.max,
      kind.key + ' seeds must sit inside the track');
    // The two thumbs must be separable on the step grid.
    assert.equal(cfg.minSpan, cfg.step, kind.key + ' minSpan pins to the step');
  });
});

test('wind/gust/distance scales follow the Setup › Units pickers', () => {
  const kph = B.thresholdRangeCfg({}, ENV, { keyStem: 'Wind' });
  assert.deepEqual([kph.max, kph.seedWarn, kph.seedDanger, kph.unit], [120, 40, 60, 'kph']);
  const mph = B.thresholdRangeCfg({ windUnits: 'mph' }, ENV, { keyStem: 'Wind' });
  assert.deepEqual([mph.max, mph.seedWarn, mph.seedDanger, mph.unit], [75, 25, 40, 'mph']);
  const kn = B.thresholdRangeCfg({ windUnits: 'knots' }, ENV, { keyStem: 'Gust' });
  assert.deepEqual([kn.max, kn.seedWarn, kn.seedDanger, kn.unit], [85, 35, 50, 'kn']);
  // Distance seeds order upward since the goal rework (close, then the goal).
  const km = B.thresholdRangeCfg({}, ENV, { keyStem: 'Distance' });
  assert.deepEqual([km.max, km.seedWarn, km.seedDanger, km.unit], [20, 4, 5, 'km']);
  const mi = B.thresholdRangeCfg({ distanceUnits: 'imperial' }, ENV, { keyStem: 'Distance' });
  assert.deepEqual([mi.max, mi.seedWarn, mi.seedDanger, mi.unit], [12, 2.5, 3, 'mi']);
});

test('AQI scale: European only when Open-Meteo is the source and the picker says so', () => {
  const eu = B.thresholdRangeCfg({ aqiSource: 'openmeteo', aqiScale: 'european' }, ENV, { keyStem: 'Aqi' });
  assert.deepEqual([eu.max, eu.seedWarn, eu.seedDanger], [150, 60, 80]);
  const us = B.thresholdRangeCfg({ aqiSource: 'openmeteo', aqiScale: 'us' }, ENV, { keyStem: 'Aqi' });
  assert.deepEqual([us.max, us.seedWarn, us.seedDanger], [300, 100, 150]);
  // WAQI (and auto, which prefers it) reports US-style AQI regardless of the picker.
  ['waqi', 'auto'].forEach(src => {
    const cfg = B.thresholdRangeCfg({ aqiSource: src, aqiScale: 'european' }, ENV, { keyStem: 'Aqi' });
    assert.equal(cfg.max, 300, src + ' uses the US-style scale');
  });
});

test('every unit and scale variant a kind can take has slider geometry around its seed', () => {
  // The slider table is plain data keyed by the contract's scaleVariant, like the
  // seed table: a variant without a row would throw at render, not draw a wrong scale.
  [undefined, 'kph', 'mph', 'knots'].forEach((windUnits) =>
    [undefined, 'metric', 'imperial'].forEach((distanceUnits) =>
      [undefined, 'waqi', 'auto', 'openmeteo'].forEach((aqiSource) =>
        [undefined, 'european', 'us'].forEach((aqiScale) => STEMS.forEach((stem) => {
          const S = { windUnits, distanceUnits, aqiSource, aqiScale };
          const cfg = B.thresholdRangeCfg(S, ENV, { keyStem: stem });
          const seed = thresholds.seedPair(stem, S);
          assert.deepEqual([cfg.seedWarn, cfg.seedDanger], [seed.warn, seed.danger]);
          assert.ok(cfg.min <= seed.warn && seed.danger <= cfg.max,
            stem + ' ' + JSON.stringify(S) + ': the seed sits on the track');
        })))));
});

test('bounded kinds have no scale-max editor; unbounded kinds do', () => {
  ['Pollen', 'Sleep'].forEach(stem => {
    assert.equal(B.thresholdRangeCfg({}, ENV, { keyStem: stem }).maxEditable, false, stem);
  });
  ['Aqi', 'Wind', 'Gust', 'Steps', 'Distance'].forEach(stem => {
    assert.equal(B.thresholdRangeCfg({}, ENV, { keyStem: stem }).maxEditable, true, stem);
  });
});

test('scale max: override honored, garbage ignored, always grows to fit stored values', () => {
  const overridden = B.thresholdRangeCfg({ threshStepsMax: '30000' }, ENV, { keyStem: 'Steps' });
  assert.equal(overridden.max, 30000);
  const garbage = B.thresholdRangeCfg({ threshStepsMax: 'abc' }, ENV, { keyStem: 'Steps' });
  assert.equal(garbage.max, 20000);
  const blank = B.thresholdRangeCfg({ threshStepsMax: '' }, ENV, { keyStem: 'Steps' });
  assert.equal(blank.max, 20000);
  // A stored pair beyond the (default or overridden) max stretches the track —
  // a pair typed under the old text UI must never strand a thumb off the track.
  const grown = B.thresholdRangeCfg({ threshStepsWarn: '25100' }, ENV, { keyStem: 'Steps' });
  assert.equal(grown.max, 25250, 'grows to the next step multiple');
  const shrunk = B.thresholdRangeCfg(
    { threshStepsMax: '10000', threshStepsWarn: '15000' }, ENV, { keyStem: 'Steps' });
  assert.equal(shrunk.max, 15000, 'an override below a stored threshold loses');
  // A blank pair means the SEED on the phone (resolvedPair), and the slider previews
  // that seed — so an override below the seed must lose too, or the slider would clamp
  // the seed it shows while the bake uses the real one.
  const clampedSeed = B.thresholdRangeCfg(
    { windUnits: 'kph', threshWindMax: '30', threshWindWarn: '', threshWindDanger: '' },
    ENV, { keyStem: 'Wind' });
  assert.deepEqual([clampedSeed.seedWarn, clampedSeed.seedDanger], [40, 60], 'kph wind seed');
  assert.ok(clampedSeed.max >= 60, 'the scale grows to hold the seed pair: ' + clampedSeed.max);
  assert.equal(clampedSeed.seedWarn, thresholds.resolvedPair('Wind',
    { windUnits: 'kph', threshWindMax: '30', threshWindWarn: '', threshWindDanger: '' }).warn,
    'the slider seed is the number the phone holds on');
  // Bounded kinds ignore stray max keys entirely.
  const sleep = B.thresholdRangeCfg({ threshSleepMax: '40' }, ENV, { keyStem: 'Sleep' });
  assert.equal(sleep.max, 12);
});

test('resolver colors: auto tracks the theme fg, picks stick, garbage sanitized', () => {
  // Warn look 'none' = no box: the slider draws its warn pieces in the neutral gray
  // (the zone still shows where warn spans). An unset warn colour = auto theme fg;
  // an unset danger colour = the contract's red.
  const dflt = B.thresholdRangeCfg({}, ENV, { keyStem: 'Wind' });
  assert.equal(dflt.warnColor, '#FFFFFF', 'unset warn colour = auto theme fg');
  assert.equal(dflt.dangerColor, '#FF0000', 'unset danger colour = red');
  const whiteDanger = B.thresholdRangeCfg({ threshWindDangerColor: '#FFFFFF' }, ENV, { keyStem: 'Wind' });
  assert.equal(whiteDanger.dangerColor, '#FFFFFF', 'a white danger pick = the theme fg');
  assert.equal(whiteDanger.dangerText, '#20232A', 'white fill takes dark ink');
  const bwDay = B.thresholdRangeCfg({ theme: 'bw', threshWindWarnColor: '#00AAFF' }, ENV,
    { keyStem: 'Wind' });
  assert.deepEqual([bwDay.warnColor, bwDay.dangerColor], ['#FFFFFF', '#FFFFFF'],
    'a B&W day theme draws both levels in the text colour, as the watch does');
  const none = B.thresholdRangeCfg({ threshWindWarnLook: 'none' }, ENV, { keyStem: 'Wind' });
  assert.equal(none.warnColor, '#8A8E97', 'look none: the neutral gray');
  const light = B.thresholdRangeCfg({ theme: 'light', threshWindWarnLook: 'none' }, ENV,
    { keyStem: 'Wind' });
  assert.equal(light.warnColor, '#8A8E97', 'no-box neutral is theme-independent');
  const lightBlack = B.thresholdRangeCfg({ theme: 'light', threshWindDangerColor: '#FFFFFF' }, ENV,
    { keyStem: 'Wind' });
  assert.equal(lightBlack.dangerColor, '#000000', 'a text-colour danger follows the theme');
  assert.equal(lightBlack.dangerText, '#FFFFFF', 'black fill takes white ink');
  // User picks — the old orange/red defaults included — are ordinary colors now.
  const picked = B.thresholdRangeCfg(
    { threshWindWarnColor: '#00aaff', threshWindDangerColor: '#FFFF00' }, ENV, { keyStem: 'Wind' });
  assert.equal(picked.warnColor, '#00AAFF');
  assert.equal(picked.warnGlow, 'rgba(0,170,255,0.35)');
  assert.equal(picked.dangerText, '#20232A', 'light fill takes dark ink');
  const orange = B.thresholdRangeCfg({ threshWindWarnColor: '#FFAA00' }, ENV, { keyStem: 'Wind' });
  assert.equal(orange.warnColor, '#FFAA00', 'orange is a pick, not auto');
  // A hostile stored string must never reach the inline styles (normalizes to auto
  // -> theme fg; it is a non-empty value, so it does not read as "no outline").
  const evil = B.thresholdRangeCfg(
    { threshWindWarnColor: '"><script>x</script>' }, ENV, { keyStem: 'Wind' });
  assert.equal(evil.warnColor, '#FFFFFF');
});

// --- the highlight switch writes no numbers ---------------------------------

test('switching a highlight on writes no numbers: a blank pair keeps following the unit', () => {
  // A blank pair IS the kind's seed for the unit and AQI scale in effect
  // (resolvedPair), for the bake, the alert icon, the slider and the hints alike, so the
  // switch has nothing to store beside itself — and pinning the seed would freeze the
  // unit it was pinned under (a wind 40/60 read as mph after a switch to mph).
  assert.equal(PC.onChange.get('thresholdToggle'), undefined, 'no hook behind the switch');
  const page = bootGeneratedPage({ provider: 'dwd' });
  page.openEditSheet('threshWind');
  page.clickModalToggle('threshWindOn');
  assert.strictEqual(page.S.threshWindOn, true);
  assert.equal(page.S.threshWindWarn, '', 'no warn pinned');
  assert.equal(page.S.threshWindDanger, '', 'no danger pinned');
  assert.ok(thresholds.kindConfig(page.S, thresholds.KINDS.findIndex((k) => k.key === 'Wind')).enabled,
    'the blank pair resolves to the seed, so the highlight is on');
  assert.deepEqual(thresholds.resolvedPair('Wind', page.S), { warn: 40, danger: 60, stored: false });
  page.S.windUnits = 'mph';
  assert.deepEqual(thresholds.resolvedPair('Wind', page.S), { warn: 25, danger: 40, stored: false },
    'the levels follow the unit');
  // A stored pair, broken or not, is left exactly as it was.
  page.S.threshWindWarn = '60';
  page.S.threshWindDanger = '30';
  page.clickModalToggle('threshWindOn');
  page.clickModalToggle('threshWindOn');
  assert.deepEqual([page.S.threshWindWarn, page.S.threshWindDanger], ['60', '30']);
});

// --- stored toggle state (onbuild.js onLoad) --------------------------------

test('onLoad leaves the stored toggle alone and still heals colours', () => {
  // The toggle is STORED state since the levels/highlight split: the page used to
  // re-derive it from the pair on every open, which would now undo a user's OFF
  // (the pair lives on while off). The pre-split backfill is the phone-side
  // migration (migrations/v1_24.js migrateThresholdHighlightToggles).
  const S = {
    threshStepsOn: false, threshStepsWarn: '2500', threshStepsDanger: '5000', // ordered, stored off
    threshWindOn: true, threshWindWarn: '', threshWindDanger: '',            // blank (= seed), stored on
    threshSleepOn: true, threshSleepWarn: '7', threshSleepDanger: '',       // half pair, stored on
    threshUvOn: false, threshUvWarn: '6', threshUvDanger: '8',              // ordered, stored off
    location: ''
  };
  onbuild.onLoad({
    env: { platform: 'basalt' },
    get: k => S[k],
    set: (k, v) => { S[k] = v; },
    getInitial: k => S[k]
  });
  assert.strictEqual(S.threshStepsOn, false, 'an OFF over an ordered pair survives the open');
  assert.strictEqual(S.threshUvOn, false);
  assert.strictEqual(S.threshWindOn, true, 'an ON over a blank pair survives the open');
  assert.strictEqual(S.threshSleepOn, true);
  assert.ok(!('threshAqiOn' in S), 'onLoad writes no toggle it was not given');
  // The pairs are not touched either.
  assert.equal(S.threshStepsWarn, '2500');
  assert.equal(S.threshSleepWarn, '7');
  assert.equal(S.threshSleepDanger, '');
  // The colour healing still runs for every kind (dark default theme).
  assert.equal(S.threshWindDangerColor, '#FF0000', 'an unset weather danger → red');
  assert.equal(S.threshStepsWarnColor, '#55FF00', 'goal close colour seeded green');
  assert.equal(S.threshStepsDangerColor, '#55FF00', 'goal fill colour seeded green');
});

test('onLoad derives auto colors from the theme; user picks survive', () => {
  /**
   * @param {Object} S settings state to run onLoad against (mutated)
   * @returns {Object} the same S, after the hook
   */
  function loaded(S) {
    onbuild.onLoad({
      env: { platform: 'basalt' },
      get: k => S[k],
      set: (k, v) => { S[k] = v; },
      getInitial: k => S[k]
    });
    return S;
  }
  // Fresh install, dark (default) theme: WARN lands on the theme fg — whether warn
  // draws a box is the warn look, not the colour — and DANGER on the contract's red,
  // so a warn fill never looks like danger. No outline toggle is derived any more.
  const dark = loaded({});
  assert.equal(dark.threshAqiWarnColor, '#FFFFFF');
  assert.equal(dark.threshAqiDangerColor, '#FF0000');
  // A stored black or white danger is the pick "the text colour": it heals to the
  // text colour of the theme in effect — what the packer draws for it — so the picker
  // never shows a colour the watch does not draw (a black pick on a dark theme showed
  // black while the badge, slider and watch used white).
  const textDanger = loaded({ theme: 'light', threshAqiDangerColor: '#FFFFFF' });
  assert.equal(textDanger.threshAqiDangerColor, '#000000');
  assert.equal(loaded({ threshAqiDangerColor: '#000000' }).threshAqiDangerColor, '#FFFFFF',
    'black danger on the dark theme → white');
  assert.equal(loaded({ threshAqiDangerColor: 0x000000 }).threshAqiDangerColor, '#FFFFFF',
    'the stored int shape heals the same way');
  // A goal kind's black or white pick is its green on the watch (the packer's rule),
  // so it heals to green rather than showing white or black in the page.
  const goalWhite = loaded({ threshStepsWarnColor: '#FFFFFF', threshStepsDangerColor: '#000000' });
  assert.equal(goalWhite.threshStepsWarnColor, '#55FF00');
  assert.equal(goalWhite.threshStepsDangerColor, '#55FF00');
  // An unparseable weather danger packs as the red fallback, so it heals to red.
  assert.equal(loaded({ threshAqiDangerColor: 'garbage' }).threshAqiDangerColor, '#FF0000');
  assert.equal(dark.threshAqiWarnOutlineOn, undefined, 'the retired toggle is never written');
  // Goal kinds seed the green celebration colors instead.
  assert.equal(dark.threshStepsWarnColor, '#55FF00');
  assert.equal(dark.threshStepsDangerColor, '#55FF00');
  // A STALE auto value (the other theme's fg) re-derives for this theme.
  const light = loaded({ theme: 'light', threshAqiWarnColor: '#FFFFFF' });
  assert.equal(light.threshAqiWarnColor, '#000000');
  // A blank goal colour is auto too now (green), not "outline off".
  assert.equal(loaded({ threshStepsWarnColor: '' }).threshStepsWarnColor, '#55FF00');
  // A user pick is never touched — the contract's orange/red included (nobody
  // shipped with them as page defaults, so they are ordinary picks).
  const custom = loaded({ theme: 'light', threshAqiWarnColor: '#00AAFF' });
  assert.equal(custom.threshAqiWarnColor, '#00AAFF');
  const orange = loaded({ threshAqiWarnColor: '#FFAA00', threshAqiDangerColor: '#FF0000' });
  assert.equal(orange.threshAqiWarnColor, '#FFAA00');
  assert.equal(orange.threshAqiDangerColor, '#FF0000');
});

test('the on-open heal, the page\'s colours and the packer follow ONE colour rule', () => {
  // For every colour shape a stored blob can hold, on every theme: the heal leaves the
  // bytes the watch receives unchanged, stores exactly what the page previews, and
  // that is the colour the packer resolves (status-thresholds.js thresholdColor).
  const shapes = [undefined, '', null, 0x000000, 0xFFFFFF, '#000000', '#ffffff', 0xFF0000,
    '#00AAFF', '#55ff00', 'garbage'];
  ['dark', 'light', 'bw', 'bw-light'].forEach((theme) => STEMS.forEach((stem) => shapes.forEach((v) => {
    ['Warn', 'Danger'].forEach((which) => {
      const key = 'thresh' + stem + which + 'Color';
      const S = { theme };
      if (v !== undefined) { S[key] = v; }
      const before = wire.buildSettingsBlob(Object.assign({}, S), { color: true });
      onbuild.onLoad({ env: { platform: 'basalt' }, get: k => S[k], set: (k, x) => { S[k] = x; },
        getInitial: k => S[k] });
      const label = theme + ' ' + key + '=' + JSON.stringify(v);
      assert.deepEqual(wire.buildSettingsBlob(S, { color: true }), before, label + ': same bytes');
      const drawn = PC.color.intToHex(thresholds.thresholdColor(S, stem, which));
      if (thresholds.isAutoColor(v)) {
        assert.equal(S[key], drawn, label + ': the heal stores what the watch draws');
      }
      const shown = PC.displayResolvers.get('thresholdColor')(S, { color: true },
        { keyStem: stem, which: which });
      if (theme === 'dark' || theme === 'light') {
        assert.equal(shown, drawn, label + ': the picker shows it too');
      } else {
        assert.equal(shown, theme === 'bw' ? '#FFFFFF' : '#000000', label + ': B&W draws the text colour');
      }
    });
  })));
});

test('a goal kind\'s white pick previews the goal green the watch draws (not white)', () => {
  const cfg = PC.rangeResolvers.get('thresholdRange')(
    { threshStepsWarnColor: '#FFFFFF', threshStepsDangerColor: '#000000' }, ENV, { keyStem: 'Steps' });
  assert.equal(cfg.warnColor, thresholds.DEFAULT_GOAL_HEX);
  assert.equal(cfg.dangerColor, thresholds.DEFAULT_GOAL_HEX);
  // A weather danger picked black on the dark theme previews the text colour, white.
  const uv = PC.rangeResolvers.get('thresholdRange')({ threshUvDangerColor: '#000000' }, ENV,
    { keyStem: 'Uv' });
  assert.equal(uv.dangerColor, '#FFFFFF');
});

// --- the engine's role/zone mapping -----------------------------------------

test('thresholdValues maps roles to track order by direction and clamps strays', () => {
  const E = PC.engine;
  const below = { min: 0, max: 20000, dir: 'below', seedWarn: 5000, seedDanger: 2500 };
  assert.deepEqual(E.thresholdValues(below, '5000', '2500'),
    { lo: 2500, hi: 5000, warn: 5000, danger: 2500 });
  const above = { min: 0, max: 120, dir: 'above', seedWarn: 40, seedDanger: 60 };
  assert.deepEqual(E.thresholdValues(above, '40', '60'),
    { lo: 40, hi: 60, warn: 40, danger: 60 });
  // Blanks fall back to the seeds; decimals and comma decimals both parse.
  assert.deepEqual(E.thresholdValues(above, '', ''),
    { lo: 40, hi: 60, warn: 40, danger: 60 });
  const sleep = { min: 0, max: 12, dir: 'below', seedWarn: 7, seedDanger: 6 };
  assert.equal(E.thresholdValues(sleep, '7,5', '6').warn, 7.5);
  // A stored value beyond the track pins to the bound instead of stranding a thumb.
  assert.equal(E.thresholdValues(above, '40', '500').danger, 120);
});

// --- end-to-end: the real generated page against a fake DOM ------------------
// The boot harness itself lives in test/helpers/page-harness.js — the dim-backlight
// colour sheet drives the same boot path from its own file, and a second copy of it
// here would be one more thing to drift.
const { bootGeneratedPage } = require('./helpers/page-harness.js');

// A row carrying the given data-k, muted (row class `dis`) — e.g. the warn look's row.
const disabledRowWith = (html, key) => new RegExp('<div class="row[^"]*\\bdis\\b[^"]*">'
  + '(?:(?!<div class="row)[\\s\\S])*?data-k="' + key + '"').test(html);
// A card header in a rendered page or dialog: a subheader becomes a card titled by it.
const cardTitle = title => '<span class="ttl">' + title + '</span>';

/**
 * Open a kind's alert sheet from the Alerts tab, with its More options out: the Days,
 * the tomorrow mark, the warn look and its colours ride them (more: true).
 * @param {Object} page The page-harness handle.
 * @param {string} stem Kind key stem.
 */
function openAlertSheet(page, stem) {
  page.clickTab('alerts');
  page.openEditSheet('alert' + stem);
  page.openAllMore('modal');
}

test('the sheets: the levels and look stay live whatever the slot Highlight, which writes no numbers', () => {
  const page = bootGeneratedPage();
  page.clickTab('watch');
  assert.ok(page.scroll.innerHTML.indexOf('data-edit-sheet="threshAqi"') !== -1,
    'the default AQI forecast slot renders its pencil');
  // The AQI levels live in the kind's alert sheet (the Alerts tab), which has no switch
  // (its Shows on grid places the alert); the slot's Alert highlighting switch lives in
  // the slot sheet.
  openAlertSheet(page, 'Aqi');
  assert.equal(page.modal.innerHTML.indexOf('data-k="threshAqiOn"'), -1,
    'the alert sheet carries no highlight toggle');
  assert.ok(page.modal.innerHTML.indexOf(cardTitle('Alert levels')) !== -1, 'the levels card renders');
  assert.ok(page.modal.innerHTML.indexOf('data-k="alertAqiDisplay"')
    > page.modal.innerHTML.indexOf(cardTitle('Alert levels')),
    'the alert\'s Look row follows the levels group (the owner\'s order, 2026-10-01)');
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshAqiWarnLook"') !== -1,
    'the warn look renders (under the card\'s More options)');
  // The slider is LIVE on the seeds (default cfg is WAQI → US AQI), and so are the
  // warn look and colors: they style the alert icon whether or not the slot is
  // highlighted.
  assert.ok(page.modal.innerHTML.indexOf('data-range="threshAqiWarn"') !== -1,
    'the slider renders while the highlight is off');
  assert.ok(!/class="row stack[^"]*\bdis\b/.test(page.modal.innerHTML),
    'the slider row is live');
  assert.ok(!disabledRowWith(page.modal.innerHTML, 'threshAqiWarnLook'),
    'the warn look is live while the slot highlight is off');
  assert.ok(page.modal.innerHTML.indexOf('Warn 100') !== -1,
    'the slider shows the seed values');
  assert.ok(page.modal.innerHTML.indexOf('reaching warn') !== -1,
    'the sheet carries the Alert levels intro');
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('data-zone="warn"') !== -1 && sheet.indexOf('data-zone="danger"') !== -1,
    'semantic zones rendered');
  assert.ok(sheet.indexOf('th-warn') !== -1 && sheet.indexOf('th-danger') !== -1,
    'role-styled thumbs rendered');
  assert.ok(sheet.indexOf('Example:') === -1,
    'no "Example:" label on the chip readout (dropped by user request)');
  assert.ok(sheet.indexOf('Warn 100') !== -1 && sheet.indexOf('Danger 150') !== -1,
    'readout chips carry the values');
  assert.ok(sheet.indexOf('data-max-edit="threshAqiMax"') !== -1,
    'AQI is unbounded → scale-max editor present');
  assert.ok(/<span class="ttl">Alert levels<\/span><button type="button" class="lbl-act" data-action="resetThresholds" data-action-arg="Aqi"/
    .test(sheet), 'the reset-to-defaults button rides the levels card\'s header');

  // The slot sheet's Highlight switch is its own stored state: neither ON nor OFF
  // touches the pair, which stays blank (= the seed for the AQI scale in effect).
  page.openEditSheet('threshAqi');
  page.clickModalToggle('threshAqiOn');
  assert.equal(page.S.threshAqiOn, true);
  assert.equal(page.S.threshAqiWarn, '', 'toggling on pins no warn');
  assert.equal(page.S.threshAqiDanger, '', 'toggling on pins no danger');
  page.clickModalToggle('threshAqiOn');
  assert.strictEqual(page.S.threshAqiOn, false, 'the stored toggle is off');
  assert.equal(page.S.threshAqiWarn, '', 'toggling off leaves the warn');
  assert.equal(page.S.threshAqiDanger, '', 'toggling off leaves the danger');
  openAlertSheet(page, 'Aqi');
  assert.ok(page.modal.innerHTML.indexOf('data-range="threshAqiWarn"') !== -1, 'the slider renders');
  assert.ok(!/class="row stack[^"]*\bdis\b/.test(page.modal.innerHTML),
    'the slider stays live with the highlight off');
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshAqiWarnLook"') !== -1, 'the warn look renders');
  assert.ok(!disabledRowWith(page.modal.innerHTML, 'threshAqiWarnLook'),
    'and so does the warn look');
});

// A goal kind keeps its switch on the Goals header, and its highlight-only rows mute
// while it is off.
test('the goal sheet: the switch rides the Goals header and mutes the warn look while off', () => {
  const page = bootGeneratedPage({ healthMode: 'status', statusHealthLeft: 'steps' });
  page.clickTab('watch');
  page.openEditSheet('threshSteps');
  // The Goals subheader opens a card of its own; the switch sits in that card's header.
  assert.ok(/<div class="cardHdr"><span class="ttlwrap"><span class="ttl">Goals<\/span>(?:(?!<\/div>)[\s\S])*<button class="sw" data-k="threshStepsOn" data-toggle="1"/
    .test(page.modal.innerHTML), 'the switch rides the Goals card header');
  assert.ok(disabledRowWith(page.modal.innerHTML, 'threshStepsWarnLook'),
    'the warn look is muted while the goals are off');
  page.clickModalToggle('threshStepsOn');
  assert.ok(!disabledRowWith(page.modal.innerHTML, 'threshStepsWarnLook'),
    'and live once they are on');
});

test('the page renders an alert sheet: its Shows on grid, the levels, then the Look, and no switch', () => {
  const page = bootGeneratedPage();
  openAlertSheet(page, 'Uv');
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('UV index alert') !== -1, 'the sheet carries its title');
  assert.equal(sheet.indexOf('data-k="alertUv"'), -1, 'no switch: its Shows on grid places the alert');
  assert.equal(sheet.indexOf(cardTitle('Alert')), -1, 'and no Alert card');
  assert.ok(sheet.indexOf('<div class="dlg-intro">Shows the UV icon at the edge of a status bar when the UV index reaches your warn level at any point left today, so an afternoon peak shows from the morning on.</div>') !== -1,
    'with its intro, in view');
  const at = (frag) => {
    const i = sheet.indexOf(frag);
    assert.ok(i !== -1, frag + ' renders');
    return i;
  };
  const card = '<div class="hint" data-hint-for="threshUvWarn">By default, warn sits at 6';
  assert.ok(at(cardTitle('Shows on')) < at('aria-label="Shows on"'), 'the Shows on card');
  assert.ok(at('aria-label="Shows on"') < at(cardTitle('Alert levels')), 'the grid first');
  assert.ok(at(cardTitle('Alert levels')) < at('<div class="lbl">Warn · danger</div>'), 'the levels card');
  // The card on the default levels is the slider's info text, in view under its label.
  assert.ok(at('<div class="lbl">Warn · danger</div>') < at(card), 'the slider\'s label');
  assert.ok(at(card) < at('data-range="threshUvWarn"'), 'the card, under it');
  assert.ok(at('data-range="threshUvWarn"') < at('data-k="alertUvDisplay"'), 'the slider');
  assert.ok(at('data-k="alertUvDisplay"') < at('data-k="alertUvDays"'), 'then the Look');
  assert.ok(at('data-k="alertUvDays"') < at('data-k="threshUvWarnLook"'), 'then the Days');
  assert.ok(sheet.indexOf('data-range="threshUvWarn"') !== -1, 'the slider renders');
  assert.ok(sheet.indexOf('data-k="threshUvBoldMode"') === -1
    && sheet.indexOf('data-k="uvSlotDisplay"') === -1,
    'no slot rows: those stay on the slot sheet');
  assert.equal(sheet.indexOf('data-k="threshUvOn"'), -1,
    'nor the slot\'s Highlight switch');
});

// The warn look row: 'Warn look' / 'Close look', a hint for the SELECTED look only,
// and — on a B&W watch or B&W day theme — the text-colour wording, whose Fill line
// says it matches danger there; a B&W NIGHT theme only appends that note to Fill.
test('the warn look row: label, the selected look\'s hint, and the B&W wording', () => {
  const lookFor = stem => sheetFor(stem).items.concat(levelsSheetFor(stem).items)
    .filter(it => it.messageKey === 'thresh' + stem + 'WarnLook')[0];
  const wind = lookFor('Wind');
  const steps = lookFor('Steps');
  assert.equal(wind.label, 'Warn look');
  assert.equal(steps.label, 'Close look');
  assert.equal(wind.hint, undefined, 'no all-options hint');
  assert.deepEqual(Object.keys(wind.hintByValue), ['none', 'outline', 'fill']);
  assert.equal(wind.hintFrom.resolver, 'warnLookHint');
  // The resolver gets the voice's whole look copy; its base IS the row's own hints.
  assert.deepEqual(Object.keys(wind.hintFrom.args), ['keyStem', 'copy']);
  assert.equal(wind.hintFrom.args.copy.base, wind.hintByValue);
  assert.equal(steps.hintFrom.args.copy.base, steps.hintByValue);
  assert.match(wind.hintByValue.none, /Bold row/, 'none says where the bold comes from');
  assert.match(steps.hintByValue.none, /Bold row above/);
  assert.match(wind.hintByValue.fill, /contrasting color/);
  assert.match(wind.hintFrom.args.copy.bw.fill, /looks the same as danger\.$/);
  assert.match(steps.hintFrom.args.copy.bw.fill, /looks the same as a reached goal\.$/);
  assert.equal(wind.hintFrom.args.copy.bw.none, undefined, 'none reads the same on B&W');

  const hint = PC.hintResolvers.get('warnLookHint');
  const args = v => Object.assign({ value: v }, wind.hintFrom.args);
  assert.equal(hint({ theme: 'dark' }, ENV, args('fill')), null, 'colour: the row\'s own hint');
  assert.equal(hint({ theme: 'bw' }, ENV, args('fill')), wind.hintFrom.args.copy.bw.fill, 'B&W theme');
  assert.equal(hint({ theme: 'bw-light' }, ENV, args('outline')), wind.hintFrom.args.copy.bw.outline);
  assert.equal(hint({ theme: 'dark', themeAuto: false, themeNight: 'bw' }, ENV, args('fill')), null,
    'a night theme that never switches in');
  assert.equal(hint({ theme: 'dark' }, Object.assign({}, ENV, { color: false }), args('fill')),
    wind.hintFrom.args.copy.bw.fill, 'a B&W watch');
  assert.equal(hint({ theme: 'bw' }, ENV, args('none')), null, 'none keeps its own hint');

  // A colour DAY theme with a B&W NIGHT theme: by day the box is in the picked colour
  // (the picker shows), so the colour hint stands and fill adds the night note.
  const night = hint({ theme: 'dark', themeAuto: true, themeNight: 'bw' }, ENV, args('fill'));
  assert.equal(night, wind.hintByValue.fill + ' ' + wind.hintFrom.args.copy.night.fill, 'a B&W night theme');
  assert.match(night, /At night \(black-and-white theme\) this looks the same as danger\.$/);
  assert.equal(hint({ theme: 'dark', themeAuto: true, themeNight: 'bw' }, ENV, args('outline')), null,
    'outline keeps its colour hint at night');
  const stepsArgs = v => Object.assign({ value: v }, steps.hintFrom.args);
  assert.match(hint({ theme: 'light', themeAuto: true, themeNight: 'bw-light' }, ENV, stepsArgs('fill')),
    /close color.*At night \(black-and-white theme\).*looks the same as a reached goal\./);

  // A colour screen where Fill's two colours are the same: that fill IS the danger /
  // reached-goal box, and the hint says so. A goal kind's defaults are both the goal
  // green; a weather warn pick can equal its danger (unset danger = red).
  assert.equal(hint({ theme: 'dark', threshStepsWarnColor: '#55FF00', threshStepsDangerColor: '#55FF00' },
    ENV, stepsArgs('fill')), steps.hintByValue.fill + ' ' + steps.hintFrom.args.copy.sameColor,
    'goal defaults: close fill looks like a reached goal');
  assert.match(steps.hintFrom.args.copy.sameColor, /looks like a reached goal/);
  assert.equal(hint({ theme: 'dark', threshWindWarnColor: '#FF0000', threshWindDangerColor: '' },
    ENV, args('fill')), wind.hintByValue.fill + ' ' + wind.hintFrom.args.copy.sameColor,
    'a red warn pick against the red danger default');
  assert.equal(hint({ theme: 'dark', threshWindWarnColor: '', threshWindDangerColor: '' },
    ENV, args('fill')), null, 'default warn (text colour) and default danger (red) differ');
  assert.equal(hint({ theme: 'dark', threshWindWarnColor: '#FF0000', threshWindDangerColor: '' },
    ENV, args('outline')), null, 'only Fill can be mistaken for danger');

  // Rendered: the colour watch opens on Fill with its hint; a B&W watch on Outline.
  const colour = bootGeneratedPage({ provider: 'dwd' });
  openAlertSheet(colour, 'Uv');
  assert.ok(colour.modal.innerHTML.indexOf('<button class="on" data-k="threshUvWarnLook" data-v="fill">') !== -1,
    'colour watch: Fill selected by default');
  assert.ok(colour.modal.innerHTML.indexOf('data-hint-for="threshUvWarnLook">' + wind.hintByValue.fill + '<') !== -1,
    'with the Fill hint');
  assert.ok(colour.modal.innerHTML.indexOf('>Warn color<') !== -1, 'and the Warn color picker');
  const bw = bootGeneratedPage({ provider: 'dwd' }, 'diorite');
  openAlertSheet(bw, 'Uv');
  assert.ok(bw.modal.innerHTML.indexOf('<button class="on" data-k="threshUvWarnLook" data-v="outline">') !== -1,
    'B&W watch: Outline selected by default');
  assert.ok(bw.modal.innerHTML.indexOf('data-hint-for="threshUvWarnLook">' + wind.hintFrom.args.copy.bw.outline + '<') !== -1,
    'with the text-colour wording');
  assert.equal(bw.modal.innerHTML.indexOf('data-k="threshUvWarnColor"'), -1, 'no colour picker on B&W');
});

test('the reset button blanks the pair, restores default colors, clears the scale max', () => {
  // Wind, not Aqi: the wizard seeds no wind row, so its fresh-install state is the
  // plain schema one — blank pair, highlight off. Aqi's wizard-seeded landing has
  // its own test ('Aqi reset lands on the wizard-seeded fresh-install state').
  const page = bootGeneratedPage({
    provider: 'dwd',
    threshWindWarn: '42', threshWindDanger: '77',
    threshWindWarnColor: '#00AAFF', threshWindDangerColor: '#5500FF',
    threshWindMax: '900'
  });
  // The reset rides the levels card's header in the kind's alert sheet (Alerts tab).
  openAlertSheet(page, 'Wind');
  assert.ok(/<span class="ttl">Alert levels<\/span><button type="button" class="lbl-act" data-action="resetThresholds" data-action-arg="Wind"/
    .test(page.modal.innerHTML), 'the reset button renders on the levels card');
  const t = {
    getAttribute: n => (n === 'data-action' ? 'resetThresholds'
      : n === 'data-action-arg' ? 'Wind' : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  const writesBefore = page.modal.writes;
  page.modal.dispatch('click', { target: t });
  // Blank, not seeded: a blank pair IS the kind's seed (resolved live, so a wind
  // pair follows windUnits again) — exactly what a fresh install stores — and the
  // stored highlight toggle lands off with it.
  assert.strictEqual(page.S.threshWindOn, false, 'highlight off, as on a fresh install');
  assert.equal(page.S.threshWindWarn, '', 'warn blanked');
  assert.equal(page.S.threshWindDanger, '', 'danger blanked');
  assert.equal(page.S.threshWindWarnColor, '', 'warn colour back to auto');
  assert.equal(page.S.threshWindWarnLook, 'fill', 'warn look back to the colour watch\'s default');
  assert.equal(page.S.threshWindDangerColor, '', 'danger colour back to its schema default, unset');
  assert.equal(page.S.threshWindMax, '', 'scale-max override cleared');
  assert.ok(page.modal.writes > writesBefore, 'the reset re-rendered the sheet');
  // The pickers paint what the watch draws for the unset colours straight away (the
  // contract's thresholdColor): the text colour for warn, red for danger.
  page.openEditSheet('alertWind');
  const html = page.modal.innerHTML;
  assert.ok(html.indexOf('data-color="threshWindWarnColor"><b style="background:#FFFFFF">') !== -1,
    'the warn picker shows the dark theme\'s text colour');
  assert.ok(html.indexOf('data-color="threshWindDangerColor"><b style="background:#FF0000">') !== -1,
    'the danger picker shows the red');
});

test('an enabled kind shows the ring+dot swatch beside its slot control', () => {
  const page = bootGeneratedPage({
    provider: 'dwd',
    threshAqiOn: true, threshAqiWarn: '50', threshAqiDanger: '100', threshAqiWarnLook: 'outline'
  });
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  // Slice the whole control cell rather than a window around the Edit button: the
  // swatch LEADS the control and the button TRAILS it, so a window anchored on the
  // button would have to reach backwards past the dropdown to find the dots.
  const at = html.indexOf('data-edit-sheet="threshAqi"');
  const cell = html.slice(html.lastIndexOf('<div class="rgt has-pen">', at), at + 300);
  // The library names the two dots by SHAPE (the badge's generic vocabulary); the
  // threshold meaning — warn is the outline, danger is the fill — rides the order
  // thresholdPenState builds them in, and that visual difference must survive.
  assert.ok(cell.indexOf('pen-dot ring') !== -1, 'warn ring rendered');
  assert.ok(cell.indexOf('pen-dot fill') !== -1, 'danger dot rendered');
  assert.ok(cell.indexOf('pen-dot ring') < cell.indexOf('pen-dot fill'),
    'the warn OUTLINE leads the danger FILL');
  // Never-customized colors are auto: they track the theme fg (dark default → white).
  assert.ok(cell.indexOf('--th-c:#FFFFFF') !== -1, 'auto colors resolve to the theme fg');
  assert.ok(cell.indexOf('highlighting on') !== -1, 'aria-label says the state');
  // The swatch is a preview, not a control: outside the button, nothing to press.
  assert.ok(/thr-swatch[\s\S]*?data-select=/.test(cell), 'swatch leads the dropdown');
  assert.ok(!/thr-btn[^>]*>[\s\S]*?pen-dot/.test(cell), 'dots must not sit inside the button');

  // The warn pip follows the look: the colour watch's default fill is a filled dot
  // leading the danger dot, and 'none' drops the pip (the watch draws no warn box).
  const fillCell = (look) => {
    const p = bootGeneratedPage(Object.assign({ provider: 'dwd',
      threshAqiOn: true, threshAqiWarn: '50', threshAqiDanger: '100' }, look));
    p.clickTab('watch');
    const h = p.scroll.innerHTML;
    const a = h.indexOf('data-edit-sheet="threshAqi"');
    return h.slice(h.lastIndexOf('<div class="rgt has-pen">', a), a + 300);
  };
  const fill = fillCell({});
  assert.equal(fill.indexOf('pen-dot ring'), -1, 'default fill: no ring');
  assert.equal(fill.split('pen-dot fill').length - 1, 2, 'default fill: two filled dots');
  const none = fillCell({ threshAqiWarnLook: 'none' });
  assert.equal(none.indexOf('pen-dot ring'), -1, 'none: no ring');
  assert.equal(none.split('pen-dot fill').length - 1, 1, 'none: the danger dot alone');

  const off = bootGeneratedPage();
  off.clickTab('watch');
  // The status bars' slot pencils only: the Alerts tab's Weather alerts card badges the
  // placed alerts' colours of its own (alertLevelBadge), and the bars' Alerts rows (links
  // to the Alerts tab) carry no badge.
  const statusCard = off.scroll.innerHTML;
  assert.equal(statusCard.indexOf(cardTitle('Weather alerts')), -1, 'the Weather alerts card is not on this tab');
  assert.ok(statusCard.indexOf('data-goto-tab="alerts"') !== -1, 'the bars\' Alerts rows are');
  assert.ok(statusCard.indexOf('data-edit-sheet="threshAqi"') !== -1, 'the status card is in the slice');
  assert.equal(statusCard.indexOf('pen-dot'), -1,
    'no badge while every kind is disabled');
});

test('the stored toggle round-trips through hydrate, independent of its pair', () => {
  const on = bootGeneratedPage({
    provider: 'dwd',
    threshAqiOn: true, threshAqiWarn: '50', threshAqiDanger: '100'
  });
  assert.strictEqual(on.S.threshAqiOn, true, 'a stored ON hydrates as ON');
  on.clickTab('alerts');
  on.openEditSheet('alertAqi');
  assert.ok(on.modal.innerHTML.indexOf('data-range="threshAqiWarn"') !== -1,
    'the slider renders immediately with the stored values');
  assert.ok(on.modal.innerHTML.indexOf('Warn 50') !== -1, 'stored warn on the chip');
  // An OFF over an ordered pair used to be re-derived ON on the next open.
  const off = bootGeneratedPage({
    provider: 'dwd',
    threshAqiOn: false, threshAqiWarn: '50', threshAqiDanger: '100'
  });
  assert.strictEqual(off.S.threshAqiOn, false, 'a stored OFF stays OFF');
  assert.equal(off.S.threshAqiWarn, '50', 'its pair is kept');
  // And an ON over a blank pair stays ON: the blank resolves to the kind's seed.
  const seeded = bootGeneratedPage({
    provider: 'dwd',
    threshUvOn: true, threshUvWarn: '', threshUvDanger: ''
  });
  assert.strictEqual(seeded.S.threshUvOn, true, 'a stored ON over a blank pair stays ON');
});

// --- serialize/hydrate round-trip of the hidden companions ------------------
// The type:'hidden' Danger/Max rows are the ONLY thing keeping those keys in the
// save blob (serialize walks schema items); dropping them from the walk would
// silently discard the second thumb + scale max on every save.
test('hidden Danger/Max companions survive hydrate → serialize', () => {
  const stored = { threshStepsWarn: '8000', threshStepsDanger: '4000', threshStepsMax: '30000' };
  const S = PC.engine.hydrate(schema, stored, ENV);
  const blob = PC.engine.serialize(schema, S);
  assert.equal(blob.threshStepsWarn, '8000');
  assert.equal(blob.threshStepsDanger, '4000', 'the hidden danger key rides the save blob');
  assert.equal(blob.threshStepsMax, '30000', 'the hidden scale-max key rides the save blob');
  const fresh = PC.engine.serialize(schema, PC.engine.hydrate(schema, {}, ENV));
  assert.equal(fresh.threshStepsDanger, '', 'hidden keys hydrate their blank defaults');
  assert.equal(fresh.threshStepsMax, '');
});

// --- thresholdValues minSpan repair -----------------------------------------
// The old text UI accepted warn == danger; a stacked pair puts the danger thumb on
// top and, pinned at a track end, could never be separated by touch again. The
// resolve step separates the pair by one span, keeping the danger thumb's stored
// position wherever possible.
test('an equal legacy pair renders separated, even pinned at a track end', () => {
  const E = PC.engine;
  const above = { min: 0, max: 300, dir: 'above', step: 10, minSpan: 10, seedWarn: 100, seedDanger: 150 };
  assert.deepEqual(E.thresholdValues(above, '300', '300'),
    { lo: 290, hi: 300, warn: 290, danger: 300 }, 'above-kind at max: warn pushed down');
  assert.deepEqual(E.thresholdValues(above, '0', '0'),
    { lo: 0, hi: 10, warn: 0, danger: 10 }, 'above-kind at min: danger pushed up');
  const below = { min: 0, max: 20000, dir: 'below', step: 250, minSpan: 250, seedWarn: 5000, seedDanger: 2500 };
  assert.deepEqual(E.thresholdValues(below, '20000', '20000'),
    { lo: 19750, hi: 20000, warn: 20000, danger: 19750 }, 'below-kind at max: danger pushed down');
  assert.deepEqual(E.thresholdValues(below, '0', '0'),
    { lo: 0, hi: 250, warn: 250, danger: 0 }, 'below-kind at min: warn pushed up');
});

// --- badge resolver: env gate + picked colors --------------------------------
test('thresholdPenState honors its env gate and the color pickers', () => {
  const resolver = PC.badgeResolvers.get('thresholdPenState');
  const S = { statusForecastRight: 'aqi', threshAqiOn: true,
    threshAqiWarn: '50', threshAqiDanger: '100' };
  const args = { messageKey: 'statusForecastRight' };
  assert.equal(resolver(S, { thresholds: false }, args), null, 'gated off without env.thresholds');
  // The sheet configures the whole slot now, so the button says "Edit" for every
  // kind instead of naming one of its sections. The badge speaks the LIBRARY's
  // app-neutral vocabulary — a label, an aria note, and an ordered dot list —
  // with the threshold meaning carried by shape: the warn pip takes the kind's
  // warn look (ring = outline, dot = fill, absent = none), danger fills.
  assert.deepEqual(resolver(S, ENV, args),
    { label: 'Edit', ariaNote: 'highlighting on', bold: false,
      dots: [{ color: '#FFFFFF' }, { color: '#FF0000' }] },
    'the colour watch\'s default fill: a dot in the auto theme fg, then the red danger');
  assert.deepEqual(resolver(S, Object.assign({}, ENV, { color: false }), args).dots,
    [{ color: '#FFFFFF', ring: true }, { color: '#FFFFFF' }],
    'the B&W watch\'s default outline: a ring');
  assert.deepEqual(resolver(Object.assign({}, S, { threshAqiWarnLook: 'none' }), ENV, args),
    { label: 'Edit', ariaNote: 'highlighting on', bold: false,
      dots: [{ color: '#FF0000' }] },
    'the none look drops the warn pip');
  const picked = Object.assign({}, S, { threshAqiWarnColor: '#00AAFF', threshAqiDangerColor: '#5500FF',
    threshAqiWarnLook: 'outline' });
  assert.deepEqual(resolver(picked, ENV, args),
    { label: 'Edit', ariaNote: 'highlighting on', bold: false,
      dots: [{ color: '#00AAFF', ring: true }, { color: '#5500FF' }] });
  // The stored toggle owns the state (kindConfig.enabled = On && ordered): an
  // ordered pair with the highlight off — or never switched on — still gets its
  // labeled button, just without the state dots or the aria note (the button must
  // exist to configure the kind at all).
  const none = { label: 'Edit', ariaNote: '', bold: false, dots: [] };
  assert.deepEqual(resolver(Object.assign({}, S, { threshAqiOn: false }), ENV, args), none,
    'ordered pair, On false');
  const absent = Object.assign({}, S);
  delete absent.threshAqiOn;
  assert.deepEqual(resolver(absent, ENV, args), none, 'ordered pair, On absent');
  // A half pair with the toggle on highlights on the SEED pair (a blank or half
  // pair means the seed), so the dots show.
  const half = resolver(Object.assign({}, S, { threshAqiDanger: '' }), ENV, args);
  assert.equal(half.ariaNote, 'highlighting on');
  assert.equal(half.dots.length, 2);
  const goalArgs = { messageKey: 'statusHealthLeft' };
  const goalS = { statusHealthLeft: 'steps', threshStepsOn: true,
    threshStepsWarn: '4000', threshStepsDanger: '8000' };
  const goalBadge = resolver(goalS, ENV, goalArgs);
  assert.equal(goalBadge.label, 'Edit', 'goal kinds get the same button label');
  assert.equal(goalBadge.dots.length, 2);
});

// --- interaction stubs: drive the shared range machinery on the booted page ---

/** A .rng root stub the drag/keyboard handlers and paint fns accept.
 * @param {string} key data-range messageKey
 * @param {number|string} lo data-lo
 * @param {number|string} hi data-hi
 * @returns {Object} root stub
 */
function makeRngRoot(key, lo, hi) {
  const attrs = { 'data-range': key, 'data-lo': String(lo), 'data-hi': String(hi) };
  const styled = () => ({ style: {}, setAttribute() {}, innerHTML: '' });
  const nodes = {
    '[data-zone="warn"]': styled(),
    '[data-zone="danger"]': styled(),
    '[data-range-thumb=lo]': styled(),
    '[data-range-thumb=hi]': styled(),
    '.rng-val': styled(),
    '.rng-fill': styled(),
    '.rng-track': { getBoundingClientRect: () => ({ left: 0, width: 100 }) }
  };
  const root = {
    isConnected: true,
    getAttribute: n => (attrs[n] == null ? null : attrs[n]),
    setAttribute(n, v) { attrs[n] = String(v); },
    querySelector: sel => nodes[sel] || null,
    querySelectorAll: () => [],
    closest: sel => (sel === '.rng' ? root : null)
  };
  return root;
}

/** A thumb-button stub inside a root stub.
 * @param {Object} root rng root stub
 * @param {string} which 'lo' | 'hi'
 * @returns {Object} thumb stub
 */
function thumbOn(root, which) {
  const th = {
    getAttribute: n => (n === 'data-range-thumb' ? which : null),
    closest: sel => (sel === '[data-range-thumb]' ? th : (sel === '.rng' ? root : null)),
    focus() {}, setPointerCapture() {}, style: {}, setAttribute() {}
  };
  return th;
}
const NO_TARGET = { closest: () => null };

test('a pointer drag in the sheet commits both wire keys through the role mapping', () => {
  const page = bootGeneratedPage();   // healthMode defaults allow the Steps kind
  page.S.threshStepsWarn = '2500';
  page.S.threshStepsDanger = '5000';
  // Steps orders upward since the goal rework: lo = warn ("close") thumb. Track
  // stub is 100px over 0..20000.
  const root = makeRngRoot('threshStepsWarn', 2500, 5000);
  const th = thumbOn(root, 'lo');
  page.modal.dispatch('pointerdown', { target: th, pointerId: 7, preventDefault() {} });
  page.modal.dispatch('pointermove', { target: NO_TARGET, pointerId: 7, clientX: 10 });
  // 10% of 20000 = 2000, on the 250 grid.
  assert.equal(page.S.threshStepsWarn, '2000', 'the lo thumb wrote the WARN (close) key');
  assert.equal(page.S.threshStepsDanger, '5000', 'the goal key kept its value');
  page.modal.dispatch('pointerup', { target: NO_TARGET, pointerId: 7 });
  // After release the drag is over: further moves must not write.
  page.modal.dispatch('pointermove', { target: NO_TARGET, pointerId: 7, clientX: 90 });
  assert.equal(page.S.threshStepsWarn, '2000', 'no writes after pointerup');
});

test('a pair stacked at the track max can be pulled apart from the knob hidden underneath', () => {
  // Steps 19750/20000 on a 300px track: the thumbs are ~4px apart and the danger (goal)
  // knob sits on top, so every press on the visible warn knob hit the danger thumb —
  // which can move neither right (max) nor left (one span from warn). The drag went
  // nowhere and the pair stayed jammed. The press now goes to the hidden warn thumb.
  const page = bootGeneratedPage();
  page.S.threshStepsWarn = '19750';
  page.S.threshStepsDanger = '20000';
  /**
   * A 300px-track root whose thumbs report their 28px boxes.
   * @param {number} lo data-lo
   * @param {number} hi data-hi
   * @returns {Object} root stub with .thumbs.{lo,hi}
   */
  function stackRoot(lo, hi) {
    const root = makeRngRoot('threshStepsWarn', lo, hi);
    const px = v => (v * 300) / 20000;
    const thumbs = { lo: thumbOn(root, 'lo'), hi: thumbOn(root, 'hi') };
    thumbs.lo.getBoundingClientRect = () => ({ left: px(lo) - 14, right: px(lo) + 14 });
    thumbs.hi.getBoundingClientRect = () => ({ left: px(hi) - 14, right: px(hi) + 14 });
    const query = root.querySelector;
    root.querySelector = sel => (sel === '[data-range-thumb=lo]' ? thumbs.lo
      : sel === '[data-range-thumb=hi]' ? thumbs.hi
        : sel === '.rng-track' ? { getBoundingClientRect: () => ({ left: 0, width: 300 }) }
          : query(sel));
    root.thumbs = thumbs;
    return root;
  }
  const root = stackRoot(19750, 20000);
  // The hit test returns the danger thumb (on top); the finger is on the warn knob's centre.
  page.modal.dispatch('pointerdown', { target: root.thumbs.hi, pointerId: 5, clientX: 296.25, preventDefault() {} });
  page.modal.dispatch('pointermove', { target: NO_TARGET, pointerId: 5, clientX: 216.25 });
  page.modal.dispatch('pointerup', { target: NO_TARGET, pointerId: 5 });
  assert.equal(page.S.threshStepsWarn, '14500', 'the hidden close (warn) thumb followed the finger');
  assert.equal(page.S.threshStepsDanger, '20000', 'the goal stayed at the max');

  // Not pinned (mid-track stack): the top thumb can move, so it keeps the press.
  page.S.threshStepsWarn = '10000';
  page.S.threshStepsDanger = '10250';
  const mid = stackRoot(10000, 10250);
  page.modal.dispatch('pointerdown', { target: mid.thumbs.hi, pointerId: 6, clientX: 152, preventDefault() {} });
  page.modal.dispatch('pointermove', { target: NO_TARGET, pointerId: 6, clientX: 225 });
  page.modal.dispatch('pointerup', { target: NO_TARGET, pointerId: 6 });
  assert.equal(page.S.threshStepsDanger, '15000', 'a free top thumb is dragged as hit');
  assert.equal(page.S.threshStepsWarn, '10000');

  // Pinned, but the finger is on the far side of the top knob, clear of the other
  // knob's box: that knob is not what the finger is on, so no hand-over.
  page.S.threshStepsWarn = '19750';
  page.S.threshStepsDanger = '20000';
  const far = stackRoot(19750, 20000);
  page.modal.dispatch('pointerdown', { target: far.thumbs.hi, pointerId: 7, clientX: 312, preventDefault() {} });
  page.modal.dispatch('pointermove', { target: NO_TARGET, pointerId: 7, clientX: 216.25 });
  page.modal.dispatch('pointerup', { target: NO_TARGET, pointerId: 7 });
  assert.equal(page.S.threshStepsWarn, '19750', 'no hand-over outside the hidden knob');
  assert.equal(page.S.threshStepsDanger, '20000');
});

test('keyboard nudge steps half-units and keeps the untouched decimal thumb intact', () => {
  const page = bootGeneratedPage();
  page.S.threshSleepWarn = '6.5';
  page.S.threshSleepDanger = '7.5';
  // Sleep orders upward since the goal rework: hi = danger ("goal") thumb; step
  // 0.5. parseInt on data-lo would silently turn the untouched close 6.5 into 6 —
  // the float regression this pins.
  const root = makeRngRoot('threshSleepWarn', 6.5, 7.5);
  const th = thumbOn(root, 'hi');
  page.modal.dispatch('keydown', { target: th, key: 'ArrowRight', preventDefault() {} });
  assert.equal(page.S.threshSleepDanger, '8', 'goal nudged one 0.5 step up');
  assert.equal(page.S.threshSleepWarn, '6.5', 'close kept its stored half-unit');
});

test('the pre-existing plain slider (hrScale) still commits its lo-hi string', () => {
  const page = bootGeneratedPage();
  page.S.hrScale = '40-180';
  const root = makeRngRoot('hrScale', 40, 180);
  const th = thumbOn(root, 'lo');
  page.scroll.dispatch('keydown', { target: th, key: 'ArrowLeft', preventDefault() {} });
  assert.equal(page.S.hrScale, '35-180', 'the shared path still writes the "lo-hi" contract');
});

test('the inline scale-max editor: open, sanitize, and untouched-blur writes nothing', () => {
  const page = bootGeneratedPage();
  page.openEditSheet('alertAqi');
  // openMaxEdit: the click swaps the wrap's markup for a seeded numeric field.
  const wrap = { innerHTML: '', querySelector: () => ({ focus() {}, select() {} }) };
  const btn = {
    getAttribute: n => (n === 'data-max-edit' ? 'threshAqiMax'
      : n === 'data-max-current' ? '300' : null),
    closest: sel => (sel === '[data-max-edit]' ? btn : (sel === '.rng-max' ? wrap : null))
  };
  page.modal.dispatch('click', { target: btn });
  assert.ok(wrap.innerHTML.indexOf('data-max-input="threshAqiMax"') !== -1,
    'the max label swapped for the inline field');
  assert.ok(wrap.innerHTML.indexOf('data-max-seed="300"') !== -1,
    'the field carries its seed for the untouched-blur check');
  /**
   * @param {string} value field text at blur
   * @returns {Object} focusout event stub
   */
  function blurWith(value) {
    const inp = {
      value,
      getAttribute: n => (n === 'data-max-input' ? 'threshAqiMax'
        : n === 'data-max-seed' ? '300' : null),
      closest: sel => (sel === '[data-max-input]' ? inp : null)
    };
    return { target: inp };
  }
  page.modal.dispatch('focusout', blurWith('300'));
  assert.equal(page.S.threshAqiMax, '', 'blurring the untouched field stores no override');
  page.modal.dispatch('focusout', blurWith('500'));
  assert.equal(page.S.threshAqiMax, '500', 'an edited value is stored raw');
  // This stub field sits in no .rng root, so it takes commitMaxEdit's full-render
  // fallback; the real in-place fold-back is pinned by the next test.
  assert.ok(page.modal.innerHTML.indexOf('data-max-current="500"') !== -1,
    'the re-render shows the grown scale');
  page.modal.dispatch('focusout', blurWith('abc'));
  assert.equal(page.S.threshAqiMax, '', 'garbage clears the override instead of storing it');
});

test('closing the scale-max field rebuilds only its slider, so the tap that closed it still lands', () => {
  // On a tap, focus moves on the mousedown, BEFORE the click. The focusout used to
  // re-render the whole sheet, replacing the node being tapped (the sheet's X, a Bold
  // option …), so that click never arrived and every first tap after the editor was
  // swallowed. Now only the slider's own .rng root is rebuilt in place.
  const page = bootGeneratedPage();
  page.openEditSheet('alertAqi');
  page.S.threshAqiWarn = '50';
  page.S.threshAqiDanger = '100';
  /**
   * A focusout from the inline field, inside a .rng root whose outerHTML setter
   * records the in-place swap.
   * @param {string} value field text at blur
   * @param {string} seed the max the field was opened with
   * @returns {{ev: Object, swapped: function(): ?string}} event + recorded swap
   */
  function blurIn(value, seed) {
    let swapped = null;
    const root = {
      parentNode: {},
      getAttribute: n => (n === 'data-range' ? 'threshAqiWarn' : null),
      set outerHTML(v) { swapped = v; },
      get outerHTML() { return swapped; }
    };
    const inp = {
      value,
      getAttribute: n => (n === 'data-max-input' ? 'threshAqiMax'
        : n === 'data-max-seed' ? seed : null),
      closest: sel => (sel === '[data-max-input]' ? inp : sel === '.rng' ? root : null)
    };
    return { ev: { target: inp }, swapped: () => swapped };
  }
  const modalWrites = page.modal.writes, scrollWrites = page.scroll.writes;

  const edited = blurIn('500', '300');
  page.modal.dispatch('focusout', edited.ev);
  assert.equal(page.S.threshAqiMax, '500', 'the edited max is stored');
  assert.equal(page.modal.writes, modalWrites,
    'no full re-render: the rest of the sheet stays attached for the pending click');
  assert.equal(page.scroll.writes, scrollWrites, 'nor of the tab body behind it');
  const html = edited.swapped();
  assert.ok(html, 'the slider was rebuilt in place');
  assert.match(html, /^<div class="rng" data-range="threshAqiWarn" data-lo="50" data-hi="100">/);
  assert.ok(html.indexOf('data-max-current="500"') !== -1, 'the rebuilt slider shows the grown scale');
  assert.equal(html.indexOf('data-max-input'), -1, 'the field folded back into its label');
  assert.ok(html.indexOf('data-max-edit="threshAqiMax"') !== -1, 'and the pencil is back');

  // The in-place copy is exactly what a full render draws for that slider: a grab and
  // release of a thumb (endRangeDrag renders once) must reproduce it byte for byte.
  const root = makeRngRoot('threshAqiWarn', 50, 100);
  page.modal.dispatch('pointerdown', { target: thumbOn(root, 'lo'), pointerId: 3, preventDefault() {} });
  page.modal.dispatch('pointerup', { target: NO_TARGET, pointerId: 3 });
  assert.equal(page.modal.writes, modalWrites + 1, 'the release rendered once');
  assert.ok(page.modal.innerHTML.indexOf(html) !== -1,
    'the in-place slider matches the full render of the same state');

  // Opened and left unchanged: nothing stored, but the field still folds back.
  const untouched = blurIn('500', '500');
  page.modal.dispatch('focusout', untouched.ev);
  assert.equal(page.S.threshAqiMax, '500', 'an untouched field writes nothing');
  assert.equal(page.modal.writes, modalWrites + 1, 'still no full re-render');
  assert.ok(untouched.swapped() && untouched.swapped().indexOf('data-max-edit=') !== -1,
    'the untouched field folds back too (nothing else would)');

  // Blurred by grabbing a thumb: the drag owns the slider until release — no swap now,
  // and the release's render folds the field back.
  page.modal.dispatch('pointerdown', { target: thumbOn(root, 'hi'), pointerId: 4, preventDefault() {} });
  const mid = blurIn('700', '500');
  page.modal.dispatch('focusout', mid.ev);
  assert.equal(page.S.threshAqiMax, '700', 'the value still commits mid-drag');
  assert.equal(mid.swapped(), null, 'no swap under a live drag');
  assert.equal(page.modal.writes, modalWrites + 1, 'and no render under it either');
  page.modal.dispatch('pointerup', { target: NO_TARGET, pointerId: 4 });
  assert.equal(page.modal.writes, modalWrites + 2, 'the release renders, folding the field back');
});

// The section-level platform gate has to survive into the FLAT generated page (the
// concatenated <script> the webview really runs), not just the module-level engine:
// aplite compiles the highlight out (no WW_THRESHOLD_HIGHLIGHT), so a threshold card
// there would be a settings card that silently does nothing.
test('the real generated page: threshold pencils + sheet on basalt, nothing on aplite', () => {
  const aplite = bootGeneratedPage({ provider: 'dwd' }, 'aplite');
  aplite.clickTab('watch');
  aplite.openAllMore('scroll');   // the master Bold row rides More options: look behind them too
  const apliteWatch = aplite.scroll.innerHTML;
  assert.equal(apliteWatch.indexOf('data-edit-sheet'), -1,
    'no threshold pencil on aplite (env.thresholds is false)');
  ['threshAqiOn', 'threshAqiWarn', 'threshWindOn', 'threshStepsOn',
    'threshAqiWarnColor', 'statusBoldAll'].forEach((k) =>
    assert.equal(apliteWatch.indexOf('data-k="' + k + '"'), -1, k + ' absent on aplite'));
  // Time/Calendar live in the Watchface tab, so probe an always-shown
  // Watch-Status-Bar toggle instead.
  assert.ok(apliteWatch.indexOf('data-k="showQt"') !== -1,
    'the rest of the Status bars tab still renders on aplite');
});

// --- the slot sheet's shape: Bold row above its own thresholds/goals group ----

/** @returns {Object[]} Every threshold sheet section, in schema order. */
function sheetSections() {
  const out = [];
  schema.tabs.forEach(t => (t.sections || []).forEach(s => {
    if (s.sheetOnly && /^thresh/.test(s.sheetId || '')) { out.push(s); }
  }));
  return out;
}
/** @param {string} stem Kind key stem. @returns {Object} That kind's sheet. */
function sheetFor(stem) {
  const s = sheetSections().find(x => x.sheetId === 'thresh' + stem);
  assert.ok(s, 'no sheet for ' + stem);
  return s;
}
/**
 * @param {string} stem Kind key stem.
 * @returns {Object} The sheet holding the kind's levels group: its alert sheet in the
 *     Alert settings card for an alert kind, its slot sheet for a goal kind.
 */
function levelsSheetFor(stem) {
  let s = null;
  schema.tabs.forEach(t => (t.sections || []).forEach(x => {
    if (x.sheetOnly && x.sheetId === levelsSheetId(stem)) { s = x; }
  }));
  assert.ok(s, 'no levels sheet for ' + stem);
  return s;
}
/** @param {string} stem Kind key stem. @returns {Object} Its levels group's subheader. */
function headerFor(stem) {
  const hdr = levelsSheetFor(stem).items.find(it => it.type === 'subheader'
    && (it.text === 'Alert levels' || it.text === 'Goals'));
  assert.ok(hdr, stem + ' has no levels subheader');
  return hdr;
}
/** @param {string} stem Kind key stem. @returns {Object} Its Bold row. */
function boldFor(stem) {
  const b = sheetFor(stem).items.find(it => it.messageKey === 'thresh' + stem + 'BoldMode');
  assert.ok(b, stem + ' has no bold row');
  return b;
}

test('each sheet is titled "<kind> slot", not "<kind> thresholds/goal"', () => {
  assert.equal(sheetFor('Wind').title, 'Wind speed slot');
  assert.equal(sheetFor('Gust').title, 'Wind gusts slot');
  assert.equal(sheetFor('Steps').title, 'Steps slot');
  assert.equal(sheetFor('Distance').title, 'Walked distance slot');
  sheetSections().forEach(s => {
    assert.match(s.title, / slot$/, s.sheetId + ' title');
  });
});

test('the master toggle moved off the sheet title row onto the group header', () => {
  sheetSections().forEach(s => {
    assert.equal(s.headerToggleKey, undefined, s.sheetId + ' still has headerToggleKey');
  });
  // Only the level kinds have a levels group header — in their levels sheet; the
  // bold-only sheets carry no subheader at all (their single Bold row IS the sheet), and
  // the alert kinds' slot sheets carry no levels group (their levels live in the alert
  // sheet). Only a GOAL kind's header carries the switch: a weather kind's is the slot
  // sheet's Alert highlighting row, and its alert sheet has no switch at all.
  STEMS.forEach(stem => {
    assert.equal(headerFor(stem).toggleKey,
      ALERT_STEMS.includes(stem) ? undefined : 'thresh' + stem + 'On', stem);
  });
  ALERT_STEMS.forEach(stem => {
    const items = sheetFor(stem).items;
    assert.ok(!items.some(it => it.type === 'subheader' && (it.text === 'Alert levels' || it.text === 'Goals')),
      stem + ' slot sheet carries no levels group');
    assert.ok(!items.some(it => it.type === 'range'), stem + ' slot sheet carries no levels slider');
    // Its one header is the highlight group's, and that header hosts no switch: the
    // Alert highlighting toggle is a row of its own under it.
    const headers = items.filter(it => it.type === 'subheader');
    assert.deepEqual(headers, [{ type: 'subheader', text: 'Alert highlighting' }],
      stem + ' slot sheet: only the highlight group\'s header, no switch on it');
  });
});

test('the group header owns the title and the reset action', () => {
  assert.equal(headerFor('Wind').text, 'Alert levels');
  assert.deepEqual(headerFor('Wind').labelAction,
    { action: 'resetThresholds', arg: 'Wind', label: 'Reset to defaults' });
  assert.equal(headerFor('Steps').text, 'Goals');
});

// Each sheet builder picks its voice record (level-rows-schema.js GOAL_VOICE / ALERT_VOICE), so
// nothing ties the page's words to the contract but this: the kinds the watch packs
// as goals (isGoalKind: green defaults, an outline look) are the kinds worded as goals,
// and the rest are the alert kinds.
test('each kind speaks the contract\'s voice: goals for its goal kinds, alert levels for the rest', () => {
  assert.deepEqual(STEMS.filter(stem => !thresholds.isGoalKind(stem)).sort(), ALERT_STEMS.slice().sort());
  STEMS.forEach(stem => {
    const goal = thresholds.isGoalKind(stem);
    const row = key => levelsSheetFor(stem).items.find(it => it.messageKey === 'thresh' + stem + key);
    assert.equal(headerFor(stem).text, goal ? 'Goals' : 'Alert levels', stem + ' header');
    assert.equal(row('WarnLook').label, goal ? 'Close look' : 'Warn look', stem + ' look');
    assert.deepEqual([row('WarnColor').label, row('DangerColor').label],
      goal ? ['Close color', 'Goal fill color'] : ['Warn color', 'Danger color'], stem + ' colour labels');
    assert.deepEqual([row('WarnColor').defaultValue, row('DangerColor').defaultValue],
      goal ? [thresholds.DEFAULT_GOAL_HEX, thresholds.DEFAULT_GOAL_HEX] : ['', ''], stem + ' colour defaults');
    assert.deepEqual(row('Warn').rangeFrom.args.chips,
      goal ? { warn: 'Close', danger: 'Goal' } : { warn: 'Warn', danger: 'Danger' }, stem + ' chips');
    assert.equal(boldFor(stem).options[1][0], goal ? 'Close' : 'Warn', stem + ' Bold middle option');
    assert.match(boldFor(stem).hintByValue.warn, goal ? /goal/ : /warn level/, stem + ' Bold hint');
  });
});

test('the slider no longer carries the group title or the reset action', () => {
  STEMS.forEach(stem => {
    const range = levelsSheetFor(stem).items.find(it => it.type === 'range');
    assert.equal(range.labelAction, undefined, stem + ' slider still has the reset button');
    // Its label names the slider's two values (the chips' words), never the group title
    // its card header already shows.
    assert.notEqual(range.label, headerFor(stem).text, stem + ' slider has a label duplicating the header');
    const chips = range.rangeFrom.args.chips;
    assert.equal(range.label, chips.warn + ' · ' + chips.danger.toLowerCase(), stem + ' slider label');
  });
  assert.equal(levelsSheetFor('Wind').items.find(it => it.type === 'range').label, 'Warn · danger');
  assert.equal(levelsSheetFor('Steps').items.find(it => it.type === 'range').label, 'Close · goal');
});

test('the intro describes the group, so it hangs off the header, not the sheet', () => {
  sheetSections().forEach(s => {
    assert.equal(s.intro, undefined, s.sheetId + ' still has a sheet-level intro');
  });
  STEMS.forEach(stem => {
    assert.match(String(headerFor(stem).intro), /\S/, stem + ' header carries no intro');
  });
  assert.match(headerFor('Wind').intro, /level/i);
  assert.ok(headerFor('Wind').intro.indexOf('reaching warn') !== -1, 'the weather intro');
  assert.doesNotMatch(headerFor('Wind').intro, /threshold/i, 'the old vocabulary is gone');
  assert.match(headerFor('Steps').intro, /goal/i);
  // The goal slider is live with the switch off, so its intro must say the SWITCH is
  // what puts the levels on the watch — not the numbers alone.
  assert.match(headerFor('Steps').intro, /switch/i, 'Steps intro names the switch');
  assert.match(headerFor('Steps').intro, /on the watch/i, 'Steps intro says what the switch does');
  // The close box follows the Close look row, and B&W has no color pickers
  // (settings audit #23).
  assert.match(headerFor('Steps').intro, /getting close draws the close look below/);
  assert.match(headerFor('Wind').intro, /reaching warn draws the warn look below/);
  assert.match(headerFor('Steps').intro, /On color watches the colors are yours to change below\.$/);
  // The weather group has no switch: its look styles the alert icon always and the
  // slot only while the slot's Alert highlighting is on — and the intro says so.
  assert.match(headerFor('Wind').intro, /alert icon/, 'the weather intro names the alert icon');
  assert.match(headerFor('Wind').intro, /status slot, while its Alert highlighting is on/, 'and the slot switch');
});

test('Bold sits above the group and is never gated by the master toggle', () => {
  HEALTH_STEMS.forEach(stem => {
    const items = sheetFor(stem).items;
    assert.ok(items.indexOf(boldFor(stem)) < items.indexOf(headerFor(stem)),
      stem + ' bold row is not above the group header');
  });
  // An alert kind's slot sheet closes its own rows with Bold, then its highlight group
  // follows as a card of its own: the 'Alert highlighting' header, the switch, then a
  // row leading to the kind's alert sheet on the Alerts tab, where its levels and
  // colours are set (it replaced the info box that pointed there).
  ALERT_STEMS.forEach(stem => {
    const items = sheetFor(stem).items;
    const n = items.length;
    assert.equal(items[n - 4], boldFor(stem), stem + ' Bold closes the slot\'s own rows');
    assert.equal(boldFor(stem).joinPrevious, undefined, stem + ' Bold is a row of its own');
    assert.deepEqual(items[n - 3], { type: 'subheader', text: 'Alert highlighting' },
      stem + ' the highlight group opens its own card');
    assert.deepEqual(items[n - 2], {
      type: 'toggle', messageKey: 'thresh' + stem + 'On', label: 'Alert highlighting',
      hintByValue: {
        true: 'Fills this slot from the danger level on and draws the warn look from warn.'
      },
      defaultValue: false
    }, stem + ' the highlight group leads with its switch');
    const alertDays = levelsSheetFor(stem).items.find(it => it.messageKey === 'alert' + stem + 'Days');
    assert.deepEqual(items[n - 1], {
      type: 'sheet', sheetId: 'alert' + stem, label: 'Alert levels and colors', navNote: 'Alerts',
      hintFrom: { resolver: 'alertLevelsHint',
        args: { keyStem: stem, days: alertDays.options, levelsOnly: true } },
      showWhen: { env: 'onDemand' }
    }, stem + ' then the row into its alert sheet (Alerts tab), summarising the levels');
    assert.equal(levelsSheetId(stem), items[n - 1].sheetId, stem + ': the row leads to the levels sheet');
  });
  STEMS.forEach(stem => {
    const bold = boldFor(stem);
    assert.equal(bold.type, 'segmented');
    assert.equal(bold.label, 'Bold');
    assert.equal(bold.defaultValue, 'warn');
    // The row must stay live while the kind's thresholds are off (Always needs
    // none) — its only mute is the Status bars tab's master row's override.
    assert.deepEqual(bold.disabledWhen, { key: 'statusBoldAll', eq: 'all' },
      stem + ' bold row must mute only under the master Bold values row');
  });
});

test('the Bold middle option speaks the kind vocabulary, over one stored value', () => {
  // Only the LABEL differs — the stored value stays 'warn' for both, so the blob
  // keeps a single bold vocabulary (status-thresholds.js BOLD_MODES).
  assert.deepEqual(boldFor('Wind').options,
    [['Off', 'off'], ['Warn', 'warn'], ['Always', 'always']]);
  assert.deepEqual(boldFor('Steps').options,
    [['Off', 'off'], ['Close', 'warn'], ['Always', 'always']]);
  STEMS.forEach(stem => {
    assert.deepEqual(boldFor(stem).options.map(o => o[1]), ['off', 'warn', 'always'], stem);
  });
});

test('the Bold hint explains the selected step only, and when the level bold applies', () => {
  // One hint per step (hintByValue), never a list of all three. The level-driven bold
  // — danger / a reached goal, and the middle step — needs the kind's level, which
  // the watch zeroes while Highlight (Goals) is off (status_threshold_slot_level), so the
  // hints say "while … is on" (settings audit #8).
  assert.equal(boldFor('Wind').hint, undefined, 'no all-options hint');
  // A weather kind's ladder also weights its alert's value (status_on_demand.c), so
  // its hints name both places.
  assert.deepEqual(boldFor('Wind').hintByValue, {
    off: 'Danger still prints bold: in the slot while Alert highlighting is on, and in the value next to the alert icon.',
    warn: 'Heavier text from the warn level on: in the slot while Alert highlighting is on, and in the value next to the alert icon.',
    always: 'Every status slot showing this value prints it in heavier text.'
  });
  assert.deepEqual(boldFor('Steps').hintByValue, {
    off: 'A reached goal still prints bold while Goals are on.',
    warn: 'Heavier text once you get close to the goal, while Goals are on.',
    always: 'Every status slot showing this value prints it in heavier text.'
  });
});

test('the middle Bold option goes inert only while nothing gives the kind a level', () => {
  // Goal kinds: their Goals switch. Weather kinds: the slot's Highlight OR the kind's
  // alert placed on a bar — the alert's value bolds on the same ladder (audit #9).
  HEALTH_STEMS.forEach(stem => {
    assert.deepEqual(boldFor(stem).optionDisabledWhen,
      { warn: { not: { key: 'thresh' + stem + 'On' } } }, stem);
  });
  // The weather gate holds exactly while the highlight is off and the kind's alert shows
  // on no bar (the onDemandPlaced leaf: on-demand.js placedAnywhere, pinned in
  // test/when-resolvers.test.js).
  const OD = require('../src/pkjs/on-demand.js');
  const env = { thresholds: true, onDemand: true, radar: true, health: true };
  ALERT_STEMS.forEach(stem => {
    const code = thresholds.ALERT_KINDS.find(a => a.key === stem).code;
    const gate = boldFor(stem).optionDisabledWhen.warn;
    // The page holds every key hydrated: the side keys' defaults under the state.
    const unplaced = Object.assign({}, OD.DEFAULTS, { statusTopOnDemandRightItems: '' });
    const placed = Object.assign({}, unplaced, { statusForecastOnDemandLeftItems: code });
    [[unplaced, false, true], [unplaced, true, false], [placed, false, false], [placed, true, false]]
      .forEach(([od, highlight, inert]) => {
        const S = Object.assign({ env: env }, od, { ['thresh' + stem + 'On']: highlight });
        assert.equal(PC.showWhen.evaluate(gate, S), inert,
          stem + ' highlight ' + highlight + (od === placed ? ', placed' : ', not placed'));
      });
    assert.equal(PC.showWhen.evaluate(gate, Object.assign({ env: { onDemand: false } }, placed)), true,
      stem + ': a watch without On demand places nothing');
  });
  assert.equal(HEALTH_STEMS.length + ALERT_STEMS.length, STEMS.length, 'every kind covered');
});

test('the warn look heads the colours: right after the levels in a goal sheet, after Days and the mark in an alert sheet', () => {
  const wind = levelsSheetFor('Wind').items;
  const wi = wind.findIndex(it => it.messageKey === 'threshWindWarnLook');
  assert.equal(wind[wi].type, 'segmented');
  assert.equal(wind[wi - 1].messageKey, 'alertWindNextDayMark', 'after the Days and its mark');
  assert.equal(wind[wi].joinPrevious, undefined, 'its own group: a divider above it');
  assert.equal(wind[wi + 1].messageKey, 'threshWindWarnColor', 'before the colours');
  const steps = sheetFor('Steps').items;
  const si = steps.findIndex(it => it.messageKey === 'threshStepsWarnLook');
  assert.equal(steps[si - 1].messageKey, 'threshStepsMax', 'a goal sheet: after the slider\'s companions');
  assert.equal(steps[si].joinPrevious, true, 'a goal sheet keeps its join (no visible effect behind the companions)');
  assert.equal(steps[si + 1].messageKey, 'threshStepsWarnColor');
});

test('the reset button leaves the Bold setting alone', () => {
  const S = { theme: 'dark', threshWindBoldMode: 'always', threshWindOn: true,
    threshWindWarn: '10', threshWindDanger: '20', threshWindMax: '200' };
  PC.actions.resetThresholds('Wind', S, ENV, SCHEMA_DEFAULT_OF);
  assert.equal(S.threshWindBoldMode, 'always', 'reset must not touch Bold');
  assert.equal(S.threshWindMax, '', 'reset still clears the scale max');
  assert.equal(S.threshWindWarn, '', 'reset blanks the pair — the kind\'s seed, as fresh');
});

test('reset lands on exactly what a fresh install has, a goal kind switch included', () => {
  // "Reset to defaults" has to mean the shipped defaults: the levels back on the
  // kind's seed (a blank pair) AND, for a goal kind, whose switch rides this group's
  // header, the stored toggle off. The toggle is stored state, so "off" is proven on
  // the toggle itself — a blank pair alone resolves to an ordered seed and says
  // nothing about the highlight. The switch flips in the same render, so the
  // re-rendered sheet never shows it ON while what saves is off.
  ['Steps', 'Sleep'].forEach((stem) => {
    const S = { theme: 'dark' };
    S['thresh' + stem + 'On'] = true;
    S['thresh' + stem + 'Warn'] = '10';
    S['thresh' + stem + 'Danger'] = '20';
    S['thresh' + stem + 'Max'] = '200';
    PC.actions.resetThresholds(stem, S, ENV, SCHEMA_DEFAULT_OF);
    assert.strictEqual(S['thresh' + stem + 'On'], false,
      stem + ': the goals switch must be OFF after a reset, as on a fresh install');
    assert.equal(S['thresh' + stem + 'Warn'], '', stem + ': warn back on the seed (blank)');
    assert.equal(S['thresh' + stem + 'Danger'], '', stem + ': danger back on the seed (blank)');
    assert.ok(!thresholds.kindConfig(S, thresholds.KINDS.findIndex(k => k.key === stem)).enabled,
      stem + ': the packed enable bit is clear');
    assert.equal(S['thresh' + stem + 'Max'], '', stem + ': scale max cleared');
  });
});

test('a weather kind levels reset leaves its slot Highlight switch alone', () => {
  // The weather group sits in the alert sheet and has no switch: the kind's
  // Highlight is a slot-sheet row (like Bold), so resetting the levels must not
  // flip it — neither off (schema) nor on (AQI's wizard row).
  ['Wind', 'Gust', 'Uv', 'Aqi'].forEach((stem) => {
    [true, false].forEach((on) => {
      const S = { theme: 'dark' };
      S['thresh' + stem + 'On'] = on;
      S['thresh' + stem + 'Warn'] = '10';
      S['thresh' + stem + 'Danger'] = '20';
      PC.actions.resetThresholds(stem, S, ENV, SCHEMA_DEFAULT_OF);
      assert.strictEqual(S['thresh' + stem + 'On'], on, stem + ': Highlight stays ' + on);
      assert.equal(S['thresh' + stem + 'Warn'], '', stem + ': warn back on the seed (blank)');
    });
  });
});

test('Aqi reset lands on the wizard-seeded fresh-install look, not schema-off', () => {
  // The wizard's AQI row (defaults-policy 'wizard-aqi-keeps-a-warn-signal') only
  // switches the highlight on — the warn box is the look's platform default. That
  // switch is the slot sheet's Highlight row, outside this group, so the levels
  // reset leaves it as it was.
  const S = { theme: 'dark', threshAqiOn: false,
    threshAqiWarn: '42', threshAqiDanger: '77', threshAqiMax: '400' };
  PC.actions.resetThresholds('Aqi', S, ENV, SCHEMA_DEFAULT_OF);
  assert.strictEqual(S.threshAqiOn, false, 'the slot Highlight is not this group\'s');
  assert.equal(S.threshAqiWarn, '', 'the pair is back on the seed (blank)');
  assert.equal(S.threshAqiDanger, '', 'the pair is back on the seed (blank)');
  assert.equal(S.threshAqiWarnLook, 'fill', 'the warn look is back on the platform default');
  assert.equal(S.threshAqiWarnColor, '', 'the warn color is back on auto (the theme fg)');
  assert.equal(S.threshAqiMax, '', 'the scale max is still cleared');
  // Bold stays out of it — the reset deliberately leaves Bold alone (pinned above),
  // so the wizard's threshAqiBoldMode row must NOT be applied here.
  assert.ok(!('threshAqiBoldMode' in S), 'reset must not write the Bold mode');
});

test("a kind's reset never reaches outside that kind", () => {
  // The defaults-policy table carries rows for other kinds and for the status-bar
  // layout (the health-slot swap); a Wind-sheet reset writes its own group's schema
  // defaults and nothing else. Foreign keys must stay ABSENT, not merely unchanged.
  const S = { theme: 'dark', threshWindOn: true,
    threshWindWarn: '40', threshWindDanger: '60' };
  PC.actions.resetThresholds('Wind', S, ENV, SCHEMA_DEFAULT_OF);
  ['statusTopRight', 'statusHealthLeft', 'threshAqiOn', 'threshAqiWarnLook',
    'threshStepsBoldMode', 'threshWindBoldMode', 'threshTempBoldMode'].forEach((key) => {
    assert.ok(!(key in S), key + ' must not be written by a Wind reset');
  });
});

test('onLoad keeps an auto warn color tracking the theme fg and never touches the look', () => {
  // The warn look decides whether warn draws a box; the colour only paints it. So an
  // auto warn colour — blank, the old null, or an fg value — heals to the CURRENT
  // theme's fg on every open, whatever the look, and the look itself is left alone.
  ['', null, '#FFFFFF', '#000000'].forEach((rawColor) => {
    ['none', 'outline', 'fill', undefined].forEach((look) => {
      const S = { theme: 'dark', threshWindWarnColor: rawColor, threshWindWarnLook: look };
      const ctx = { env: { platform: 'basalt' },
        get: (k) => S[k], set: (k, v) => { S[k] = v; }, getInitial: (k) => S[k] };
      onbuild.onLoad(ctx);
      assert.equal(S.threshWindWarnColor, '#FFFFFF', JSON.stringify(rawColor) + ' ' + look);
      assert.strictEqual(S.threshWindWarnLook, look, 'the look is untouched');
      S.theme = 'light';
      onbuild.onLoad(ctx);
      assert.equal(S.threshWindWarnColor, '#000000', 'auto re-derives for the light theme');
    });
  });
});

test('the slot button is labelled Edit for every kind', () => {
  const S = { theme: 'dark', statusLine1Left: 'wind', threshWindOn: true,
    threshWindWarn: '40', threshWindDanger: '60' };
  const badge = PC.badgeResolvers.get('thresholdPenState')(
    S, ENV, { messageKey: 'statusLine1Left' });
  assert.equal(badge.label, 'Edit');
  assert.equal(badge.dots.length, 2, 'an enabled kind badges its warn+danger pair');
  const goalS = { theme: 'dark', statusLine1Left: 'steps', threshStepsOn: true,
    threshStepsWarn: '8000', threshStepsDanger: '10000' };
  assert.equal(PC.badgeResolvers.get('thresholdPenState')(
    goalS, ENV, { messageKey: 'statusLine1Left' }).label, 'Edit');
  // Bold-only kinds get the same button; with no pair there is no highlight
  // state, so the badge carries no dots at all.
  const boldBadge = PC.badgeResolvers.get('thresholdPenState')(
    { theme: 'dark', statusLine1Left: 'city' }, ENV, { messageKey: 'statusLine1Left' });
  assert.ok(boldBadge, 'a city slot offers the Edit button');
  assert.equal(boldBadge.label, 'Edit');
  assert.equal(boldBadge.dots.length, 0, 'a bold-only kind never badges any dots');
});

// --- bold-only slot sheets: every level-less kind, one Bold row each ---------
// (wire ids 8..16 in status-thresholds.js; the battery GLYPH item deliberately
// absent — its slot draws a glyph, not text, so a Bold option would be a no-op
// lie. The battery PERCENTAGE kind renders text, so it gets a normal sheet.
// Temp's sheet additionally carries the tempSlotDisplay row and the rows shaping
// its Both pair — see below and test/config-slot-pair.test.js.)

const BOLD_STEMS = ['Temp', 'Pressure', 'Sun', 'Date', 'Week', 'City', 'Countdown', 'Hr', 'BatteryPct'];
const BOLD_CODES = {
  temp: 'Temp', pressure: 'Pressure', sun: 'Sun', date: 'Date',
  week: 'Week', city: 'City', countdown: 'Countdown', hr: 'Hr',
  batteryPct: 'BatteryPct'
};
// Rows a bold-only sheet carries BELOW its Bold row, in order. Absent stem = Bold
// alone. The unit toggles exist only for the kinds the phone bakes the text for
// (status-lines.js); the watch-formatted ones — Hr, BatteryPct — have no such row.
const BOLD_SHEET_EXTRA_ROWS = {
  Temp: ['tempSlotDisplay', 'tempSlotOrder', 'tempSlotSeparator', 'tempSlotSeparatorCustom',
    'tempSlotSeparatorSpaced', 'tempSlotUnit'],
  Pressure: ['pressureSlotUnit'],
  Countdown: ['countdownSlotUnit'],
  Date: ['dateSlotMonthFormat', 'dateSlotFullFormat']
};

// Bold is the last row before any group card on EVERY slot sheet — the bold-only
// ones, where it follows the kind's extras, the alert kinds', where it sits right above
// the Alert highlighting card, and the goal ones, where it sits right above the Goals
// card. Asserted across all of them at once rather than per kind, so a sheet added later
// cannot quietly become an exception.
test('Bold is the last row before any Goals or Alert highlighting group on every slot sheet', () => {
  const sheets = sheetSections();
  assert.ok(sheets.length >= 17, 'found ' + sheets.length + ' slot sheets');
  sheets.forEach((s) => {
    const group = s.items.findIndex(it => it.type === 'subheader');
    if (group !== -1) {
      assert.ok(['Goals', 'Alert highlighting'].includes(s.items[group].text),
        s.title + ': the only group a slot sheet opens is its Goals or Alert highlighting card');
    }
    const end = group === -1 ? s.items.length : group;
    const last = s.items[end - 1];
    assert.ok(last, s.title + ' has no rows');
    assert.match(String(last.messageKey), /BoldMode$/,
      s.title + ' must close its own rows with Bold, got ' + (last.label || last.messageKey));
    assert.equal(last.label, 'Bold', s.title + ' Bold row label');
    assert.equal(s.items.filter(it => /BoldMode$/.test(String(it.messageKey))).length, 1,
      s.title + ' has one Bold row');
  });
});

// --- the weather alerts' sheets (the Alert settings card) --------------------------

/** @returns {Object[]} Every alert<Stem> sheet section, in schema order. */
function alertSheets() {
  const out = [];
  schema.tabs.forEach(t => (t.sections || []).forEach(s => {
    if (s.sheetOnly && /^alert/.test(s.sheetId || '')) { out.push(s); }
  }));
  return out;
}

test('every metric alert sheet: its intro, the Shows on grid, the levels group, the Look, the Days and mark, then the warn look — no switch', () => {
  const sheets = alertSheets().filter(s => s.sheetId !== 'alertRain');
  assert.deepEqual(sheets.map(s => s.sheetId), ALERT_STEMS.map(stem => 'alert' + stem));
  const SUBJECT = { Uv: 'the UV index', Wind: 'the wind speed', Gust: 'the gust speed',
    Aqi: 'the air quality index', Pollen: 'the pollen index' };
  // Each intro names the kind's alert icon and where it shows (the owner's glossary).
  const ICON = { Uv: 'UV', Wind: 'wind', Gust: 'gust', Aqi: 'air quality', Pollen: 'pollen' };
  // The slot's "Tomorrow's peak mark" choices, the same list (schema nextDayMarkOptions).
  const MARKS = [['»6', 'raquo'], ['>6', 'gt'], ['+6', 'plus'], ['6*', 'star'], ['No mark', 'none']];
  sheets.forEach((s) => {
    const stem = s.sheetId.slice('alert'.length);
    const key = 'alert' + stem;
    assert.deepEqual(s.showWhen, { env: 'onDemand' }, s.sheetId + ': gated to a watch with On demand');
    // AQI's look-ahead — later today and tomorrow — depends on its source (WAQI has no
    // forecast): its intro closes on the note the slot sheet carries too (settings
    // audit #10), naming where the AQI provider is picked (Setup › Weather data).
    const coda = stem === 'Aqi' ? ' Looking ahead — later today and tomorrow — needs the Open-Meteo AQI'
      + ' provider (Setup › Weather data): WAQI, which Auto mostly reads, has no forecast, so the alert then judges'
      + ' the current reading.' : '';
    assert.equal(s.intro, 'Shows the ' + ICON[stem] + ' icon at the edge of a status bar when '
      + SUBJECT[stem] + ' reaches your warn level at any point left today, so an afternoon peak shows'
      + ' from the morning on.' + coda, s.sheetId + ' intro');
    const lookAt = s.items.findIndex(it => it.messageKey === key + 'Display');
    assert.deepEqual(s.items.slice(lookAt, lookAt + 3), [{
      type: 'segmented', messageKey: key + 'Display', label: 'Look', defaultValue: 'icon',
      options: [['Icon', 'icon'], ['Icon + value', 'value']],
      // Only the value look explains itself — and when it gives way (after the status
      // slot on its side and the middle slot, the owner's order of 2026-09-30); the
      // default icon look has no hint.
      hintByValue: {
        value: 'Adds the value the alert fires on after the icon. On a crowded bar, the status slot on its'
          + ' side and the middle slot shorten and hide first; only then does the alert drop to just the icon.'
      }
    }, {
      // Days: "Today + tomorrow" by default (the contract's alertDays on an absent
      // key); only it explains itself — Today is what the intro already says.
      // It is rarely changed, so it waits under the card's More options.
      type: 'segmented', messageKey: key + 'Days', label: 'Days', defaultValue: 'tomorrow',
      options: [['Today', 'today'], ['Today + tomorrow', 'tomorrow']],
      more: true,
      hintByValue: {
        tomorrow: 'When nothing left today reaches your warn level but tomorrow does, the alert is active'
          + ' for tomorrow and its icon carries its Tomorrow’s mark.'
      }
    }, {
      // The tomorrow mark: the slot's choices, the » by default, shown only while the
      // alert looks ahead (anything but a stored Today, as alertDays reads it).
      type: 'select', messageKey: key + 'NextDayMark', label: 'Tomorrow\'s mark', defaultValue: 'raquo',
      options: MARKS,
      hintByValue: { none: 'An alert for tomorrow then looks just like one for today.' },
      joinPrevious: true,
      more: true,
      showWhen: { key: key + 'Days', ne: 'today' }
    }], s.sheetId + ': the Look, the Days and the mark, never inert');
    assert.ok(!s.items.some(it => it.messageKey === key), s.sheetId + ': no switch (its Shows on grid places it)');
    // The owner's order (2026-10-01): the Shows on grid and its note first, then the alert
    // levels, the info card, the Look, then everything else. The grid opens its own
    // 'Shows on' card, the note its intro (where items drop first, and how the alert
    // merges into a slot showing the same value), and the Default view's warning follows it.
    assert.deepEqual(s.items[0], { type: 'subheader', text: 'Shows on',
      intro: 'One side per bar. On a crowded bar, the items lower in the Alerts tab’s list drop first.'
        + ' Where the status slot on that side shows ' + SUBJECT[stem] + ', the alert goes into that slot,'
        + ' with its colors, instead of adding its alert icon.' }, s.sheetId + ': the Shows on card, its note as intro');
    assert.equal(s.items[1].check, stem.toLowerCase(), s.sheetId + ': the Shows on grid first');
    assert.equal(s.items[1].captionsOnly, true, s.sheetId + ': its header row shows the column captions only');
    assert.equal(s.items[2].type, 'staticText', s.sheetId + ': then the Default view note');
    assert.equal(s.items[2].text, 'Your Default view has no Watch Status Bar. Tick another bar below.');
    assert.ok(s.items[2].showWhen, s.sheetId + ': only while that view has no On demand bar');
    const head = s.items[3];
    assert.equal(head.type, 'subheader', s.sheetId + ': the levels group follows');
    assert.equal(head.text, 'Alert levels');
    assert.equal(head.toggleKey, undefined, s.sheetId + ': the levels header has no switch');
    assert.deepEqual(head.labelAction,
      { action: 'resetThresholds', arg: stem, label: 'Reset to defaults' });
    // The levels and their look are always live: they also drive the slots' Alert
    // highlighting, and the look styles the alert icon whatever the slot's Highlight
    // switch says.
    const range = s.items.find(it => it.type === 'range');
    assert.equal(range.disabledWhen, undefined, s.sheetId + ' slider never mutes');
    ['WarnLook', 'WarnColor', 'DangerColor'].forEach((which) => {
      const it = s.items.find(x => x.messageKey === 'thresh' + stem + which);
      assert.equal(it.disabledWhen, undefined, s.sheetId + ' ' + which + ' never mutes');
    });
    assert.ok(!s.items.some(it => it.messageKey === 'thresh' + stem + 'On'),
      s.sheetId + ': the slot Highlight is not in this sheet');
    // The cards on the default levels ride the slider's info text, one per unit or AQI
    // scale (test/config-alert-level-cards.test.js holds their numbers and gates).
    const CARDS = { Gust: 3, Wind: 3, Aqi: 2, Uv: 1, Pollen: 1 };
    const at = s.items.indexOf(range);
    assert.equal(range.hintFrom.resolver, 'levelInfo', s.sheetId + ': the slider\'s info text carries the cards');
    assert.equal(range.hintFrom.args.cards.length, CARDS[stem], s.sheetId + ': one card per unit or scale');
    assert.ok(!s.items.some(it => it.type === 'staticText' && it.style === 'info'
      && range.hintFrom.args.cards.some(c => c.text === it.text)), s.sheetId + ': no card stands as a row of its own');
    assert.equal(at, 4, s.sheetId + ': the slider right under the levels header');
    assert.equal(s.items[at + 1].type, 'hidden', s.sheetId + ': then the hidden companions');
    assert.equal(s.items[at + 2].type, 'hidden');
    assert.equal(lookAt, at + 3, s.sheetId + ': then the Look, Days and mark');
    assert.equal(s.items[lookAt].more, undefined, s.sheetId + ': the Look stays in view');
    assert.deepEqual(s.items.slice(lookAt + 3).map(it => it.messageKey),
      ['thresh' + stem + 'WarnLook', 'thresh' + stem + 'WarnColor', 'thresh' + stem + 'DangerColor'],
      s.sheetId + ': the warn look and its colours close it');
    assert.equal(s.items[lookAt + 3].joinPrevious, undefined, s.sheetId + ': the warn look starts its own group');
    s.items.slice(lookAt + 3).forEach(it => assert.strictEqual(it.more, true,
      s.sheetId + ': ' + it.messageKey + ' waits under More options'));
    assert.equal(s.items.length, 3 + 1 + 1 + 2 + 3 + 3,
      s.sheetId + ': Shows on header + grid + note, levels header, slider, two companions, Look/Days/mark, the look rows');
  });
  assert.equal(itemsByKey().threshPollenWarn[0].hint,
    'DWD pollen index 0–3 (half-levels like "2-3" count as 2.5); DWD provider only.',
    'Pollen\'s scale note rides its slider in the alert sheet');
});

test('the rain alert sheet: the Shows on card (note, radar-off and not-placed boxes, grid), then the time window and the look — no switch', () => {
  const s = alertSheets().find(x => x.sheetId === 'alertRain');
  assert.ok(s, 'the rain sheet exists');
  assert.equal(s.title, 'Rain alert');
  assert.deepEqual(s.showWhen, { env: 'onDemand' }, 'shown in any radar mode: the card row names the radar');
  // When the watch shows it: raining now or due within the window, never in the
  // Battery saver hours (rain_countdown.c; settings audit #14). rain_tint
  // (status_on_demand.c): the radar colour only under a colour theme on a colour watch.
  assert.equal(s.intro, 'Shows the rain icon at the edge of a status bar while it rains at your location'
    + ' or rain is due within the time window. On a color watch the rain icon takes the radar’s rain color,'
    + ' except with a B&W theme. Hidden during the Battery saver hours.');
  assert.ok(!s.items.some(it => it.messageKey === 'alertRain'), 'no switch: its Shows on grid places Rain');
  // The Shows on card: its note as the card's intro (rain never merges into a slot, so no
  // merge sentence), then the boxes — the radar is off (a link to where it is turned on),
  // or Rain sits on no bar — then the grid they point at, then the Default view's warning.
  assert.deepEqual(s.items[0], { type: 'subheader', text: 'Shows on',
    intro: 'One side per bar. On a crowded bar, the items lower in the Alerts tab’s list drop first.' });
  assert.deepEqual(s.items[1], { type: 'staticText', style: 'info',
    text: 'The rain alert needs the rain radar. Turn it on in <button type="button" class="txt-link"'
      + ' data-goto-tab="watchface">Watchface › Views</button>.',
    showWhen: { key: 'radarMode', eq: 'off' } });
  assert.equal(s.items[2].text, 'Rain isn’t on any status bar yet, so the rain icon won’t show. Tick a side below.');
  const OD = require('../src/pkjs/on-demand.js');
  const odEnv = { onDemand: true, radar: true, health: true };
  const notPlaced = (od) => PC.showWhen.evaluate(s.items[2].showWhen,
    Object.assign({ env: odEnv }, OD.DEFAULTS, od));
  assert.equal(notPlaced({ radarMode: 'countdown' }), false, 'hidden while Rain is on a bar (the default)');
  assert.equal(notPlaced({ radarMode: 'countdown', statusTopOnDemandLeftItems: 'bt' }), true,
    'shown once Rain is on no bar');
  assert.equal(notPlaced({ radarMode: 'off', statusTopOnDemandLeftItems: 'bt' }), false,
    'never doubled with the radar-off box');
  assert.equal(s.items[3].check, 'rain', 'then the grid');
  assert.equal(s.items[3].captionsOnly, true);
  assert.equal(s.items[4].text, 'Your Default view has no Watch Status Bar. Tick another bar below.');
  // Then the Alert card: rain's own row first, then its Look (the owner's order since
  // the restructure; it was the Look first).
  assert.deepEqual(s.items[5], { type: 'subheader', text: 'Alert' });
  assert.deepEqual(s.items[6], {
    type: 'segmented', messageKey: 'rainCountdownHorizon', label: 'Time window', defaultValue: '60',
    options: [['30 min', '30'], ['60 min', '60'], ['2 hours', '120']],
    hint: 'Rain due further out doesn’t show the icon. Radar forecasts change often, so a shorter window'
      + ' gives fewer false alarms.'
  });
  assert.deepEqual(s.items[7], {
    type: 'segmented', messageKey: 'rainAlertDisplay', label: 'Look', defaultValue: 'text',
    options: [['Icon', 'icon'], ['Icon + minutes', 'minutes'], ['Text', 'text']],
    // The icon alone describes itself; the two longer looks say what they print and
    // when they shrink on a crowded bar (settings audit #7/#13; only after the status
    // slot on its side and the middle slot, the owner's order of 2026-09-30) — the
    // default Text look too, because its name does not carry that. While it rains the
    // '+' number is the minutes until the rain stops (review set-7).
    hintByValue: {
      minutes: 'The rain icon with the minutes until the rain starts or, while it rains, + the minutes'
        + ' until it stops. On a crowded bar, the status slot on its side and the middle slot shorten and'
        + ' hide first; only then is it just the icon.',
      text: 'On a crowded bar, the status slot on its side and the middle slot shorten and hide first; only'
        + ' then does it shorten to the minutes, then to the rain icon alone.'
    }
  });
  assert.equal(s.items.length, 8);
});

test('alert sheets carry no slot rows (Bold, display mode, arrow, unit)', () => {
  alertSheets().forEach((s) => {
    s.items.forEach((it) => {
      assert.ok(!/(BoldMode|SlotDisplay|SlotDirection|SlotUnit)$/.test(String(it.messageKey)),
        s.sheetId + ' must not carry the slot row ' + it.messageKey);
    });
  });
});

test('the goal kinds get no alert sheet', () => {
  const ids = alertSheets().map(s => s.sheetId);
  HEALTH_STEMS.forEach(stem =>
    assert.ok(!ids.includes('alert' + stem), 'no alert' + stem + ' sheet'));
});

test('the Bold-last pin covers the slot sheets only (its /^thresh/ filter)', () => {
  // The pin above iterates sheetSections(), which the alert sheets must stay out of:
  // they configure an alert, not a slot.
  const ids = sheetSections().map(s => s.sheetId);
  assert.ok(ids.length > 0);
  assert.ok(ids.every(id => /^thresh/.test(id)), 'no alert sheet among the slot sheets');
});

test('every bold-only kind gets a sheet whose Bold row is its LAST control', () => {
  const titles = {
    Temp: 'Temperature slot', Pressure: 'Air pressure (hPa) slot',
    Sun: 'Sunrise/sunset slot', Date: 'Date slot', Week: 'Calendar week slot',
    City: 'City slot', Countdown: 'Date countdown slot', Hr: 'Heart rate slot',
    BatteryPct: 'Battery percentage slot'
  };
  BOLD_STEMS.forEach(stem => {
    const s = sheetFor(stem);
    assert.equal(s.title, titles[stem], stem + ' sheet title');
    assert.deepEqual(s.showWhen, { env: 'thresholds' },
      stem + ' sheet carries the platform gate');
    // Bold is the row all of these sheets share, so it closes every one; a few kinds
    // add their own controls above it — Temp its Value selection group, and the
    // phone-baked unit kinds their "Show unit" toggle. Naming the extra rows per stem
    // rather than counting them keeps this a real guard: a row added later has to be
    // declared here, and it cannot be declared in the wrong sheet or below the Bold row.
    assert.deepEqual(s.items.slice(0, -1).map(it => it.messageKey),
      BOLD_SHEET_EXTRA_ROWS[stem] || [], stem + ' rows above Bold');
    const bold = boldFor(stem);
    assert.equal(s.items[s.items.length - 1], bold,
      stem + ' Bold row must close the sheet');
    assert.equal(bold.type, 'segmented');
    assert.equal(bold.label, 'Bold');
    assert.equal(bold.joinPrevious, undefined, stem + ' Bold is a row of its own');
    assert.equal(bold.defaultValue, 'off', stem + ' defaults to off');
    assert.deepEqual(bold.hintByValue, { always: 'Every status slot showing this value prints it in heavier text.' },
      stem + ' hint: Always only (Off, the default, needs none)');
    assert.equal(bold.hint, undefined, stem + ' no all-options hint');
    assert.deepEqual(bold.disabledWhen, { key: 'statusBoldAll', eq: 'all' },
      stem + ' row mutes only under the master Bold values row');
  });
});

test('bold-only sheets offer Off/Always only — no level, no Warn pill', () => {
  BOLD_STEMS.forEach(stem => {
    assert.deepEqual(boldFor(stem).options,
      [['Off', 'off'], ['Always', 'always']], stem);
    assert.equal(boldFor(stem).optionDisabledWhen, undefined,
      stem + ' has no threshold toggle to go inert on');
  });
});

test('the Hr sheet row mirrors the hr slot availability (health + sensor)', () => {
  const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
  const it = boldFor('Hr');
  // HEALTH_SLOT_WHEN plus env.hr — the rule statusLineCatalog.itemAvailable
  // applies to the hr item itself (needsHealth AND needsHr).
  assert.deepEqual(it.showWhen,
    { all: [{ env: 'health' }, { key: 'healthMode', ne: 'off' }, { env: 'hr' }] });
  const ctx = (health, hr, mode) =>
    Object.assign({ env: { health, hr, color: true } }, { healthMode: mode });
  assert.equal(showWhen.isVisible(it, ctx(true, false, 'all')), false,
    'hidden without a heart-rate sensor');
  assert.equal(showWhen.isVisible(it, ctx(false, true, 'all')), false,
    'hidden without health sensors');
  assert.equal(showWhen.isVisible(it, ctx(true, true, 'off')), false,
    'hidden with health off');
  ['slot', 'status', 'all'].forEach(mode => {
    assert.equal(showWhen.isVisible(it, ctx(true, true, mode)), true,
      'shown in healthMode ' + mode);
  });
  // The other bold-only kinds need no availability gate at all.
  BOLD_STEMS.filter(stem => stem !== 'Hr').forEach(stem => {
    assert.equal(boldFor(stem).showWhen, undefined, stem + ' needs no gate');
  });
});

test('battery GLYPH has NO sheet (draws a glyph, not text); battery % has one', () => {
  assert.equal(sheetSections().find(s => s.sheetId === 'threshBattery'), undefined,
    'no threshBattery sheet exists');
  const resolve = PC.sheetResolvers.get('statusSlotEditSheet');
  assert.equal(resolve({ statusTopRight: 'battery' }, ENV, { messageKey: 'statusTopRight' }),
    null, 'no pencil on a battery-glyph slot');
  // The battery PERCENTAGE kind renders text (a real bold cell, wire id 16), so
  // the same machinery gives it a sheet and a pencil.
  assert.ok(sheetFor('BatteryPct'), 'threshBatteryPct sheet exists');
  assert.equal(resolve({ statusTopRight: 'batteryPct' }, ENV, { messageKey: 'statusTopRight' }),
    'threshBatteryPct', 'the battery-% slot resolves its bold sheet');
});

test('the Temp sheet leads with its Value selection, and Bold closes it', () => {
  const items = sheetFor('Temp').items;
  const disp = items[0];
  assert.equal(disp.messageKey, 'tempSlotDisplay', 'Value selection leads the sheet');
  assert.equal(items[items.length - 1].messageKey, 'threshTempBoldMode', 'Bold closes it');
  assert.equal(disp.type, 'segmented');
  assert.equal(disp.defaultValue, 'actual', 'shipped behaviour: the actual temp');
  assert.equal(disp.label, 'Value selection');
  assert.deepEqual(disp.options,
    [['Temp', 'actual'], ['Feels like', 'feels'], ['Both', 'both']]);
  // One hint per SELECTED mode; the measured temperature (the default) needs none.
  assert.equal(disp.hint, undefined, 'no all-options hint');
  assert.equal(disp.hintByValue.actual, undefined, 'the default mode has no hint');
  assert.equal(disp.hintByValue.feels, 'What it feels like, by the formula set under Setup › Units.');
  // Both shows the pair on the default separator and names the rows that shape it.
  assert.equal(disp.hintByValue.both,
    'The temperature and what it feels like, like 12|10. Order and Separator shape the pair.');
  // No gate of its own: it inherits the sheet's THRESHOLD_WHEN, so aplite (which
  // has no Edit sheets) deliberately never reaches it — feels-like is left out
  // there entirely (slot mode AND graph metric, see the forecastMetric resolver).
  assert.equal(disp.showWhen, undefined);
  // NOT muted by the master Bold row: display mode is not a bold setting.
  assert.equal(disp.disabledWhen, undefined);
});

test('the UV sheet: the Value selection group, Bold, then the highlight group', () => {
  const items = sheetFor('Uv').items;
  const disp = items[0];
  assert.equal(disp.messageKey, 'uvSlotDisplay', 'Value selection leads the sheet');
  assert.equal(disp.type, 'segmented');
  assert.equal(disp.label, 'Value selection');
  assert.equal(disp.defaultValue, 'current', 'shipped behaviour: the current index');
  assert.deepEqual(disp.options, [['Now', 'current'], ['Day max', 'max'], ['Both', 'both']]);
  // A static hint per SELECTED mode (Now, the default, gets none); only AQI adds a
  // resolver for its source note.
  assert.equal(disp.hint, undefined, 'no all-modes hint');
  assert.equal(disp.hintFrom, undefined, 'UV needs no resolver');
  assert.deepEqual(Object.keys(disp.hintByValue).sort(), ['both', 'max']);
  // It configures the SLOT, not the highlight, so it leads the sheet like the wind
  // arrow — and stays live while the highlight is off. So do the rows shaping how it
  // reads (test/config-slot-pair.test.js), which follow it directly, then the mark; Bold
  // closes the slot's own rows, and the highlight group follows as a card of its own.
  assert.deepEqual(items.map(it => it.messageKey || it.type),
    ['uvSlotDisplay', 'uvSlotOrder', 'uvSlotSeparator', 'uvSlotSeparatorCustom',
      'uvSlotSeparatorSpaced', 'uvSlotNextDayMark', 'threshUvBoldMode', 'subheader', 'threshUvOn', 'sheet'],
    'Value selection → Order → separator rows → Tomorrow\'s peak mark → Bold, then the highlight group');
  ['uvSlotOrder', 'uvSlotSeparator', 'uvSlotSeparatorCustom', 'uvSlotSeparatorSpaced',
    'uvSlotNextDayMark'].forEach((key) => {
    const row = items.find(it => it.messageKey === key);
    assert.strictEqual(row.joinPrevious, true, key + ' joins the group tight');
    assert.strictEqual(row.more, true, key + ' waits under More options');
  });
  assert.equal(items[6].joinPrevious, undefined, 'Bold keeps its divider above');
  assert.equal(items[7].text, 'Alert highlighting', 'the highlight group opens its own card');
  assert.equal(items[8].joinPrevious, undefined, 'its switch leads it');
  assert.equal(items[9].sheetId, 'alertUv', 'the row into the alert sheet (Alerts tab) follows the switch');
  assert.equal(disp.disabledWhen, undefined, 'not muted by the highlight toggle or the master Bold row');
  // Tomorrow's peak mark explains its one value that needs it.
  assert.deepEqual(items[5].hintByValue, { none: 'Tomorrow\'s peak then looks just like today\'s.' });
});

// --- the Value selection hint: the SELECTED mode's copy, static by value ------------

// Each kind's noun and sample pair, as dayMaxRows builds them.
const DAY_MAX_COPY = {
  uv: { noun: 'UV index', sample: '3/7' },
  wind: { noun: 'wind', sample: '12/30' },
  gust: { noun: 'gusts', sample: '20/45' },
  aqi: { noun: 'air quality index', sample: '42/58' }
};

/**
 * A day-max kind's Value selection hint as the engine shows it: the hintFrom
 * resolver's answer (AQI's source note) when it gives one, else the static
 * hintByValue for the shown value (engine renderRow).
 * @param {string} prefix 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {Object} S Settings state.
 * @param {string} value The shown mode.
 * @returns {string|undefined} The hint the row shows.
 */
function dayMaxHintOf(prefix, S, value) {
  const item = itemsByKey()[prefix + 'SlotDisplay'][0];
  const derived = PC.engine.resolveHint(item, S, ENV, value);
  return derived !== undefined ? derived : item.hintByValue[value];
}

test('dayMaxHint: Now gets no hint; Day max and Both each explain themselves alone', () => {
  // Now is the default and the pill says it: no hint (settings audit, owner rule).
  catalog.DAY_MAX_KINDS.forEach((prefix) => {
    assert.strictEqual(dayMaxHintOf(prefix, {}, 'current'), undefined, prefix + ' Now: no hint');
  });
  assert.equal(dayMaxHintOf('uv', {}, 'max'),
    'The highest UV index left today, while that peak is still ahead or happening now. After'
    + ' it, tomorrow\'s peak with Tomorrow\'s peak mark, or the reading when tomorrow\'s isn\'t'
    + ' known. Tomorrow\'s peak never triggers Alert highlighting.');
  assert.equal(dayMaxHintOf('uv', {}, 'both'),
    'The UV index now and the highest left today, like 3/7, while that peak is still ahead or'
    + ' happening now. After it, tomorrow\'s peak takes its place with Tomorrow\'s peak'
    + ' mark, or the reading shows alone when tomorrow\'s isn\'t known. Tomorrow\'s peak never'
    + ' triggers Alert highlighting.');
});

test('dayMaxHint: every day-max kind carries a static by-value hint on its own noun and samples', () => {
  catalog.DAY_MAX_KINDS.forEach((prefix) => {
    const item = itemsByKey()[prefix + 'SlotDisplay'][0];
    const copy = DAY_MAX_COPY[prefix];
    assert.equal(item.label, 'Value selection', prefix);
    assert.deepEqual(item.options, [['Now', 'current'], ['Day max', 'max'], ['Both', 'both']], prefix);
    assert.deepEqual(Object.keys(item.hintByValue).sort(), ['both', 'max'], prefix + ': Now needs none');
    assert.ok(item.hintByValue.max.indexOf('The highest ' + copy.noun + ' left today, ') === 0,
      prefix + ' max: ' + item.hintByValue.max);
    assert.ok(item.hintByValue.both.indexOf('The ' + copy.noun + ' now and the highest left today, like '
      + copy.sample + ', ') === 0, prefix + ' both: ' + item.hintByValue.both);
    ['max', 'both'].forEach((mode) => {
      const h = item.hintByValue[mode];
      // No warn number: the slot's day max no longer hangs on a level.
      assert.doesNotMatch(h, /warn|level|\d+ \(/, prefix + ' ' + mode + ': no level');
      // One sentence about highlighting: tomorrow's peak never triggers it.
      assert.equal(h.match(/highlight/gi).length, 1, prefix + ' ' + mode + ': one highlighting word');
      assert.match(h, /Tomorrow's peak never triggers Alert highlighting\.$/, prefix + ' ' + mode);
      assert.doesNotMatch(h, /is highlighted/, prefix + ' ' + mode + ': no "tomorrow is highlighted"');
      // The mark is a choice, so the hint names the row instead of quoting one glyph.
      assert.equal(h.indexOf('»'), -1, prefix + ' ' + mode + ': no hard-coded » mark');
      assert.match(h, /Tomorrow's peak mark/, prefix + ' ' + mode + ': names the mark row');
    });
    // Only AQI keeps a resolver (its source note); the rest need none.
    assert.equal(Boolean(item.hintFrom), prefix === 'aqi', prefix + ' hintFrom');
  });
});

test('dayMaxHint: AQI closes on its source note via the resolver, from the same by-value copy', () => {
  const item = itemsByKey().aqiSlotDisplay[0];
  assert.equal(item.hintFrom.resolver, 'dayMaxHint');
  assert.deepEqual(Object.keys(item.hintFrom.args), ['notes'],
    'one table: the resolver closes the static hint the engine hands it (args.staticHint)');
  assert.equal(item.hintFrom.args.keyStem, undefined, 'the resolver reads no levels');
  const waqi = ' Your AQI provider (WAQI) has no forecast, so the current reading shows.';
  const auto = ' Auto mostly reads WAQI, which has no forecast — then the current reading shows.';
  ['max', 'both'].forEach((mode) => {
    const full = item.hintByValue[mode];
    // An absent source reads as WAQI, the default.
    assert.equal(dayMaxHintOf('aqi', {}, mode), full + waqi, mode + ': absent source = WAQI');
    assert.equal(dayMaxHintOf('aqi', { aqiSource: 'waqi' }, mode), full + waqi, mode);
    assert.equal(dayMaxHintOf('aqi', { aqiSource: 'auto' }, mode), full + auto, mode);
    // Open-Meteo can give a peak: no note, and the resolver hands over to hintByValue.
    assert.equal(PC.engine.resolveHint(item, { aqiSource: 'openmeteo' }, ENV, mode), undefined, mode);
    assert.equal(dayMaxHintOf('aqi', { aqiSource: 'openmeteo' }, mode), full, mode);
    assert.equal(dayMaxHintOf('aqi', { aqiSource: 'constructor' }, mode), full,
      mode + ': an unknown source adds nothing');
  });
  assert.equal(PC.engine.resolveHint(item, {}, ENV, 'current'), undefined, 'Now: the resolver steps aside');
  assert.strictEqual(dayMaxHintOf('aqi', {}, 'current'), undefined, 'Now: no hint, source note included');
});

test('dayMaxHint: the same text whatever the levels, the units or the switch', () => {
  ['max', 'both'].forEach((mode) => {
    const plain = dayMaxHintOf('uv', {}, mode);
    [{ threshUvOn: true }, { threshUvOn: false }, { threshUvWarn: '7', threshUvDanger: '9' }]
      .forEach((S) => assert.equal(dayMaxHintOf('uv', S, mode), plain, mode + ' ' + JSON.stringify(S)));
    assert.equal(dayMaxHintOf('wind', { windUnits: 'mph' }, mode), dayMaxHintOf('wind', {}, mode),
      mode + ': the wind unit does not enter the copy');
  });
});

test('dayMaxHint: the sheet renders the selected mode\'s hint', () => {
  const page = bootGeneratedPage({ provider: 'dwd', uvSlotDisplay: 'max' });
  page.openEditSheet('threshUv');
  assert.ok(page.modal.innerHTML.indexOf('The highest UV index left today') !== -1, 'the Day max hint');
  assert.equal(page.modal.innerHTML.indexOf('data-range="threshUvWarn"'), -1,
    'no slider here: the slot sheet only points at the alert sheet');
  const aqi = bootGeneratedPage({ provider: 'dwd', aqiSlotDisplay: 'both' });
  aqi.openEditSheet('threshAqi');
  assert.ok(aqi.modal.innerHTML.indexOf('data-hint-for="aqiSlotDisplay"') !== -1,
    'the AQI hint is marked for the in-place repaint');
  assert.ok(aqi.modal.innerHTML.indexOf('like 42/58') !== -1, 'the AQI Both hint');
  assert.ok(aqi.modal.innerHTML.indexOf('Your AQI provider (WAQI) has no forecast') !== -1,
    'with the WAQI note');
});

test('dayMaxHint: picking Day max on a Now slot brings the hint in', () => {
  // Now renders no hint at all, so the pill click itself has to render the Day max hint.
  const page = bootGeneratedPage({ provider: 'dwd' });
  page.openEditSheet('threshUv');
  assert.equal(page.modal.innerHTML.indexOf('The highest UV index'), -1, 'Now: no hint');
  const t = {
    getAttribute: n => (n === 'data-k' ? 'uvSlotDisplay' : (n === 'data-v' ? 'max' : null)),
    closest: sel => (sel === '[data-v]' ? t : null)
  };
  page.modal.dispatch('click', { target: t });
  assert.equal(page.S.uvSlotDisplay, 'max');
  assert.ok(page.modal.innerHTML.indexOf('The highest UV index left today') !== -1,
    'the Day max hint renders');
});

test('the slot pencil resolves the bold-only sheet for every new kind', () => {
  const resolve = PC.sheetResolvers.get('statusSlotEditSheet');
  Object.keys(BOLD_CODES).forEach(code => {
    assert.equal(resolve({ statusLine1Left: code }, ENV, { messageKey: 'statusLine1Left' }),
      'thresh' + BOLD_CODES[code], code + ' resolves its sheet');
  });
  assert.equal(resolve({ statusLine1Left: 'wind' }, ENV, { messageKey: 'statusLine1Left' }),
    'threshWind', 'threshold kinds keep their sheets');
  assert.equal(resolve({ statusLine1Left: 'city' }, { thresholds: false },
    { messageKey: 'statusLine1Left' }), null, 'the env gate still applies');
});

test('bold-only BoldMode keys hydrate their default and ride the save blob', () => {
  const S = PC.engine.hydrate(schema, {}, ENV);
  const blob = PC.engine.serialize(schema, S);
  BOLD_STEMS.forEach(stem => {
    assert.equal(blob['thresh' + stem + 'BoldMode'], 'off',
      stem + ' BoldMode must survive hydrate → serialize');
  });
  assert.equal(blob.tempSlotDisplay, 'actual',
    'tempSlotDisplay must survive hydrate → serialize');
  assert.equal(blob.uvSlotDisplay, 'current',
    'uvSlotDisplay must survive hydrate → serialize');
});

// --- the Status bars tab's master Bold row (statusBoldAll) --------------------
// A settings-store key only — it has no AppMessage key of its own: 'all'
// overrides the PACKED bold cell of every kind at blob-build time
// (status-wire.js buildSettingsBlob), the stored per-kind modes stay
// untouched, and the Clay change-detector resends because the blob content
// changes.

test('the master Bold values row leads the slot selects, thresholds-gated', () => {
  const watch = schema.tabs.find(t => t.id === 'watch');
  // The master governs EVERY bar, so it lives in the Status bars tab's first card, 'All
  // status bars' — ABOVE the per-bar cards ("Watch Status Bar", "Forecast Status Bar",
  // ...), not inside the first bar's own card.
  const sections = watch.sections.filter(s => !s.sheetOnly);
  const masterIdx = sections.findIndex(s =>
    (s.items || []).some(it => it.messageKey === 'statusBoldAll'));
  const slotsIdx = sections.findIndex(s =>
    (s.items || []).some(it => it.messageKey === 'statusTopLeft'));
  assert.ok(masterIdx !== -1, 'master row exists in the Status bars tab');
  assert.equal(masterIdx, 0, 'in its first card');
  assert.ok(masterIdx < slotsIdx,
    'master row renders above the first status-bar card');
  assert.equal(sections[masterIdx].id, 'statusAll');
  assert.equal(sections[masterIdx].title, 'All status bars',
    'master row lives in the card for every bar, not under a bar header');
  assert.ok(!sections[masterIdx].items.some(it => /^status(Top|Forecast|Health|Radar)(Left|Mid|Right)$/
    .test(String(it.messageKey))), 'a card that holds no bar\'s slots');
  const master = sections[masterIdx].items
    .find(it => it.messageKey === 'statusBoldAll');
  assert.strictEqual(master.more, true, 'rarely changed: it waits under the card\'s More options');
  assert.equal(master.type, 'segmented');
  assert.equal(master.label, 'Bold values');
  assert.equal(master.defaultValue, 'perSlot');
  assert.deepEqual(master.options, [['Per slot', 'perSlot'], ['All', 'all']]);
  // Same platform gate as the sheets: aplite compiles the bold machinery out.
  assert.deepEqual(master.showWhen, { env: 'thresholds' },
    'the master row must be hidden on aplite');
  // One hint per selected option: All says what it does, Per slot where the choice is.
  assert.match(master.hintByValue.all, /heavier text/, 'All explains itself');
  // The sheets' row reads "Bold" since the rename; the hint names it as it reads.
  assert.match(master.hintByValue.perSlot, /\bBold row\b/, 'Per slot points at the per-slot row');
  assert.doesNotMatch(master.hintByValue.perSlot, /Bold value/,
    'Per slot must not name the retired "Bold value" label');
  assert.equal(master.hint, undefined, 'no all-options hint');
});

test('every per-slot Bold row carries the master-disable predicate', () => {
  STEMS.concat(BOLD_STEMS).forEach(stem => {
    assert.deepEqual(boldFor(stem).disabledWhen, { key: 'statusBoldAll', eq: 'all' },
      stem + ' bold row must mute while the master is "all"');
  });
});

/** Class attribute of the row div holding the given data-k control.
 * @param {string} html rendered body/sheet HTML
 * @param {string} key messageKey to locate
 * @returns {string} the row div's opening tag up to (not including) '>'
 */
function rowClassFor(html, key) {
  const at = html.indexOf('data-k="' + key + '"');
  assert.ok(at !== -1, key + ' rendered');
  const open = html.lastIndexOf('<div class="row', at);
  return html.slice(open, html.indexOf('>', open));
}

test('the sheets gray their Bold row out while the master is "all"', () => {
  const page = bootGeneratedPage({ provider: 'dwd', statusBoldAll: 'all' });
  page.clickTab('watch');
  assert.ok(page.scroll.innerHTML.indexOf('data-k="statusBoldAll"') !== -1,
    'the master row renders in the Status bars tab (its non-default value opens More options)');
  page.openEditSheet('threshAqi');
  assert.match(rowClassFor(page.modal.innerHTML, 'threshAqiBoldMode'), /\bdis\b/,
    'the sheet Bold row is muted under the master override');
  const perSlot = bootGeneratedPage({ provider: 'dwd' });
  perSlot.clickTab('watch');
  perSlot.openEditSheet('threshAqi');
  assert.doesNotMatch(rowClassFor(perSlot.modal.innerHTML, 'threshAqiBoldMode'), /\bdis\b/,
    'the default perSlot leaves the Bold row live');
});

test('the generated page renders the Temp display pills and the battery-% sheet', () => {
  const page = bootGeneratedPage({ provider: 'dwd' });
  page.clickTab('watch');
  page.openEditSheet('threshTemp');
  assert.ok(page.modal.innerHTML.indexOf('data-k="tempSlotDisplay"') !== -1,
    'the Temp sheet renders the display-mode control');
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshTempBoldMode"') !== -1,
    'the Temp sheet still renders its Bold row');
  page.openEditSheet('threshBatteryPct');
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshBatteryPctBoldMode"') !== -1,
    'the battery-% sheet renders its Bold row');
});

// --- the status-card reset button (blocks.js resetStatusSlots) ---------------
// One link row in the Status bars tab's 'All status bars' card puts every slot of every bar back to
// its platform-aware default and the bold settings back to their shipped
// defaults. Thresholds, colors, outlines, and scale maxes stay put — each sheet
// carries its own reset for those.

/** @returns {Object} A settings state with nothing at its default. */
function scrambledSlotState() {
  const S = { statusBoldAll: 'all', tempSlotDisplay: 'both', uvSlotDisplay: 'both' };
  // 'uv' is not the default of any of the 12 slots.
  catalog.allSlotKeys().forEach(k => { S[k] = 'uv'; });
  thresholds.KINDS.forEach((kind, i) => {
    S['thresh' + kind.key + 'BoldMode'] = (i % 2 === 0) ? 'always' : 'off';
  });
  S.threshWindOn = true;
  S.threshStepsOn = true;
  S.threshWindWarn = '10'; S.threshWindDanger = '20'; S.threshWindMax = '200';
  S.threshWindWarnColor = '#00AAFF'; S.threshWindDangerColor = '#5500FF';
  return S;
}

test('resetStatusSlots restores every slot default (hr and non-hr) and the bold defaults', () => {
  const hrEnv = Object.assign({}, ENV, { hr: true });
  // Sanity: the two envs really differ (the health bar's hrDefaults flavor).
  assert.notEqual(catalog.slotDefault('statusHealthRight', ENV),
    catalog.slotDefault('statusHealthRight', hrEnv));
  const map = itemsByKey();
  [{ env: ENV, name: 'non-hr' }, { env: hrEnv, name: 'hr' }].forEach(({ env, name }) => {
    const S = scrambledSlotState();
    // The same stored-shape resolver the engine hands actions (defaultAsStored),
    // rebuilt from the real schema so the assertions stay end-to-end honest.
    const defaultOf = (key) => PC.engine.resolveDefaultFrom(map[key][0], env);
    assert.equal(PC.actions.resetStatusSlots(null, S, env, defaultOf), true,
      name + ': returns true so the engine re-renders');
    catalog.allSlotKeys().forEach(k => {
      assert.equal(S[k], catalog.slotDefault(k, env),
        name + ': ' + k + ' back to its platform-aware default');
    });
    assert.equal(S.statusBoldAll, 'perSlot', name + ': master Bold row back to perSlot');
    assert.equal(S.tempSlotDisplay, 'actual',
      name + ': temp display pills back to Temp (same sheet, no reset path of its own)');
    assert.equal(S.uvSlotDisplay, 'current',
      name + ': UV display pills back to Now (its sheet\'s reset covers the thresholds only)');
    thresholds.KINDS.forEach(kind => {
      assert.equal(S['thresh' + kind.key + 'BoldMode'], kind.boldOnly ? 'off' : 'warn',
        name + ': ' + kind.key + ' BoldMode back to its sheet default');
    });
    // A weather kind's slot Highlight is a slot-sheet row like Bold: back to off.
    assert.strictEqual(S.threshWindOn, false, name + ': the slot Highlight back to off');
    // Thresholds/colors/outline/max belong to the per-sheet reset — untouched here.
    assert.strictEqual(S.threshStepsOn, true, name + ': a goal kind\'s switch (its Goals group) untouched');
    assert.equal(S.threshWindWarn, '10', name + ': warn threshold untouched');
    assert.equal(S.threshWindDanger, '20', name + ': danger threshold untouched');
    assert.equal(S.threshWindMax, '200', name + ': scale max untouched');
    assert.equal(S.threshWindWarnColor, '#00AAFF', name + ': warn color untouched');
    assert.equal(S.threshWindDangerColor, '#5500FF', name + ': danger color untouched');
  });
});

test('resetStatusSlots reverts every bar\'s On demand ticks, and leaves the items\' settings to their card', () => {
  const map = itemsByKey();
  const defaultOf = (key) => PC.engine.resolveDefaultFrom(map[key][0], ENV);
  const OD = require('../src/pkjs/on-demand.js');
  const S = scrambledSlotState();
  S.statusTopOnDemandLeftItems = 'uv';
  S.statusTopOnDemandRightItems = 'bt';
  ['Forecast', 'Radar', 'Health'].forEach((bar) => {
    S['status' + bar + 'OnDemandRightItems'] = 'uv,wind';
  });
  S.alertUvDisplay = 'value';
  S.rainAlertDisplay = 'minutes';
  S.batteryLowLevel = '30';
  S.btIcons = 'both';
  S.batteryLowOnly = false;
  S.showQt = false;
  PC.actions.resetStatusSlots(null, S, Object.assign({ onDemand: true }, ENV), defaultOf);
  Object.keys(OD.DEFAULTS).filter((k) => /OnDemand/.test(k)).forEach((k) =>
    assert.equal(S[k], OD.DEFAULTS[k], k + ' back to its default'));
  assert.equal(S.alertUvDisplay, 'value', 'the items\' settings are the Alert settings card\'s reset\'s business');
  assert.equal(S.rainAlertDisplay, 'minutes');
  assert.equal(S.batteryLowLevel, '30');
  assert.equal(S.btIcons, 'both', 'the Bluetooth sheet\'s key is the Alert settings card\'s');
  assert.strictEqual(S.batteryLowOnly, false, 'aplite\'s rows are not in this card here');
  assert.strictEqual(S.showQt, false);
  // aplite: no On demand, and the Watch Status Bar's own rows are in the card.
  const A = scrambledSlotState();
  Object.assign(A, { batteryLowOnly: false, showQt: false, vibe: true, btIcons: 'none' });
  PC.actions.resetStatusSlots(null, A, Object.assign({}, ENV, { onDemand: false }), defaultOf);
  assert.strictEqual(A.batteryLowOnly, true);
  assert.strictEqual(A.showQt, true);
  assert.strictEqual(A.vibe, false);
  assert.equal(A.btIcons, 'disconnected');
});

test('resetOnDemand reverts the items\' settings and where each shows — not the levels or the colours', () => {
  const map = itemsByKey();
  const defaultOf = (key) => PC.engine.resolveDefaultFrom(map[key][0], ENV);
  const S = { threshUvWarn: '7', threshUvDanger: '9', threshUvOn: true, rainCountdownHorizon: '120',
    statusTopOnDemandRightItems: 'rain', rainAlertDisplay: 'icon', uvSlotNextDayMark: 'star',
    batteryLowLevel: '25', batteryLowDisplay: 'value', btIcons: 'none', vibe: true,
    threshUvWarnLook: 'outline' };
  ALERT_STEMS.forEach(stem => {
    S['alert' + stem + 'Display'] = 'value';
    S['alert' + stem + 'Days'] = 'today'; S['alert' + stem + 'NextDayMark'] = 'gt';
  });
  assert.equal(PC.actions.resetOnDemand(null, S, ENV, defaultOf), true, 'asks for a re-render');
  ALERT_STEMS.forEach(stem => {
    assert.ok(!('alert' + stem in S), stem + ': no switch key written');
    assert.equal(S['alert' + stem + 'Display'], 'icon', stem + ' Look back to Icon');
    assert.equal(S['alert' + stem + 'Days'], 'tomorrow', stem + ' Days back to Today + tomorrow');
    assert.equal(S['alert' + stem + 'NextDayMark'], 'raquo', stem + ' mark back to the »');
  });
  assert.equal(S.uvSlotNextDayMark, 'star', 'the slot\'s own mark is the status card\'s');
  assert.equal(S.rainAlertDisplay, 'text', 'rain look back to the countdown text');
  assert.equal(S.rainCountdownHorizon, '60', 'the rain window back to 60 min');
  assert.equal(S.batteryLowLevel, '10');
  assert.equal(S.batteryLowDisplay, 'icon');
  assert.equal(S.btIcons, 'disconnected');
  assert.strictEqual(S.vibe, false);
  assert.ok(!('alertRain' in S), 'no rain switch key');
  assert.equal(S.threshUvWarn, '7', 'the levels keep their own reset');
  assert.equal(S.threshUvWarnLook, 'outline', 'and so do the warn looks');
  assert.strictEqual(S.threshUvOn, true, 'and the highlight switch');
  assert.equal(S.statusTopOnDemandRightItems, 'battery,gust,uv,aqi,wind', 'where each item shows: the defaults (E2)');
  assert.equal(S.statusTopOnDemandLeftItems, 'bt,qt,snooze,rain');
  ['Forecast', 'Radar', 'Health'].forEach((bar) => ['Left', 'Right'].forEach((side) =>
    assert.equal(S['status' + bar + 'OnDemand' + side + 'Items'], '', bar + side + ': empty again')));
});

test('the All status bars reset link resets a live page (slots + bold) on click', () => {
  const page = bootGeneratedPage({
    provider: 'dwd',
    statusForecastLeft: 'uv', statusTopMid: 'week', statusHealthRight: 'steps',
    statusBoldAll: 'all', threshCityBoldMode: 'always', threshWindBoldMode: 'off'
  });
  page.clickTab('watch');
  assert.ok(/<div class="row linkrow[^"]*"><button type="button" class="txt-link" data-action="resetStatusSlots">Reset status bars to defaults<\/button><\/div>/
    .test(page.scroll.innerHTML), 'the All status bars card renders the reset link');
  assert.ok(page.scroll.innerHTML.indexOf('data-action="resetStatusSlots"')
    > page.scroll.innerHTML.indexOf(cardTitle('All status bars')), 'inside that card');
  const t = {
    getAttribute: n => (n === 'data-action' ? 'resetStatusSlots' : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  const writesBefore = page.scroll.writes;
  page.scroll.dispatch('click', { target: t });
  assert.equal(page.S.statusForecastLeft, 'temp', 'forecast left back to its default');
  assert.equal(page.S.statusTopMid, 'date', 'top mid back to its default');
  // The harness boots basalt (no HR sensor) → the non-hr health flavor.
  assert.equal(page.S.statusHealthRight, 'sleep', 'health right back to the non-hr default');
  assert.equal(page.S.statusBoldAll, 'perSlot', 'master Bold row back to perSlot');
  assert.equal(page.S.threshCityBoldMode, 'off', 'bold-only kind back to off');
  assert.equal(page.S.threshWindBoldMode, 'warn', 'threshold kind back to warn');
  assert.ok(page.scroll.writes > writesBefore, 'the reset re-rendered the page');
});

test('the temp slot\'s Value selection and its degree sign never touch each other', () => {
  // The owner, 2026-10-03: Show unit is separate from Value selection. Both prints the
  // degree on both readings while the pair fits (slot-text.js tempText), so neither
  // row steps the other aside any more.
  assert.equal(PConf.onChange.get('tempUnitExclusive'), undefined, 'no coupling hook');
});

test("a goal kind's legacy null warn color heals to the auto green on page open", () => {
  // The old parseResponse stored hexToInt('') = NaN -> JSON null for a turned-off
  // goal outline. Since the warn look, "off" is threshSleepWarnLook 'none' (written
  // for exactly those blobs by migrations/v1_24.js migrateWarnLook), and a blank or
  // null colour is auto: the goal green.
  ['', null, undefined].forEach((raw) => {
    const S = { theme: 'dark', threshSleepWarn: '360', threshSleepDanger: '480',
      threshSleepWarnColor: raw, threshSleepWarnLook: 'none' };
    onbuild.onLoad({ env: { platform: 'basalt' },
      get: (k) => S[k], set: (k, v) => { S[k] = v; }, getInitial: (k) => S[k] });
    assert.equal(S.threshSleepWarnColor, '#55FF00', JSON.stringify(raw) + ': the auto green');
    assert.equal(S.threshSleepWarnLook, 'none', 'the none look survives the open');
    assert.equal(S.threshSleepWarnOutlineOn, undefined, 'no outline toggle is derived');
  });
});

