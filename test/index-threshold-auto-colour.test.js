// test/index-threshold-auto-colour.test.js — end to end through the REAL index.js:
// an install whose stored highlight colours are a stale "auto" value (black saved
// under a light theme, white under a dark one) must never reach the watch face as
// ink the face cannot show. The settings page re-derives auto on every open, but a
// blob nobody re-saved kept the old colour, and the watch drew the warn outline and
// danger fill black on the black face (reported on a Pebble Time 2 with the night
// theme switch). status-thresholds.test.js pins buildSettingsBlob; this pins that
// the Clay the phone actually sends -- startup and night switch -- carries the
// resolved colour for the face in effect.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { installIndexRuntime } = require('./helpers/index-runtime');

const BLACK8 = 0xC0;
const WHITE8 = 0xFF;
const EMERY = { platform: 'emery', model: 'qemu_platform_emery', language: 'en' };
// The manual night window defaults to 20:00-07:00 (theme-schedule.js).
const SWITCH = { themeAuto: true, themeAutoMode: 'manual' };

const SCENARIOS = [
  { name: 'Dark, no theme switching: a stale black packs as white',
    settings: { theme: 'dark' }, hour: 13, stale: '#000000', face: 'dark' },
  { name: 'Light day, Dark night, at night: a stale black packs as white',
    settings: Object.assign({ theme: 'light', themeNight: 'dark' }, SWITCH), hour: 2, stale: '#000000', face: 'dark' },
  { name: 'B&W day, Dark night, at night: a stale black packs as white',
    settings: Object.assign({ theme: 'bw', themeNight: 'dark' }, SWITCH), hour: 2, stale: '#000000', face: 'dark' },
  { name: 'Dark day, Light night, at night: a stale white packs as black',
    settings: Object.assign({ theme: 'dark', themeNight: 'light' }, SWITCH), hour: 2, stale: '#ffffff', face: 'light' },
];

SCENARIOS.forEach((sc) => {
  test(sc.name, (t) => {
    const h = installIndexRuntime({ now: new Date(2026, 8, 23, sc.hour, 30).getTime(), watchInfo: EMERY });
    t.after(() => h.restore());
    const other = sc.stale === '#000000' ? '#ffffff' : '#000000';
    h.store['clay-settings'] = JSON.stringify(Object.assign({
      threshWindWarnColor: sc.stale, threshWindDangerColor: sc.stale,
      threshUvWarnColor: sc.stale, threshUvDangerColor: other,
      threshAqiWarnColor: '#ff5500',  // a real pick: packs unchanged
    }, sc.settings));
    h.quietNetwork();
    const listeners = h.boot();
    listeners.ready({});
    // The watch reports no config, so the startup Clay goes out; the ticks that
    // follow run the night-switch path.
    listeners.appmessage({ payload: { WATCH_HAS_CONFIG: 0, WATCH_HAS_FORECAST_DATA: 1 } });
    h.advance(3 * 60 * 1000);

    const sends = h.sent.filter((m) => 'CLAY_THRESHOLDS_UINT8' in m.dict);
    assert.ok(sends.length >= 1, 'a Clay carrying the threshold blob went out');
    const bytes = Array.from(sends[sends.length - 1].dict.CLAY_THRESHOLDS_UINT8);

    const ST = h.mod('status-thresholds.js');
    const stored = JSON.parse(h.store['clay-settings']);
    const ink = sc.face === 'dark' ? '#ffffff' : '#000000';
    const expected = ST.buildSettingsBlob(Object.assign({}, stored, {
      theme: sc.face,
      threshWindWarnColor: ink, threshWindDangerColor: ink,
      threshUvWarnColor: ink, threshUvDangerColor: ink,
    }));
    assert.deepEqual(bytes, Array.from(expected), 'every auto colour packs as the face\'s text colour');
    // The paired kinds' warn/danger colour bytes start right after the version byte.
    const colours = bytes.slice(1, 1 + 16);
    assert.equal(colours.indexOf(sc.face === 'dark' ? BLACK8 : WHITE8), -1,
      'no colour the face cannot show reaches the watch');
    assert.ok(colours.indexOf(0xF4) !== -1, 'the orange pick packs unchanged');
  });
});
