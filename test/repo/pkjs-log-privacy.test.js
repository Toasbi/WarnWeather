// test/repo/pkjs-log-privacy.test.js
// PKJS logs end up in bug reports and pasted issues, and the Pebble app shows them to anyone
// with a developer connection, so they never carry where the user is: no coordinates, no place
// the user typed. A static check over every console call in src/pkjs: the names it prints
// (its strings, comments and regexes left out) hold no position and no typed place. Settings
// blobs are logged through clay-settings.js redactForLog, which hides the typed places
// (api-key-logs.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tokenize } = require('../helpers/es5-lint.js');
const { listFiles } = require('../architecture/source-tree.js');

const ROOT = path.resolve(__dirname, '..', '..');
const PKJS = path.join(ROOT, 'src', 'pkjs');

// A name that holds a position or a place the user typed, alone or as a word of a longer one
// (userLat, latStr, roundedLon, locationOverride, geocodeQuery), so a copy a module rounds or
// renames is caught too; latency, along and isLonger are not.
const PLACE_NAME = new RegExp('^(lat|lon|lng|latitude|longitude|coords|coordinates|location|address|query)(?![a-z])'
  + '|(Lat|Lon|Lng|Latitude|Longitude|Coords|Coordinates|Location|Address|Query)(?![a-z])');

/**
 * @param {Array<{type: string, value: string}>} tokens tokenize's tokens.
 * @param {number} open The index of an opening parenthesis.
 * @returns {number} The index of the parenthesis that closes it, or the last token's.
 */
function closeOf(tokens, open) {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].type !== 'punct') { continue; }
    if (tokens[i].value === '(') { depth += 1; }
    if (tokens[i].value === ')') { depth -= 1; }
    if (depth === 0) { return i; }
  }
  return tokens.length - 1;
}

/**
 * @param {Array<{type: string, value: string}>} args A console call's argument tokens.
 * @returns {boolean} Whether they print a position or a place the user typed (PLACE_NAME).
 */
function printsPlace(args) {
  return args.some((t) => t.type === 'name' && PLACE_NAME.test(t.value));
}

/**
 * @param {string} source A file's text.
 * @returns {string[]} Each console call that prints a place (printsPlace), as its source text.
 */
function placeLogs(source) {
  const tokens = tokenize(source, () => {});
  const found = [];
  tokens.forEach((t, i) => {
    const call = t.type === 'name' && t.value === 'console' && tokens[i + 1] && tokens[i + 1].value === '.'
      && tokens[i + 2] && /^(log|warn|error|info)$/.test(tokens[i + 2].value)
      && tokens[i + 3] && tokens[i + 3].value === '(';
    if (!call) { return; }
    const close = closeOf(tokens, i + 3);
    if (printsPlace(tokens.slice(i + 4, close))) {
      found.push(source.slice(tokens[i + 3].pos, tokens[close].pos + 1).replace(/\s+/g, ' ').slice(0, 120));
    }
  });
  return found;
}

test('the check sees the names a console call prints, not its strings, comments or regexes', () => {
  const prints = (src) => placeLogs(src).length > 0;
  assert.ok(prints('console.log("at " + pos.lat + "," + pos.lon);'));
  assert.ok(prints('console.warn("near " + userLat);'), 'a word of a longer name');
  assert.ok(prints('console.log(latStr, roundedLongitude);'));
  assert.ok(prints('console.log(position.coords);'));
  assert.ok(prints('console.info("for " + request.query);'), 'a typed place');
  assert.ok(prints('console.error(this.location);'));
  assert.ok(prints('console.log(JSON.stringify(locationOverride));'));
  assert.ok(prints('console.log(app.settings.location);'), 'the Manual location setting');
  assert.ok(prints('console.log(f(g(x), latitude));'), 'inside a nested call');
  assert.ok(!prints('console.log("lat: n/a (no fix)");'), 'a string');
  assert.ok(!prints('console.log(n /* lat ) */ + 1);'), 'a comment');
  assert.ok(!prints('console.log(/lat\\)/.test(s) ? 1 : 0);'), 'a regex');
  assert.ok(!prints('console.log(latency + along + isLonger);'), 'names that only start alike');
  assert.ok(!prints('log(lat); console.log("x");'), 'a call that is no console call');
});

test('no console call in src/pkjs prints a position or a place the user typed', () => {
  const offenders = [];
  listFiles(PKJS, { name: /\.js$/, skipDirs: ['vendor', 'node_modules'] })
    .filter((rel) => !rel.endsWith('.generated.js'))
    .forEach((rel) => {
      placeLogs(fs.readFileSync(path.join(PKJS, rel), 'utf8')).forEach((call) => {
        offenders.push('src/pkjs/' + rel + ': console' + call);
      });
    });
  assert.deepEqual(offenders, []);
});
