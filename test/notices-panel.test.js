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

test('buildNoticesPanel hides the panel once acknowledged this session', function () {
  var html = panel.buildNoticesPanel(
    { fetchNoticeAck: true },
    { notices: JSON.stringify([{ type: 'error', html: 'x', since: 1 }]) }
  );
  assert.strictEqual(html, '');
});

test('buildNoticesPanel renders the parsed notice list when not acknowledged', function () {
  var html = panel.buildNoticesPanel(
    {},
    { notices: JSON.stringify([{ type: 'info', html: 'hi', since: 1 }]) }
  );
  assert.ok(html.indexOf('notice-item info') !== -1);
  assert.ok(html.indexOf('hi') !== -1);
});

test('buildNoticesPanel returns empty string for an empty, absent, or malformed notice list', function () {
  assert.strictEqual(panel.buildNoticesPanel({}, { notices: '[]' }), '');
  assert.strictEqual(panel.buildNoticesPanel({}, {}), '');
  assert.strictEqual(panel.buildNoticesPanel({}, { notices: 'not json' }), '');
});
