const test = require('node:test');
const assert = require('node:assert/strict');
// The time every bake in this file runs at, where the test does not care which it is.
const NOW = new Date(2026, 5, 15, 12, 0, 0);

// The rebaker and phone-battery.js keep their state in localStorage. AGENTS.md:
// install the mock BEFORE the watch modules load. Node 26's implicit global
// `localStorage` is undefined on first access, so leaning on it makes the suite flaky.
const pkjsStorage = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(pkjsStorage, k) ? pkjsStorage[k] : null; },
  setItem(k, v) { pkjsStorage[k] = String(v); },
  removeItem(k) { delete pkjsStorage[k]; }
};

const { toRenderPayload } = require('../../../src/pkjs/weather/application/render-payload.js');
const statusRebake = require('../../../src/pkjs/status-bars/application/status-rebake.js');
const phoneBattery = require('../../../src/pkjs/status-bars/adapter/phone-battery.js');

// --- Phone battery: the bake-input stash ------------------------------------
// buildStatusLines() consumes transient payload keys that die a few lines later,
// so a phone-battery event -- which re-bakes the status lines WITHOUT a fetch --
// needs the bake *inputs*, not the pruned wire payload. toRenderPayload hands
// them to status-rebake.js immediately before the bake. Get that order wrong in
// either direction and the re-bake silently renders '--'/empty everywhere with no
// error anywhere, so the ordering itself is what these two tests pin.

/** Decode one packed status line into its three {kind, icon, text} slots. */
function decodeStatusLine(bytes) {
  const slots = [];
  let off = 0;
  for (let i = 0; i < 3; i++) {
    const kind = bytes[off], icon = bytes[off + 1], len = bytes[off + 2];
    off += 3;
    slots.push({ kind, icon, text: Buffer.from(bytes.slice(off, off + len)).toString('utf8') });
    off += len;
  }
  return slots;
}

test('toRenderPayload stashes the bake inputs BEFORE the bake and before the transient deletes', () => {
  const realRemember = statusRebake.rememberBakeInputs;
  const seen = [];
  statusRebake.rememberBakeInputs = function(payload, watchInfo) {
    // Snapshot the argument as it looked AT THE CALL: the real module clones it,
    // and the payload it is handed is mutated and pruned moments later.
    seen.push({ payload: Object.assign({}, payload), watchInfo, argc: arguments.length });
  };
  const payload = {
    CURRENT_TEMP: 68, CITY: 'Bonn', SUN_EVENTS: [1, 0, 0, 0, 0],
    AQI_TREND: [150], POLLEN_TODAY: '3', DEW_TREND: [53.6], FEELS_CURRENT: 70,
    PRECIP_TREND_UINT8: [70], RAIN_TREND_UINT8: [0],
    WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64], UV_DAY_PEAKS: [64, 80],
    WIND_DIR_TREND: [270], PRESSURE_TREND: [1013],
    TEMP_TREND_UINT8: [100], TEMP_MIN: 0, TEMP_MAX: 30,
    FORECAST_START: 1700000000, NUM_ENTRIES: 1
  };
  // healthMode 'status' puts the Health bar on a screen, so all four lines bake.
  const settings = { secondaryLine: 'off', thirdLine: 'off', barSource: 'off',
                     temperatureUnits: 'c', axisTimeFormat: '24h', healthMode: 'status' };
  const watchInfo = { platform: 'basalt' };
  let out;
  try {
    out = toRenderPayload(payload, settings, watchInfo, NOW);
  }
  finally {
    statusRebake.rememberBakeInputs = realRemember;
  }

  assert.equal(seen.length, 1, 'stashed exactly once per bake');
  assert.equal(seen[0].argc, 2, 'no settings: a re-bake pairs the live ones');
  assert.equal(seen[0].watchInfo, watchInfo, 'watchInfo by reference');

  // BEFORE the bake: the packed lines do not exist on the payload yet, so the
  // stash cannot be a post-bake copy of an already-rendered result.
  ['STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8', 'STATUS_LINE_3_UINT8',
   'STATUS_LINE_4_UINT8', 'STATUS_LEVELS_UINT8'].forEach(function(k) {
    assert.equal(k in seen[0].payload, false, k + ' must not exist yet at stash time');
    assert.ok(k in out, k + ' is produced by the bake that follows');
  });

  // BEFORE the deletes: every transient the bake reads is still on the payload
  // the stash was taken from -- and really is gone by the time the caller sees it.
  ['CURRENT_TEMP', 'CITY', 'AQI_TREND', 'POLLEN_TODAY', 'DEW_TREND', 'FEELS_CURRENT',
   'WIND_TREND_UINT8', 'GUST_TREND_UINT8', 'UV_TREND_UINT8', 'UV_DAY_PEAKS', 'WIND_DIR_TREND',
   'PRESSURE_TREND'].forEach(function(k) {
    assert.ok(k in seen[0].payload, k + ' must still be present at stash time');
    assert.equal(k in out, false, k + ' is deleted after the bake');
  });
});

test('a phone-battery event re-bakes from the stash after the payload has been pruned', () => {
  // End-to-end through the REAL module: the stash has to be a clone taken before
  // the prune, or the morning's micro-send would carry a stripped payload.
  const listeners = {};
  const mgr = {
    level: 0.62, charging: false,
    addEventListener: function(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); }
  };
  const sends = [];
  const settings = {
    secondaryLine: 'off', thirdLine: 'off', barSource: 'off',
    temperatureUnits: 'c', axisTimeFormat: '24h',
    statusForecastLeft: 'phoneBattery', statusForecastMid: 'city',
    statusForecastRight: 'empty'
  };
  const origLog = console.log;
  console.log = function() {};
  try {
    statusRebake.init({
      getSettings: function() { return settings; },
      getPhoneBattery: phoneBattery.bakeFacts,
      sendWeather: function(p) { sends.push(p); }
    });
    phoneBattery.init({
      navigator: { getBattery: function() { return { then: function(ok) { ok(mgr); } }; } },
      getSettings: function() { return settings; },
      now: function() { return new Date(2026, 0, 1, 12, 0, 0); }  // saver window shut
    });
    const payload = {
      CURRENT_TEMP: 68, CITY: 'Bonn', SUN_EVENTS: [1, 0, 0, 0, 0],
      PRECIP_TREND_UINT8: [70], RAIN_TREND_UINT8: [0],
      WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64],
      TEMP_RAW_TREND: [12], TEMP_MIN: 0, TEMP_MAX: 30,
      FORECAST_START: 1700000000, NUM_ENTRIES: 1
    };
    const out = toRenderPayload(payload, settings, { platform: 'basalt' }, NOW,
      phoneBattery.bakeFacts());
    const baked = decodeStatusLine(out.STATUS_LINE_1_UINT8);
    // The bucket is only the SEND trigger; the baked text is the exact reading.
    assert.equal(baked[0].text, '62%', 'the fetch itself carries the exact charge');
    assert.equal(baked[1].text, 'Bonn');
    assert.equal('CITY' in out, false, 'and the payload is pruned right after');

    mgr.level = 0.42;
    (listeners.levelchange || []).forEach(function(fn) { fn(); });

    assert.equal(sends.length, 1, 'crossing 60 -> 40 pushes a status-only micro-send');
    const resent = decodeStatusLine(sends[0].STATUS_LINE_1_UINT8);
    assert.equal(resent[0].text, '42%', 'the new reading, exact and not the 40 bucket');
    assert.equal(resent[1].text, 'Bonn', 'and the city survived, so the stash predated the prune');
  }
  finally {
    console.log = origLog;
    // Leave the module inert for the rest of the file (and clear the cache keys).
    phoneBattery.init({ navigator: null });
  }
});
