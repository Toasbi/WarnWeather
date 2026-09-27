// test/rainbow-key-test.test.js — the Rainbow (own key) "Test" button
// (settings/rainbow-key-test.js), driven through its registered PConf action against a
// fake DOM + XHR. The webview can't call Rainbow itself, so the button POSTs the key to
// the rainbow-nowcast proxy's key-check mode and reads Rainbow's status out of the
// proxy's {"status": n} envelope; every other proxy answer maps to a proxy verdict that
// must never read as a verdict on the key.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const EP = 'https://proxy.example/functions/v1/rainbow-nowcast';
// The endpoint's root is the nowcast; the key check is its '/key-check' path.
const KEY_CHECK = EP + '/key-check';
const UNAVAILABLE = '✗ Key test isn’t available in this build. You can still save the key.';
const COULDNT_CHECK = '✗ Couldn’t check the key right now — try again later.';
const NOT_A_KEY = '✗ That doesn’t look like a Rainbow key — copy it again from your profile page on developer.rainbow.ai.';
const NO_ANSWER = '✗ Rainbow didn’t answer — try again later.';

/**
 * Register the Rainbow Test action on a fresh PConf over a fake field + result line,
 * with an XHR fake that records its request and only answers when the test tells it to.
 * @returns {{run: Function, field: Object, result: Object, xhrs: Array, api: Object}} Harness.
 */
function harness() {
  const field = { value: '' };
  const result = { textContent: '' };
  const xhrs = [];
  global.PConf = {};
  global.document = {
    querySelector: (sel) => {
      if (sel === 'input[data-k="rainbowApiKey"]') { return field; }
      if (sel === '[data-action-result="rainbowApiKey"]') { return result; }
      return null;
    }
  };
  global.XMLHttpRequest = function () {
    this.headers = [];
    this.open = (method, url) => { this.method = method; this.url = url; };
    this.setRequestHeader = (name, value) => { this.headers.push([name, value]); };
    this.send = function () { this.sendArgs = Array.prototype.slice.call(arguments); };
    xhrs.push(this);
  };
  ['../src/pkjs/settings/key-test.js', '../src/pkjs/settings/rainbow-key-test.js'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const api = require('../src/pkjs/settings/rainbow-key-test.js');
  return { run: global.PConf.actions.testRainbowKey, field, result, xhrs, api };
}

/**
 * Tap Test with a key and answer the one request it sends.
 * @param {number} status The proxy's HTTP status.
 * @param {string} [body] The proxy's response text.
 * @returns {string} The verdict shown.
 */
function verdictFor(status, body) {
  const h = harness();
  h.field.value = 'abc123-key-0123456789';
  h.run();
  assert.equal(h.xhrs.length, 1);
  h.xhrs[0].status = status;
  h.xhrs[0].responseText = body === undefined ? '' : body;
  h.xhrs[0].onload();
  return h.result.textContent;
}

test.beforeEach(() => { global.INJECTED_USERDATA = { rainbowEndpoint: EP }; });

test.afterEach(() => {
  delete global.PConf;
  delete global.document;
  delete global.XMLHttpRequest;
  delete global.INJECTED_USERDATA;
});

test('Test POSTs the trimmed key to the proxy in the body, never in the URL', () => {
  const h = harness();
  h.field.value = ' abc \n';
  h.run();
  assert.equal(h.xhrs.length, 1);
  const xhr = h.xhrs[0];
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, KEY_CHECK, 'the injected endpoint\'s key-check path');
  assert.equal(xhr.url.indexOf('abc'), -1, 'no key in the URL');
  assert.deepEqual(xhr.sendArgs, ['{"key":"abc"}']);
  assert.deepEqual(xhr.headers, [], 'no setRequestHeader: a CORS simple request, no preflight');
  assert.equal(xhr.timeout, 8000);
  assert.equal(h.result.textContent, 'Testing…');
});

test('an envelope status of 2xx reads as a working key', () => {
  assert.equal(verdictFor(200, '{"status":200}'), '✓ Key works.');
});

test('Rainbow\'s own 401 / 403 / 429 read as verdicts on the key', () => {
  assert.match(verdictFor(200, '{"status":401}'), /Rejected \(401\)/);
  assert.match(verdictFor(200, '{"status":403}'), /Refused \(403\)/);
  assert.match(verdictFor(200, '{"status":429}'), /Rate limited \(429\)/);
  assert.equal(verdictFor(200, '{"status":401}'),
    '✗ Rejected (401). The key is invalid — copy it again from your profile page on developer.rainbow.ai.');
  assert.equal(verdictFor(200, '{"status":403}'),
    '✗ Refused (403). Rainbow won’t serve this key right now — check its plan and monthly allowance on developer.rainbow.ai.');
  assert.equal(verdictFor(200, '{"status":429}'),
    '✗ Rate limited (429). The key is valid but over its allowance right now — try again later.');
});

test('any other upstream status falls through to the shared "Unexpected response"', () => {
  assert.equal(verdictFor(200, '{"status":503}'), '✗ Unexpected response (503).');
});

test('a proxy 200 with an unreadable envelope says the key couldn\'t be checked', () => {
  assert.equal(verdictFor(200, 'garbage'), COULDNT_CHECK);
  assert.equal(verdictFor(200, '{}'), COULDNT_CHECK);
  assert.equal(verdictFor(200, ''), COULDNT_CHECK);
  assert.equal(verdictFor(200, '{"status":"401"}'), COULDNT_CHECK, 'a non-number status is not a verdict');
  assert.equal(verdictFor(200, '{"status":0}'), COULDNT_CHECK);
});

test('proxy 400 = not a Rainbow key, proxy 504 = Rainbow didn\'t answer', () => {
  assert.equal(verdictFor(400, '{"error":"bad key"}'), NOT_A_KEY);
  assert.equal(verdictFor(504, ''), NO_ANSWER);
});

test('every other proxy status says the key couldn\'t be checked', () => {
  [502, 404, 405, 500, 413].forEach((status) => {
    assert.equal(verdictFor(status, ''), COULDNT_CHECK, 'proxy ' + status);
  });
});

test('the proxy\'s own 429 (per-IP limit) is NOT "Rate limited": that would blame the key', () => {
  const v = verdictFor(429, '{"error":"too many checks"}');
  assert.equal(v, COULDNT_CHECK);
  assert.doesNotMatch(v, /Rate limited/);
});

test('a network error says Rainbow couldn\'t be reached; a timeout says so too', () => {
  const h = harness();
  h.field.value = 'abc123-key-0123456789';
  h.run();
  h.xhrs[0].onerror();
  assert.equal(h.result.textContent, '✗ Couldn\'t reach Rainbow. Check your connection and try again.');
  h.run();
  h.xhrs[1].ontimeout();
  assert.equal(h.result.textContent, '✗ Timed out reaching Rainbow.');
});

test('with no endpoint in this build, Test says it isn\'t available and sends nothing', () => {
  global.INJECTED_USERDATA = {};
  let h = harness();
  h.field.value = 'abc123-key-0123456789';
  h.run();
  assert.equal(h.result.textContent, UNAVAILABLE);
  assert.equal(h.xhrs.length, 0, 'no XMLHttpRequest constructed');

  delete global.INJECTED_USERDATA;
  h = harness();
  h.field.value = 'abc123-key-0123456789';
  h.run();
  assert.equal(h.result.textContent, UNAVAILABLE);
  assert.equal(h.xhrs.length, 0);

  global.INJECTED_USERDATA = null;   // the page's own default before injection
  h = harness();
  h.field.value = 'abc123-key-0123456789';
  h.run();
  assert.equal(h.result.textContent, UNAVAILABLE);
  assert.equal(h.xhrs.length, 0);
});

test('an empty key asks for one first and sends nothing', () => {
  const h = harness();
  h.field.value = '  \n';
  h.run();
  assert.equal(h.result.textContent, 'Enter your API key above first.');
  assert.equal(h.xhrs.length, 0);
});

test('the endpoint is read when Test is tapped, not when the module loads', () => {
  delete global.INJECTED_USERDATA;
  const h = harness();                       // module required with no userData yet
  global.INJECTED_USERDATA = { rainbowEndpoint: EP };
  h.field.value = 'abc123-key-0123456789';
  h.run();
  assert.equal(h.xhrs.length, 1);
  assert.equal(h.xhrs[0].url, KEY_CHECK);
});

test('a trailing slash on the endpoint never gives \'//key-check\'', () => {
  ['/', '//'].forEach((slash) => {
    global.INJECTED_USERDATA = { rainbowEndpoint: EP + slash };
    const h = harness();
    assert.equal(h.api.buildTestUrl('K'), KEY_CHECK, JSON.stringify(slash));
  });
});

test('the pure halves are exported for the trim lockstep test', () => {
  const h = harness();
  assert.equal(h.api.buildBody(' K '), '{"key":"K"}');
  assert.equal(h.api.buildTestUrl('K'), KEY_CHECK);
  assert.equal(typeof h.api.readStatus, 'function');
  assert.equal(h.api.interpretStatus(-2).message, NOT_A_KEY);
});
