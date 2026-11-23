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
  assert.ok(html.indexOf('<button type="button" class="txt-act-btn notice-ack"') !== -1,
    'the page\'s neutral button (shell.html .txt-act-btn)');
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
test('the card is an error note while any notice is an error, else an info note', function (t) {
  // A display resolver: fn(S, env, args), reading the page's userData itself.
  t.after(function () { delete global.INJECTED_USERDATA; });
  var lookOf = function (userData) {
    global.INJECTED_USERDATA = userData;
    return panel.noticesCardStyle({}, {}, {});
  };
  var list = function (types) {
    return { notices: JSON.stringify(types.map(function (ty) { return { type: ty, html: 'x', since: 1 }; })) };
  };
  assert.strictEqual(lookOf(list(['info', 'error'])), 'error');
  assert.strictEqual(lookOf(list(['error'])), 'error');
  assert.strictEqual(lookOf(list(['info'])), 'info');
  assert.strictEqual(lookOf({ notices: 'not json' }), 'info');
  assert.strictEqual(lookOf(list(['error'])), 'error', 'a list parsed before is read again when the text changes');
  delete global.INJECTED_USERDATA;
  assert.strictEqual(panel.noticesCardStyle({}, {}, {}), 'info', 'no userData: no notices');
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
  assert.ok(css.indexOf('.notice-item+.notice-item{border-top:1px solid var(--note-line-soft)') !== -1,
    'the line between notices is the note\'s');
  assert.ok(css.indexOf('.card.error .notice-item.info{border-left:3px solid var(--info-rule)') !== -1,
    'in an error note, an info notice keeps the info amber\'s rule');
  assert.strictEqual(css.indexOf('background'), -1, 'no box');
  assert.strictEqual(panel.NOTICE_CSS.indexOf('var(--ctl)'), -1, 'Understood\'s look is the shell\'s, not copied');
  var shell = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'pkjs', 'config-ui', 'lib', 'shell.html'), 'utf8');
  ['--info-tint:', '--info-rule:', '--info-line:', '--info-line-soft:',
    '--err-tint:', '--err-rule:', '--err-line:', '--err-line-soft:'].forEach(function (v) {
    assert.equal(shell.split(v).length - 1, 2, v + ' is defined once per theme (body, body.light)');
  });
  // Each look sets the note's colours, which one rule set draws the card with.
  assert.match(shell, /\.card\.info \{ --note: var\(--info-rule\); --note-tint: var\(--info-tint\); --note-line: var\(--info-line\); --note-line-soft: var\(--info-line-soft\); \}/);
  assert.match(shell, /\.card\.error \{ --note: var\(--err-rule\); --note-tint: var\(--err-tint\); --note-line: var\(--err-line\); --note-line-soft: var\(--err-line-soft\); \}/);
  assert.match(shell, /\.card\.info, \.card\.error \{ background: linear-gradient\(var\(--note-tint\), var\(--note-tint\)\), var\(--card\); border-color: var\(--note-line\); \}/);
  assert.match(shell, /\.card\.info \.cardHdr \.ttl, \.card\.error \.cardHdr \.ttl \{ color: var\(--note\); \}/);
});
