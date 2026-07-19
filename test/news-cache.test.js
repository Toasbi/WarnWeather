const test = require('node:test');
const assert = require('node:assert/strict');

// news-cache.js resolves localStorage/XMLHttpRequest lazily off the global, so
// the mocks just have to be installed before each call (change-detector pattern).
function withLocalStorage(map) {
  global.localStorage = {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
    },
    setItem: function (k, v) { map[k] = String(v); },
    removeItem: function (k) { delete map[k]; }
  };
  return map;
}

// Captures every XHR the module creates; tests fire onload/onerror by hand.
function withXhr() {
  const created = [];
  global.XMLHttpRequest = function () {
    this.headers = {};
    this.status = 0;
    this.responseText = '';
    this.open = function (method, url) { this.method = method; this.url = url; };
    this.setRequestHeader = function (k, v) { this.headers[k] = v; };
    this.send = function (body) { this.sentBody = body; };
    created.push(this);
  };
  return created;
}

const newsCache = require('../src/pkjs/news-cache.js');
const KEY = require('../src/pkjs/storage-keys.js').NEWS_CACHE_KEY;

const HOUR = newsCache.MAX_AGE_MS;
const NOW = 1000 * HOUR;
const OPTS = { endpoint: 'https://x/functions/v1/news', accountToken: 'tok', version: '1.8.0', nowMs: NOW };

const UNREAD_BODY = '{"items":[{"id":3},{"id":1}],"lastSeenId":1}';
// Same items, watermark at the newest id → nothing unread (the read state).
const READ_BODY = '{"items":[{"id":3},{"id":1}],"lastSeenId":3}';

function envelope(ageMs, body, version) {
  return JSON.stringify({ at: NOW - ageMs, version: version || '1.8.0', body: body });
}

// --- readBody ---

test('readBody: absent, corrupt JSON, and wrong-shape envelopes read as null', () => {
  withLocalStorage({});
  assert.equal(newsCache.readBody(), null);
  withLocalStorage({ [KEY]: 'not json' });
  assert.equal(newsCache.readBody(), null);
  withLocalStorage({ [KEY]: JSON.stringify({ body: 42, at: 'x' }) });
  assert.equal(newsCache.readBody(), null);
});

test('readBody returns the stored response text', () => {
  withLocalStorage({ [KEY]: envelope(0, '{"items":[]}') });
  assert.equal(newsCache.readBody(), '{"items":[]}');
});

// --- seedIfAbsent ---

test('seedIfAbsent without an endpoint sends nothing', () => {
  withLocalStorage({});
  const xhrs = withXhr();
  newsCache.seedIfAbsent({ endpoint: '', accountToken: 'tok', version: '1.8.0', nowMs: NOW });
  assert.equal(xhrs.length, 0);
});

test('seedIfAbsent leaves any usable cache alone, even a stale one', () => {
  withLocalStorage({ [KEY]: envelope(10 * HOUR, UNREAD_BODY) });
  const xhrs = withXhr();
  newsCache.seedIfAbsent(OPTS);
  assert.equal(xhrs.length, 0);
});

test('seedIfAbsent fetches and stores when nothing is cached', () => {
  const map = withLocalStorage({});
  const xhrs = withXhr();
  newsCache.seedIfAbsent(OPTS);
  assert.equal(xhrs.length, 1);
  assert.equal(xhrs[0].method, 'POST');
  assert.equal(xhrs[0].url, OPTS.endpoint);
  assert.deepEqual(JSON.parse(xhrs[0].sentBody),
    { op: 'list', accountToken: 'tok', version: '1.8.0' });
  xhrs[0].status = 200;
  xhrs[0].responseText = '{"items":[{"id":3}],"lastSeenId":1}';
  xhrs[0].onload();
  assert.deepEqual(JSON.parse(map[KEY]),
    { at: NOW, version: '1.8.0', body: '{"items":[{"id":3}],"lastSeenId":1}' });
});

test('seedIfAbsent treats a cache from another app version as absent', () => {
  withLocalStorage({ [KEY]: envelope(0, '{"items":[]}', '1.7.0') });
  const xhrs = withXhr();
  newsCache.seedIfAbsent(OPTS);
  assert.equal(xhrs.length, 1);
});

// --- refreshIfStale ---

test('refreshIfStale without an endpoint sends nothing', () => {
  withLocalStorage({});
  const xhrs = withXhr();
  newsCache.refreshIfStale({ endpoint: '', accountToken: 'tok', version: '1.8.0', nowMs: NOW });
  assert.equal(xhrs.length, 0);
});

test('refreshIfStale with a fresh, fully-read cache sends nothing', () => {
  // Nothing unread → no stale watermark to heal → traffic stays minimal.
  withLocalStorage({ [KEY]: envelope(HOUR - 1, READ_BODY) });
  const xhrs = withXhr();
  newsCache.refreshIfStale(OPTS);
  assert.equal(xhrs.length, 0);
});

test('refreshIfStale refetches a fresh cache that still shows unread', () => {
  // The read-then-close case: opening the popup advanced the server watermark
  // without touching this cache, so the close refetch pulls it and the dot
  // does not reappear on the next open.
  const map = withLocalStorage({ [KEY]: envelope(HOUR - 1, UNREAD_BODY) });
  const xhrs = withXhr();
  newsCache.refreshIfStale(OPTS);
  assert.equal(xhrs.length, 1);
  assert.deepEqual(JSON.parse(xhrs[0].sentBody),
    { op: 'list', accountToken: 'tok', version: '1.8.0' });
  xhrs[0].status = 200;
  xhrs[0].responseText = READ_BODY;
  xhrs[0].onload();
  assert.deepEqual(JSON.parse(map[KEY]),
    { at: NOW, version: '1.8.0', body: READ_BODY });
});

test('refreshIfStale refetches an hour-old cache and stores the response', () => {
  const map = withLocalStorage({ [KEY]: envelope(HOUR + 1, UNREAD_BODY) });
  const xhrs = withXhr();
  newsCache.refreshIfStale(OPTS);
  assert.equal(xhrs.length, 1);
  assert.deepEqual(JSON.parse(xhrs[0].sentBody),
    { op: 'list', accountToken: 'tok', version: '1.8.0' });
  xhrs[0].status = 200;
  xhrs[0].responseText = READ_BODY;
  xhrs[0].onload();
  assert.deepEqual(JSON.parse(map[KEY]),
    { at: NOW, version: '1.8.0', body: READ_BODY });
});

test('refreshIfStale refetches when the cache is missing or from another version', () => {
  withLocalStorage({});
  let xhrs = withXhr();
  newsCache.refreshIfStale(OPTS);
  assert.equal(xhrs.length, 1);
  withLocalStorage({ [KEY]: envelope(0, '{"items":[]}', '1.7.0') });
  xhrs = withXhr();
  newsCache.refreshIfStale(OPTS);
  assert.equal(xhrs.length, 1);
});

test('refreshIfStale keeps the old cache on refetch failures', () => {
  const stale = envelope(HOUR + 1, '{"items":[]}');
  const cases = [
    function (xhr) { xhr.status = 500; xhr.responseText = 'oops'; xhr.onload(); },
    function (xhr) { xhr.onerror(); },
    function (xhr) { xhr.ontimeout(); },
    function (xhr) { xhr.status = 200; xhr.responseText = 'not json'; xhr.onload(); },
    function (xhr) { xhr.status = 200; xhr.responseText = '{"nope":1}'; xhr.onload(); }
  ];
  cases.forEach(function (fire) {
    const map = withLocalStorage({ [KEY]: stale });
    const xhrs = withXhr();
    newsCache.refreshIfStale(OPTS);
    assert.equal(xhrs.length, 1);
    fire(xhrs[0]);
    assert.equal(map[KEY], stale);
  });
});

test('news-cache calls survive a synchronous XHR throw', () => {
  global.XMLHttpRequest = function () {
    this.open = function () { throw new Error('malformed endpoint'); };
  };
  withLocalStorage({});
  assert.doesNotThrow(function () { newsCache.seedIfAbsent(OPTS); });
  withLocalStorage({ [KEY]: envelope(HOUR + 1, UNREAD_BODY) });
  assert.doesNotThrow(function () { newsCache.refreshIfStale(OPTS); });
});
