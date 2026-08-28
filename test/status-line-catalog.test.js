const test = require('node:test');
const assert = require('node:assert');
const catalog = require('../src/pkjs/status-line-catalog.js');

const ENV_EMERY = { color: true, round: false, platform: 'emery', health: true, radar: true, hr: true };
const ENV_DIORITE = { color: false, round: false, platform: 'diorite', health: true, radar: true, hr: true };
const ENV_BASALT = { color: true, round: false, platform: 'basalt', health: true, radar: true, hr: false };
const ENV_APLITE = { color: false, round: false, platform: 'aplite', health: false, radar: false, hr: false };
// env.phoneBattery is the Android-only Battery Status API verdict, threaded from
// the PHONE_BATTERY_SUPPORTED storage key. Every env above deliberately LACKS the
// flag — that is the iOS/emulator default, under which the two phone-battery items
// must not exist at all.
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
    { statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi' });
  assert.deepEqual(catalog.LINES[1].defaults,
    { statusRadarLeft: 'uv', statusRadarMid: 'wind', statusRadarRight: 'gust' });
  assert.deepEqual(catalog.LINES[2].defaults,
    { statusTopLeft: 'empty', statusTopMid: 'date', statusTopRight: 'battery' });
  assert.deepEqual(catalog.LINES[2].emeryDefaults,
    { statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'sun' });
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
  assert.equal(catalog.slotDefault('statusForecastRight', ENV_EMERY), 'aqi');
  // The top strip: three readings on emery, date + battery corner everywhere else.
  assert.equal(catalog.slotDefault('statusTopLeft', ENV_EMERY), 'week');
  assert.equal(catalog.slotDefault('statusTopRight', ENV_EMERY), 'sun');
  assert.equal(catalog.slotDefault('statusTopLeft', ENV_BASALT), 'empty');
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
  // 'battery' is topRightOnly and 'date' is middleOnly, so a default that drifted
  // into the wrong slot would resolve away to Empty on every fresh install.
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

test('availability gating', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  assert.ok(catalog.itemAvailable(catalog.byCode('temp'), s, ENV_BASALT));
  assert.ok(catalog.itemAvailable(catalog.byCode('steps'), s, ENV_BASALT));
  assert.ok(!catalog.itemAvailable(catalog.byCode('steps'), s, ENV_APLITE));
  assert.ok(!catalog.itemAvailable(catalog.byCode('steps'), { healthMode: 'off' }, ENV_BASALT));
  assert.ok(catalog.itemAvailable(catalog.byCode('hr'), s, ENV_EMERY));
  assert.ok(catalog.itemAvailable(catalog.byCode('hr'), s, ENV_DIORITE));
  assert.ok(!catalog.itemAvailable(catalog.byCode('hr'), s, ENV_BASALT));
});

test('date is middle-only: offered in mid slots of any line, nowhere else', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  const date = catalog.byCode('date');
  assert.ok(!catalog.itemAvailable(date, s, ENV_BASALT), 'no slot context -> unavailable');
  assert.ok(!catalog.itemAvailable(date, s, ENV_BASALT, { slotKey: 'statusTopLeft', position: 'left' }));
  assert.ok(!catalog.itemAvailable(date, s, ENV_BASALT, { slotKey: 'statusTopRight', position: 'right' }));
  assert.ok(catalog.itemAvailable(date, s, ENV_BASALT, { slotKey: 'statusTopMid', position: 'mid' }));
  assert.ok(catalog.itemAvailable(date, s, ENV_BASALT, { slotKey: 'statusForecastMid', position: 'mid' }));
  const mid = catalog.slotOptions(s, ENV_BASALT, { slotKey: 'statusTopMid', position: 'mid' });
  assert.ok(mid.some(o => o[1] === 'date'), 'date offered in a mid dropdown');
  const left = catalog.slotOptions(s, ENV_BASALT, { slotKey: 'statusTopLeft', position: 'left' });
  assert.ok(!left.some(o => o[1] === 'date'), 'date absent from an edge dropdown');
});

test('resolveSelection honors the slot context', () => {
  const s = {};
  assert.equal(catalog.resolveSelection('date', s, ENV_BASALT,
    { slotKey: 'statusTopMid', position: 'mid' }), 'date');
  assert.equal(catalog.resolveSelection('date', s, ENV_BASALT,
    { slotKey: 'statusTopLeft', position: 'left' }), 'empty');
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
  assert.ok(!codes.includes('date'));      // date is middle-only: absent without a mid slot context
});

test('selectedCodes falls back to line defaults for missing keys', () => {
  const codes = catalog.selectedCodes({ statusRadarMid: 'wind' });
  assert.equal(codes.length, 12);
  assert.ok(codes.includes('wind'));  // stored value wins
  assert.ok(codes.includes('temp'));  // forecast-left default
  assert.ok(codes.includes('battery'));
  assert.ok(!codes.includes('sun'), 'it answers the flavor-less top row');
  // Deliberately env-free: its callers are fetch gates for uv/aqi/pollen, none of which
  // a per-platform flavor moves, so no caller has an env to pass. The emery flavor is
  // pinned at its real source instead.
  assert.equal(catalog.selectedCodes.length, 1,
    'selectedCodes takes only settings — an env parameter nothing can pass is dead');
  assert.equal(catalog.slotDefault('statusTopRight', ENV_EMERY), 'sun');
});

test('resolveSelection maps invalid/unavailable to empty without touching storage', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  assert.equal(catalog.resolveSelection('hr', s, ENV_BASALT), 'empty');
  assert.equal(catalog.resolveSelection('hr', s, ENV_EMERY), 'hr');
  assert.equal(catalog.resolveSelection('nonsense', s, ENV_EMERY), 'empty');
  assert.equal(catalog.resolveSelection('empty', s, ENV_EMERY), 'empty');
});

test('allSlotKeys lists the 12 configurable slot settings', () => {
  assert.deepEqual(catalog.allSlotKeys(), [
    'statusForecastLeft', 'statusForecastMid', 'statusForecastRight',
    'statusRadarLeft', 'statusRadarMid', 'statusRadarRight',
    'statusTopLeft', 'statusTopMid', 'statusTopRight',
    'statusHealthLeft', 'statusHealthMid', 'statusHealthRight'
  ]);
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

test('pollen is a DWD-only TEXT item: selectable for DWD, visible-but-disabled elsewhere', () => {
  const item = catalog.byCode('pollen');
  assert.ok(item, 'pollen item exists');
  assert.equal(item.kind, catalog.KINDS.TEXT);
  assert.equal(item.icon, catalog.ICONS.POLLEN);
  assert.equal(catalog.ICONS.POLLEN, 12);
  assert.equal(item.needsProvider, 'dwd');
  assert.equal(item.label, 'Pollen (DWD)', 'the label names the providing service');

  // An item failing ONLY the provider gate stays in the dropdown as a disabled
  // row (the user learns the option exists) instead of vanishing.
  const providerCodes = ['wunderground', 'openweathermap', 'dwd', 'openmeteo', 'metno'];
  providerCodes.forEach(provider => {
    const opts = catalog.slotOptions({ provider }, ENV_BASALT,
      { slotKey: 'statusForecastLeft', position: 'left' });
    const row = opts.find(o => o[1] === 'pollen');
    assert.ok(row, 'pollen row present under ' + provider);
    assert.equal(row[0], 'Pollen (DWD)', provider);
    assert.equal(Boolean(row[2] && row[2].disabled), provider !== 'dwd',
      provider + ' disabled flag');
  });
});

test('a disabled provider-gated row still carries its group-child metadata', () => {
  // The weather category has several items, so pollen rides inside the group:
  // the disabled flag must merge with (not replace) the child indentation meta.
  const opts = catalog.slotOptions({ provider: 'openmeteo' }, ENV_BASALT,
    { slotKey: 'statusForecastLeft', position: 'left' });
  const row = opts.find(o => o[1] === 'pollen');
  assert.equal(row[2].disabled, true);
  assert.equal(row[2].groupChild, true);
  assert.equal(typeof row[2].groupEnd, 'boolean');
});

test('pollen defensively resolves to empty unless the weather provider is DWD', () => {
  assert.equal(catalog.resolveSelection('pollen', { provider: 'dwd' }, ENV_BASALT), 'pollen');
  ['wunderground', 'openweathermap', 'openmeteo', 'metno'].forEach(provider => {
    assert.equal(catalog.resolveSelection('pollen', { provider }, ENV_BASALT), 'empty', provider);
  });
  assert.equal(catalog.resolveSelection('pollen', {}, ENV_BASALT), 'empty', 'missing provider');
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
  assert.ok(catalog.allSlotKeys().indexOf('statusForecastMid') !== -1);
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
    && ['temp', 'wind', 'gust', 'uv', 'aqi', 'sun'].indexOf(o[1]) >= 0);
  assert.equal(weatherChildren[0][0], 'Temperature/feels like', 'no label-space indentation');
  assert.equal(weatherChildren[0][2].groupEnd, false);
  assert.equal(weatherChildren[weatherChildren.length - 1][2].groupEnd, true);

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

test('battery is a LIVE_BATTERY item offered only in the top-right slot', () => {
  const item = catalog.byCode('battery');
  assert.ok(item, 'battery item exists');
  assert.equal(item.kind, catalog.KINDS.LIVE_BATTERY);
  assert.equal(item.icon, catalog.ICONS.NONE);
  assert.equal(item.category, 'battery');
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  const topRight = { slotKey: 'statusTopRight', position: 'right' };
  const topLeft = { slotKey: 'statusTopLeft', position: 'left' };
  assert.ok(catalog.itemAvailable(item, s, ENV_BASALT, topRight), 'available top-right');
  assert.ok(!catalog.itemAvailable(item, s, ENV_BASALT, topLeft), 'not in the left slot');
  assert.ok(!catalog.itemAvailable(item, s, ENV_BASALT,
    { slotKey: 'statusForecastRight', position: 'right' }), 'not in other lines');
  const opts = catalog.slotOptions(s, ENV_BASALT, topRight);
  assert.ok(opts.some(o => o[1] === '__hdr_battery'),
    'the Battery group (watch glyph + watch %) gets a header top-right');
  const glyph = opts.find(o => o[1] === 'battery');
  assert.ok(glyph && glyph[2].groupChild, 'battery offered top-right as a group child');
  const leftOpts = catalog.slotOptions(s, ENV_BASALT, topLeft);
  // ENV_BASALT carries no phoneBattery, so the Battery category holds only the
  // two WATCH items here and both are top-right only — hence no header at all
  // elsewhere. (With env.phoneBattery the phone items DO populate this category
  // in every slot; covered below.)
  assert.ok(!leftOpts.some(o => o[1] === '__hdr_battery'),
    'the watch Battery items are top-right only, so the category emits no header elsewhere');
  assert.ok(!leftOpts.some(o => o[1] === 'battery'), 'no glyph battery elsewhere');
  assert.ok(!leftOpts.some(o => o[1] === 'batteryPct'), 'no battery % elsewhere either');
});

test('batteryPct is a LIVE_BATTERY_PCT text item, top-right only, gated off aplite', () => {
  const item = catalog.byCode('batteryPct');
  assert.ok(item, 'batteryPct item exists');
  assert.equal(item.kind, catalog.KINDS.LIVE_BATTERY_PCT);
  assert.equal(item.icon, catalog.ICONS.NONE);
  assert.equal(item.category, 'battery');
  assert.equal(item.notAplite, true);
  // Both battery items live in the top-right slot — the corner the watch already
  // reads as the battery's — so the glyph and the "NN%" text are two renderings of
  // the same thing in the same place rather than one of them roaming the other rows.
  assert.equal(item.topRightOnly, true);
  const topRight = { slotKey: 'statusTopRight', position: 'right' };
  const ctx = { slotKey: 'statusForecastLeft', position: 'left' };
  assert.ok(catalog.itemAvailable(item, {}, ENV_BASALT, topRight), 'available on basalt');
  assert.ok(catalog.itemAvailable(item, {}, ENV_EMERY, topRight), 'available on emery');
  assert.ok(catalog.itemAvailable(item, {}, ENV_DIORITE, topRight), 'available on diorite');
  assert.ok(!catalog.itemAvailable(item, {}, ENV_BASALT, ctx), 'not in a non-top-right slot');
  assert.ok(!catalog.itemAvailable(item, {}, ENV_APLITE, topRight),
    'absent on aplite — its glyph battery slot already renders "NN%" text');
  const basalt = catalog.slotOptions({}, ENV_BASALT, topRight).map(o => o[1]);
  assert.ok(basalt.indexOf('batteryPct') !== -1, 'offered on a basalt top-right dropdown');
  const basaltLeft = catalog.slotOptions({}, ENV_BASALT, ctx).map(o => o[1]);
  assert.equal(basaltLeft.indexOf('batteryPct'), -1, 'not offered on a non-top-right dropdown');
  const aplite = catalog.slotOptions({}, ENV_APLITE, topRight).map(o => o[1]);
  assert.equal(aplite.indexOf('batteryPct'), -1, 'not offered on an aplite dropdown');
  // Defensive resolve mirrors the gate (a synced non-aplite top-right selection).
  assert.equal(catalog.resolveSelection('batteryPct', {}, ENV_BASALT, topRight), 'batteryPct');
  assert.equal(catalog.resolveSelection('batteryPct', {}, ENV_BASALT, ctx), 'empty');
  assert.equal(catalog.resolveSelection('batteryPct', {}, ENV_APLITE, topRight), 'empty');
});

test('the WATCH battery items are top-right only — there, and nowhere else', () => {
  // Scoped to an env WITHOUT phoneBattery: the category itself is no longer
  // top-right-only (the two phone items roam every slot), but the two watch
  // items still are, and that pinning is what keeps the glyph and its "NN%"
  // rendering in the corner the watch already reads as its own battery.
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  assert.equal(ENV_BASALT.phoneBattery, undefined, 'this test needs the no-phone env');
  const trCodes = catalog.slotOptions(s, ENV_BASALT,
    { slotKey: 'statusTopRight', position: 'right' }).map(o => o[1]);
  assert.ok(trCodes.includes('battery'), 'top-right offers the glyph item');
  assert.ok(trCodes.includes('batteryPct'), 'top-right offers the % item');
  [
    { slotKey: 'statusTopLeft', position: 'left' },
    { slotKey: 'statusForecastMid', position: 'mid' },
    { slotKey: 'statusHealthRight', position: 'right' }
  ].forEach((ctx) => {
    const codes = catalog.slotOptions(s, ENV_BASALT, ctx).map(o => o[1]);
    assert.ok(!codes.includes('battery'), ctx.slotKey + ': no glyph battery');
    assert.ok(!codes.includes('batteryPct'), ctx.slotKey + ': no battery %');
    assert.ok(!codes.includes('__hdr_battery'), ctx.slotKey + ': no orphan Battery header');
  });
});

test('slotOptions omits headers whose category has no available item', () => {
  const healthOff = catalog.slotOptions({ healthMode: 'off', radarProvider: 'rainbow', radarMode: 'graph' },
    ENV_BASALT, { slotKey: 'statusForecastLeft', position: 'left' });
  assert.ok(!healthOff.some(o => o[1] === '__hdr_health'), 'no orphan Health header');
  // aplite edge slot: date (middleOnly) is gone, but city and week (now available
  // on aplite as phone-baked text) remain, so the Date and location group DOES
  // get a header (it is not an orphan single-item collapse).
  const apliteEdge = catalog.slotOptions({ healthMode: 'off', radarMode: 'off' },
    ENV_APLITE, { slotKey: 'statusTopLeft', position: 'left' });
  assert.ok(apliteEdge.some(o => o[1] === '__hdr_datelocation'), 'Date and location header present');
});

test("'slot' health mode keeps health items selectable (no dedicated Health view needed)", () => {
  const slot = { healthMode: 'slot' };
  ['steps', 'distance', 'sleep'].forEach((code) => {
    assert.ok(catalog.itemAvailable(catalog.byCode(code), slot, ENV_BASALT),
      code + " must be available under healthMode 'slot'");
  });
  assert.ok(catalog.itemAvailable(catalog.byCode('hr'), slot, ENV_EMERY),
    "hr must be available under 'slot' on a heart-rate watch");
  // 'off' still hides them.
  assert.ok(!catalog.itemAvailable(catalog.byCode('steps'), { healthMode: 'off' }, ENV_BASALT));
});

// --- Phone battery (Android-only, phone-baked TEXT) -------------------------

test('the phone-battery items are TEXT with their own icon ids and no position pinning', () => {
  const plain = catalog.byCode('phoneBatteryPlain');
  const iconed = catalog.byCode('phoneBattery');
  assert.ok(iconed, 'phoneBattery item exists');
  assert.ok(plain, 'phoneBatteryPlain item exists');
  assert.equal(iconed.label, 'Phone battery');
  assert.equal(plain.label, 'Phone battery (no icon)');
  [iconed, plain].forEach((item) => {
    // SLOT_TEXT, not a new SLOT_LIVE_* kind: the phone bakes "NN%" and the watch
    // just prints it, which is why the feature costs no watch-side plumbing.
    assert.equal(item.kind, catalog.KINDS.TEXT, item.code + ' kind');
    assert.equal(item.category, 'battery', item.code + ' category');
    assert.equal(item.needsPhoneBattery, true, item.code + ' gate');
    assert.equal(item.notAplite, true, item.code + ' aplite gate');
    // NOT corner-pinned like the watch items: these carry their own icon (or
    // deliberately none) and belong in any slot.
    assert.equal(item.topRightOnly, undefined, item.code + ' must not be top-right only');
    assert.equal(item.middleOnly, undefined, item.code + ' must not be middle-only');
    // A provider gate would render a DISABLED row; the phone gate must omit.
    assert.equal(item.needsProvider, undefined, item.code + ' must not be provider-gated');
  });
  assert.equal(iconed.icon, catalog.ICONS.PHONE_BATTERY);
  assert.equal(plain.icon, catalog.ICONS.PHONE_BATTERY_PLAIN);
  // The plain variant must NOT be TEXT + ICON_NONE: that is City's shape on the
  // watch, and the no-icon slot would silently drive City's Bold row.
  assert.notEqual(plain.icon, catalog.ICONS.NONE);
  assert.notEqual(plain.icon, iconed.icon);
});

test('the phone battery is OMITTED, not shown disabled, without env.phoneBattery', () => {
  // iOS, the emulator, and a first run before the detector has answered all look
  // the same: no env.phoneBattery. There is no setting the user could change to
  // earn the item, so it must vanish (the notAplite path) rather than appear as
  // a greyed-out row (the needsProvider path, e.g. "Pollen (DWD)").
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  [ENV_BASALT, ENV_EMERY, ENV_DIORITE].forEach((env) => {
    ALL_SLOT_CTXS.forEach((ctx) => {
      ['phoneBattery', 'phoneBatteryPlain'].forEach((code) => {
        assert.ok(!catalog.itemAvailable(catalog.byCode(code), s, env, ctx),
          code + ' must be unavailable on ' + env.platform + ' / ' + ctx.slotKey);
        const row = catalog.slotOptions(s, env, ctx).find(o => o[1] === code);
        assert.equal(row, undefined,
          code + ' must be absent from the ' + ctx.slotKey + ' dropdown, not disabled');
      });
    });
  });
  // An env object missing entirely is the same answer.
  assert.ok(!catalog.itemAvailable(catalog.byCode('phoneBattery'), s, undefined,
    ALL_SLOT_CTXS[0]));
  // A slot synced from an Android phone and then opened on an iPhone resolves
  // away rather than packing an item the phone can never fill.
  assert.equal(catalog.resolveSelection('phoneBattery', s, ENV_BASALT, ALL_SLOT_CTXS[0]), 'empty');
  assert.equal(catalog.resolveSelection('phoneBatteryPlain', s, ENV_BASALT, ALL_SLOT_CTXS[0]), 'empty');
});

test('both phone-battery items are selectable in all 12 slots when the phone supports it', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  assert.equal(ALL_SLOT_CTXS.length, catalog.allSlotKeys().length, 'all 12 slots covered');
  ALL_SLOT_CTXS.forEach((ctx) => {
    const codes = catalog.slotOptions(s, ENV_BASALT_PHONE, ctx).map(o => o[1]);
    ['phoneBattery', 'phoneBatteryPlain'].forEach((code) => {
      assert.ok(catalog.itemAvailable(catalog.byCode(code), s, ENV_BASALT_PHONE, ctx),
        code + ' available in ' + ctx.slotKey);
      assert.ok(codes.indexOf(code) !== -1, code + ' offered in the ' + ctx.slotKey + ' dropdown');
      assert.equal(catalog.resolveSelection(code, s, ENV_BASALT_PHONE, ctx), code,
        code + ' resolves in ' + ctx.slotKey);
    });
  });
  // Also available with no slot context at all (unlike date/battery, which are
  // position-gated and answer false without one).
  ['phoneBattery', 'phoneBatteryPlain'].forEach((code) => {
    assert.ok(catalog.itemAvailable(catalog.byCode(code), s, ENV_EMERY_PHONE),
      code + ' needs no slot context');
  });
});

test('the phone battery is absent on aplite even where the phone reports a charge', () => {
  // aplite is a frozen lean image: no glyph ships, and its status-row twin never
  // learns the ids. The gate is the platform, not the phone.
  const s = { healthMode: 'all' };
  ALL_SLOT_CTXS.forEach((ctx) => {
    const codes = catalog.slotOptions(s, ENV_APLITE_PHONE, ctx).map(o => o[1]);
    ['phoneBattery', 'phoneBatteryPlain'].forEach((code) => {
      assert.ok(!catalog.itemAvailable(catalog.byCode(code), s, ENV_APLITE_PHONE, ctx),
        code + ' must be unavailable on aplite (' + ctx.slotKey + ')');
      assert.equal(codes.indexOf(code), -1,
        code + ' must not reach an aplite dropdown (' + ctx.slotKey + ')');
    });
  });
  assert.equal(catalog.resolveSelection('phoneBattery', s, ENV_APLITE_PHONE, ALL_SLOT_CTXS[0]),
    'empty');
});

test('with env.phoneBattery the Battery category populates non-top-right slots too', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow', radarMode: 'graph' };
  // Top-right sees all four items and a header.
  const topRight = catalog.slotOptions(s, ENV_BASALT_PHONE,
    { slotKey: 'statusTopRight', position: 'right' });
  const trCodes = topRight.map(o => o[1]);
  ['battery', 'batteryPct', 'phoneBattery', 'phoneBatteryPlain'].forEach((code) => {
    assert.ok(trCodes.indexOf(code) !== -1, code + ' offered top-right');
  });
  assert.ok(trCodes.indexOf('__hdr_battery') !== -1, 'four-item Battery group gets a header');
  // Elsewhere the two WATCH items drop out and only the phone pair remains —
  // still two children, so the group keeps its header rather than collapsing.
  const left = catalog.slotOptions(s, ENV_BASALT_PHONE,
    { slotKey: 'statusForecastLeft', position: 'left' });
  const leftCodes = left.map(o => o[1]);
  assert.equal(leftCodes.indexOf('battery'), -1, 'watch glyph stays top-right');
  assert.equal(leftCodes.indexOf('batteryPct'), -1, 'watch % stays top-right');
  assert.ok(leftCodes.indexOf('phoneBattery') !== -1, 'phone battery roams');
  assert.ok(leftCodes.indexOf('phoneBatteryPlain') !== -1, 'phone battery (no icon) roams');
  assert.ok(leftCodes.indexOf('__hdr_battery') !== -1, 'the phone pair still gets a header');
  const children = left.filter(o => o[2] && o[2].groupChild
    && ['phoneBattery', 'phoneBatteryPlain'].indexOf(o[1]) !== -1);
  assert.equal(children.length, 2, 'both phone rows are group children');
  assert.equal(children[children.length - 1][2].groupEnd, true, 'the group is closed');
});

test('the four Battery rows are labelled Watch/Phone so none of them just reads "battery"', () => {
  assert.equal(catalog.byCode('battery').label, 'Watch battery');
  assert.equal(catalog.byCode('batteryPct').label, 'Watch battery percentage');
  const labels = catalog.slotOptions({}, ENV_BASALT_PHONE,
    { slotKey: 'statusTopRight', position: 'right' })
    .filter(o => ['battery', 'batteryPct', 'phoneBattery', 'phoneBatteryPlain'].indexOf(o[1]) !== -1)
    .map(o => o[0]);
  assert.deepEqual(labels,
    ['Watch battery', 'Watch battery percentage', 'Phone battery', 'Phone battery (no icon)']);
  // Every label is unique: four rows under one header would otherwise be
  // indistinguishable in the dropdown.
  assert.equal(new Set(labels).size, labels.length, 'Battery labels must be unique');
});
