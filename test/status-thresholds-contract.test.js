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
});

test('kind indices are in lockstep with the ThreshKind enum', () => {
  const names = { aqi: 'THRESH_AQI', pollen: 'THRESH_POLLEN', wind: 'THRESH_WIND',
    gust: 'THRESH_GUST', steps: 'THRESH_STEPS', sleep: 'THRESH_SLEEP',
    distance: 'THRESH_DISTANCE' };
  th.KINDS.forEach((k, i) => {
    assert.equal(i, cEnum(names[k.code]), k.code + ' wire index');
  });
});

test('directions match the C module: health kinds are below-is-worse', () => {
  th.KINDS.forEach((k, i) => {
    assert.equal(k.belowIsWorse, i >= cEnum('THRESH_STEPS'), k.code);
  });
});
