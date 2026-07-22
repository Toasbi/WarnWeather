'use strict';
var test = require('node:test');
var assert = require('node:assert');

var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; },
  clear: function () { store = {}; }
};

var sent = [];
global.Pebble = {
  sendAppMessage: function (payload, ack /*, nack */) { sent.push(payload); if (ack) { ack(); } }
};

var outbox = require('../src/pkjs/outbox.js');

test('partial {NOTICE_TEXT} payload sends only the notice category', function () {
  store = {}; sent = [];
  outbox.sendWeather({ NOTICE_TEXT: 'API key error' });
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(Object.keys(sent[0]), ['NOTICE_TEXT']);
  assert.strictEqual(sent[0].NOTICE_TEXT, 'API key error');
});

test('unchanged notice is deduped; clearNoticeCache forces a resend', function () {
  store = {}; sent = [];
  outbox.sendWeather({ NOTICE_TEXT: 'API key error' });   // sent + cached
  outbox.sendWeather({ NOTICE_TEXT: 'API key error' });   // deduped
  assert.strictEqual(sent.length, 1);
  outbox.clearNoticeCache();
  outbox.sendWeather({ NOTICE_TEXT: 'API key error' });   // cache cleared → resend
  assert.strictEqual(sent.length, 2);
});
