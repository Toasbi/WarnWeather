'use strict';
var test = require('node:test');
var assert = require('node:assert');

var panel = require('../../../src/pkjs/page/notices/notices-panel.js');

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

// The card is the note, in the page's own colours (shell.html .card.error / .card.info): an
// error note while any notice is an error, else an info note. The notices have no box of
// their own and no colour of their own, so the light theme's flip reaches them.
test('the card is an error note while any notice is an error, else an info note', function () {
  var list = function (types) {
    return { notices: JSON.stringify(types.map(function (t) { return { type: t, html: 'x', since: 1 }; })) };
  };
  assert.strictEqual(panel.noticesCardStyle({}, {}, {}, list(['info', 'error'])), 'error');
  assert.strictEqual(panel.noticesCardStyle({}, {}, {}, list(['error'])), 'error');
  assert.strictEqual(panel.noticesCardStyle({}, {}, {}, list(['info'])), 'info');
  assert.strictEqual(panel.noticesCardStyle({}, {}, {}, { notices: 'not json' }), 'info');
  var schema = require('../../../src/pkjs/page/settings/schema.js');
  var section = schema.tabs.filter(function (t) { return t.id === 'watchface'; })[0].sections[0];
  assert.strictEqual(section.block, 'noticesPanel');
  assert.deepStrictEqual(section.styleFrom, { resolver: 'noticesCardStyle' });
});

test('the notices take the note\'s colours and none of their own', function () {
  var fs = require('fs');
  var path = require('path');
  // The notices' rules; the Understood button's come after them.
  var css = panel.NOTICE_CSS.split('.notice-ack')[0];
  assert.strictEqual(/#[0-9a-f]{3,6}\b|rgba?\(/i.test(css), false, 'no colour of its own');
  assert.ok(css.indexOf('var(--err-line-soft)') !== -1 && css.indexOf('var(--info-line-soft)') !== -1,
    'the line between notices is the card\'s');
  assert.strictEqual(css.indexOf('background'), -1, 'no box');
  var shell = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'pkjs', 'config-ui', 'lib', 'shell.html'), 'utf8');
  ['--info-tint:', '--info-rule:', '--info-line:', '--info-line-soft:',
    '--err-tint:', '--err-rule:', '--err-line:', '--err-line-soft:'].forEach(function (v) {
    assert.equal(shell.split(v).length - 1, 2, v + ' is defined once per theme (body, body.light)');
  });
  assert.match(shell, /\.card\.error \{ background: linear-gradient\(var\(--err-tint\), var\(--err-tint\)\), var\(--card\); border-color: var\(--err-line\); \}/);
  assert.match(shell, /\.card\.info \{ background: linear-gradient\(var\(--info-tint\), var\(--info-tint\)\), var\(--card\); border-color: var\(--info-line\); \}/);
});
