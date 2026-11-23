// test/repo/pkjs-log-privacy.test.js
// PKJS logs end up in bug reports and pasted issues, and the Pebble app shows them to anyone
// with a developer connection, so they never carry where the user is: no coordinates, no place
// the user typed. A static check over every console call in src/pkjs: what it prints, its string
// literals left out, names no coordinate and no typed place. Settings blobs are logged through
// clay-settings.js redactForLog, which hides the typed places (api-key-logs.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');

/** The names a console call must not print: a position, or a place the user typed. */
const PLACE_NAMES = /(^|[^A-Za-z0-9_$])(lat|lon|lng|latitude|longitude|coords|coordinates)\b|\.query\b|\bthis\.location\b/;

/**
 * @param {string} dir A directory.
 * @returns {string[]} Every .js file under it, generated and vendored files left out.
 */
function sources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor' && entry.name !== 'node_modules') { out.push(...sources(full)); }
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.generated.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {string} text Source text from an opening parenthesis on.
 * @returns {string} The call's arguments up to its closing parenthesis, string literals emptied.
 */
function argumentsOf(text) {
  let depth = 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { j += text[j] === '\\' ? 2 : 1; }
      out += c + c;
      i = j;
      continue;
    }
    if (c === '(') { depth += 1; } else if (c === ')') { depth -= 1; }
    out += c;
    if (depth === 0) { return out; }
  }
  return out;
}

/**
 * @param {string} source A file's text.
 * @returns {string[]} Each console call's arguments (argumentsOf) that name a place.
 */
function placeLogs(source) {
  const found = [];
  const call = /console\.(log|warn|error|info)\s*\(/g;
  let match;
  while ((match = call.exec(source)) !== null) {
    const args = argumentsOf(source.slice(match.index + match[0].length - 1));
    if (PLACE_NAMES.test(args)) { found.push(args.replace(/\s+/g, ' ').slice(0, 120)); }
  }
  return found;
}

test('no console call in src/pkjs prints a position or a place the user typed', () => {
  const offenders = [];
  sources(path.join(ROOT, 'src', 'pkjs')).forEach((file) => {
    placeLogs(fs.readFileSync(file, 'utf8')).forEach((args) => {
      offenders.push(path.relative(ROOT, file) + ': console(' + args + ')');
    });
  });
  assert.deepEqual(offenders, []);
});

test('the check sees a coordinate in a call, and only outside its words', () => {
  assert.equal(placeLogs("console.log('FOUND LOCATION: lat= ' + lat + ' lon= ' + lon);").length, 1);
  assert.equal(placeLogs("console.log('fix: ' + cachedFix.lat);").length, 1);
  assert.equal(placeLogs("console.log('Query ' + locationOverride.query);").length, 1);
  assert.equal(placeLogs("console.log('override: ' + JSON.stringify(this.location));").length, 1);
  assert.equal(placeLogs("console.warn(\n  'at',\n  pos.latitude\n);").length, 1, 'over several lines');
  assert.equal(placeLogs("console.log('Reusing the cached GPS fix: lat and lon kept.');").length, 0, 'words are not values');
  assert.equal(placeLogs("console.log('Using the cached GPS coordinates (' + count + ').');").length, 0);
});
