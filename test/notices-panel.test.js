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

// The panel's info item and the settings page's staticText info box are one look, in
// the page's info amber: both read shell.html's --info-tint / --info-rule, so a colour
// change (or the light theme's flip) reaches both. The error item keeps its own red.
test('the info item shares the info box\'s amber variables; the error item keeps its red', function () {
  var fs = require('fs');
  var path = require('path');
  var css = panel.NOTICE_CSS;
  var info = /\.notice-item\.info\{([^}]*)\}/.exec(css);
  var error = /\.notice-item\.error\{([^}]*)\}/.exec(css);
  assert.ok(info && error, 'the panel styles both item types');
  assert.ok(info[1].indexOf('background:var(--info-tint)') !== -1, 'info fill is the shared tint');
  assert.ok(info[1].indexOf('border-left:3px solid var(--info-rule)') !== -1, 'info rule is the shared rule');
  assert.ok(error[1].indexOf('border-left:3px solid #FF6A52') !== -1, 'the error rule stays red');
  assert.ok(error[1].indexOf('background:rgba(255,106,82,0.12)') !== -1, 'and so does its fill');
  var shell = fs.readFileSync(path.join(__dirname, '..', 'src', 'pkjs', 'config-ui', 'lib', 'shell.html'), 'utf8');
  var box = /\.static\.info \.info-box \{([^}]*)\}/.exec(shell);
  assert.ok(box, 'shell.html styles the info box');
  assert.ok(box[1].indexOf('var(--info-tint)') !== -1 && box[1].indexOf('var(--info-rule)') !== -1,
    'the info box reads the same two variables');
  ['--info-tint:', '--info-rule:'].forEach(function (v) {
    assert.equal(shell.split(v).length - 1, 2, v + ' is defined once per theme (body, body.light)');
  });
});
