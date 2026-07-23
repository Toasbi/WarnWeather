// test/config-integration-build.test.js — integration: build pipeline + createConfig instance
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Step 1: require the repo-root build wrapper and run it to emit page.generated.js
const build = require('../scripts/build-config-page.js');
build.run();

// Step 2: require the WarnWeather settings instance (which requires page.generated.js)
const settings = require('../src/pkjs/settings/index.js');

// The instance now carries an emulatorConfigUrl, and in Node (no Pebble global) generateUrl
// would read as "emulator" and emit the hosted-helper URL. This suite verifies the device
// data:-URL build output, so simulate a real basalt watch. isEmulator() reads Pebble at
// generateUrl call time (not at createConfig time), so setting this after the require is
// fine. (node:test isolates files in separate processes, so the global does not leak.)
global.Pebble = { platform: 'basalt' };

test('generateUrl returns a data: URL', function () {
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    assert.ok(url.indexOf('data:text/html;charset=utf-8,') === 0, 'must be a data: URL');
});

test('decoded HTML contains schema injected with defaults-as-hex', function () {
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    var decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    assert.ok(decoded.indexOf('"messageKey":"provider"') !== -1, 'schema injected');
    // color defaults must be hex strings, not raw integers
    assert.ok(decoded.indexOf('"colorTime":"#FFFFFF"') !== -1, 'colorTime as hex');
    assert.ok(decoded.indexOf('"colorSunday":"#FF0055"') !== -1, 'colorSunday as hex');
});

test('decoded HTML contains computed env for basalt (color platform)', function () {
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    var decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    assert.ok(decoded.indexOf('"color":true') !== -1, 'basalt env: color=true');
});

test('decoded HTML contains app blocks (blocks.js) and PConf.engine.boot()', function () {
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    var decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    assert.ok(decoded.indexOf('forecastPreview') !== -1, 'blocks.js forecastPreview present');
    assert.ok(decoded.indexOf('PConf.engine.boot();') !== -1, 'boot call present');
});

// Regression: the generated page concatenates view-cycle.js + blocks.js + onbuild.js into
// ONE plain <script> (no CommonJS `require` in that context — see build-page.js). A block
// that only worked via blocks.js's `require('../view-cycle.js')` branch would pass every
// test that loads blocks.js as its own Node module (require() exists there) while silently
// throwing in the real webview the moment a user opened the Layout tab. Execute the ACTUAL
// generated script in a sandbox with no `require`, the way the webview runs it, and drive
// the Layout tab's preview block for real.
test('generated page renders the Layout tab preview without require() (webview has none)', function () {
    var vm = require('vm');
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    var decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    var scriptMatch = decoded.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(scriptMatch, 'page contains a <script> block');
    // Strip the auto-appended boot() call — this test only needs the block registry, and
    // boot() reaches into live DOM APIs this sandbox doesn't stub.
    var src = scriptMatch[1].replace(/PConf\.engine\.boot\(\);\s*$/, '');
    var sandbox = { console: console };
    sandbox.window = sandbox;
    sandbox.document = { getElementById: function () { return { addEventListener: function () {} }; }, addEventListener: function () {} };
    sandbox.navigator = {};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'generated-page.js' });
    var fn = sandbox.PConf.blocks.get('layoutPreviewCombined');
    assert.ok(fn, 'layoutPreviewCombined is registered');
    var out = fn({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' }, {}, {});
    assert.ok(out.indexOf('<svg') >= 0, 'renders real SVG content, not a thrown error');
});

test('generated page registers PConf.actions.startWizard (wizard.js concatenated + shimmed)', function () {
    var vm = require('vm');
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    var decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    var scriptMatch = decoded.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(scriptMatch, 'page contains a <script> block');
    // Strip the auto-appended boot() call — it reaches into live DOM APIs the sandbox lacks.
    var src = scriptMatch[1].replace(/PConf\.engine\.boot\(\);\s*$/, '');
    var sandbox = { console: console };
    sandbox.window = sandbox;
    sandbox.document = { getElementById: function () { return { addEventListener: function () {} }; }, addEventListener: function () {} };
    sandbox.navigator = {};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'generated-page.js' });
    assert.equal(typeof sandbox.PConf.actions.startWizard, 'function', 'startWizard action registered');
});
