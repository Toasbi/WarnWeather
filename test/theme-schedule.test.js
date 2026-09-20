// test/theme-schedule.test.js — the automatic day/night theme switch's
// decision logic: night-window evaluation (manual hours + sun times), the
// effective theme id the scheduler compares across ticks, and the scratch-copy
// settings substitution sendClaySettings builds wire payloads from.
const test = require('node:test');
const assert = require('node:assert/strict');
const themeSchedule = require('../src/pkjs/theme-schedule.js');

// A local-noon reference day; manual-mode tests derive hours from it.
const at = (h, m) => new Date(2026, 8, 20, h, m || 0, 0);

function sunTimes(riseH, setH) {
  return { sunrise: at(riseH), sunset: at(setH) };
}

test('switch off: never night, whatever the window says', () => {
  assert.equal(themeSchedule.isNightNow(at(23), { themeAuto: false, themeAutoMode: 'manual' }, null), false);
  assert.equal(themeSchedule.isNightNow(at(23), null, null), false);
});

test('manual mode: wrap-around window 20..7 covers evening and early morning', () => {
  const s = { themeAuto: true, themeAutoMode: 'manual', themeAutoStartHour: '20', themeAutoEndHour: '7' };
  assert.equal(themeSchedule.isNightNow(at(19, 59), s, null), false);
  assert.equal(themeSchedule.isNightNow(at(20, 0), s, null), true);
  assert.equal(themeSchedule.isNightNow(at(23, 30), s, null), true);
  assert.equal(themeSchedule.isNightNow(at(3, 0), s, null), true);
  assert.equal(themeSchedule.isNightNow(at(6, 59), s, null), true);
  assert.equal(themeSchedule.isNightNow(at(7, 0), s, null), false);
  assert.equal(themeSchedule.isNightNow(at(12, 0), s, null), false);
});

test('manual mode: non-wrapping window, equal hours never match, garbage clamps to 20..7', () => {
  const plain = { themeAuto: true, themeAutoMode: 'manual', themeAutoStartHour: '1', themeAutoEndHour: '5' };
  assert.equal(themeSchedule.isNightNow(at(3), plain, null), true);
  assert.equal(themeSchedule.isNightNow(at(5), plain, null), false);
  const same = { themeAuto: true, themeAutoMode: 'manual', themeAutoStartHour: '9', themeAutoEndHour: '9' };
  assert.equal(themeSchedule.isNightNow(at(9), same, null), false);
  const junk = { themeAuto: true, themeAutoMode: 'manual', themeAutoStartHour: 'x', themeAutoEndHour: '99' };
  assert.equal(themeSchedule.isNightNow(at(22), junk, null), true, 'clamped to the 20..7 defaults');
  assert.equal(themeSchedule.isNightNow(at(12), junk, null), false);
});

test('sun mode: night before sunrise and from sunset onward, day in between', () => {
  const s = { themeAuto: true, themeAutoMode: 'sun' };
  const times = sunTimes(6, 19);
  assert.equal(themeSchedule.isNightNow(at(5, 59), s, times), true);
  assert.equal(themeSchedule.isNightNow(at(6, 0), s, times), false);
  assert.equal(themeSchedule.isNightNow(at(12, 0), s, times), false);
  assert.equal(themeSchedule.isNightNow(at(18, 59), s, times), false);
  assert.equal(themeSchedule.isNightNow(at(19, 0), s, times), true);
});

test('sun mode is the default when themeAutoMode is absent', () => {
  const s = { themeAuto: true };
  assert.equal(themeSchedule.isNightNow(at(23), s, sunTimes(6, 19)), true);
});

test('sun mode: unknown or invalid sun times answer day, never night', () => {
  const s = { themeAuto: true, themeAutoMode: 'sun' };
  assert.equal(themeSchedule.isNightNow(at(23), s, null), false, 'no location fix yet');
  const invalid = { sunrise: new Date(NaN), sunset: new Date(NaN) };
  assert.equal(themeSchedule.isNightNow(at(23), s, invalid), false, 'polar day/night: Invalid Date');
  assert.equal(themeSchedule.isNightNow(at(23), s, { sunrise: null, sunset: null }), false);
});

test('effectiveThemeId: stored theme by day, night theme inside the window', () => {
  const s = { themeAuto: true, theme: 'light', themeNight: 'dark' };
  assert.equal(themeSchedule.effectiveThemeId(s, false), 'light');
  assert.equal(themeSchedule.effectiveThemeId(s, true), 'dark');
  assert.equal(themeSchedule.effectiveThemeId({ themeAuto: false, theme: 'bw' }, true), 'bw',
    'switch off: the night verdict is ignored');
  assert.equal(themeSchedule.effectiveThemeId({ themeAuto: true, theme: 'light' }, true), 'dark',
    'absent night pick falls back to dark');
});

test('effectiveSettings: identity outside the flip — same object, not a copy', () => {
  const s = { themeAuto: true, theme: 'light', themeNight: 'dark', colorTime: '#000000' };
  assert.equal(themeSchedule.effectiveSettings(s, false), s);
  assert.equal(themeSchedule.effectiveSettings({ themeAuto: false, theme: 'light' }, true).theme, 'light');
  const same = { themeAuto: true, theme: 'dark', themeNight: 'dark' };
  assert.equal(themeSchedule.effectiveSettings(same, true), same, 'identical picks: nothing to flip');
});

test('effectiveSettings at night: scratch copy carries the night theme and converted defaults', () => {
  const s = {
    themeAuto: true, theme: 'light', themeNight: 'dark',
    colorTime: '#000000', colorSunday: '#FF0055',
    rainBarColor: 'white', radarColor: '#00AAFF',
    provider: 'dwd'
  };
  const eff = themeSchedule.effectiveSettings(s, true);
  assert.notEqual(eff, s, 'a scratch copy, not the original');
  assert.equal(eff.theme, 'dark');
  assert.equal(eff.colorTime, '#FFFFFF', 'default-tracking time colour converts, like a manual flip');
  assert.equal(eff.colorSunday, '#FF0055', 'an explicit pick survives the flip');
  assert.equal(eff.rainBarColor, 'multicolor', 'light default bar mode converts to the dark default');
  assert.equal(eff.radarColor, '#00AAFF', 'an explicit radar colour survives');
  assert.equal(eff.provider, 'dwd', 'unrelated settings ride along unchanged');
  // The stored blob stays untouched — `theme` remains the day theme.
  assert.equal(s.theme, 'light');
  assert.equal(s.colorTime, '#000000');
  assert.equal(s.rainBarColor, 'white');
});

test('effectiveSettings: a dark<->bw night pair flips the theme without converting colours', () => {
  const s = { themeAuto: true, theme: 'dark', themeNight: 'bw', colorTime: '#FFFFFF' };
  const eff = themeSchedule.effectiveSettings(s, true);
  assert.equal(eff.theme, 'bw');
  assert.equal(eff.colorTime, '#FFFFFF', 'same polarity: nothing converts');
});
