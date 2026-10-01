// test/key-test.test.js — the shared "Test key" button machinery (settings/key-test.js),
// driven through its registered PConf action against a fake DOM + XHR. The per-provider
// URL/verdict halves are covered in owm-key-test / tomorrowio-key-test.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Register the tomorrow.io Test action on a fresh PConf over a fake field + result line,
 * with an XHR fake that only answers when the test tells it to.
 * @returns {{run: Function, field: Object, result: Object, rerender: Function, xhrs: Array}}
 *   Harness; `result` is the result line currently on the page, and rerender() replaces
 *   it with a fresh, empty one (a page re-render) and returns the detached old one.
 */
function harness() {
  const field = { value: '' };
  const dom = { result: { textContent: '' } };
  const xhrs = [];
  global.PConf = {};
  global.document = {
    querySelector: (sel) => {
      if (sel === 'input[data-k="tomorrowioApiKey"]') { return field; }
      if (sel === '[data-action-result="tomorrowioApiKey"]') { return dom.result; }
      return null;
    }
  };
  global.XMLHttpRequest = function () {
    this.open = (method, url) => { this.method = method; this.url = url; };
    this.setRequestHeader = () => {};
    this.send = function () { this.sendArgs = Array.prototype.slice.call(arguments); };
    xhrs.push(this);
  };
  ['../src/pkjs/settings/key-test.js', '../src/pkjs/settings/tomorrowio-key-test.js'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  require('../src/pkjs/settings/tomorrowio-key-test.js');
  return {
    run: global.PConf.actions.testTomorrowioKey, field, xhrs,
    get result() { return dom.result; },
    rerender() { const old = dom.result; dom.result = { textContent: '' }; return old; }
  };
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

test('a verdict that arrives after a page re-render shows on the re-rendered line', () => {
  const h = harness();
  h.field.value = 'good-key';
  h.run();
  const detached = h.rerender();            // e.g. a toggle flipped on the same tab mid-request
  h.xhrs[0].status = 200;
  h.xhrs[0].onload();
  assert.equal(h.result.textContent, '✓ Key works.', 'the line the user can see gets the verdict');
  assert.equal(detached.textContent, 'Testing…', 'not the node the re-render threw away');
});

test('with no result line on the page any more, a late verdict does not throw', () => {
  const h = harness();
  h.field.value = 'good-key';
  h.run();
  const detached = h.rerender();
  global.document.querySelector = () => null;   // another tab is showing
  h.xhrs[0].ontimeout();
  assert.match(detached.textContent, /Timed out/);
});

test('a plain key test (tomorrow.io) still opens a GET and sends no body', () => {
  const h = harness();
  h.field.value = 'some-key';
  h.run();
  assert.equal(h.xhrs.length, 1);
  assert.equal(h.xhrs[0].method, 'GET');
  assert.deepEqual(h.xhrs[0].sendArgs, [], 'send() is called with no argument at all');
  assert.match(h.xhrs[0].url, /^https:\/\/api\.tomorrow\.io\//);
});

/**
 * Register a key test built straight from makeKeyTest on a fresh PConf over a fake
 * field + result line, counting every XMLHttpRequest constructed.
 * @param {Object} config makeKeyTest config (action 'testFake', dataKey 'fakeKey' are filled in).
 * @param {{throwOnOpen: boolean}} [opts] Make every XHR's open() throw.
 * @returns {{run: Function, field: Object, result: Object, xhrs: Array}} Harness.
 */
function customHarness(config, opts) {
  const field = { value: '' };
  const result = { textContent: '' };
  const xhrs = [];
  global.PConf = {};
  global.document = {
    querySelector: (sel) => {
      if (sel === 'input[data-k="fakeKey"]') { return field; }
      if (sel === '[data-action-result="fakeKey"]') { return result; }
      return null;
    }
  };
  global.XMLHttpRequest = function () {
    this.open = (method, url) => {
      if (opts && opts.throwOnOpen && opts.throwOnOpen()) { throw new Error('SyntaxError: bad URL'); }
      this.method = method; this.url = url;
    };
    this.setRequestHeader = () => {};
    this.send = () => {};
    xhrs.push(this);
  };
  delete require.cache[require.resolve('../src/pkjs/settings/key-test.js')];
  const keyTest = require('../src/pkjs/settings/key-test.js');
  keyTest.makeKeyTest(Object.assign({ action: 'testFake', dataKey: 'fakeKey', host: 'Fake' }, config));
  return { run: global.PConf.actions.testFake, field, result, xhrs };
}

test('a test URL of \'\' shows the unavailable message and builds no request', () => {
  const h = customHarness({
    buildTestUrl: () => '',
    unavailableMessage: '✗ Key test isn’t available in this build. You can still save the key.'
  });
  h.field.value = 'some-key';
  h.run();
  assert.equal(h.result.textContent, '✗ Key test isn’t available in this build. You can still save the key.');
  assert.equal(h.xhrs.length, 0, 'no XMLHttpRequest constructed');

  const plain = customHarness({ buildTestUrl: () => '' });
  plain.field.value = 'some-key';
  plain.run();
  assert.equal(plain.result.textContent, '✗ Key test isn’t available in this build.', 'the shared fallback text');
  assert.equal(plain.xhrs.length, 0);
});

test('an open() that throws reports "Couldn\'t reach" instead of hanging on Testing…', () => {
  let throwNext = false;
  const h = customHarness({ buildTestUrl: () => 'https://fake.example/check' },
    { throwOnOpen: () => throwNext });
  h.field.value = 'first-key';
  h.run();                                   // a normal request, still in flight
  assert.equal(h.result.textContent, 'Testing…');
  throwNext = true;
  h.field.value = 'second-key';
  h.run();                                   // this tap's open() throws
  assert.equal(h.result.textContent, '✗ Couldn\'t reach Fake. Check your connection and try again.');
  // The stale-ticket rule still holds: the first request's late answer is ignored.
  h.xhrs[0].status = 200;
  h.xhrs[0].onload();
  assert.equal(h.result.textContent, '✗ Couldn\'t reach Fake. Check your connection and try again.');
  // ...and a later tap still gets its own verdict.
  throwNext = false;
  h.run();
  const last = h.xhrs[h.xhrs.length - 1];
  last.status = 200;
  last.onload();
  assert.equal(h.result.textContent, '✓ Key works.');
});

test('the latest test\'s answer reaches the page\'s key status, with the key it tested', () => {
  const h = harness();
  const recorded = [];
  global.PConf.keyStatus = { recordTest: (field, key, status) => recorded.push([field, key, status]) };
  h.field.value = 'old-key';
  h.run();
  h.field.value = 'new-key';
  h.run();
  h.xhrs[1].status = 401;
  h.xhrs[1].onload();
  h.xhrs[0].status = 200;
  h.xhrs[0].onload();                       // stale: dropped like its verdict line
  h.run();
  h.xhrs[2].ontimeout();                    // no answer: nothing to hand over
  assert.deepEqual(recorded, [['tomorrowioApiKey', 'new-key', 401]]);
});

test('no key status on the page (a Node caller, an old bundle): the verdict line works as before', () => {
  const h = harness();
  h.field.value = 'some-key';
  h.run();
  h.xhrs[0].status = 200;
  h.xhrs[0].onload();
  assert.equal(h.result.textContent, '✓ Key works.');
});
