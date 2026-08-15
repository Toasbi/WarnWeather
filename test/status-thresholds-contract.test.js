'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const th = require('../src/pkjs/status-thresholds.js');

const header = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'appendix', 'status_threshold.h'), 'utf8');

function cDefine(name) {
  const m = header.match(new RegExp('#define\\s+' + name + '\\s+(\\d+)'));
  assert.ok(m, name + ' missing from status_threshold.h');
  return Number(m[1]);
}

function cEnum(name) {
  const m = header.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, name + ' missing from status_threshold.h');
  return Number(m[1]);
}

test('kind count and blob layout are in lockstep with status_threshold.h', () => {
  assert.equal(th.KINDS.length, cDefine('THRESH_KIND_COUNT'));
  assert.equal(th.SETTINGS_BYTES, cDefine('THRESH_SETTINGS_BYTES'));
  assert.equal(th.COLORS_OFFSET, cDefine('THRESH_COLORS_OFFSET'));
  assert.equal(th.HEALTH_OFFSET, cDefine('THRESH_HEALTH_OFFSET'));
  assert.equal(th.BOLD_OFFSET, cDefine('THRESH_BOLD_OFFSET'));
  // The paired kinds — the ones owning an enable bit, a color pair, and (for
  // the health trio) a u16 pair — are exactly the non-boldOnly ones, and they
  // must ALL precede the bold-only tail: byte 0 has 8 enable bits, no more.
  const paired = th.KINDS.filter(k => !k.boldOnly).length;
  assert.equal(paired, cDefine('THRESH_PAIRED_KIND_COUNT'));
  th.KINDS.forEach((k, i) => {
    assert.equal(Boolean(k.boldOnly), i >= paired, k.code + ' paired/bold-only split');
  });
});

test('bold modes are in lockstep with the ThreshBold enum', () => {
  assert.equal(th.BOLD_MODES.warn, cEnum('THRESH_BOLD_WARN'));
  assert.equal(th.BOLD_MODES.off, cEnum('THRESH_BOLD_OFF'));
  assert.equal(th.BOLD_MODES.always, cEnum('THRESH_BOLD_ALWAYS'));
  // 'warn' must stay the zero value: an all-zero (or never-configured) blob has
  // to reproduce the shipped bold-from-warn behaviour, watch and phone alike.
  assert.equal(th.BOLD_MODES[th.DEFAULT_BOLD_MODE], 0);
});

test('the bold bytes cover every kind at 2 bits each', () => {
  const boldBytes = th.SETTINGS_BYTES - th.BOLD_OFFSET;
  assert.equal(boldBytes, Math.ceil((th.KINDS.length * 2) / 8));
});

test('kind indices are in lockstep with the ThreshKind enum', () => {
  const names = { aqi: 'THRESH_AQI', pollen: 'THRESH_POLLEN', wind: 'THRESH_WIND',
    gust: 'THRESH_GUST', steps: 'THRESH_STEPS', sleep: 'THRESH_SLEEP',
    distance: 'THRESH_DISTANCE', uv: 'THRESH_UV',
    temp: 'THRESH_TEMP', pressure: 'THRESH_PRESSURE', sun: 'THRESH_SUN',
    date: 'THRESH_DATE', week: 'THRESH_WEEK', city: 'THRESH_CITY',
    countdown: 'THRESH_COUNTDOWN', hr: 'THRESH_HR' };
  th.KINDS.forEach((k, i) => {
    assert.equal(i, cEnum(names[k.code]), k.code + ' wire index');
  });
});

test('persist boundary carries the full levels word (UV rides bits 8-9)', () => {
  // STATUS_LEVELS_UINT8 widened to 2 wire bytes when UV became kind 7. The
  // persist accessors sit between app_message (writer) and status_row (reader);
  // a uint8_t parameter there silently truncates the high byte and kills UV
  // highlighting while the low-byte kinds keep working (2026-08-15 bug).
  const persistHeader = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'c', 'appendix', 'persist.h'), 'utf8');
  assert.match(persistHeader, /int\s+persist_get_status_levels\s*\(/,
    'persist_get_status_levels must return int');
  assert.match(persistHeader, /persist_set_status_levels\s*\(\s*int\s+/,
    'persist_set_status_levels must take int — uint8_t truncates the UV bits');
});

test('directions match the C module: no kind is below-is-worse since the goal rework', () => {
  th.KINDS.forEach((k) => {
    assert.equal(k.belowIsWorse, false, k.code);
  });
  // The goal flag covers exactly the health trio (the C module returns false for
  // every kind — see status_threshold_below_is_worse); UV (appended after them)
  // is a plain weather kind.
  th.KINDS.forEach((k, i) => {
    assert.equal(Boolean(k.goal),
      i >= cEnum('THRESH_STEPS') && i <= cEnum('THRESH_DISTANCE'),
      k.code + ' goal flag');
  });
});
