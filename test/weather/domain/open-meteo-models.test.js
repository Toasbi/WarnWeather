// test/weather/domain/open-meteo-models.test.js — the Open-Meteo weather models the Provider can
// use (src/pkjs/weather/domain/open-meteo-models.js): the table's order and facts, and which
// model the settings have a fetch ask.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const models = require('../../../src/pkjs/weather/domain/open-meteo-models.js');

test('the default first, the other worldwide models, then the national ones by country', () => {
  assert.equal(models.DEFAULT, 'ecmwf_ifs025');
  assert.equal(models.IDS[0], models.DEFAULT);
  const worldwide = models.MODELS.filter((m) => m.worldwide).map((m) => m.id);
  assert.deepEqual(worldwide, ['ecmwf_ifs025', 'ecmwf_ifs', 'ncep_gfs_global']);
  assert.deepEqual(models.IDS.slice(0, 3), worldwide, 'the worldwide ones lead');
  const national = models.MODELS.filter((m) => !m.worldwide).map((m) => m.area);
  assert.deepEqual(national, national.slice().sort(), 'by country, A to Z');
  assert.equal(new Set(models.IDS).size, models.IDS.length, 'one row a model');
  models.MODELS.forEach((m) => {
    assert.ok(m.name && m.area && /^\d+(\.\d+)? km$/.test(m.grid), m.id);
    assert.ok(['own', 'borrowed', 'coarser', 'none'].indexOf(m.chance) !== -1, m.id);
    assert.ok(m.chance === 'none' ? m.chanceHours === null : m.chanceHours === 1 || m.chanceHours === 3, m.id);
  });
});

test('a fetch reads the chance from the model\'s own answer, or from the default\'s beside a model with none', () => {
  models.IDS.forEach((id) => {
    assert.equal(models.chanceRow(id).id, models.asksChance(id) ? models.DEFAULT : id, id);
  });
  assert.equal(models.chanceRow('meteofrance_seamless').chanceHours, 3, 'ECMWF\'s ensemble steps every 3 hours');
  assert.equal(models.chanceRow('gone_model').id, models.DEFAULT);
});

test('only a model whose chance is its own brings a precipitation amount', () => {
  const bring = models.IDS.filter(models.bringsAmount);
  assert.deepEqual(bring, ['ecmwf_ifs025', 'ecmwf_ifs', 'ncep_gfs_global', 'meteoswiss_icon_seamless',
    'ukmo_seamless']);
  assert.deepEqual(models.IDS.filter(models.asksChance), ['meteofrance_seamless', 'jma_seamless'],
    'the two with no chance at all take ECMWF\'s');
  assert.equal(models.bringsAmount('gone_model'), true, 'an unknown model is the default');
  assert.equal(models.asksChance('gone_model'), false);
});

test('the regional models name where they answer', () => {
  assert.deepEqual(models.MODELS.filter((m) => m.covers).map((m) => [m.id, m.covers]),
    [['chmi_aladin_seamless', 'Central Europe'], ['meteoswiss_icon_seamless', 'the Alps']]);
});

test('a fetch asks the stored model while Open-Meteo is the Provider, else the default', () => {
  assert.equal(models.modelOf({ provider: 'openmeteo', openMeteoModel: 'dwd_icon_seamless' }), 'dwd_icon_seamless');
  assert.equal(models.modelOf({ provider: 'metno', openMeteoModel: 'dwd_icon_seamless' }), 'ecmwf_ifs025');
  ['', 'best_match', 'ncep_hrrr_conus', 'constructor', 'toString', 7, null].forEach((stored) => {
    assert.equal(models.modelOf({ provider: 'openmeteo', openMeteoModel: stored }), 'ecmwf_ifs025',
      JSON.stringify(stored));
  });
  assert.equal(models.modelOf(null), 'ecmwf_ifs025');
  assert.equal(models.rowOf('constructor'), null, 'a stored value finds no row of the prototype');
  assert.equal(models.modelRow('nope').id, 'ecmwf_ifs025');
});
