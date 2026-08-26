// test/telemetry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSettingsSnapshot } = require('../src/pkjs/telemetry.js');

test('buildSettingsSnapshot includes forecast and radar display settings', () => {
  const snapshot = buildSettingsSnapshot({
    secondaryLine: 'wind',
    secondaryLineFill: true,
    windScale: 'high',
    thirdLine: 'gust',
    barSource: 'rain',
    rainBarColor: 'white',
    radarProvider: 'dwd',
    radarColor: 'multicolor',
    devStatsEnabled: true
  });

  assert.equal(snapshot.secondaryLine, 'wind');
  assert.equal(snapshot.secondaryLineFill, true);
  assert.equal(snapshot.windScale, 'high');
  assert.equal(snapshot.thirdLine, 'gust');
  assert.equal(snapshot.barSource, 'rain');
  assert.equal(snapshot.rainBarColor, 'white');
  assert.equal(snapshot.radarProvider, 'dwd');
  assert.equal(snapshot.radarColor, 'multicolor');
  assert.equal(snapshot.devStatsEnabled, true);
});

// pressureScale is windScale's sibling (graph scale for the pressure line, added
// alongside it); per this repo's rule a telemetry setting must be added in BOTH the
// watch-side snapshot here AND the Deno .strip() schema
// (supabase/functions/telemetry-ingest/index.ts) or it's silently dropped end to end.
test('buildSettingsSnapshot includes pressureScale', () => {
  const snapshot = buildSettingsSnapshot({ pressureScale: 'low' });
  assert.equal(snapshot.pressureScale, 'low');
});

test('buildSettingsSnapshot coerces toggle settings to real booleans', () => {
  const snapshot = buildSettingsSnapshot({});

  assert.equal(snapshot.secondaryLineFill, false);
  assert.equal(snapshot.thirdLine, undefined);
  assert.equal(snapshot.devStatsEnabled, false);
});

test('snapshot includes healthMode', () => {
    assert.strictEqual(buildSettingsSnapshot({ healthMode: 'all' }).healthMode, 'all');
    assert.strictEqual(buildSettingsSnapshot({ healthMode: 'status' }).healthMode, 'status');
    assert.strictEqual(buildSettingsSnapshot({ healthMode: 'slot' }).healthMode, 'slot');
    assert.strictEqual(buildSettingsSnapshot({}).healthMode, 'off'); // defaults to off when unset
});

test('snapshot includes rainCountdownHorizon as an int', () => {
  assert.strictEqual(buildSettingsSnapshot({ rainCountdownHorizon: '60' }).rainCountdownHorizon, 60);
  assert.strictEqual(buildSettingsSnapshot({}).rainCountdownHorizon, undefined);
});

test('snapshot includes topViewMode as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ topViewMode: 'none' }).topViewMode, 'none');
  assert.strictEqual(buildSettingsSnapshot({}).topViewMode, undefined);
});

test('snapshot omits the retired dualStatus field', () => {
  const snap = buildSettingsSnapshot({});
  assert.strictEqual(Object.prototype.hasOwnProperty.call(snap, 'dualStatus'), false);
});

test('snapshot includes layoutPreset as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ layoutPreset: 'radarLast' }).layoutPreset, 'radarLast');
  assert.strictEqual(buildSettingsSnapshot({}).layoutPreset, undefined);
});

test('snapshot includes viewResetMin as an int', () => {
  assert.strictEqual(buildSettingsSnapshot({ viewResetMin: '5' }).viewResetMin, 5);
  assert.strictEqual(buildSettingsSnapshot({}).viewResetMin, undefined);
});

test('snapshot includes theme as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ theme: 'light' }).theme, 'light');
  assert.strictEqual(buildSettingsSnapshot({}).theme, undefined);
});

test('snapshot includes configTheme as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ configTheme: 'light' }).configTheme, 'light');
  assert.strictEqual(buildSettingsSnapshot({}).configTheme, undefined);
});

test('snapshot includes aqiScale', () => {
  assert.equal(buildSettingsSnapshot({ aqiScale: 'us' }).aqiScale, 'us');
  assert.equal(buildSettingsSnapshot({ aqiScale: 'european' }).aqiScale, 'european');
});

test('snapshot includes aqiSource', () => {
  assert.strictEqual(buildSettingsSnapshot({ aqiSource: 'waqi' }).aqiSource, 'waqi');
  assert.strictEqual(buildSettingsSnapshot({ aqiSource: 'auto' }).aqiSource, 'auto');
  assert.strictEqual(buildSettingsSnapshot({}).aqiSource, undefined);
});

test('snapshot includes tempSlotDisplay as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ tempSlotDisplay: 'both' }).tempSlotDisplay, 'both');
  assert.strictEqual(buildSettingsSnapshot({}).tempSlotDisplay, undefined);
});

// The two per-kind wind-direction toggles. Same lockstep rule as pressureScale above:
// watch-side snapshot AND the Deno .strip() schema, or ingest silently drops them.
test('snapshot includes the wind and gust direction toggles as real booleans', () => {
  assert.strictEqual(buildSettingsSnapshot({ windSlotDirection: true }).windSlotDirection, true);
  assert.strictEqual(buildSettingsSnapshot({ gustSlotDirection: true }).gustSlotDirection, true);
  assert.strictEqual(buildSettingsSnapshot({}).windSlotDirection, false);
  assert.strictEqual(buildSettingsSnapshot({}).gustSlotDirection, false);
});

// The six per-kind "Show unit" toggles, same lockstep rule again. Four of them ship ON,
// so an absent key must report the SHIPPED state and not a spurious "off" — otherwise
// the fleet reads as having turned kph off en masse. seedDefaults backfills the keys at
// boot, so this is belt and braces, but a telemetry column that can lie about a default
// is worse than no column.
test('snapshot includes the six Show unit toggles as real booleans', () => {
  ['windSlotUnit', 'gustSlotUnit', 'pressureSlotUnit', 'countdownSlotUnit',
    'tempSlotUnit', 'dewSlotUnit'].forEach((key) => {
    assert.strictEqual(buildSettingsSnapshot({ [key]: true })[key], true, key + ' reports on');
    assert.strictEqual(buildSettingsSnapshot({ [key]: false })[key], false, key + ' reports off');
  });
});

// Drift guard for the fallbacks above: the snapshot's absent-key value is a SECOND copy
// of each toggle's shipped default, and the settings schema owns the first. Pin them
// together so flipping a default in schema.js can never leave telemetry reporting the
// old one.
test('an absent Show unit key reports the schema default, not false', () => {
  const schema = require('../src/pkjs/settings/schema.js');
  const items = [];
  schema.tabs.forEach((t) => t.sections.forEach((s) => s.items.forEach((i) => items.push(i))));
  const snap = buildSettingsSnapshot({});
  const unitItems = items.filter((i) => /SlotUnit$/.test(i.messageKey || ''));
  assert.equal(unitItems.length, 6, 'expected six Show unit rows in the schema');
  unitItems.forEach((item) => {
    assert.strictEqual(snap[item.messageKey], item.defaultValue,
      item.messageKey + ' must fall back to its schema default');
  });
});

test('snapshot includes windUnits and distanceUnits', () => {
  assert.equal(buildSettingsSnapshot({ windUnits: 'mph' }).windUnits, 'mph');
  assert.equal(buildSettingsSnapshot({ distanceUnits: 'imperial' }).distanceUnits, 'imperial');
});

test('snapshot carries the twelve status slot selections', () => {
  const snap = buildSettingsSnapshot({
    statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'sun',
    statusRadarLeft: 'temp', statusRadarMid: 'city', statusRadarRight: 'sun',
    statusTopLeft: 'empty', statusTopMid: 'date', statusTopRight: 'uv',
    statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'hr'
  });
  assert.equal(snap.statusForecastLeft, 'temp');
  assert.equal(snap.statusForecastMid, 'city');
  assert.equal(snap.statusRadarMid, 'city');
  assert.equal(snap.statusTopMid, 'date');
  assert.equal(snap.statusTopRight, 'uv');
  assert.equal(snap.statusHealthRight, 'hr');
});

test('snapshot includes batteryLowOnly as a real boolean', () => {
  assert.equal(buildSettingsSnapshot({ batteryLowOnly: true }).batteryLowOnly, true);
  assert.equal(buildSettingsSnapshot({}).batteryLowOnly, false);
});

test('buildSettingsSnapshot includes radarMode (default graph)', () => {
  assert.strictEqual(buildSettingsSnapshot({ radarMode: 'status' }).radarMode, 'status');
  assert.strictEqual(buildSettingsSnapshot({}).radarMode, 'graph');
});

// The phone-battery slot's Bold mode — the ONLY per-kind bold mode telemetry reports.
// It earns the column because the slot is Android-only (its reading comes from a host
// API that exists on no other phone), so how the small subset of phones that can have
// it actually configure it is worth seeing. Passed through RAW, like tempSlotDisplay:
// an install that has never opened the sheet reports undefined, which reads as "left at
// the default" rather than as a deliberate "off".
test('snapshot includes threshPhoneBatteryBoldMode, raw', () => {
  assert.strictEqual(buildSettingsSnapshot({ threshPhoneBatteryBoldMode: 'always' }).threshPhoneBatteryBoldMode, 'always');
  assert.strictEqual(buildSettingsSnapshot({ threshPhoneBatteryBoldMode: 'off' }).threshPhoneBatteryBoldMode, 'off');
  assert.strictEqual(buildSettingsSnapshot({}).threshPhoneBatteryBoldMode, undefined,
    'unset stays undefined — do not coerce it to a boolean or to "off"');
  // The lockstep test below compares key SETS, and a key whose value is undefined is
  // still a key — so pin that the property exists at all, since dropping it is exactly
  // how a snapshot field goes missing without the set comparison noticing a shape change.
  assert.ok(Object.prototype.hasOwnProperty.call(buildSettingsSnapshot({}), 'threshPhoneBatteryBoldMode'),
    'the key must be emitted even when unset');
});

// Targeted half of the lockstep for the newest field. The set-equality test below would
// also catch a one-sided edit, but it fails as a 90-key diff; this one names the key and
// the file, which is what a reader needs when the two-place rule gets broken.
test('threshPhoneBatteryBoldMode is declared in the Deno .strip() schema too', () => {
  const fs = require('fs');
  const path = require('path');
  const ts = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'telemetry-ingest', 'index.ts'), 'utf8');
  const start = ts.indexOf('const settingsSchema');
  assert.ok(start !== -1, 'settingsSchema not found in telemetry-ingest/index.ts');
  const slice = ts.slice(start, ts.indexOf('.strip()', start));
  assert.match(slice, /^\s*threshPhoneBatteryBoldMode:\s*z\.string\(\)\.optional\(\)/m,
    'ingest must accept it as an optional string, or .strip() drops it silently');
});

test('settings snapshot keys match the Deno telemetry schema (lockstep)', () => {
  const fs = require('fs');
  const path = require('path');
  const ts = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'telemetry-ingest', 'index.ts'), 'utf8');

  // Slice the settingsSchema object literal: `const settingsSchema = z ... .strip()`.
  const start = ts.indexOf('const settingsSchema');
  assert.ok(start !== -1, 'settingsSchema not found in telemetry-ingest/index.ts');
  const slice = ts.slice(start, ts.indexOf('.strip()', start));

  // Field lines look like `  fieldName: z.string()...` or `  provider: providerSchema...`.
  const denoKeys = [];
  slice.replace(/^\s*([a-zA-Z0-9_]+):\s*[A-Za-z]/gm, function (_m, name) { denoKeys.push(name); return _m; });
  assert.ok(denoKeys.length >= 20, 'expected to parse the schema fields, got ' + denoKeys.length);

  const snapshotKeys = Object.keys(buildSettingsSnapshot({}));
  assert.deepEqual(snapshotKeys.slice().sort(), denoKeys.slice().sort(),
    'buildSettingsSnapshot (telemetry.js) and the Deno settingsSchema must declare the same fields');
});

test('snapshot includes largeGraphFont as a real boolean', () => {
  assert.strictEqual(buildSettingsSnapshot({ largeGraphFont: true }).largeGraphFont, true);
  assert.strictEqual(buildSettingsSnapshot({}).largeGraphFont, false);
});

// The six graph-colour FIELDS, pinned here by hand. They are named for the ELEMENT of the
// graph they colour, which is all the Deno schema and the dashboards know; the storage
// underneath is per metric and per polarity (gcWindLineDark, …), so there is no list in
// line-style to derive these from any more — the mapping element -> (metric, role) is
// telemetry.js's own and this file is the thing that pins it.
//
// Telemetry reports ONE value per element: the colour for the metric that element is
// currently painted from, in the polarity the watch ACTUALLY renders, resolved through
// line-style.renderContext — the same call the wire packer opens with — so a telemetry row
// can never disagree with the wire. Same lockstep rule as pressureScale above: the watch
// snapshot AND the Deno .strip() schema, or it is silently dropped.
const GRAPH_COLOR_FIELDS = ['graphMainColor', 'graphFillColor', 'graphSecondColor',
                            'nightHatchColor', 'nightBoundaryColor', 'nightFillColor'];

test('graph colours report as #RRGGBB, and default while still on the built-in', () => {
  const snap = buildSettingsSnapshot({
    theme: 'dark',
    secondaryLine: 'wind',
    thirdLine: 'uv',
    gcWindLineDark: 0xFFAA00,       // moved off the built-in Yellow
    gcWindFillDark: 0x555500,       // the built-in ArmyGreen, stored concretely
    gcUvLineDark: null,             // legacy: JSON persistence turned a NaN hexToInt into null
    gcNightHatchDark: '#00AAFF'     // a fixture blob carries the hex string, not the int
    // gcWindNightDark / gcNightBoundaryDark absent entirely
  });

  assert.strictEqual(snap.graphMainColor, '#FFAA00');
  assert.strictEqual(snap.graphFillColor, 'default');
  assert.strictEqual(snap.graphSecondColor, 'default');
  assert.strictEqual(snap.nightHatchColor, '#00AAFF');
  assert.strictEqual(snap.nightBoundaryColor, 'default');
  assert.strictEqual(snap.nightFillColor, 'default');
  // Never a number and never null on the wire: the ingest types these z.string(), and a
  // number-typed field would fail safeParse and 400 the WHOLE event, with no retry.
  GRAPH_COLOR_FIELDS.forEach((field) => {
    assert.strictEqual(typeof snap[field], 'string', field + ' must serialize as a string');
  });
});

// The whole point of the 'default' encoding: with concrete defaults there is no sentinel
// left, so "still the built-in" has to be a comparison — and it is line-style's comparison
// (graphColorIsDefault), not a hex match here. gust's dark line is the case that proves it:
// its built-in follows rainBarColor, so BOTH greys read as untouched.
test('a colour equal to the built-in reports as default, including gust either way', () => {
  const gust = (extra) => buildSettingsSnapshot(
    Object.assign({ theme: 'dark', secondaryLine: 'gust' }, extra)).graphMainColor;

  assert.strictEqual(gust({ rainBarColor: 'white', gcGustLineDark: 0xFFFFFF }), 'default');
  assert.strictEqual(gust({ rainBarColor: 'white', gcGustLineDark: 0xAAAAAA }), 'default');
  assert.strictEqual(gust({ rainBarColor: 'multicolor', gcGustLineDark: 0xFFFFFF }), 'default');
  // A real pick still reports as one — the wart is only that White and LightGray cannot be
  // pinned deliberately on this one row.
  assert.strictEqual(gust({ rainBarColor: 'white', gcGustLineDark: 0xFF0000 }), '#FF0000');
});

// The field names are per element, but the colours are stored per METRIC: which one
// graphMainColor reports is whichever metric is currently the secondary line. The metric
// itself rides the same snapshot (secondaryLine / thirdLine), so a query can slice by it.
test('the reported colour follows the metric each element is painted from', () => {
  const blob = { theme: 'dark', gcWindLineDark: 0x0000AA, gcUvLineDark: 0xFF0000 };

  assert.strictEqual(
    buildSettingsSnapshot(Object.assign({ secondaryLine: 'wind' }, blob)).graphMainColor, '#0000AA');
  assert.strictEqual(
    buildSettingsSnapshot(Object.assign({ secondaryLine: 'uv' }, blob)).graphMainColor, '#FF0000');
  assert.strictEqual(
    buildSettingsSnapshot(Object.assign({ secondaryLine: 'wind', thirdLine: 'uv' }, blob)).graphSecondColor,
    '#FF0000');
});

// No third line, no colour in effect — sleepStartHour's rule, and it keeps 'off' installs
// out of the sample when the third line's colours are ranked.
test('graphSecondColor reports nothing when the third line is off', () => {
  const off = buildSettingsSnapshot({
    theme: 'dark', secondaryLine: 'wind', thirdLine: 'off', gcUvLineDark: 0xFF0000 });
  assert.strictEqual(off.graphSecondColor, undefined);
  // Assigned undefined, never deleted — the key must survive for the set-equality lockstep.
  assert.ok(Object.prototype.hasOwnProperty.call(off, 'graphSecondColor'),
    'graphSecondColor must still be emitted as a key');
  // The other five are unaffected by the third line.
  assert.strictEqual(off.graphMainColor, 'default');
});

test('the reported graph colour is the pick for the polarity the watch renders', () => {
  const picks = {
    secondaryLine: 'wind',
    gcWindLineDark: 0x0000AA, gcWindLineLight: 0xFF0000,
    gcWindNightDark: 0x555555, gcWindNightLight: 0xAA5500
  };
  const dark = buildSettingsSnapshot(Object.assign({ theme: 'dark' }, picks), { platform: 'basalt' });
  assert.strictEqual(dark.graphMainColor, '#0000AA');
  assert.strictEqual(dark.nightFillColor, '#555555');

  const light = buildSettingsSnapshot(Object.assign({ theme: 'light' }, picks), { platform: 'basalt' });
  assert.strictEqual(light.graphMainColor, '#FF0000');
  // The night tint is selectable in BOTH polarities — a Light pick moved off the built-in
  // opts the watch into the night re-shade it otherwise skips — so it reports on light too.
  assert.strictEqual(light.nightFillColor, '#AA5500');

  // emery is the other colour platform, and it ships the light polarity, so a light
  // install there reports its Light picks like basalt does.
  const emery = buildSettingsSnapshot(Object.assign({ theme: 'light' }, picks), { platform: 'emery' });
  assert.strictEqual(emery.graphMainColor, '#FF0000');
});

// CHANGED, deliberately, from "aplite reports its Dark picks on a light theme". That
// pinned a divergence: this file had copied line-style's effectiveTheme fold but not its
// colour-display check, so a B&W watch reported picks the wire was already resolving away
// to GColorWhite — the dashboards would have counted a pick nobody could see. Both halves
// now come from line-style.renderContext, so a B&W watch reports nothing, exactly like a
// B&W theme below. The aplite polarity fold still matters and is still tested — on the
// wire (test/line-style.test.js), where it changes a colour that is actually painted.
test('a watch with no colour display reports no graph colours at all', () => {
  const picks = {
    theme: 'light', secondaryLine: 'wind', thirdLine: 'uv',
    gcWindLineDark: 0x0000AA, gcWindLineLight: 0xFF0000,
    gcWindNightDark: 0x555555, gcWindNightLight: 0xAA5500
  };
  ['aplite', 'diorite'].forEach((platform) => {
    const snap = buildSettingsSnapshot(picks, { platform });
    GRAPH_COLOR_FIELDS.forEach((field) => {
      assert.strictEqual(snap[field], undefined,
        platform + ' paints no colour, so ' + field + ' must report nothing');
      assert.ok(Object.prototype.hasOwnProperty.call(snap, field),
        field + ' must still be emitted as a key on ' + platform);
    });
  });
});

test('a Black & White theme reports no graph colours at all', () => {
  ['bw', 'bw-light'].forEach((theme) => {
    const snap = buildSettingsSnapshot({
      theme: theme, secondaryLine: 'wind', thirdLine: 'uv',
      gcWindLineDark: 0xFFAA00, gcWindFillDark: 0xFF0000,
      gcUvLineDark: 0x00FF00, gcNightHatchDark: 0x0000AA,
      gcNightBoundaryDark: 0xAAAAAA, gcWindNightDark: 0x555555
    });
    GRAPH_COLOR_FIELDS.forEach((field) => {
      assert.strictEqual(snap[field], undefined,
        theme + ' paints no colour, so ' + field + ' must report nothing');
      // Assigned undefined, never deleted: the key must still EXIST for the
      // set-equality lockstep above, which is what catches a one-sided edit.
      assert.ok(Object.prototype.hasOwnProperty.call(snap, field),
        field + ' must still be emitted as a key on ' + theme);
    });
  });
});

// The failure the split authority produced, pinned so it cannot come back: the value
// telemetry reports for an element and the colour the wire resolves for it have to agree
// about whether the pick survived at all.
test('the reported pick agrees with the wire on every platform', () => {
  const lineStyle = require('../src/pkjs/line-style.js');
  const settings = { theme: 'dark', secondaryLine: 'wind', thirdLine: 'off',
                     gcWindLineDark: 0xFF0000 };
  ['basalt', 'emery', 'diorite', 'aplite'].forEach((platform) => {
    const watchInfo = { platform };
    const reported = buildSettingsSnapshot(settings, watchInfo).graphMainColor;
    const painted = lineStyle.resolveLineStyle(settings, watchInfo).secondary === 0xFF0000;
    assert.strictEqual(reported === '#FF0000', painted,
      platform + ' must not report a pick the wire resolved away (or vice versa)');
  });
});

// The other half of that agreement, which only became possible once "untouched" stopped
// being a sentinel and became a comparison: telemetry saying 'default' has to mean the wire
// is painting the built-in, on the gust row where the built-in is not even a constant.
test('reporting default agrees with the wire painting the built-in', () => {
  const lineStyle = require('../src/pkjs/line-style.js');
  [{ rainBarColor: 'white', stored: 0xFFFFFF, builtIn: 0xAAAAAA },
   { rainBarColor: 'multicolor', stored: 0xAAAAAA, builtIn: 0xFFFFFF }].forEach((c) => {
    const settings = { theme: 'dark', secondaryLine: 'gust', thirdLine: 'off',
                       rainBarColor: c.rainBarColor, gcGustLineDark: c.stored };
    assert.strictEqual(buildSettingsSnapshot(settings, { platform: 'basalt' }).graphMainColor,
      'default', 'a gust line on either built-in reads as untouched');
    assert.strictEqual(lineStyle.resolveLineStyle(settings, { platform: 'basalt' }).secondary,
      c.builtIn, 'and the wire paints the rainBarColor-correct built-in, not the stored byte');
  });
});

// Targeted half of the lockstep for the six colour fields, per threshPhoneBatteryBoldMode
// above — and the ONLY automated guard on their TYPE: the set-equality test catches a
// missing key but not a wrong type, and `mise test-deno` never loads telemetry-ingest
// (it runs rainbow-nowcast and news only). A z.number() here would make every 'default'
// fail safeParse and 400 the whole event fleet-wide, taking the fetch outcome with it.
// These six names and types are what the per-metric redesign deliberately did NOT move:
// the storage changed, the reporting contract did not.
test('the six graph colour fields are optional STRINGS in the Deno .strip() schema', () => {
  const fs = require('fs');
  const path = require('path');
  const ts = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'telemetry-ingest', 'index.ts'), 'utf8');
  const start = ts.indexOf('const settingsSchema');
  assert.ok(start !== -1, 'settingsSchema not found in telemetry-ingest/index.ts');
  const slice = ts.slice(start, ts.indexOf('.strip()', start));
  GRAPH_COLOR_FIELDS.forEach((field) => {
    assert.match(slice, new RegExp('^\\s*' + field + ':\\s*z\\.string\\(\\)\\.optional\\(\\)', 'm'),
      field + ' must be z.string().optional() — a number-typed field would reject the event');
  });
});

// The ingest refuses a body over MAX_BODY_BYTES with a 413, and a 413 is terminal:
// send() logs the non-2xx and nothing retries it. So the heaviest realistic envelope has
// to stay under the cap with room left to grow.
// Ledger (MEASURED — read the byte count off this test's own console line, never
// arithmetic): 2956 B of 4096, headroom 1140. The six colours are 169 B of that, and that
// is their WORST case however they are set: '#RRGGBB' and 'default' are both seven
// characters. This envelope was 2787 B before them.
test('the heaviest realistic telemetry envelope stays under MAX_BODY_BYTES', () => {
  const fs = require('fs');
  const path = require('path');
  const ts = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'telemetry-ingest', 'index.ts'), 'utf8');
  const cap = Number(/const MAX_BODY_BYTES = (\d+)/.exec(ts)[1]);
  assert.equal(cap, 4096, 'read the cap from the function, do not pin a stale copy here');

  // Every reported setting on its longest realistic option, on a light-polarity colour
  // theme so all six picks report (bw would report none of them).
  const settings = {
    temperatureUnits: 'fahrenheit', tempSlotDisplay: 'both', aqiScale: 'european',
    aqiSource: 'openmeteo', windUnits: 'beaufort', distanceUnits: 'imperial',
    windSlotDirection: true, gustSlotDirection: true,
    threshPhoneBatteryBoldMode: 'always', configTheme: 'light', dayNightShading: true,
    healthMode: 'status', provider: 'openweathermap', fetchIntervalMin: '120',
    rainCountdownHorizon: '60', sleepNightEnabled: true, sleepStartHour: '23',
    sleepEndHour: '7', axisTimeFormat: 'h12', timeFont: 'bitham', timeLeadingZero: true,
    timeShowAmPm: true, weekStartDay: 'monday', firstWeek: 'iso', showQt: true,
    batteryLowOnly: true, topViewMode: 'compact', layoutPreset: 'compactDense',
    viewResetMin: '15', largeGraphFont: true, vibe: true, btIcons: 'both',
    secondaryLine: 'precip_prob', secondaryLineFill: true, windScale: 'high',
    pressureScale: 'high', thirdLine: 'pressure', barSource: 'precip_prob',
    rainBarColor: 'white', radarProvider: 'rainbow', radarMode: 'countdown',
    radarColor: 'multicolor', devStatsEnabled: true, theme: 'light',
    statusForecastLeft: 'phone_battery', statusForecastMid: 'phone_battery',
    statusForecastRight: 'phone_battery', statusRadarLeft: 'phone_battery',
    statusRadarMid: 'phone_battery', statusRadarRight: 'phone_battery',
    statusTopLeft: 'phone_battery', statusTopMid: 'phone_battery',
    statusTopRight: 'phone_battery', statusHealthLeft: 'phone_battery',
    statusHealthMid: 'phone_battery', statusHealthRight: 'phone_battery',
    colorTime: 0xFFFFFF, colorToday: 0xFF0000, colorSunday: 0xFF0000,
    colorSaturday: 0xFF0000, colorUSFederal: 0xFF0000,
    // The light-polarity colours for the two metrics selected above (precip_prob as the
    // secondary line, pressure as the third), each moved off its built-in so all six
    // fields report the seven-character form.
    gcPrecipLineLight: 0xFF00FF, gcPrecipFillLight: 0xAAFF55,
    gcPressureLineLight: 0x00AAFF, gcPrecipNightLight: 0xAA5500,
    gcNightHatchLight: 0xAAAAAA, gcNightBoundaryLight: 0xFF0000
  };
  const payload = {
    eventType: 'weather_fetch',
    timestampUtc: new Date().toISOString(),
    accountToken: 'a'.repeat(64),
    watchToken: 'b'.repeat(64),
    provider: 'openweathermap',
    success: false,
    usedGpsCache: true,
    gpsErrorCode: 2,
    locationMode: 'manual_coordinates',
    error: 'e'.repeat(512),  // serializeError's own cap
    countryCode: 'DEU',
    settings: buildSettingsSnapshot(settings, { platform: 'basalt' }),
    appVersion: '10.10.10',
    buildProfile: 'release',
    watchInfo: {
      platform: 'basalt', model: 'qemu_platform_basalt', language: 'en_US',
      firmware: { major: 4, minor: 4, patch: 4, suffix: 'beta10' }
    },
    durationMs: 999999,
    attempt: 99
  };
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  console.log('heaviest telemetry envelope: ' + bytes + ' B of ' + cap
    + ' B (headroom ' + (cap - bytes) + ')');
  assert.ok(bytes < cap, 'heaviest envelope ' + bytes + ' B must stay under ' + cap + ' B');
});
