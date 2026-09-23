// test/key-test.test.js — the shared "Test key" button machinery (settings/key-test.js),
// driven through its registered PConf action against a fake DOM + XHR. The per-provider
// URL/verdict halves are covered in owm-key-test / tomorrowio-key-test.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Register the tomorrow.io Test action on a fresh PConf over a fake field + result line,
 * with an XHR fake that only answers when the test tells it to.
 * @returns {{run: Function, field: Object, result: Object, xhrs: Array}} Harness.
 */
function harness() {
  const field = { value: '' };
  const result = { textContent: '' };
  const xhrs = [];
  global.PConf = {};
  global.document = {
    querySelector: (sel) => {
      if (sel === 'input[data-k="tomorrowioApiKey"]') { return field; }
      if (sel === '[data-action-result="tomorrowioApiKey"]') { return result; }
      return null;
    }
  };
  global.XMLHttpRequest = function () {
    this.open = (method, url) => { this.url = url; };
    this.setRequestHeader = () => {};
    this.send = () => {};
    xhrs.push(this);
  };
  ['../src/pkjs/settings/key-test.js', '../src/pkjs/settings/tomorrowio-key-test.js'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  require('../src/pkjs/settings/tomorrowio-key-test.js');
  return { run: global.PConf.actions.testTomorrowioKey, field, result, xhrs };
}

test.afterEach(() => {
  delete global.PConf;
  delete global.document;
  delete global.XMLHttpRequest;
});

test('a stale timeout from an earlier test does not overwrite the newer verdict', () => {
  const h = harness();
  h.field.value = 'bad-key';
  h.run();                                  // hangs on a flaky connection
  h.field.value = 'good-key';
  h.run();
  assert.equal(h.xhrs.length, 2);
  h.xhrs[1].status = 200;
  h.xhrs[1].onload();
  assert.equal(h.result.textContent, '✓ Key works.');
  h.xhrs[0].ontimeout();                    // the first request's 8 s timer fires late
  assert.equal(h.result.textContent, '✓ Key works.', 'the newer key keeps its verdict');
});

test('a late rejection for the old key does not mark the new key invalid', () => {
  const h = harness();
  h.field.value = 'bad-key';
  h.run();
  h.field.value = 'good-key';
  h.run();
  h.xhrs[1].status = 200;
  h.xhrs[1].onload();
  h.xhrs[0].status = 401;
  h.xhrs[0].onload();
  assert.equal(h.result.textContent, '✓ Key works.');
  h.xhrs[0].onerror();
  assert.equal(h.result.textContent, '✓ Key works.');
});

test('the latest request still reports, whichever order the answers arrive in', () => {
  const h = harness();
  h.field.value = 'good-key';
  h.run();
  h.field.value = 'bad-key';
  h.run();
  h.xhrs[0].status = 200;
  h.xhrs[0].onload();                       // the superseded request answers first ...
  assert.equal(h.result.textContent, 'Testing…', '... and is ignored');
  h.xhrs[1].status = 401;
  h.xhrs[1].onload();
  assert.match(h.result.textContent, /Rejected \(401\)/);
});

test('tapping Test on an emptied field also cancels the result still in flight', () => {
  const h = harness();
  h.field.value = 'some-key';
  h.run();
  h.field.value = '   ';
  h.run();
  assert.equal(h.result.textContent, 'Enter your API key above first.');
  assert.equal(h.xhrs.length, 1, 'no request for an empty key');
  h.xhrs[0].status = 200;
  h.xhrs[0].onload();
  assert.equal(h.result.textContent, 'Enter your API key above first.');
});
