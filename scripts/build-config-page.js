// scripts/build-config-page.js — repo-root wrapper: builds WarnWeather's config page.
// Calls the generic library builder with WarnWeather's app files + out path.
'use strict';
var path = require('path');
var build = require('../src/pkjs/config-ui/scripts/build-page.js');

var ROOT = path.join(__dirname, '..');
var OUT  = path.join(ROOT, 'src/pkjs/settings/page.generated.js');
var APP_FILES = [
  // view-cycle.js must precede blocks.js: blocks.js's VC fallback (used when this page
  // is a flat concatenated <script>, not a Node module) reads its declarations directly
  // from this shared top-level scope.
  path.join(ROOT, 'src/pkjs/view-cycle.js'),
  path.join(ROOT, 'src/pkjs/settings/blocks.js'),
  path.join(ROOT, 'src/pkjs/settings/wizard.js'),
  path.join(ROOT, 'src/pkjs/settings/onbuild.js')
];

function run() {
  return build.writeGenerated({ out: OUT, appFiles: APP_FILES });
}

if (require.main === module) {
  console.log('wrote ' + run());
}

module.exports = { run: run, APP_FILES: APP_FILES };
