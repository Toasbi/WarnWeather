'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vocabulary = require('../lib/vocabulary');
const build = require('../scripts/build');

const PLUGINS = build.pluginDirs();
const REPO = path.join(__dirname, '..', '..');

/**
 * @param {string} dir Plugin directory.
 * @returns {Object} Its parsed package.json.
 */
function manifestOf(dir) {
  return JSON.parse(fs.readFileSync(path.join(build.PLUGINS_DIR, dir, 'package.json'), 'utf8'));
}

test('both weather plugins are found', () => {
  assert.deepEqual(PLUGINS, ['dwd', 'open-meteo']);
});

test('every plugin has its own uuid, apart from the watchface\'s', () => {
  const appUuids = fs.readdirSync(path.join(REPO, 'profiles'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(REPO, 'profiles', file), 'utf8')).uuid);
  const uuids = PLUGINS.map((dir) => manifestOf(dir).pebble.uuid);
  assert.equal(new Set(uuids).size, uuids.length);
  uuids.forEach((uuid) => assert.equal(appUuids.indexOf(uuid), -1, uuid));
});

PLUGINS.forEach((dir) => {
  const pkg = manifestOf(dir);
  const pebble = pkg.pebble;
  const source = pebble.plugin.sources[0];
  const serves = require(path.join(build.PLUGINS_DIR, dir, 'src', 'source.js')).SERVES;

  test(dir + ': a plugin-only project with a version to release', () => {
    assert.equal(pebble.projectType, 'plugin');
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(pebble.plugin.script, 'plugin.js');
    assert.ok(pebble.plugin.description.length > 40);
    assert.equal(pebble.watchapp, undefined, 'no watch binary');
  });

  test(dir + ': declares exactly the shapes it serves (the app drops undeclared ones)', () => {
    assert.deepEqual(source.properties, vocabulary.declare(serves),
      'regenerate the properties block from plugins/lib/vocabulary.js');
  });

  test(dir + ': serves weather/location, guarded by Location like every weather source', () => {
    assert.equal(pebble.plugin.sources.length, 1);
    assert.equal(source.category, 'weather');
    assert.deepEqual(source.items, ['location']);
    assert.deepEqual(source.callerPermissions, ['Location']);
    assert.equal(source.supportsMultiple, true);
    assert.ok(source.suggestedRefreshIntervalSec >= 600);
  });

  test(dir + ': asks for Location and its one API host, nothing more', () => {
    const internet = pebble.usesPermissions.filter((permission) => permission.name === 'Internet');
    assert.equal(pebble.usesPermissions.length, 2);
    assert.ok(pebble.usesPermissions.indexOf('Location') !== -1);
    assert.equal(internet.length, 1);
    assert.equal(internet[0].parameters.domains.length, 1);
  });

  test(dir + ': the release notes have a section for its version', () => {
    const changelog = fs.readFileSync(path.join(build.PLUGINS_DIR, dir, 'CHANGELOG.md'), 'utf8');
    assert.ok(changelog.split('\n').indexOf('## ' + pkg.version) !== -1, 'CHANGELOG.md needs ## ' + pkg.version);
  });

  test(dir + ': serves what the Pebble app needs to make it the weather provider', () => {
    ['temperature', 'condition_code', 'utc_offset', 'daily_high', 'daily_low', 'daily_condition_code',
      'daily_sunrise', 'daily_sunset'].forEach((name) => assert.ok(serves.indexOf(name) !== -1, name));
  });
});
