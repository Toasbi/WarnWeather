#!/usr/bin/env node
'use strict';

// Build the plugin pbws: node plugins/scripts/build.js [plugin-dir ...] (every plugin by default).
//
// A plugin-only pbw holds no watch binary, just appinfo.json (the package.json `pebble` block,
// marked manifestVersion 2 so the Pebble app loads its plugin) and the plugin script, bundled from
// src/index.js. Each lands in plugins/<dir>/build/<name>.pbw, with the bundled script beside it
// for reading. No Pebble SDK needed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const bundler = require('./bundle');
const zipper = require('./zip');
const vocabulary = require('../lib/vocabulary');

const PLUGINS_DIR = path.join(__dirname, '..');

/** The appinfo rules the pbw is built for: below 2 the app treats it as a legacy app. */
const MANIFEST_VERSION = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The plugin directories: those with a package.json and a src/index.js.
 *
 * @returns {string[]} Directory names, sorted.
 */
function pluginDirs() {
  const has = (name, file) => fs.existsSync(path.join(PLUGINS_DIR, name, file));
  return fs.readdirSync(PLUGINS_DIR)
    .filter((name) => has(name, 'package.json') && has(name, path.join('src', 'index.js')))
    .sort();
}

/**
 * A source as the app reads it: its manifest entry with the shapes it declares (the Pebble app
 * drops a shape no source declares), written after its items. The manifest itself never lists
 * them; they come from what the plugin serves, so the two cannot drift.
 *
 * @param {Object} source A pebble.plugin.sources entry.
 * @param {string[]} serves The plugin's SERVES (its src/source.js).
 * @returns {Object} The entry with `properties`.
 */
function declaredSource(source, serves) {
  const out = {};
  Object.keys(source).forEach((key) => {
    if (key === 'properties') {
      return;
    }
    out[key] = source[key];
    if (key === 'items') {
      out.properties = vocabulary.declare(serves);
    }
  });
  if (!out.properties) {
    out.properties = vocabulary.declare(serves);
  }
  return out;
}

/**
 * The appinfo.json a plugin-only pbw carries, from its package.json: the `pebble` block with the
 * fields `pebble build` would add and, given what the plugin serves, each source's declared shapes.
 *
 * @param {Object} pkg Parsed package.json.
 * @param {string[]} [serves] The plugin's SERVES; without it the sources stay as the manifest has them.
 * @returns {Object} appinfo.
 */
function appinfoFor(pkg, serves) {
  const pebble = pkg.pebble || {};
  if (!UUID.test(pebble.uuid || '')) {
    throw new Error(pkg.name + ': the pebble block needs a uuid');
  }
  const plugin = pebble.plugin;
  if (!plugin || typeof plugin !== 'object' || !plugin.script || !Array.isArray(plugin.sources)
    || !plugin.sources.length) {
    throw new Error(pkg.name + ': the pebble block needs a plugin with a script and sources');
  }
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version || '')) {
    throw new Error(pkg.name + ': version must be major.minor.patch');
  }
  const display = pebble.displayName || pkg.name;
  const appinfo = Object.assign({
    shortName: display,
    longName: display,
    companyName: pkg.author || '',
    versionLabel: pkg.version,
    sdkVersion: '3',
    resources: { media: [] },
    watchapp: { watchface: false },
  }, pebble, { manifestVersion: MANIFEST_VERSION });
  if (serves) {
    appinfo.plugin = Object.assign({}, plugin, {
      sources: plugin.sources.map((source) => declaredSource(source, serves)),
    });
  }
  return appinfo;
}

/**
 * Everything one plugin's pbw is made of, in memory.
 *
 * @param {string} dir Plugin directory name under plugins/.
 * @returns {{pkg: Object, appinfo: Object, script: string, archive: Buffer}} The parts and the pbw.
 */
function buildArtifacts(dir) {
  const project = path.join(PLUGINS_DIR, dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  const appinfo = appinfoFor(pkg, require(path.join(project, 'src', 'source.js')).SERVES);
  const bundled = bundler.bundle(path.join(project, 'src', 'index.js'), {
    root: PLUGINS_DIR,
    banner: '// ' + appinfo.longName + ' ' + pkg.version + ': bundled by plugins/scripts/build.js from '
      + 'plugins/' + dir + '/src. Do not edit; change the sources and rebuild.',
  });
  // Compile (not run) it, so a syntax error fails the build rather than the plugin on a phone.
  new vm.Script(bundled.script, { filename: appinfo.plugin.script });
  const archive = zipper.zip([
    { name: 'appinfo.json', data: JSON.stringify(appinfo, null, 2) + '\n' },
    { name: appinfo.plugin.script, data: bundled.script },
  ]);
  return { pkg, appinfo, script: bundled.script, archive };
}

/**
 * Build one plugin into plugins/<dir>/build/.
 *
 * @param {string} dir Plugin directory name under plugins/.
 * @returns {{file: string, bytes: number, scriptBytes: number}} The pbw written.
 */
function buildPlugin(dir) {
  const built = buildArtifacts(dir);
  const out = path.join(PLUGINS_DIR, dir, 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, built.appinfo.plugin.script), built.script);
  const file = path.join(out, built.pkg.name + '.pbw');
  fs.writeFileSync(file, built.archive);
  return { file, bytes: built.archive.length, scriptBytes: Buffer.byteLength(built.script) };
}

/**
 * CLI: build the named plugins, or all of them.
 *
 * @param {string[]} args Directory names.
 * @returns {void}
 */
function main(args) {
  const known = pluginDirs();
  const dirs = args.length ? args : known;
  dirs.forEach((dir) => {
    if (known.indexOf(dir) === -1) {
      throw new Error("no plugin called '" + dir + "' (have: " + known.join(', ') + ')');
    }
    const built = buildPlugin(dir);
    console.log(path.relative(process.cwd(), built.file) + '  ' + built.bytes + ' B (script '
      + built.scriptBytes + ' B)');
  });
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { MANIFEST_VERSION, PLUGINS_DIR, pluginDirs, appinfoFor, buildArtifacts, buildPlugin };
