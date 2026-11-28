const test = require('node:test');
const assert = require('node:assert');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');

const ENV_EMERY = { color: true, platform: 'emery', health: true, radar: true, hr: true };
const ENV_DIORITE = { color: false, platform: 'diorite', health: true, radar: true, hr: true };
const ENV_BASALT = { color: true, platform: 'basalt', health: true, radar: true, hr: false };
const ENV_APLITE = { color: false, platform: 'aplite', health: false, radar: false, hr: false };
// env.phoneBattery is the verdict that the phone can report its charge (the Pebble
// app's Phone plugin or an Android WebView's Battery Status API), threaded from
// the PHONE_BATTERY_SUPPORTED storage key. Every env above deliberately LACKS the
// flag — that is the emulator default (no plugin, no API), under which the two
// phone-battery items must not exist at all.
const ENV_BASALT_PHONE = Object.assign({}, ENV_BASALT, { phoneBattery: true });
const ENV_EMERY_PHONE = Object.assign({}, ENV_EMERY, { phoneBattery: true });
const ENV_APLITE_PHONE = Object.assign({}, ENV_APLITE, { phoneBattery: true });
// All 12 configurable slots, with the position each dropdown passes.
const ALL_SLOT_CTXS = [
  { slotKey: 'statusForecastLeft', position: 'left' },
  { slotKey: 'statusForecastMid', position: 'mid' },
  { slotKey: 'statusForecastRight', position: 'right' },
  { slotKey: 'statusRadarLeft', position: 'left' },
  { slotKey: 'statusRadarMid', position: 'mid' },
  { slotKey: 'statusRadarRight', position: 'right' },
  { slotKey: 'statusTopLeft', position: 'left' },
  { slotKey: 'statusTopMid', position: 'mid' },
  { slotKey: 'statusTopRight', position: 'right' },
  { slotKey: 'statusHealthLeft', position: 'left' },
  { slotKey: 'statusHealthMid', position: 'mid' },
  { slotKey: 'statusHealthRight', position: 'right' }
];

test('LINES describes 4 lines in wire order with three real slots each', () => {
  assert.deepEqual(catalog.LINES.map(l => l.id), ['forecast', 'radar', 'top', 'health']);
  assert.deepEqual(catalog.LINES.map(l => l.wireKey),
    ['STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8', 'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8']);
  catalog.LINES.forEach(l => {
    assert.equal(l.fixedMid, undefined, l.id + ' has no fixed mid');
    assert.equal(l.slots.length, 3);
    l.slots.forEach(k => assert.equal(typeof k, 'string'));
  });
  assert.equal(catalog.LINES[2].slots[1], 'statusTopMid');
});

test('defaults + the two flavors are the shipped status-bar set', () => {
  assert.deepEqual(catalog.LINES[0].defaults,
    { statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'sun' });
  assert.deepEqual(catalog.LINES[1].defaults,
    { statusRadarLeft: 'uv', statusRadarMid: 'wind', statusRadarRight: 'gust' });
  assert.deepEqual(catalog.LINES[2].defaults,
    { statusTopLeft: 'aqi', statusTopMid: 'date', statusTopRight: 'battery' });
  assert.deepEqual(catalog.LINES[2].emeryDefaults,
    { statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'aqi' });
  assert.deepEqual(catalog.LINES[3].defaults,
    { statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  assert.deepEqual(catalog.LINES[3].hrDefaults,
    { statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'hr' });
});

test('slotDefault takes the emery and HR flavors; the other rows are flat', () => {
  assert.equal(catalog.slotDefault('statusHealthRight', ENV_EMERY), 'hr');
  assert.equal(catalog.slotDefault('statusHealthRight', ENV_DIORITE), 'hr');
  assert.equal(catalog.slotDefault('statusHealthRight', ENV_BASALT), 'sleep');
  assert.equal(catalog.slotDefault('statusHealthRight', undefined), 'sleep');
  assert.equal(catalog.slotDefault('statusForecastRight', ENV_EMERY), 'sun');
  assert.equal(catalog.slotDefault('statusForecastRight', ENV_BASALT), 'sun');
  // The top strip: three readings on emery, air quality in its corner; air quality, the
  // date and the battery corner everywhere else.
  assert.equal(catalog.slotDefault('statusTopLeft', ENV_EMERY), 'week');
  assert.equal(catalog.slotDefault('statusTopRight', ENV_EMERY), 'aqi');
  assert.equal(catalog.slotDefault('statusTopLeft', ENV_BASALT), 'aqi');
  assert.equal(catalog.slotDefault('statusTopRight', ENV_BASALT), 'battery');
  assert.equal(catalog.slotDefault('statusTopRight', ENV_DIORITE), 'battery',
    'the split is display width, not colour or heart rate');
  assert.equal(catalog.slotDefault('statusTopMid', ENV_EMERY), 'date');
  assert.equal(catalog.slotDefault('statusTopMid', ENV_BASALT), 'date');
  assert.equal(catalog.slotDefault('statusTopRight', undefined), 'battery',
    'no env is not emery');
  assert.equal(catalog.slotDefault('nope', ENV_BASALT), undefined);
});

test('the top strip default is placeable in the slot it names', () => {
  // A position-gated item (middleOnly) as a default that drifted into the wrong slot
  // would resolve away to Empty on every fresh install.
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  const POSITION = { statusTopLeft: 'left', statusTopMid: 'mid', statusTopRight: 'right' };
  [ENV_EMERY, ENV_BASALT, ENV_DIORITE, ENV_APLITE].forEach((env) => {
    Object.keys(POSITION).forEach((slotKey) => {
      const code = catalog.slotDefault(slotKey, env);
      if (code === 'empty') { return; }
      assert.ok(catalog.itemAvailable(catalog.byCode(code), s, env,
        { slotKey, position: POSITION[slotKey] }),
      `${env.platform}: "${code}" is not placeable in ${slotKey}`);
    });
  });
});

// dayMaxInUse is the SLOT half of the day-peaks gate: a slot shows the kind in a mode
// that prints a peak. The catalog is alert-agnostic — an enabled alert joins the gate
// in forecast-series.js dayPeakCodes (through the threshold contract), not here.
test('dayMaxInUse: a slot in a peak mode, and nothing about alerts', () => {
  const noSlot = { statusRadarLeft: 'empty', statusForecastRight: 'empty' };
  assert.equal(catalog.dayMaxInUse(noSlot, 'uv'), false);
  assert.equal(catalog.dayMaxInUse({ statusTopMid: 'uv', uvSlotDisplay: 'max' }, 'uv'), true);
  assert.equal(catalog.dayMaxInUse({ statusTopMid: 'uv', uvSlotDisplay: 'both' }, 'uv'), true);
  assert.equal(catalog.dayMaxInUse({ statusTopMid: 'uv', uvSlotDisplay: 'current' }, 'uv'), false);
  assert.equal(catalog.dayMaxInUse(Object.assign({ alertUv: true }, noSlot), 'uv'), false,
    'an alert alone is not a slot');
  assert.equal(catalog.dayMaxInUse(null, 'uv'), false);
  assert.equal(catalog.alertEnabled, undefined, 'the catalog exports no alert reader');
});

test('availability gating', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  assert.ok(catalog.itemAvailable(catalog.byCode('temp'), s, ENV_BASALT));
  assert.ok(catalog.itemAvailable(catalog.byCode('steps'), s, ENV_BASALT));
  assert.ok(!catalog.itemAvailable(catalog.byCode('steps'), s, ENV_APLITE));
  // Not healthMode: since 2.6 it is worked out from the screens and the slots.
  assert.ok(catalog.itemAvailable(catalog.byCode('steps'), { healthMode: 'off' }, ENV_BASALT));
  assert.ok(catalog.itemAvailable(catalog.byCode('hr'), s, ENV_EMERY));
  assert.ok(catalog.itemAvailable(catalog.byCode('hr'), s, ENV_DIORITE));
  assert.ok(!catalog.itemAvailable(catalog.byCode('hr'), s, ENV_BASALT));
});

test('date is offered in EVERY slot position (custom layouts freed the calendar)', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  const date = catalog.byCode('date');
  // The middle-only gate was a leftover from the hard-wired strip centre; with
  // custom layouts the calendar can sit anywhere or be absent, so the date is a
  // first-class slot like City — any position, any line, and available without a
  // slot context (nothing position-gates it any more).
  assert.ok(catalog.itemAvailable(date, s, ENV_BASALT));
  assert.ok(catalog.itemAvailable(date, s, ENV_BASALT, { slotKey: 'statusTopLeft', position: 'left' }));
  assert.ok(catalog.itemAvailable(date, s, ENV_BASALT, { slotKey: 'statusTopRight', position: 'right' }));
  assert.ok(catalog.itemAvailable(date, s, ENV_BASALT, { slotKey: 'statusTopMid', position: 'mid' }));
  assert.ok(catalog.itemAvailable(date, s, ENV_BASALT, { slotKey: 'statusForecastMid', position: 'mid' }));
  const mid = catalog.slotOptions(s, ENV_BASALT, { slotKey: 'statusTopMid', position: 'mid' });
  assert.ok(mid.some(o => o[1] === 'date'), 'date offered in a mid dropdown');
  const left = catalog.slotOptions(s, ENV_BASALT, { slotKey: 'statusTopLeft', position: 'left' });
  assert.ok(left.some(o => o[1] === 'date'), 'date offered in an edge dropdown too');
});

test('resolveSelection keeps date in any slot position', () => {
  const s = {};
  assert.equal(catalog.resolveSelection('date', s, ENV_BASALT,
    { slotKey: 'statusTopMid', position: 'mid' }), 'date');
  assert.equal(catalog.resolveSelection('date', s, ENV_BASALT,
    { slotKey: 'statusTopLeft', position: 'left' }), 'date');
});

test('slotOptions: empty first, excludeCodes removed, sibling selections now shown', () => {
  const s = {
    healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph',
    statusForecastLeft: 'temp', statusForecastRight: 'sun'
  };
  const opts = catalog.slotOptions(s, ENV_BASALT,
    { excludeKeys: ['statusForecastRight'], excludeCodes: ['city'] });
  const codes = opts.map(o => o[1]);
  assert.equal(codes[0], 'empty');
  assert.ok(codes.includes('temp'));       // own current value present
  assert.ok(codes.includes('sun'));        // sibling's selection NO LONGER hidden
  assert.ok(!codes.includes('city'));      // excludeCodes still honored
  assert.ok(!codes.includes('hr'));        // env gate (basalt)
  assert.ok(codes.includes('date'));       // date is position-free since custom layouts
});

test('selectedCodes falls back to line defaults for missing keys, over the bars a screen shows', () => {
  const codes = catalog.selectedCodes({ statusRadarMid: 'wind' });
  assert.equal(codes.length, 9, 'the default screens show the Forecast, Radar and Watch bars');
  assert.ok(codes.includes('wind'));  // stored value wins
  assert.ok(codes.includes('temp'));  // forecast-left default
  assert.ok(codes.includes('battery'), 'no env: the base flavor\'s battery corner');
  assert.ok(codes.includes('sun'), 'the Forecast bar\'s sunrise/sunset');
  assert.ok(!codes.includes('steps'), 'the Health bar\'s defaults count only while a screen shows it');
  const all = catalog.selectedCodes({ statusRadarMid: 'wind', healthMode: 'status' });
  assert.equal(all.length, 12, 'with the Health bar on a screen');
  assert.ok(all.includes('steps'));
  assert.equal(catalog.selectedCodes({ radarMode: 'off', statusRadarMid: 'pollen' }).indexOf('pollen'), -1,
    'the radar off: no screen shows the Radar bar, so its slots fetch nothing');
  // The codes answer the defaults the bake packs for this watch (status-lines.js packLine):
  // its callers are fetch gates, and air quality sits in the top row's corner on emery and
  // in its left slot elsewhere. The env also decides which bars the watch draws
  // (test/status-bars/domain/extra-bars.test.js).
  const emery = catalog.selectedCodes({ statusRadarMid: 'wind' }, ENV_EMERY);
  assert.deepEqual(emery.slice(6), ['week', 'date', 'aqi'], 'emery: its own top row');
  assert.deepEqual(codes.slice(6), ['aqi', 'date', 'battery'], 'elsewhere: the base flavor');
  assert.equal(catalog.selectedCodes({ statusRadarMid: 'wind', statusTopLeft: 'empty' }, ENV_EMERY)
    .indexOf('aqi'), 8, 'emery\'s corner fetches air quality whatever the left slot holds');
  assert.equal(catalog.selectedCodes({ statusRadarMid: 'wind', statusTopRight: 'sun' }, ENV_EMERY)
    .indexOf('aqi'), -1, 'and a corner the user changed does not');
  // aplite draws neither the Radar bar nor the Health bar, whatever a settings blob from
  // another watch puts on its screens.
  assert.equal(catalog.selectedCodes({ statusRadarMid: 'wind', healthMode: 'status' }, ENV_APLITE).length, 6,
    'aplite: the Forecast and Watch bars');
});

test('resolveSelection maps invalid/unavailable to empty without touching storage', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  assert.equal(catalog.resolveSelection('hr', s, ENV_BASALT), 'empty');
  assert.equal(catalog.resolveSelection('hr', s, ENV_EMERY), 'hr');
  assert.equal(catalog.resolveSelection('nonsense', s, ENV_EMERY), 'empty');
  assert.equal(catalog.resolveSelection('empty', s, ENV_EMERY), 'empty');
});

/** The four bars' slot settings keys, in line order. */
const FOUR_BAR_SLOTS = catalog.LINES.flatMap((line) => line.slots);

test('the four bars hold the 12 slot settings, in line order', () => {
  assert.deepEqual(FOUR_BAR_SLOTS, [
    'statusForecastLeft', 'statusForecastMid', 'statusForecastRight',
    'statusRadarLeft', 'statusRadarMid', 'statusRadarRight',
    'statusTopLeft', 'statusTopMid', 'statusTopRight',
    'statusHealthLeft', 'statusHealthMid', 'statusHealthRight'
  ]);
});

test('everySlotKey lists every bar\'s slots, bars 4 to 6 after the four, line order', () => {
  assert.deepEqual(catalog.everySlotKey(), FOUR_BAR_SLOTS.concat([
    'statusBar4Left', 'statusBar4Mid', 'statusBar4Right',
    'statusBar5Left', 'statusBar5Mid', 'statusBar5Right',
    'statusBar6Left', 'statusBar6Mid', 'statusBar6Right'
  ]));
});

test('aqi is a TEXT item (leaf icon) available on every platform and in slot options', () => {
  const item = catalog.byCode('aqi');
  assert.ok(item, 'aqi item exists');
  assert.equal(item.kind, catalog.KINDS.TEXT);
  assert.equal(item.icon, catalog.ICONS.AQI);
  assert.ok(catalog.itemAvailable(item, {}, ENV_APLITE), 'available on aplite');
  assert.ok(catalog.itemAvailable(item, {}, ENV_BASALT), 'available on basalt');
  const codes = catalog.slotOptions({}, ENV_BASALT, {}).map(o => o[1]);
  assert.ok(codes.indexOf('aqi') !== -1, 'aqi offered in slot dropdown');
});

test('the day-max kinds are labelled by what they measure, not by a display mode', () => {
  // The Now / Alert / Both pills on the Edit sheet pick what prints; the dropdown names
  // the kind only — UV lost its old '/day max' suffix, the other three never had one.
  assert.equal(catalog.byCode('uv').label, 'UV index');
  catalog.DAY_MAX_KINDS.forEach((code) => {
    assert.doesNotMatch(catalog.byCode(code).label, /max|alert/i, code + ' label names no mode');
  });
});

test('dew point is a TEXT weather item with an icon id of its own', () => {
  const item = catalog.byCode('dew');
  assert.ok(item, 'dew item exists');
  assert.equal(item.kind, catalog.KINDS.TEXT);
  assert.equal(item.label, 'Dew point');
  assert.equal(item.category, 'weather');
  assert.equal(catalog.ICONS.DEWPOINT, 15);
  assert.equal(item.icon, catalog.ICONS.DEWPOINT);
  // Not ICON_NONE: a TEXT slot without its own icon id inherits City's bold mode.
  assert.notEqual(item.icon, catalog.ICONS.NONE);
});

test('dew point works on aplite as plain text (no glyph, so no notAplite gate)', () => {
  const item = catalog.byCode('dew');
  assert.equal(item.notAplite, undefined,
    'the aplite status-row twin reserves zero width for an unknown icon id');
  assert.ok(catalog.itemAvailable(item, {}, ENV_APLITE), 'available on aplite');
  assert.ok(catalog.itemAvailable(item, {}, ENV_BASALT), 'available on basalt');
  const aplite = catalog.slotOptions({}, ENV_APLITE,
    { slotKey: 'statusRadarLeft', position: 'left' }).map(o => o[1]);
  assert.ok(aplite.indexOf('dew') !== -1, 'dew offered in an aplite dropdown');
  const basalt = catalog.slotOptions({}, ENV_BASALT,
    { slotKey: 'statusRadarLeft', position: 'left' }).map(o => o[1]);
  assert.ok(basalt.indexOf('dew') !== -1, 'dew offered in a basalt dropdown');
});

test('dew point follows air pressure in the weather dropdown group', () => {
  const codes = catalog.slotOptions({}, ENV_BASALT,
    { slotKey: 'statusRadarLeft', position: 'left' }).map(o => o[1]);
  assert.equal(codes.indexOf('dew'), codes.indexOf('pressure') + 1);
});

test('no two catalog icon ids collide (a shared id merges two slots\' bold modes)', () => {
  const seen = {};
  Object.keys(catalog.ICONS).forEach((name) => {
    const id = catalog.ICONS[name];
    assert.equal(seen[id], undefined, name + ' reuses icon id ' + id + ' (' + seen[id] + ')');
    seen[id] = name;
  });
  // Id 6 is a retired hole (STATUS_ICON_PRECIP, removed in 3dae9f4): a
  // pre-3dae9f4 install can still hold a persisted blob referencing it.
  assert.ok(Object.keys(catalog.ICONS).every(n => catalog.ICONS[n] !== 6),
    'icon id 6 is retired and must stay unused');
});

test('pollen is a TEXT item every Provider offers: its pollen source follows the Provider', () => {
  const item = catalog.byCode('pollen');
  assert.ok(item, 'pollen item exists');
  assert.equal(item.kind, catalog.KINDS.TEXT);
  assert.equal(item.icon, catalog.ICONS.POLLEN);
  assert.equal(catalog.ICONS.POLLEN, 12);
  assert.equal(item.label, 'Pollen', 'no source in the name: the slot dialog names the one in use');
  ['wunderground', 'openweathermap', 'dwd', 'openmeteo', 'metno', undefined].forEach(provider => {
    const opts = catalog.slotOptions({ provider }, ENV_BASALT,
      { slotKey: 'statusForecastLeft', position: 'left' });
    assert.deepEqual(opts.find(o => o[1] === 'pollen'), ['Pollen', 'pollen', { groupChild: true, groupEnd: false }],
      String(provider));
    assert.equal(catalog.resolveSelection('pollen', { provider }, ENV_BASALT), 'pollen', String(provider));
  });
});

test('week is a LIVE_WEEK item offered on all platforms (aplite gets it as phone-baked text)', () => {
  const item = catalog.byCode('week');
  assert.ok(item, 'week item exists');
  assert.equal(item.kind, catalog.KINDS.LIVE_WEEK);
  assert.equal(item.icon, catalog.ICONS.NONE);
  assert.ok(catalog.itemAvailable(item, {}, ENV_BASALT), 'available on basalt');
  assert.ok(catalog.itemAvailable(item, {}, ENV_APLITE), 'available on aplite');
  const basalt = catalog.slotOptions({}, ENV_BASALT, {}).map(o => o[1]);
  assert.ok(basalt.indexOf('week') !== -1, 'week offered on basalt dropdown');
  const aplite = catalog.slotOptions({}, ENV_APLITE, {}).map(o => o[1]);
  assert.ok(aplite.indexOf('week') !== -1, 'week offered on aplite dropdown');
});

test('forecast line has a configurable middle defaulting to city', () => {
  const forecast = catalog.LINES.filter(l => l.id === 'forecast')[0];
  assert.deepEqual(forecast.slots,
    ['statusForecastLeft', 'statusForecastMid', 'statusForecastRight']);
  assert.equal(forecast.fixedMid, undefined);
  assert.equal(forecast.defaults.statusForecastMid, 'city');
  assert.ok(FOUR_BAR_SLOTS.indexOf('statusForecastMid') !== -1);
});

test('city is offered in the forecast slot dropdowns', () => {
  const codes = catalog.slotOptions({}, ENV_BASALT,
    { excludeKeys: ['statusForecastLeft', 'statusForecastRight'] }).map(o => o[1]);
  assert.ok(codes.indexOf('city') !== -1);
});

test('countdown is a TEXT calendar item available in every slot and exempt from taken codes', () => {
  const item = catalog.byCode('countdown');
  assert.ok(item, 'countdown item exists');
  assert.equal(item.kind, catalog.KINDS.TEXT);
  assert.equal(item.icon, catalog.ICONS.COUNTDOWN);
  assert.equal(item.category, 'datelocation');
  [
    { slotKey: 'statusForecastLeft', position: 'left' },
    { slotKey: 'statusForecastMid', position: 'mid' },
    { slotKey: 'statusTopRight', position: 'right' }
  ].forEach((ctx) => {
    assert.ok(catalog.itemAvailable(item, {}, ENV_APLITE, ctx));
    const codes = catalog.slotOptions({}, ENV_APLITE, {
      slotKey: ctx.slotKey, position: ctx.position, excludeCodes: ['countdown']
    }).map((o) => o[1]);
    assert.ok(codes.indexOf('countdown') !== -1,
      'countdown remains selectable when a sibling already uses it');
  });
});

test('the Plugin value stays in a slot\'s list while a sibling holds it, as the countdown does', () => {
  const env = Object.assign({}, ENV_BASALT, { plugins: true });
  ['statusTopLeft', 'statusTopMid', 'statusBar4Right'].forEach((slotKey) => {
    const codes = catalog.slotOptions({}, env, { slotKey: slotKey, position: 'left',
      excludeCodes: ['pluginValue', 'countdown', 'city'] }).map((o) => o[1]);
    assert.ok(codes.indexOf('pluginValue') !== -1 && codes.indexOf('countdown') !== -1, slotKey);
    assert.equal(codes.indexOf('city'), -1, slotKey + ': another item a sibling holds is not offered');
  });
});

test('walked distance is one catalog entry; the mi kind is pack-time only', () => {
  assert.ok(catalog.byCode('distance'), 'distance entry exists');
  assert.equal(catalog.byCode('distance').kind, catalog.KINDS.LIVE_DISTANCE);
  assert.equal(catalog.byCode('distance_mi'), null, 'no separate mi dropdown code');
  const entries = catalog.slotOptions({ healthMode: 'all' }, ENV_BASALT, {})
    .filter(o => o[1] === 'distance');
  assert.equal(entries.length, 1, 'exactly one Walked distance dropdown entry');
});

test('slotOptions marks multi-item groups and collapses single-item groups', () => {
  const s = { healthMode: 'all', radarMode: 'off' };
  const opts = catalog.slotOptions(s, ENV_EMERY,
    { slotKey: 'statusForecastMid', position: 'mid' });
  const weatherHeader = opts.find(o => o[1] === '__hdr_weather');
  assert.deepEqual(weatherHeader[2], { disabled: true, groupHeader: true });
  const weatherChildren = opts.filter(o => o[2] && o[2].groupChild
    && ['temp', 'wind', 'gust', 'uv', 'aqi', 'sun', 'condition'].indexOf(o[1]) >= 0);
  assert.equal(weatherChildren[0][0], 'Temperature/feels like', 'no label-space indentation');
  assert.equal(weatherChildren[0][2].groupEnd, false);
  assert.equal(weatherChildren[weatherChildren.length - 1][2].groupEnd, true);
  assert.equal(weatherChildren[weatherChildren.length - 1][1], 'condition', 'the weather condition ends the group');

  // city now lives in the "Date and location" group. On an aplite left edge slot,
  // date (middleOnly) is gone but calendar-week is now available (phone-baked
  // text on aplite), so the group has {city, week} -> it gets a header and does
  // NOT collapse.
  const edge = catalog.slotOptions({ healthMode: 'off', radarMode: 'off' },
    ENV_APLITE, { slotKey: 'statusTopLeft', position: 'left' });
  assert.ok(edge.some(o => o[1] === 'city'), 'city is offered');
  assert.ok(edge.some(o => o[1] === 'week'), 'week is offered on aplite too');
  assert.ok(edge.some(o => o[1] === '__hdr_datelocation'), 'multi-item group gets a header');
});

test('the watch battery is one LIVE_BATTERY item for both looks; the retired batteryPct is gone', () => {
  // Until 3.3.0 the Text look was an item of its own, 'batteryPct'. Now the Look is a
  // setting of the one 'battery' item (slot-text.js batteryLook); the catalog only
  // keeps the Icon look's kind. The bake's kind 10 for the Text look, and kind 9 on
  // aplite whatever the look, are pinned in status-lines.test.js.
  const item = catalog.byCode('battery');
  assert.ok(item, 'battery item exists');
  assert.equal(item.kind, catalog.KINDS.LIVE_BATTERY);
  assert.equal(item.icon, catalog.ICONS.NONE);
  assert.equal(item.category, 'battery');
  assert.equal(item.notAplite, undefined, 'the item stays on aplite');
  assert.equal(catalog.byCode('batteryPct'), undefined, 'the retired item is gone');
  // A stored 'batteryPct' is migrated (mergeBatterySlots); the catalog no longer resolves it.
  const topRight = { slotKey: 'statusTopRight', position: 'right' };
  assert.equal(catalog.resolveSelection('batteryPct', {}, ENV_BASALT, topRight), 'empty');
  // ENV_BASALT carries no phoneBattery, so the Battery category holds the WATCH item
  // alone, and a group of one has no header (with env.phoneBattery it has two; below).
  const opts = catalog.slotOptions({}, ENV_BASALT, topRight);
  assert.ok(!opts.some(o => o[1] === '__hdr_battery'), 'a lone watch battery gets no header');
  assert.ok(!opts.some(o => o[1] === 'batteryPct'), 'the retired batteryPct is not offered');
});

test('the WATCH battery is offered in every slot of every bar; on aplite only in the top strip\'s corner', () => {
  // Until 2026-11-23 the top strip's right-hand corner alone could hold it. Aplite's frozen
  // twin repaints only the top strip on a battery change, so it keeps the corner.
  const item = catalog.byCode('battery');
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  [ENV_BASALT, ENV_EMERY, ENV_DIORITE, ENV_APLITE].forEach((env) => {
    catalog.ALL_LINES.forEach((line) => {
      line.slots.forEach((slotKey, i) => {
        const slot = { slotKey, position: catalog.SLOT_POSITIONS[i] };
        const offered = env !== ENV_APLITE || slotKey === 'statusTopRight';
        const where = env.platform + ' ' + slotKey;
        assert.equal(catalog.itemAvailable(item, s, env, slot), offered, where + ': available');
        assert.equal(catalog.slotOptions(s, env, slot).some(o => o[1] === 'battery'), offered, where + ': in the dropdown');
        assert.equal(catalog.resolveSelection('battery', s, env, slot), offered ? 'battery' : 'empty', where + ': kept');
      });
    });
  });
});

test('slotOptions omits headers whose category has no available item', () => {
  const noHealth = catalog.slotOptions({ healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' },
    ENV_APLITE, { slotKey: 'statusForecastLeft', position: 'left' });
  assert.ok(!noHealth.some(o => o[1] === '__hdr_health'), 'no orphan Health header on a watch without Health');
  // aplite edge slot: date (middleOnly) is gone, but city and week (now available
  // on aplite as phone-baked text) remain, so the Date and location group DOES
  // get a header (it is not an orphan single-item collapse).
  const apliteEdge = catalog.slotOptions({ healthMode: 'off', radarMode: 'off' },
    ENV_APLITE, { slotKey: 'statusTopLeft', position: 'left' });
  assert.ok(apliteEdge.some(o => o[1] === '__hdr_datelocation'), 'Date and location header present');
});

// A slot picks a health item in any health mode (no Health screen needed): the mode follows
// the slots and the screens (screens.js deriveModes, 'slot' for a health item in a shown slot).
test('health items are selectable in any health mode, on a watch with Health', () => {
  ['off', 'slot', 'status', 'all', undefined].forEach((healthMode) => {
    const S = { healthMode };
    ['steps', 'distance', 'sleep'].forEach((code) => {
      assert.ok(catalog.itemAvailable(catalog.byCode(code), S, ENV_BASALT), code + ' under healthMode ' + healthMode);
      assert.ok(!catalog.itemAvailable(catalog.byCode(code), S, ENV_APLITE), code + ': never on aplite');
    });
    assert.ok(catalog.itemAvailable(catalog.byCode('hr'), S, ENV_EMERY), 'hr on a heart-rate watch, ' + healthMode);
  });
});

// --- Phone battery (phone-baked TEXT, where the phone can report it) -------------------------

test('the phone battery is a TEXT item with its own icon id and no position pinning', () => {
  const iconed = catalog.byCode('phoneBattery');
  assert.ok(iconed, 'phoneBattery item exists');
  assert.equal(iconed.label, 'Phone battery');
  // The no-icon variant is the item's Text look (slot-text.js phoneBatteryLook), not an item.
  assert.equal(catalog.byCode('phoneBatteryPlain'), undefined, 'no item of its own');
  [iconed].forEach((item) => {
    // SLOT_TEXT, not a new SLOT_LIVE_* kind: the phone bakes "NN%" and the watch
    // just prints it, which is why the feature costs no watch-side plumbing.
    assert.equal(item.kind, catalog.KINDS.TEXT, item.code + ' kind');
    assert.equal(item.category, 'battery', item.code + ' category');
    assert.equal(item.needsPhoneBattery, true, item.code + ' gate');
    assert.equal(item.notAplite, true, item.code + ' aplite gate');
    // These carry their own icon (or deliberately none) and belong in any slot.
    assert.equal(item.middleOnly, undefined, item.code + ' must not be middle-only');
  });
  assert.equal(iconed.icon, catalog.ICONS.PHONE_BATTERY);
  // The Text look's icon id (18) is packed by the bake, never TEXT + ICON_NONE: that is
  // City's shape on the watch, and the slot would silently drive City's Bold row.
  assert.notEqual(catalog.ICONS.PHONE_BATTERY_PLAIN, catalog.ICONS.NONE);
  assert.notEqual(catalog.ICONS.PHONE_BATTERY_PLAIN, iconed.icon);
});

test('the phone battery is OMITTED, not shown disabled, without env.phoneBattery', () => {
  // iOS, the emulator, and a first run before the detector has answered all look
  // the same: no env.phoneBattery. There is no setting the user could change to
  // earn the item, so it must vanish (the notAplite path) rather than appear as
  // a greyed-out row.
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  [ENV_BASALT, ENV_EMERY, ENV_DIORITE].forEach((env) => {
    ALL_SLOT_CTXS.forEach((ctx) => {
      assert.ok(!catalog.itemAvailable(catalog.byCode('phoneBattery'), s, env, ctx),
        'phoneBattery must be unavailable on ' + env.platform + ' / ' + ctx.slotKey);
      const row = catalog.slotOptions(s, env, ctx).find(o => o[1] === 'phoneBattery');
      assert.equal(row, undefined,
        'phoneBattery must be absent from the ' + ctx.slotKey + ' dropdown, not disabled');
    });
  });
  // An env object missing entirely is the same answer.
  assert.ok(!catalog.itemAvailable(catalog.byCode('phoneBattery'), s, undefined,
    ALL_SLOT_CTXS[0]));
  // A slot synced from an Android phone and then opened on an iPhone resolves
  // away rather than packing an item the phone can never fill.
  assert.equal(catalog.resolveSelection('phoneBattery', s, ENV_BASALT, ALL_SLOT_CTXS[0]), 'empty');
});

test('the Plugin value is offered only where the Pebble app reads plugins, never on aplite, in a group of its own', () => {
  // env.plugins: plugin-reader.js available, the page's from index.js, the bake's from its facts.
  const s = {};
  const item = catalog.byCode('pluginValue');
  assert.equal(item.kind, catalog.KINDS.TEXT);
  assert.equal(item.icon, catalog.ICONS.PLUGIN_TEXT, 'the value alone until an icon is picked for it');
  [ENV_BASALT, ENV_EMERY, ENV_DIORITE].forEach((env) => {
    const withPlugins = Object.assign({ plugins: true }, env);
    ALL_SLOT_CTXS.forEach((ctx) => {
      const where = env.platform + ' / ' + ctx.slotKey;
      assert.ok(!catalog.itemAvailable(item, s, env, ctx), where);
      assert.equal(catalog.slotOptions(s, env, ctx).find((o) => o[1] === 'pluginValue'), undefined,
        'absent, not disabled: ' + where);
      assert.ok(catalog.itemAvailable(item, s, withPlugins, ctx), where);
      const options = catalog.slotOptions(s, withPlugins, ctx);
      assert.deepEqual(options.slice(0, 2), [['Empty', 'empty'], ['Plugin value', 'pluginValue']],
        'right under Empty, alone: no header');
    });
  });
  ALL_SLOT_CTXS.forEach((ctx) => {
    assert.ok(!catalog.itemAvailable(item, s, Object.assign({ plugins: true }, ENV_APLITE), ctx), ctx.slotKey);
  });
  assert.equal(catalog.resolveSelection('pluginValue', s, ENV_BASALT, ALL_SLOT_CTXS[0]), 'empty');
});

test('each slot keeps its own Plugin value settings and dialog, which a bar made or deleted clears', () => {
  const slots = catalog.everySlotKey();
  assert.equal(slots.length, 21);
  const keys = [];
  const sheets = [];
  slots.forEach((slotKey) => {
    const own = catalog.pluginValueKeys(slotKey);
    assert.deepEqual(own, { plugin: slotKey + 'PluginValuePlugin', id: slotKey + 'PluginValueId',
      instance: slotKey + 'PluginValueInstance', look: slotKey + 'PluginValueLook', icon: slotKey + 'PluginValueIcon',
      label: slotKey + 'PluginValueLabel', every: slotKey + 'PluginValueEvery' });
    Object.keys(own).forEach((name) => keys.push(own[name]));
    assert.deepEqual(catalog.pluginValueKeyList(slotKey), Object.values(own), 'the list of them');
    sheets.push(catalog.pluginValueSheet(slotKey));
    // The companions a bar made or deleted puts back with the slot (screens.js makeBar,
    // unmakeBar), never signed: a new source needs a read, not a weather fetch.
    assert.deepEqual(catalog.slotCompanions(slotKey).filter((c) => c.code === 'pluginValue'),
      Object.keys(own).map((name) => ({ code: 'pluginValue', key: own[name], defaultValue: undefined, signed: false })));
  });
  assert.equal(new Set(keys).size, 147, 'no slot shares a key with another');
  assert.equal(new Set(sheets).size, 21, 'nor a dialog');
  assert.equal(catalog.pluginValueSheet('statusTopRight'), 'threshPluginValueTopRight');
  assert.equal(catalog.pluginValueSheet('statusBar4Left'), 'threshPluginValueBar4Left');
});

test('the phone battery is selectable in all 12 slots when the phone supports it', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  assert.equal(ALL_SLOT_CTXS.length, FOUR_BAR_SLOTS.length, 'all 12 slots covered');
  ALL_SLOT_CTXS.forEach((ctx) => {
    const codes = catalog.slotOptions(s, ENV_BASALT_PHONE, ctx).map(o => o[1]);
    assert.ok(catalog.itemAvailable(catalog.byCode('phoneBattery'), s, ENV_BASALT_PHONE, ctx),
      'phoneBattery available in ' + ctx.slotKey);
    assert.ok(codes.indexOf('phoneBattery') !== -1,
      'phoneBattery offered in the ' + ctx.slotKey + ' dropdown');
    assert.equal(catalog.resolveSelection('phoneBattery', s, ENV_BASALT_PHONE, ctx), 'phoneBattery',
      'phoneBattery resolves in ' + ctx.slotKey);
  });
  // Also available with no slot context at all (unlike date/battery, which are
  // position-gated and answer false without one).
  assert.ok(catalog.itemAvailable(catalog.byCode('phoneBattery'), s, ENV_EMERY_PHONE),
    'phoneBattery needs no slot context');
});

test('the phone battery is absent on aplite even where the phone reports a charge', () => {
  // aplite is a frozen lean image: no glyph ships, and its status-row twin never
  // learns the ids. The gate is the platform, not the phone.
  const s = { healthMode: 'all' };
  ALL_SLOT_CTXS.forEach((ctx) => {
    const codes = catalog.slotOptions(s, ENV_APLITE_PHONE, ctx).map(o => o[1]);
    assert.ok(!catalog.itemAvailable(catalog.byCode('phoneBattery'), s, ENV_APLITE_PHONE, ctx),
      'phoneBattery must be unavailable on aplite (' + ctx.slotKey + ')');
    assert.equal(codes.indexOf('phoneBattery'), -1,
      'phoneBattery must not reach an aplite dropdown (' + ctx.slotKey + ')');
  });
  assert.equal(catalog.resolveSelection('phoneBattery', s, ENV_APLITE_PHONE, ALL_SLOT_CTXS[0]),
    'empty');
});

test('with env.phoneBattery every slot offers both batteries under a Battery header', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  [{ slotKey: 'statusTopRight', position: 'right' }, { slotKey: 'statusForecastLeft', position: 'left' }]
    .forEach((slot) => {
      const codes = catalog.slotOptions(s, ENV_BASALT_PHONE, slot).map(o => o[1]);
      ['battery', 'phoneBattery'].forEach((code) => {
        assert.ok(codes.indexOf(code) !== -1, slot.slotKey + ': ' + code + ' offered');
      });
      assert.ok(codes.indexOf('__hdr_battery') !== -1, slot.slotKey + ': the two-item Battery group gets a header');
    });
});

test('the two Battery rows are labelled Watch/Phone so neither just reads "battery"', () => {
  assert.equal(catalog.byCode('battery').label, 'Watch battery');
  assert.equal(catalog.byCode('phoneBattery').label, 'Phone battery');
  const labels = catalog.slotOptions({}, ENV_BASALT_PHONE,
    { slotKey: 'statusTopRight', position: 'right' })
    .filter(o => ['battery', 'phoneBattery'].indexOf(o[1]) !== -1)
    .map(o => o[0]);
  assert.deepEqual(labels, ['Watch battery', 'Phone battery']);
  // Every label is unique: two rows under one header would otherwise be
  // indistinguishable in the dropdown.
  assert.equal(new Set(labels).size, labels.length, 'Battery labels must be unique');
});

test('the slot lists always name the city with its weather icon, except on aplite', () => {
  const label = (env, settings) => catalog.slotOptions(settings || {}, env, { slotKey: 'statusTopLeft', position: 'left' })
    .filter((o) => o[1] === 'city').map((o) => o[0])[0];
  assert.equal(label(ENV_BASALT), 'City with weather icon');
  assert.equal(label(ENV_BASALT, { citySlotIcon: true }), 'City with weather icon');
  assert.equal(label(ENV_BASALT, { citySlotIcon: false }), 'City with weather icon', 'the toggle off: same name');
  assert.equal(label({ platform: 'aplite' }), 'City');
  assert.equal(label({ platform: 'aplite' }, { citySlotIcon: true }), 'City');
  assert.equal(label({ platform: 'aplite' }, { citySlotIcon: false }), 'City');
});

// An edge slot's weather condition takes the middle's room while the whole line fits its 48
// bytes, the left first: the one decision the bake and the settings page's pictures share.
test('an edge condition takes the middle\'s room while the line fits, the left first', () => {
  const MAX = catalog.CAPS.LINE_MAX;
  assert.deepEqual(catalog.widenEdges([11, 3, 11], [22, null, 22]), [true, false, true], 'both fit: 47 B');
  assert.deepEqual(catalog.widenEdges([11, 3, 11], [22, null, 26]), [true, false, false],
    'the left first: its room leaves the right none (51 B)');
  assert.deepEqual(catalog.widenEdges([11, 20, 11], [22, null, 15]), [false, false, true],
    'the right where the left does not fit');
  assert.deepEqual(catalog.widenEdges([11, 3, 11], [MAX - 14, null, null]), [true, false, false], 'the cap itself fits');
  assert.deepEqual(catalog.widenEdges([11, 3, 11], [MAX - 13, null, null]), [false, false, false], 'a byte over does not');
  assert.deepEqual(catalog.widenEdges([11, 3, 11], [null, 30, undefined]), [false, false, false],
    'no wide value, nothing grows; the middle never does');
});
