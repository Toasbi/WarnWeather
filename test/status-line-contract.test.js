const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../src/pkjs/status-line-catalog.js');

const header = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'appendix', 'status_line.h'), 'utf8');

function cDefine(name) {
  const m = header.match(new RegExp('#define\\s+' + name + '\\s+(\\d+)'));
  assert.ok(m, name + ' missing from status_line.h');
  return Number(m[1]);
}

function cEnum(name) {
  const m = header.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, name + ' missing from status_line.h');
  return Number(m[1]);
}

test('caps are in lockstep with status_line.h', () => {
  assert.equal(catalog.CAPS.LINE_MAX, cDefine('STATUS_LINE_MAX_BYTES'));
  assert.equal(catalog.CAPS.EDGE_TEXT_MAX, cDefine('STATUS_TEXT_EDGE_MAX'));
  assert.equal(catalog.CAPS.MID_TEXT_MAX, cDefine('STATUS_TEXT_MID_MAX'));
});

test('slot kinds are in lockstep with status_line.h', () => {
  assert.equal(catalog.KINDS.EMPTY, cEnum('SLOT_EMPTY'));
  assert.equal(catalog.KINDS.TEXT, cEnum('SLOT_TEXT'));
  assert.equal(catalog.KINDS.LIVE_DATE, cEnum('SLOT_LIVE_DATE'));
  assert.equal(catalog.KINDS.LIVE_STEPS, cEnum('SLOT_LIVE_STEPS'));
  assert.equal(catalog.KINDS.LIVE_HR, cEnum('SLOT_LIVE_HR'));
  assert.equal(catalog.KINDS.LIVE_SLEEP, cEnum('SLOT_LIVE_SLEEP'));
  assert.equal(catalog.KINDS.LIVE_DISTANCE, cEnum('SLOT_LIVE_DISTANCE'));
  assert.equal(catalog.KINDS.LIVE_WEEK, cEnum('SLOT_LIVE_WEEK'));
  assert.equal(catalog.KINDS.LIVE_DISTANCE_MI, cEnum('SLOT_LIVE_DISTANCE_MI'));
});

test('icon ids are in lockstep with status_line.h', () => {
  assert.equal(catalog.ICONS.NONE, cEnum('STATUS_ICON_NONE'));
  assert.equal(catalog.ICONS.DRAWN_SUN, cEnum('STATUS_ICON_DRAWN_SUN'));
  assert.equal(catalog.ICONS.TEMP, cEnum('STATUS_ICON_TEMP'));
  assert.equal(catalog.ICONS.UV, cEnum('STATUS_ICON_UV'));
  assert.equal(catalog.ICONS.WIND, cEnum('STATUS_ICON_WIND'));
  assert.equal(catalog.ICONS.GUST, cEnum('STATUS_ICON_GUST'));
  assert.equal(catalog.ICONS.PRECIP, cEnum('STATUS_ICON_PRECIP'));
  assert.equal(catalog.ICONS.STEPS, cEnum('STATUS_ICON_STEPS'));
  assert.equal(catalog.ICONS.SLEEP, cEnum('STATUS_ICON_SLEEP'));
  assert.equal(catalog.ICONS.HR, cEnum('STATUS_ICON_HR'));
  assert.equal(catalog.ICONS.DISTANCE, cEnum('STATUS_ICON_DISTANCE'));
});

test('every dropdown item maps kind+icon consistently', () => {
  const expected = {
    empty: [catalog.KINDS.EMPTY, catalog.ICONS.NONE],
    temp: [catalog.KINDS.TEXT, catalog.ICONS.TEMP],
    city: [catalog.KINDS.TEXT, catalog.ICONS.NONE],
    sun: [catalog.KINDS.TEXT, catalog.ICONS.DRAWN_SUN],
    uv: [catalog.KINDS.TEXT, catalog.ICONS.UV],
    wind: [catalog.KINDS.TEXT, catalog.ICONS.WIND],
    gust: [catalog.KINDS.TEXT, catalog.ICONS.GUST],
    precip_prob: [catalog.KINDS.TEXT, catalog.ICONS.PRECIP],
    steps: [catalog.KINDS.LIVE_STEPS, catalog.ICONS.STEPS],
    distance: [catalog.KINDS.LIVE_DISTANCE, catalog.ICONS.DISTANCE],
    hr: [catalog.KINDS.LIVE_HR, catalog.ICONS.HR],
    sleep: [catalog.KINDS.LIVE_SLEEP, catalog.ICONS.SLEEP],
    date: [catalog.KINDS.LIVE_DATE, catalog.ICONS.NONE],
    week: [catalog.KINDS.LIVE_WEEK, catalog.ICONS.NONE]
  };
  Object.keys(expected).forEach(code => {
    const item = catalog.byCode(code);
    assert.ok(item, code + ' missing from catalog');
    assert.equal(item.kind, expected[code][0], code + ' kind');
    assert.equal(item.icon, expected[code][1], code + ' icon');
  });
});
