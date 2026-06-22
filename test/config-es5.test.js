'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FILES = [
  'src/pkjs/config-ui/index.js',
  'src/pkjs/config-ui/lib/color.js',
  'src/pkjs/config-ui/lib/schema-walk.js',
  'src/pkjs/config-ui/lib/platform.js',
  'src/pkjs/config-ui/lib/defaults.js',
  'src/pkjs/config-ui/lib/show-when.js',
  'src/pkjs/config-ui/lib/engine.js',
  'src/pkjs/settings/schema.js',
  'src/pkjs/settings/blocks.js',
  'src/pkjs/settings/onbuild.js',
  'src/pkjs/settings/index.js',
].map((f) => path.join(ROOT, f));

const FORBIDDEN = [
  ['arrow', /=>/],
  ['const', /\bconst\s/],
  ['let', /\blet\s/],
  ['template literal', /`/],
  ['class', /\bclass\s/],
  ['for…of', /\bfor\s*\([^;)]*\bof\b/],
  ['padStart', /\.padStart\s*\(/],
  ['padEnd', /\.padEnd\s*\(/],
  ['Object.values', /\bObject\.values\s*\(/],
  ['Object.entries', /\bObject\.entries\s*\(/],
  ['Array.from', /\bArray\.from\s*\(/],
];

test('shipped pkjs files contain no ES6 syntax or unpolyfilled built-ins', () => {
  FILES.forEach((file) => {
    const src = fs.readFileSync(file, 'utf8');
    FORBIDDEN.forEach((rule) => assert.equal(src.search(rule[1]), -1, path.basename(file) + ' contains forbidden ' + rule[0]));
  });
});
