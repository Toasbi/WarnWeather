// test/helpers/provider-pins.js — one weather fetch per provider and watch, end to end, as
// data: the requests it makes, in order, and the payload it hands the outbox. A fetch runs
// the real chain as the fetch cycle runs it (provider-world.js fetchLikeTheCycle: the city,
// the provider's own requests, DWD's UV from Open-Meteo, the sun events, air quality,
// pollen, the day records and the render transform), with every request answered by
// test/helpers/provider-world.js at its fixed clock and place.
//
// The pins are test/provider-pins.golden.json, checked byte for byte by
// test/weather/adapter/provider-pins.test.js. The fetches run in Europe/Berlin, set when the
// process starts (the day records, the pollen day and the status bake read local time, and
// a zone changed mid-run is not trusted: test/page/weather/weather-tab/weather-tab-charts.test.js),
// so the pins are the same on every host. After a DELIBERATE change to what a provider asks
// or sends, rewrite them with
//     node test/helpers/provider-pins.js --write
// and review the diff like code.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const world = require('./provider-world.js');

const GOLDEN_PATH = path.join(__dirname, '..', 'provider-pins.golden.json');
const ZONE = 'Europe/Berlin';
// Every provider the factory builds, so a new one is pinned (and its pins written) at once.
const PROVIDERS = require('../../src/pkjs/weather/adapter/provider-factory.js').PROVIDER_IDS.slice().sort();

const WATCHES = {
  basalt: { platform: 'basalt', model: 'qemu_platform_basalt', language: 'en' },
  emery: { platform: 'emery', model: 'qemu_platform_emery', language: 'en' },
  aplite: { platform: 'aplite', model: 'qemu_platform_aplite', language: 'en' }
};

// What a fresh install draws on a Pebble Time and on a Classic (the chance of rain line, the
// rain bars and air quality), the wind, feels-like and gust lines with the feels-like slot
// on a Pebble Time, and on an emery's long span every other reading a fetch can ask a
// provider for: the cloud, UV, dew point and air pressure lines, the feels-like with the
// Steadman formula, the dew point and the weather condition in the Forecast bar, the pollen
// (the DWD's index with DWD, the CAMS forecast with the rest), the wind with its direction and the gusts
// in the Watch bar. A fresh install already asks for UV, air quality and the day max of UV,
// wind, gusts and air quality (the On demand items).
const SCENARIOS = {
  basalt: { watch: 'basalt', settings: {} },
  aplite: { watch: 'aplite', settings: {} },
  lines: {
    watch: 'basalt',
    settings: { thirdLine: 'wind', fourthLine: 'feels', fifthLine: 'gust', tempSlotDisplay: 'both' }
  },
  everything: {
    watch: 'emery',
    settings: { secondaryLine: 'cloud', thirdLine: 'uv', fourthLine: 'dew', fifthLine: 'pressure',
      tempSlotDisplay: 'both', feelsFormula: 'steadman',
      statusForecastLeft: 'temp', statusForecastMid: 'dew', statusForecastRight: 'condition',
      statusTopLeft: 'pollen', statusTopMid: 'wind', statusTopRight: 'gust' }
  }
};

/**
 * One pinned fetch: the provider on a scenario's watch and settings, fetched as the fetch
 * cycle fetches.
 * @param {string} providerId A provider-factory.js id.
 * @param {string} scenarioName A SCENARIOS key.
 * @returns {{options: Object, outcome: string, requests: string[], payload: ?Object}} The pin.
 */
function runPin(providerId, scenarioName) {
  const scenario = SCENARIOS[scenarioName];
  const watchInfo = WATCHES[scenario.watch];
  return world.inWorld(watchInfo, ({ mod, requests }) => {
    const run = world.fetchLikeTheCycle(mod, world.settingsFor(mod, providerId, scenario.settings), watchInfo);
    return { options: run.provider.options, outcome: run.outcome, requests: requests, payload: run.payload };
  });
}

/**
 * Every provider on every scenario, keyed '<provider>@<scenario>'. Must run in ZONE.
 * @returns {Object<string, Object>} The pins.
 */
function buildPins() {
  if (new Date(world.NOW_MS).getTimezoneOffset() !== -120) {
    throw new Error('the provider pins run in ' + ZONE + ' (UTC+2 on the pinned day), not here');
  }
  const pins = {};
  PROVIDERS.forEach((id) => {
    Object.keys(SCENARIOS).forEach((name) => { pins[id + '@' + name] = runPin(id, name); });
  });
  return pins;
}

/**
 * The pins as the golden file holds them: one case per block, its payload one key per line,
 * so a diff names the key that changed.
 * @param {Object<string, Object>} pins buildPins() result.
 * @returns {string} The golden file's text.
 */
function stringify(pins) {
  const blocks = Object.keys(pins).map((name) => {
    const pin = pins[name];
    const payload = pin.payload === null ? 'null' : '{\n' + Object.keys(pin.payload).map((key) =>
      '      ' + JSON.stringify(key) + ': ' + JSON.stringify(pin.payload[key])).join(',\n') + '\n    }';
    return '  ' + JSON.stringify(name) + ': {\n'
      + '    "outcome": ' + JSON.stringify(pin.outcome) + ',\n'
      + '    "options": ' + JSON.stringify(pin.options) + ',\n'
      + '    "requests": [\n' + pin.requests.map((r) => '      ' + JSON.stringify(r)).join(',\n') + '\n    ],\n'
      + '    "payload": ' + payload + '\n'
      + '  }';
  });
  return '{\n' + blocks.join(',\n') + '\n}\n';
}

/**
 * The pins built in a child process started in ZONE, as golden text.
 * @returns {string} stringify(buildPins()) from that child.
 */
function pinsTextInZone() {
  return execFileSync(process.execPath, [__filename, '--print'],
    { env: Object.assign({}, process.env, { TZ: ZONE }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

if (require.main === module) {
  if (process.argv.indexOf('--print') !== -1) {
    process.stdout.write(stringify(buildPins()));
  } else if (process.argv.indexOf('--write') !== -1) {
    fs.writeFileSync(GOLDEN_PATH, pinsTextInZone());
    console.log('wrote ' + path.relative(process.cwd(), GOLDEN_PATH));
  } else {
    console.log('usage: node test/helpers/provider-pins.js --write');
  }
}

module.exports = { GOLDEN_PATH, PROVIDERS, SCENARIOS, pinsTextInZone };
