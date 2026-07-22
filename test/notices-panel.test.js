'use strict';
var test = require('node:test');
var assert = require('node:assert');

var panel = require('../src/pkjs/settings/notices-panel.js');

test('empty list renders nothing', function () {
  assert.strictEqual(panel.renderNoticesPanelHtml([]), '');
  assert.strictEqual(panel.renderNoticesPanelHtml(null), '');
});

test('renders error + info rows with type class and the Understood button', function () {
  var html = panel.renderNoticesPanelHtml([
    { key: 'auth', type: 'error', html: '<b>OWM</b> rejected', since: 1 },
    { key: 'ratelimit', type: 'info', html: 'rate limited', since: 2 }
  ]);
  assert.ok(html.indexOf('notice-item error') !== -1);
  assert.ok(html.indexOf('notice-item info') !== -1);
  assert.ok(html.indexOf('<b>OWM</b> rejected') !== -1);      // html body passed through
  assert.ok(html.indexOf('data-k="fetchNoticeAck"') !== -1);  // Understood button
  assert.ok(html.indexOf('data-toggle="1"') !== -1);
});
