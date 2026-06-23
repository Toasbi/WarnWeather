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
var schema = require(path.join(ROOT, 'src/pkjs/settings/schema.js'));
var APP_FILES = [
  path.join(ROOT, 'src/pkjs/settings/blocks.js'),
  path.join(ROOT, 'src/pkjs/settings/onbuild.js')
];
var DEFAULT_OUT = path.join(ROOT, 'build/config-ui-preview.html');

// color/round mirror each platform's hardware so showWhen env-gates render as they would on-watch.
function envFor(platform) {
  return {
    color: platform !== 'aplite' && platform !== 'diorite',
    round: platform === 'chalk',
    platform: platform
  };
}

function run(opts) {
  opts = opts || {};
  return build.previewPage({
    appFiles: APP_FILES,
    schema: schema,
    env: envFor(opts.platform || 'basalt'),
    cfg: {},
    userData: {},
    returnTo: '#'
  });
}

if (require.main === module) {
  var out = process.argv[2] || DEFAULT_OUT;
  var platform = process.argv[3] || 'basalt';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, run({ platform: platform }));
  console.log('wrote ' + out + ' (' + platform + ')');
}

module.exports = { run: run };
