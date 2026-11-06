'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const vocabulary = require('../lib/vocabulary');
const build = require('../scripts/build');
const bundler = require('../scripts/bundle');
const zipper = require('../scripts/zip');
const { installHost, uninstallHost, weatherLocation } = require('./helpers/host');
const { validateEnvelope } = require('./helpers/validate');

const HOUR = 3600;
const MIDNIGHT = Date.UTC(2026, 10, 5, 23) / 1000;
const NOW_MS = (MIDNIGHT + 9.5 * HOUR) * 1000;

afterEach(() => uninstallHost());

/**
 * Read a zip the way an unzipper does: from the end-of-central-directory record, through each
 * central header, to its local header and data.
 *
 * @param {Buffer} archive Zip bytes.
 * @returns {Object<string, Buffer>} Entry name -> inflated data.
 */
function unzip(archive) {
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(archive.readUInt32LE(at), 0x02014b50);
    const crc = archive.readUInt32LE(at + 16);
    const packedSize = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extra = archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    const dataStart = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(archive.subarray(dataStart, dataStart + packedSize));
    assert.equal(data.length, size, name);
    assert.equal(zipper.crc32(data), crc, name);
    out[name] = data;
    at += 46 + nameLength + extra;
  }
  return out;
}

test('appinfo: the package.json pebble block, marked manifestVersion 2', () => {
  const pkg = { name: 'x', author: 'Me', version: '1.2.3', pebble: {
    displayName: 'X', uuid: '24ea078a-a2c4-4161-a5fa-b61fca7163c8', projectType: 'plugin',
    plugin: { script: 'plugin.js', sources: [{ category: 'weather' }] } } };
  const appinfo = build.appinfoFor(pkg);
  assert.equal(appinfo.manifestVersion, 2);
  assert.equal(appinfo.versionLabel, '1.2.3');
  assert.equal(appinfo.companyName, 'Me');
  assert.equal(appinfo.longName, 'X');
  assert.deepEqual(appinfo.watchapp, { watchface: false });
  assert.deepEqual(appinfo.plugin, pkg.pebble.plugin);
  // Given what the plugin serves, each source declares those shapes.
  const served = build.appinfoFor(pkg, vocabulary.ALL.slice(0, 2));
  assert.deepEqual(served.plugin.sources[0].properties, vocabulary.declare(vocabulary.ALL.slice(0, 2)));
  assert.equal(pkg.pebble.plugin.sources[0].properties, undefined, 'the manifest is left as it is');
  assert.throws(() => build.appinfoFor(Object.assign({}, pkg, { pebble: Object.assign({}, pkg.pebble, { uuid: 'nope' }) })), /uuid/);
  assert.throws(() => build.appinfoFor(Object.assign({}, pkg, { pebble: Object.assign({}, pkg.pebble, { plugin: {} }) })), /plugin/);
  assert.throws(() => build.appinfoFor(Object.assign({}, pkg, { version: '1.2' })), /version/);
});

test('the bundler follows relative requires only', () => {
  assert.deepEqual(bundler.requestsIn("const a = require('./a');\nconst b = require( \"../lib/b\" );"), ['./a', '../lib/b']);
  assert.throws(() => bundler.resolveRequest(__filename, 'fs'), /only relative requires/);
  assert.throws(() => bundler.resolveRequest(__filename, './missing'), /cannot find/);
});

test('a bundle runs like the modules it holds, each loaded once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-bundle-'));
  try {
    fs.writeFileSync(path.join(dir, 'entry.js'), "'use strict';\nconst a = require('./a');\nconst b = require('./b');\nresult.push(a.name + b.name + a.count());");
    fs.writeFileSync(path.join(dir, 'a.js'), "'use strict';\nlet n = 0;\nmodule.exports = { name: 'a', count: () => ++n };");
    fs.writeFileSync(path.join(dir, 'b.js'), "'use strict';\nconst a = require('./a');\na.count();\nexports.name = 'b';");
    const bundled = bundler.bundle(path.join(dir, 'entry.js'), { root: dir, banner: '// test' });
    assert.deepEqual(bundled.files.map((file) => path.basename(file)), ['entry.js', 'a.js', 'b.js']);
    const result = [];
    vm.runInNewContext(bundled.script, { result });
    assert.deepEqual(result, ['ab2']);
    assert.ok(bundled.script.indexOf(dir) === -1, 'no absolute paths in the bundle');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zip: an unzipper reads back what was written, byte for byte, the same every time', () => {
  const entries = [{ name: 'appinfo.json', data: '{"a":1}\n' }, { name: 'plugin.js', data: Buffer.from('x'.repeat(5000)) }];
  const archive = zipper.zip(entries);
  const read = unzip(archive);
  assert.equal(read['appinfo.json'].toString(), '{"a":1}\n');
  assert.equal(read['plugin.js'].length, 5000);
  assert.deepEqual(zipper.zip(entries), archive);
  assert.equal(zipper.crc32(Buffer.from('123456789')), 0xCBF43926);
});

build.pluginDirs().forEach((dir) => {
  test(dir + ': the pbw holds its appinfo and the bundled script, and builds reproducibly', () => {
    const built = build.buildArtifacts(dir);
    const read = unzip(built.archive);
    assert.deepEqual(Object.keys(read), ['appinfo.json', 'plugin.js']);
    const serves = require('../' + dir + '/src/source.js').SERVES;
    assert.deepEqual(JSON.parse(read['appinfo.json']), build.appinfoFor(built.pkg, serves));
    assert.equal(read['plugin.js'].toString(), built.script);
    assert.deepEqual(build.buildArtifacts(dir).archive, built.archive);
  });

  test(dir + ': the bundled script, run in a fresh engine, answers with nothing the app would drop', async () => {
    const built = build.buildArtifacts(dir);
    const fixtures = dir === 'dwd'
      ? { weather: require('./fixtures/bright-sky-freiburg-weather.json'), current: require('./fixtures/bright-sky-freiburg-current.json') }
      : { forecast: require('./fixtures/open-meteo-freiburg-forecast.json'), uv: require('./fixtures/open-meteo-freiburg-uv.json') };
    const host = installHost({
      locations: [weatherLocation('home', 'Freiburg', 47.99, 7.85)],
      respond: (url) => {
        let body = fixtures.forecast;
        if (url.indexOf('ncep_gfs_global') !== -1) { body = fixtures.uv; }
        if (url.indexOf('/weather?') !== -1) { body = fixtures.weather; }
        if (url.indexOf('/current_weather') !== -1) { body = fixtures.current; }
        return { status: 200, body };
      },
    });
    class FixedDate extends Date {
      constructor(...args) {
        if (args.length) {
          super(...args);
        } else {
          super(NOW_MS);
        }
      }

      static now() {
        return NOW_MS;
      }
    }
    vm.runInNewContext(built.script, {
      Pebble: globalThis.Pebble,
      fetch: globalThis.fetch,
      localStorage: globalThis.localStorage,
      navigator: globalThis.navigator,
      console: { log() {}, error() {} },
      Date: FixedDate,
    });
    assert.equal(typeof host.handler, 'function', 'the script registers a source handler');
    const answer = await host.run(host.handler, { category: 'weather', item: 'location' });
    assert.equal(answer.error, undefined, JSON.stringify(answer.error));
    assert.equal(answer.data.instances.length, 1);
    const declared = built.appinfo.plugin.sources[0].properties;
    assert.deepEqual(validateEnvelope(answer.data, declared).dropped, []);
    assert.deepEqual(Object.keys(answer.data.instances[0].properties).sort(), Object.keys(declared).sort());
  });
});
