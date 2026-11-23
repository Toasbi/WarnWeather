'use strict';
// The card of new features to try on the settings page (page/notices/feature-tips-panel.js):
// what it draws from the tips the phone hands over, what its buttons do, and when it is gone.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
require('../../../src/pkjs/config-ui/lib/engine.js');
const panel = require('../../../src/pkjs/page/notices/feature-tips-panel.js');
const featureTips = require('../../../src/pkjs/notices/domain/feature-tips.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');

const TIPS = [
  { id: 'one', title: 'Days <b>left</b> & more', html: 'Set the <a href=\'https://example.com\'>thing</a>.', sheet: 'bar-top', tab: null },
  { id: 'two', title: 'A black page', html: 'On the Setup tab.', sheet: null, tab: 'setup' }
];

test('no tips, no card', () => {
  assert.equal(panel.renderFeatureTipsHtml([]), '');
  assert.equal(panel.renderFeatureTipsHtml(null), '');
  assert.equal(panel.buildFeatureTips({}, {}), '');
  assert.equal(panel.buildFeatureTips({}, { featureTips: null }), '');
  assert.equal(panel.buildFeatureTips({}, { featureTips: 'not a list' }), '');
  assert.equal(panel.buildFeatureTips({}, null), '');
});

test('the card names each tip, says how, and ends on Got it', () => {
  const html = panel.renderFeatureTipsHtml(TIPS);
  assert.match(html, /^<div class="tips"><div class="tips-hdr">New in this update<\/div>/);
  assert.equal((html.match(/<div class="tip">/g) || []).length, 2);
  // A title is text: its markup is escaped. The how-to is the phone's own markup, as written.
  assert.ok(html.indexOf('<div class="tip-ttl">Days &lt;b&gt;left&lt;/b&gt; &amp; more</div>') !== -1);
  assert.ok(html.indexOf('<div class="tip-body">Set the <a href=\'https://example.com\'>thing</a>.</div>') !== -1);
  assert.ok(html.indexOf('one') < html.indexOf('A black page'), 'in the order handed over');
  assert.match(html, /<button type="button" class="txt-act-btn tips-ack" data-k="featureTipsAck" data-toggle="1">Got it<\/button><\/div>$/);
});

test('Show me opens the tip\'s dialog or brings its tab to the front, through the engine\'s own paths', () => {
  const html = panel.renderFeatureTipsHtml(TIPS);
  assert.ok(html.indexOf('<button type="button" class="txt-act-btn" data-edit-sheet="bar-top">Show me</button>') !== -1);
  assert.ok(html.indexOf('<button type="button" class="txt-act-btn" data-goto-tab="setup">Show me</button>') !== -1);
  // A tip that names no place has no button, and a name is an attribute value, never markup.
  const bare = panel.renderFeatureTipsHtml([{ id: 'x', title: 'T', html: 'H', sheet: null, tab: null }]);
  assert.equal(bare.indexOf('Show me'), -1);
  const odd = panel.renderFeatureTipsHtml([{ id: 'x', title: 'T', html: 'H', sheet: 'a"><i>', tab: null }]);
  assert.ok(odd.indexOf('data-edit-sheet="a&quot;&gt;&lt;i&gt;"') !== -1);
});

test('Got it hides the card for the session; the flag is one of the page\'s own keys', () => {
  assert.notEqual(panel.buildFeatureTips({}, { featureTips: TIPS }), '');
  assert.notEqual(panel.buildFeatureTips({ featureTipsAck: false }, { featureTips: TIPS }), '');
  assert.equal(panel.buildFeatureTips({ featureTipsAck: true }, { featureTips: TIPS }), '');
  // The card's block and its flag are the Watchface tab's second section, above the pinned watch.
  const wf = schema.tabs.find((tab) => tab.id === 'watchface');
  const section = wf.sections[1];
  assert.equal(section.block, 'featureTips');
  assert.equal(section.beforePin, true);
  assert.deepEqual(section.items, [{ type: 'hidden', messageKey: 'featureTipsAck', defaultValue: false }]);
  assert.equal(wf.sections[0].block, 'noticesPanel', 'the fetch notices stay first');
});

test('the block is registered, and draws the phone\'s tips as they come', () => {
  const block = global.PConf.blocks.get('featureTips');
  assert.equal(typeof block, 'function');
  const forPage = featureTips.forPage(featureTips.pending([], { platform: 'basalt', plugins: true }));
  const html = block({}, { platform: 'basalt' }, { featureTips: forPage });
  forPage.forEach((tip) => {
    assert.ok(html.indexOf(tip.html) !== -1, tip.id + ': its how-to');
    assert.ok(html.indexOf(tip.sheet ? 'data-edit-sheet="' + tip.sheet + '"' : 'data-goto-tab="' + tip.tab + '"') !== -1,
      tip.id + ': its Show me');
  });
  assert.equal(block({ featureTipsAck: true }, { platform: 'basalt' }, { featureTips: forPage }), '');
});

test('the card\'s styles follow the page\'s theme, and its buttons are the page\'s own', () => {
  assert.ok(panel.TIPS_CSS.indexOf('var(--info-tint)') !== -1);
  assert.equal(/#[0-9a-f]{3,6}\b/i.test(panel.TIPS_CSS), false, 'no colour of its own');
  // The buttons take the page's neutral button (shell.html .txt-act-btn), which the shell
  // always carries; the card's sheet only sizes them.
  const shell = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', '..', 'src/pkjs/config-ui/lib/shell.html'), 'utf8');
  assert.match(shell, /\.txt-act-btn \{[^}]*background: var\(--ctl\)/);
  assert.equal(panel.TIPS_CSS.indexOf('var(--ctl)'), -1, 'the look is not copied here');
});
