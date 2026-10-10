'use strict';
// test/hr-alert.test.js — emery's heart-rate alert on the phone: the Heart rate On demand
// item's readings (src/pkjs/on-demand.js: hrAvailable, hrLevel, hrShowsValue, its sides
// and its telemetry letters), the heart rate slot's Alert highlighting
// (src/pkjs/status-thresholds.js kindConfig of the tuplePair kind) and the tuple both ride,
// CLAY_HR_ALERT_UINT8 (src/pkjs/status-wire.js buildHrAlertBytes). The byte layout
// itself is pinned against the C header in test/hr-alert-contract.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const OD = require('../src/pkjs/on-demand.js');
const th = require('../src/pkjs/status-thresholds.js');
const wire = require('../src/pkjs/status-wire.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');

const PLATFORMS = ['aplite', 'basalt', 'chalk', 'diorite', 'emery', 'flint'];
// The heart rate slot's kind (KINDS' tuplePair entry), as the packer finds it.
const HR = th.HR_KIND;
const ENV = {};
PLATFORMS.forEach((p) => { ENV[p] = platform.computeEnv({ platform: p }); });
const UNKNOWN = platform.computeEnv(null);
// A settings blob with the item ticked on the Watch Status Bar's right and the health bar's
// left, and every other list empty.
const TICKED = { healthMode: 'status', statusTopOnDemandLeftItems: '', statusTopOnDemandRightItems: 'hr',
  statusForecastOnDemandLeftItems: '', statusForecastOnDemandRightItems: '', statusRadarOnDemandLeftItems: '',
  statusRadarOnDemandRightItems: '', statusHealthOnDemandLeftItems: 'hr', statusHealthOnDemandRightItems: '' };

// --- on-demand.js ---------------------------------------------------------------------

test('the Heart rate item is the last ITEMS entry, past the blob\'s ten cells', () => {
  assert.equal(OD.ITEMS[10].code, 'hr');
  assert.equal(OD.ITEMS[10].group, 'health');
  assert.equal(OD.ITEMS[10].icon, 'heart');
  assert.equal(OD.BLOB_ITEM_COUNT, 10);
  assert.equal(OD.itemIndex('hr'), 10);
  assert.equal(OD.canonical(['hr', 'wind', 'battery']), 'battery,wind,hr', 'the lowest priority');
});

test('hrLevel: the stored level inside 60..200, else 120; hrShowsValue: Icon + value by default', () => {
  assert.equal(OD.hrLevel({}), 120);
  assert.equal(OD.hrLevel(null), 120);
  [['60', 60], ['200', 200], ['135', 135], [150, 150]].forEach(([v, want]) =>
    assert.equal(OD.hrLevel({ hrAlertLevel: v }), want, JSON.stringify(v)));
  ['55', '205', 'x', '', 0, -1].forEach((v) =>
    assert.equal(OD.hrLevel({ hrAlertLevel: v }), 120, JSON.stringify(v)));
  assert.equal(OD.hrShowsValue({}), true, 'the default Look prints the value');
  assert.equal(OD.hrShowsValue({ hrAlertDisplay: 'value' }), true);
  assert.equal(OD.hrShowsValue({ hrAlertDisplay: 'icon' }), false);
  assert.equal(OD.hrShowsValue({ hrAlertDisplay: 'bogus' }), true, 'junk reads the default');
});

test('hrAvailable: an emery reading health, and nothing else (fails closed)', () => {
  ['status', 'all', 'slot'].forEach((mode) =>
    assert.equal(OD.hrAvailable({ healthMode: mode }, ENV.emery), true, 'emery ' + mode));
  assert.equal(OD.hrAvailable({ healthMode: 'off' }, ENV.emery), false, 'emery off');
  assert.equal(OD.hrAvailable({}, ENV.emery), false, 'emery, healthMode absent reads off');
  assert.equal(OD.hrAvailable(null, ENV.emery), false);
  // diorite has a heart-rate sensor, but its image has no Heart rate item.
  ['aplite', 'basalt', 'chalk', 'diorite', 'flint'].forEach((p) =>
    assert.equal(OD.hrAvailable({ healthMode: 'all' }, ENV[p]), false, p));
  assert.equal(OD.hrAvailable({ healthMode: 'all' }, UNKNOWN), false, 'an unknown watch');
  assert.equal(OD.hrAvailable({ healthMode: 'all' }, undefined), false, 'no env');
  assert.equal(OD.hrAvailable({ healthMode: 'all' }, Object.assign({}, ENV.emery, { hr: false })), false,
    'an emery whose env says no sensor');
});

test('sideOf / placedAnywhere: the item shows only where hrAvailable, on a bar that exists', () => {
  assert.equal(OD.sideOf(TICKED, 'top', 'hr', ENV.emery), 'right');
  assert.equal(OD.sideOf(TICKED, 'health', 'hr', ENV.emery), 'left');
  assert.equal(OD.sideOf(TICKED, 'forecast', 'hr', ENV.emery), null);
  assert.equal(OD.placedAnywhere(TICKED, 'hr', ENV.emery), true);
  assert.equal(OD.sideOf(Object.assign({}, TICKED, { healthMode: 'slot' }), 'health', 'hr', ENV.emery), null,
    'slot mode draws no health bar');
  ['aplite', 'basalt', 'chalk', 'diorite', 'flint'].forEach((p) => {
    OD.BARS.forEach((b) => assert.equal(OD.sideOf(TICKED, b.bar, 'hr', ENV[p]), null, p + ' ' + b.bar));
    assert.equal(OD.placedAnywhere(TICKED, 'hr', ENV[p]), false, p);
  });
  assert.equal(OD.placedAnywhere(TICKED, 'hr', UNKNOWN), false, 'an unknown watch');
  assert.equal(OD.placedAnywhere(Object.assign({}, TICKED, { healthMode: 'off' }), 'hr', ENV.emery), false);
  assert.equal(OD.sideOf({ healthMode: 'all' }, 'top', 'hr', ENV.emery), null, 'the defaults leave it off every bar');
});

test('telemetryCode keeps its 40 letters with the item ticked; telemetryHrCode reports it', () => {
  const S = Object.assign({}, TICKED, { statusTopOnDemandRightItems: 'battery,hr' });
  const code = OD.telemetryCode(S, ENV.emery);
  assert.equal(code.length, 40);
  assert.equal(code, OD.telemetryCode(Object.assign({}, S, { statusTopOnDemandRightItems: 'battery',
    statusHealthOnDemandLeftItems: '' }), ENV.emery), 'the heart moves no letter of it');
  assert.equal(OD.telemetryHrCode(S, ENV.emery), 'R--L', 'top right, health left, in BARS order');
  assert.equal(OD.telemetryHrCode(Object.assign({}, S, { healthMode: 'slot' }), ENV.emery), 'R--l',
    'a bar the modes remove reports lower case');
  assert.equal(OD.telemetryHrCode({ healthMode: 'all' }, ENV.emery), '----');
  ['aplite', 'basalt', 'diorite'].forEach((p) => assert.equal(OD.telemetryHrCode(S, ENV[p]), undefined, p));
  assert.equal(OD.telemetryHrCode(S, UNKNOWN), undefined);
  assert.equal(OD.telemetryHrCode(Object.assign({}, S, { healthMode: 'off' }), ENV.emery), undefined);
});

// --- status-thresholds.js -------------------------------------------------------------

test('the heart rate kind is KINDS\' one tuplePair entry, bold-only in the blob', () => {
  assert.equal(th.KINDS[HR].key, 'Hr');
  assert.equal(th.KINDS[HR].boldOnly, true);
  assert.deepEqual(th.KINDS.filter((k) => k.tuplePair).map((k) => k.key), ['Hr']);
});

test('kindConfig of the heart rate kind: the seed pair, a stored ordered pair, the switch', () => {
  const fresh = th.kindConfig({}, HR, true);
  assert.deepEqual(fresh, { enabled: false, warn: 120, danger: 150, warnLook: 'fill', warnColor: 0xFFFFFF,
    dangerColor: 0xFF0000, boldMode: 'warn' });
  assert.equal(th.kindConfig({ threshHrOn: true }, HR, true).enabled, true, 'on, over the seed pair');
  assert.equal(th.kindConfig({ threshHrOn: 'true' }, HR, true).enabled, false, 'only a real true switches it on');
  assert.equal(th.kindConfig(null, HR, true).enabled, false);
  const stored = th.kindConfig({ threshHrOn: true, threshHrWarn: '100', threshHrDanger: '130' }, HR, true);
  assert.deepEqual([stored.enabled, stored.warn, stored.danger], [true, 100, 130]);
  const inverted = th.kindConfig({ threshHrOn: true, threshHrWarn: '150', threshHrDanger: '120' }, HR, true);
  assert.deepEqual([inverted.warn, inverted.danger], [120, 150], 'an inverted pair reads the seed');
  const half = th.kindConfig({ threshHrOn: true, threshHrWarn: '100', threshHrDanger: '' }, HR, true);
  assert.deepEqual([half.warn, half.danger], [120, 150], 'a half pair reads the seed');
});

test('kindConfig of the heart rate kind: the warn look per screen, and the weather kinds\' auto colours', () => {
  assert.equal(th.kindConfig({}, HR, true).warnLook, 'fill', 'a colour screen fills at warn');
  assert.equal(th.kindConfig({}, HR, false).warnLook, 'outline', 'a B&W screen outlines');
  assert.equal(th.kindConfig({}, HR).warnLook, 'fill', 'an unknown screen reads as colour');
  ['none', 'outline', 'fill'].forEach((look) =>
    assert.equal(th.kindConfig({ threshHrWarnLook: look }, HR, false).warnLook, look));
  assert.equal(th.kindConfig({ threshHrWarnLook: 'bogus' }, HR, true).warnLook, 'fill');
  const light = th.kindConfig({ theme: 'light' }, HR, true);
  assert.deepEqual([light.warnColor, light.dangerColor], [0x000000, 0xFF0000], 'the light theme\'s text colour');
  const picked = th.kindConfig({ threshHrWarnColor: '#00AAFF', threshHrDangerColor: 0x5500FF }, HR, true);
  assert.deepEqual([picked.warnColor, picked.dangerColor], [0x00AAFF, 0x5500FF]);
});

test('ownsGroupSwitch names the kinds whose group carries the switch', () => {
  ['Steps', 'Sleep', 'Distance', 'Hr'].forEach((k) => assert.equal(th.ownsGroupSwitch(k), true, k));
  ['Uv', 'Wind', 'Gust', 'Aqi', 'Pollen', 'City', 'Temp', 'Nope'].forEach((k) =>
    assert.equal(th.ownsGroupSwitch(k), false, k));
});

// --- status-wire.js buildHrAlertBytes -------------------------------------------------

test('buildHrAlertBytes: a fresh emery', () => {
  assert.deepEqual(wire.buildHrAlertBytes({}, ENV.emery), [0, 120, 0x09, 120, 150, 0xFF, 0xF0],
    'on no bar, level 120, Icon + value and the colour look fill (1 | 2 << 2), the seed pair, white and red');
  assert.deepEqual(wire.buildHrAlertBytes({ healthMode: 'status' }, ENV.emery),
    [0, 120, 0x09, 120, 150, 0xFF, 0xF0], 'reading health changes nothing until it is placed');
});

test('buildHrAlertBytes: the flags — Look, highlight switch, each warn look', () => {
  const flags = (S, env) => wire.buildHrAlertBytes(S, env || ENV.emery)[wire.HR_ALERT_FLAGS_OFFSET];
  assert.equal(flags({ hrAlertDisplay: 'icon' }) & wire.HR_ALERT_VALUE_BIT, 0, 'Icon');
  assert.equal(flags({ hrAlertDisplay: 'value' }) & wire.HR_ALERT_VALUE_BIT, wire.HR_ALERT_VALUE_BIT, 'Icon + value');
  assert.equal(flags({}) & wire.HR_ALERT_HIGHLIGHT_BIT, 0, 'the highlight ships off');
  assert.equal(flags({ threshHrOn: true }) & wire.HR_ALERT_HIGHLIGHT_BIT, wire.HR_ALERT_HIGHLIGHT_BIT);
  assert.equal(flags({ threshHrOn: true, threshHrWarn: '160', threshHrDanger: '100' }) & wire.HR_ALERT_HIGHLIGHT_BIT,
    wire.HR_ALERT_HIGHLIGHT_BIT, 'an inverted pair highlights on the seed');
  [['none', 0], ['outline', 1], ['fill', 2]].forEach(([look, v]) =>
    assert.equal(flags({ threshHrWarnLook: look }) >> wire.HR_ALERT_LOOK_SHIFT, v, look));
  assert.equal(flags({}, Object.assign({}, ENV.emery, { color: false })) >> wire.HR_ALERT_LOOK_SHIFT, 1,
    'a B&W screen\'s default look: outline');
  const hl = wire.buildHrAlertBytes({ threshHrOn: true, threshHrWarn: '60', threshHrDanger: '70',
    threshHrWarnColor: '#00AAFF', threshHrDangerColor: '#5500FF' }, ENV.emery);
  assert.deepEqual(hl.slice(3), [60, 70, 0xCB, 0xD3], 'the pair, then both colours as GColor8');
});

test('buildHrAlertBytes: the levels as one byte each (clampByte), and the look none\'s real warn colour', () => {
  const levels = (S) => wire.buildHrAlertBytes(Object.assign({ threshHrOn: true }, S), ENV.emery)
    .slice(wire.HR_ALERT_WARN_OFFSET, wire.HR_ALERT_DANGER_OFFSET + 1);
  assert.deepEqual(levels({ threshHrWarn: '200', threshHrDanger: '300' }), [200, 255], 'over a byte: 255');
  assert.deepEqual(levels({ threshHrWarn: '-5', threshHrDanger: '130' }), [0, 130], 'below 0: 0');
  assert.deepEqual(levels({ threshHrWarn: '120.6', threshHrDanger: '150,4' }), [121, 150], 'rounded');
  assert.deepEqual(levels({ threshHrWarn: 'x', threshHrDanger: '130' }), [120, 150], 'junk reads the seed');
  // kindConfig nulls the warn colour for the look 'none' (the blob's no-outline
  // sentinel); the tuple carries the look in its flags and keeps the real colour.
  const none = { threshHrOn: true, threshHrWarnLook: 'none', threshHrWarnColor: '#00AAFF' };
  assert.equal(th.kindConfig(none, HR, true).warnColor, null);
  assert.equal(wire.buildHrAlertBytes(none, ENV.emery)[wire.HR_ALERT_WARN_COLOR_OFFSET], 0xCB);
});

test('buildHrAlertBytes: the cells — every bar and side, a bar that does not exist, health off', () => {
  const cells = (S, env) => wire.buildHrAlertBytes(Object.assign({ healthMode: 'all', radarMode: 'graph' }, S),
    env || ENV.emery)[wire.HR_ALERT_CELLS_OFFSET];
  OD.BARS.forEach((b, bar) => OD.SIDES.forEach((side, s) => {
    const S = {};
    S[OD.itemsKey(b.bar, side)] = 'hr';
    assert.equal(cells(S), (s + 1) << (2 * bar), b.bar + ' ' + side);
  }));
  const everywhere = {};
  OD.BARS.forEach((b) => { everywhere[OD.itemsKey(b.bar, 'right')] = 'hr'; });
  assert.equal(cells(everywhere), 0xAA, 'right on all four bars');
  assert.equal(cells(Object.assign({ radarMode: 'off' }, everywhere)), 0x8A, 'the radar bar gone: its cell 0');
  assert.equal(cells(Object.assign({ healthMode: 'off' }, everywhere)), 0, 'health off: no cell anywhere');
  ['basalt', 'diorite'].forEach((p) =>
    assert.equal(wire.buildHrAlertBytes(Object.assign({ healthMode: 'all' }, everywhere), ENV[p])[0], 0, p));
  // Left wins an overlap, the side lists' rule.
  assert.equal(cells({ statusTopOnDemandLeftItems: 'hr', statusTopOnDemandRightItems: 'hr' }), 1);
});

test('the item never moves a byte of the 48-B thresholds blob, on any watch', () => {
  const S = Object.assign({}, TICKED, { statusTopOnDemandRightItems: 'battery,hr,wind', hrAlertLevel: '150',
    hrAlertDisplay: 'icon', threshHrOn: true, threshHrWarn: '60', threshHrDanger: '70' });
  const without = Object.assign({}, TICKED, { statusTopOnDemandRightItems: 'battery,wind',
    statusHealthOnDemandLeftItems: '' });
  PLATFORMS.map((p) => ENV[p]).concat([UNKNOWN, undefined]).forEach((env) => {
    const blob = wire.buildSettingsBlob(S, env);
    assert.equal(blob.length, 48);
    assert.deepEqual(blob, wire.buildSettingsBlob(without, env), JSON.stringify(env && env.platform));
  });
});
