// test/helpers/settings-url.js
//
// What a settings-page URL carries. index.js hands Pebble.openURL one data: URL whose
// inline script assigns the schema, the stored values, the env and userData as JavaScript
// literals on one line (config-ui/index.js injectIntoPage). The tests that boot the real
// index.js read here what the page would receive.
const assert = require('node:assert/strict');
const vm = require('node:vm');

const PREFIX = 'data:text/html;charset=utf-8,';

/**
 * Evaluate the injected line of a device data: URL.
 * @param {string} url The URL index.js handed to Pebble.openURL.
 * @returns {Object} The page's injected variables: INJECTED_SCHEMA, INJECTED_CFG,
 *   INJECTED_ENV, INJECTED_USERDATA and INJECTED_RETURN.
 */
function injectedOf(url) {
  assert.equal(url.indexOf(PREFIX), 0, 'device branch gives a data: URL');
  const html = decodeURIComponent(url.slice(PREFIX.length));
  const line = html.split('\n').filter((l) => l.indexOf('INJECTED_SCHEMA=') === 0)[0];
  assert.ok(line, 'the injected snippet is one line');
  const ctx = {};
  vm.runInNewContext(line, ctx);
  return ctx;
}

/**
 * @param {string} url The URL index.js handed to Pebble.openURL.
 * @returns {Object} The page's userData, as plain data (not the vm realm's objects).
 */
function userDataOf(url) {
  return JSON.parse(JSON.stringify(injectedOf(url).INJECTED_USERDATA));
}

module.exports = { injectedOf, userDataOf };
