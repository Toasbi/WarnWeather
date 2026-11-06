'use strict';

// Open-Meteo Weather: the plugin script's entry point. plugins/scripts/build.js bundles it, with
// what it requires, into the pbw's plugin.js.

const source = require('./source');

Pebble.registerSourceHandler(source.createSource());
