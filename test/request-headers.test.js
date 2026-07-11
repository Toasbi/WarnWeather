// test/request-headers.test.js
// The shared XHR wrapper accepts an optional 5th `headers` param (used by the
// Met.no modules for api.met.no's identification requirement). A header the
// runtime forbids (setRequestHeader throws, e.g. User-Agent) must not abort
// the request — the remaining headers still identify us.
const test = require('node:test');
const assert = require('node:assert/strict');

function MockXhr() {
  this.headers = {};
  this.opened = null;
  this.sent = false;
  this.setAfterOpen = null;
  MockXhr.last = this;
}
MockXhr.throwOn = {};
MockXhr.prototype.open = function(type, url) { this.opened = { type: type, url: url }; };
MockXhr.prototype.setRequestHeader = function(name, value) {
  if (MockXhr.throwOn[name]) { throw new Error('Refused to set unsafe header "' + name + '"'); }
  this.setAfterOpen = Boolean(this.opened);
  this.headers[name] = value;
};
MockXhr.prototype.send = function() { this.sent = true; };

global.XMLHttpRequest = MockXhr;
const WeatherProvider = require('../src/pkjs/weather/provider.js');

test('request sets each header after open() and still sends', () => {
  MockXhr.throwOn = {};
  WeatherProvider.request('https://x.test/', 'GET', () => {}, () => {},
    { 'User-Agent': 'ua-value', 'Origin': 'origin-value' });
  const xhr = MockXhr.last;
  assert.deepEqual(xhr.headers, { 'User-Agent': 'ua-value', 'Origin': 'origin-value' });
  assert.equal(xhr.setAfterOpen, true, 'headers must be set after open()');
  assert.equal(xhr.sent, true);
});

test('a throwing setRequestHeader skips that header but keeps the rest and sends', () => {
  MockXhr.throwOn = { 'User-Agent': true };
  WeatherProvider.request('https://x.test/', 'GET', () => {}, () => {},
    { 'User-Agent': 'ua-value', 'Origin': 'origin-value' });
  const xhr = MockXhr.last;
  assert.deepEqual(xhr.headers, { 'Origin': 'origin-value' });
  assert.equal(xhr.sent, true, 'request must still go out');
});

test('omitting the headers param sets no headers (existing callers unchanged)', () => {
  MockXhr.throwOn = {};
  WeatherProvider.request('https://x.test/', 'GET', () => {}, () => {});
  const xhr = MockXhr.last;
  assert.deepEqual(xhr.headers, {});
  assert.equal(xhr.sent, true);
});

test('onload success routing still works with headers present', () => {
  MockXhr.throwOn = {};
  let got = null;
  WeatherProvider.request('https://x.test/', 'GET', (text) => { got = text; }, () => {},
    { 'Origin': 'origin-value' });
  const xhr = MockXhr.last;
  xhr.status = 200;
  xhr.responseText = 'body';
  xhr.onload();
  assert.equal(got, 'body');
});
