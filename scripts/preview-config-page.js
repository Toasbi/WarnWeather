// scripts/preview-config-page.js — repo-root wrapper: renders a browser-openable preview of
// WarnWeather's config page (real schema + blocks + onBuild hooks injected) so the settings UI
// can be eyeballed in a desktop browser without the emulator. The output IS the live page —
// tabs, toggles, selects, and the color picker all work. Reads shell.html + lib + app files fresh
// each run, so it always reflects the current source (no need to regenerate page.generated.js).
// Usage: node scripts/preview-config-page.js [out] [platform]
//   platform: basalt | chalk | aplite | diorite | emery   (default basalt)
'use strict';
var fs = require('fs');
var path = require('path');
var build = require('../src/pkjs/config-ui/scripts/build-page.js');

var ROOT = path.join(__dirname, '..');
var platformLib = require(path.join(ROOT, 'src/pkjs/config-ui/lib/platform.js'));
var schema = require(path.join(ROOT, 'src/pkjs/settings/schema.js'));
var previewPalette = require(path.join(ROOT, 'src/pkjs/settings/preview-palette.js'));
var APP_FILES = [
  // view-cycle.js and status-line-catalog.js must precede blocks.js: blocks.js's VC /
  // statusLineCatalog fallbacks (used when this page is a flat concatenated <script>,
  // not a Node module) read their declarations directly from this shared top-level
  // scope. Keep in lockstep with build-config-page.js's APP_FILES — both build the
  // same page, from two separate entrypoints.
  path.join(ROOT, 'src/pkjs/view-cycle.js'),
  path.join(ROOT, 'src/pkjs/status-line-catalog.js'),
  path.join(ROOT, 'src/pkjs/settings/blocks.js'),
  // wizard-screenshots.generated.js assigns PConf.screenshots; must precede wizard.js, which reads it.
  path.join(ROOT, 'src/pkjs/settings/wizard-screenshots.generated.js'),
  path.join(ROOT, 'src/pkjs/settings/wizard.js'),
  path.join(ROOT, 'src/pkjs/settings/onbuild.js'),
  path.join(ROOT, 'src/pkjs/settings/theme-convert.js')
];
var DEFAULT_OUT = path.join(ROOT, 'build/config-ui-preview.html');
var PLATFORMS = ['basalt', 'chalk', 'aplite', 'diorite', 'emery'];

// Parse CLI positionals into { out, platform } order-independently. A bare platform
// name (e.g. `mise preview-config aplite`) selects the platform and keeps the default
// output path — otherwise the arg would be taken as a filename and written as a stray
// extensionless "aplite" file rendered in the default (basalt) colors.
function parseArgs(args) {
  args = args || [];
  var out = null;
  var platform = null;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (platform === null && PLATFORMS.indexOf(a) !== -1) {
      platform = a;
    } else if (out === null) {
      out = a;
    }
  }
  return { out: out || DEFAULT_OUT, platform: platform || 'basalt' };
}

// Delegate to the platform SoT (platform.js) so color/round/health env-gates
// render exactly as they would on-watch — no duplicated platform table here.
function envFor(platform) {
  return platformLib.computeEnv({ platform: platform });
}

function run(opts) {
  opts = opts || {};
  return build.previewPage({
    appFiles: APP_FILES,
    schema: schema,
    env: envFor(opts.platform || 'basalt'),
    cfg: {},
    userData: { palette: previewPalette.buildPreviewPalette() },
    returnTo: '#'
  });
}

if (require.main === module) {
  var parsed = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(parsed.out), { recursive: true });
  fs.writeFileSync(parsed.out, run({ platform: parsed.platform }));
  console.log('wrote ' + parsed.out + ' (' + parsed.platform + ')');
}

module.exports = { run: run, parseArgs: parseArgs, DEFAULT_OUT: DEFAULT_OUT, PLATFORMS: PLATFORMS, APP_FILES: APP_FILES };
