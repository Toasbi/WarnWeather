const test = require('node:test');
const assert = require('node:assert');
const catalog = require('../src/pkjs/status-line-catalog.js');

const ENV_EMERY = { color: true, round: false, platform: 'emery', health: true, radar: true, hr: true };
const ENV_DIORITE = { color: false, round: false, platform: 'diorite', health: true, radar: true, hr: true };
const ENV_BASALT = { color: true, round: false, platform: 'basalt', health: true, radar: true, hr: false };
const ENV_APLITE = { color: false, round: false, platform: 'aplite', health: false, radar: false, hr: false };

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

test('defaults + hrDefaults are the shipped status-bar set', () => {
  assert.deepEqual(catalog.LINES[0].defaults,
    { statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi' });
  assert.deepEqual(catalog.LINES[1].defaults,
    { statusRadarLeft: 'temp', statusRadarMid: 'wind', statusRadarRight: 'gust' });
  assert.deepEqual(catalog.LINES[2].defaults,
    { statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'sun' });
  assert.deepEqual(catalog.LINES[3].defaults,
    { statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  assert.deepEqual(catalog.LINES[3].hrDefaults,
    { statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'hr' });
});

test('slotDefault is HR-aware for the health-right slot, platform-independent elsewhere', () => {
  assert.equal(catalog.slotDefault('statusHealthRight', ENV_EMERY), 'hr');
  assert.equal(catalog.slotDefault('statusHealthRight', ENV_DIORITE), 'hr');
  assert.equal(catalog.slotDefault('statusHealthRight', ENV_BASALT), 'sleep');
  assert.equal(catalog.slotDefault('statusHealthRight', undefined), 'sleep');
  assert.equal(catalog.slotDefault('statusForecastRight', ENV_EMERY), 'aqi');
  assert.equal(catalog.slotDefault('statusTopLeft', ENV_BASALT), 'week');
  assert.equal(catalog.slotDefault('nope', ENV_BASALT), undefined);
});

test('availability gating', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow' };
  assert.ok(catalog.itemAvailable(catalog.byCode('temp'), s, ENV_BASALT));
  assert.ok(catalog.itemAvailable(catalog.byCode('steps'), s, ENV_BASALT));
  assert.ok(!catalog.itemAvailable(catalog.byCode('steps'), s, ENV_APLITE));
  assert.ok(!catalog.itemAvailable(catalog.byCode('steps'), { healthMode: 'off' }, ENV_BASALT));
  assert.ok(catalog.itemAvailable(catalog.byCode('hr'), s, ENV_EMERY));
  assert.ok(catalog.itemAvailable(catalog.byCode('hr'), s, ENV_DIORITE));
  assert.ok(!catalog.itemAvailable(catalog.byCode('hr'), s, ENV_BASALT));
});

test('date is middle-only: offered in mid slots of any line, nowhere else', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow' };
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
    healthMode: 'all', radarProvider: 'rainbow',
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
  assert.ok(codes.includes('sun'));
});

test('resolveSelection maps invalid/unavailable to empty without touching storage', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow' };
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

test('pollen is a DWD-only TEXT item offered only for the DWD weather provider', () => {
  const item = catalog.byCode('pollen');
  assert.ok(item, 'pollen item exists');
  assert.equal(item.kind, catalog.KINDS.TEXT);
  assert.equal(item.icon, catalog.ICONS.POLLEN);
  assert.equal(catalog.ICONS.POLLEN, 12);
  assert.equal(item.needsProvider, 'dwd');

  const providerCodes = ['wunderground', 'openweathermap', 'dwd', 'openmeteo', 'metno'];
  providerCodes.forEach(provider => {
    const settings = { provider };
    const codes = catalog.slotOptions(settings, ENV_BASALT,
      { slotKey: 'statusForecastLeft', position: 'left' }).map(o => o[1]);
    assert.equal(codes.indexOf('pollen') !== -1, provider === 'dwd', provider);
  });
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
  const s = { healthMode: 'all', radarProvider: 'disabled' };
  const opts = catalog.slotOptions(s, ENV_EMERY,
    { slotKey: 'statusForecastMid', position: 'mid' });
  const weatherHeader = opts.find(o => o[1] === '__hdr_weather');
  assert.deepEqual(weatherHeader[2], { disabled: true, groupHeader: true });
  const weatherChildren = opts.filter(o => o[2] && o[2].groupChild
    && ['temp', 'wind', 'gust', 'uv', 'aqi', 'sun'].indexOf(o[1]) >= 0);
  assert.equal(weatherChildren[0][0], 'Current temperature', 'no label-space indentation');
  assert.equal(weatherChildren[0][2].groupEnd, false);
  assert.equal(weatherChildren[weatherChildren.length - 1][2].groupEnd, true);

  // city now lives in the "Date and location" group. On an aplite left edge slot,
  // date (middleOnly) is gone but calendar-week is now available (phone-baked
  // text on aplite), so the group has {city, week} -> it gets a header and does
  // NOT collapse.
  const edge = catalog.slotOptions({ healthMode: 'off', radarProvider: 'disabled' },
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
  const s = { healthMode: 'all', radarProvider: 'rainbow' };
  const topRight = { slotKey: 'statusTopRight', position: 'right' };
  const topLeft = { slotKey: 'statusTopLeft', position: 'left' };
  assert.ok(catalog.itemAvailable(item, s, ENV_BASALT, topRight), 'available top-right');
  assert.ok(!catalog.itemAvailable(item, s, ENV_BASALT, topLeft), 'not in the left slot');
  assert.ok(!catalog.itemAvailable(item, s, ENV_BASALT,
    { slotKey: 'statusForecastRight', position: 'right' }), 'not in other lines');
  const opts = catalog.slotOptions(s, ENV_BASALT, topRight);
  assert.ok(!opts.some(o => o[1] === '__hdr_battery'), 'single Battery group is collapsed');
  assert.equal(opts.find(o => o[1] === 'battery').length, 2,
    'battery is offered top-right as an ordinary option');
  const leftOpts = catalog.slotOptions(s, ENV_BASALT, topLeft);
  assert.ok(!leftOpts.some(o => o[1] === '__hdr_battery'), 'no Battery header elsewhere');
});

test('slotOptions omits headers whose category has no available item', () => {
  const healthOff = catalog.slotOptions({ healthMode: 'off', radarProvider: 'rainbow' },
    ENV_BASALT, { slotKey: 'statusForecastLeft', position: 'left' });
  assert.ok(!healthOff.some(o => o[1] === '__hdr_health'), 'no orphan Health header');
  // aplite edge slot: date (middleOnly) is gone, but city and week (now available
  // on aplite as phone-baked text) remain, so the Date and location group DOES
  // get a header (it is not an orphan single-item collapse).
  const apliteEdge = catalog.slotOptions({ healthMode: 'off', radarProvider: 'disabled' },
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
