// src/pkjs/config-ui/test/links.test.js
// lib/links.js: with the Pebble app's permissions preview on, the settings page can follow no link
// to a site the app has not declared, and the app gives the page Pebble.openUrl instead. A tap on a
// link to another site goes through it where the page has it; everywhere else (no Pebble global, an
// older app) the link works as before, and so does every tap that is not on such a link.
const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('../lib/links.js');
const { LIB_PAGE_FILES } = require('../scripts/build-page.js');

/**
 * A tapped element inside (or being) a link with `href`; null href: no link around it.
 * @param {?string} href The link's href attribute.
 * @returns {Object} A fake element with closest().
 */
function tapOn(href) {
  const a = { getAttribute: (k) => (k === 'href' ? href : null) };
  return { closest: (sel) => (sel === 'a[href]' && href !== null ? a : null) };
}

/**
 * A fake click on `target`.
 * @param {Object} target The tapped element.
 * @param {boolean} [handled] Already defaultPrevented by a control.
 * @returns {Object} The event, recording preventDefault.
 */
function click(target, handled) {
  return { target, defaultPrevented: Boolean(handled), prevented: 0, preventDefault() { this.prevented++; } };
}

test('externalHref: an absolute http(s) link only', () => {
  assert.equal(links.externalHref(tapOn('https://github.com/Toasbi/WarnWeather/issues')),
    'https://github.com/Toasbi/WarnWeather/issues');
  assert.equal(links.externalHref(tapOn('HTTP://example.org')), 'HTTP://example.org');
  ['#', '#news', 'javascript:void(0)', 'data:text/html,x', '/relative', '', 'pebblejs://close#'].forEach((href) => {
    assert.equal(links.externalHref(tapOn(href)), null, href);
  });
  assert.equal(links.externalHref(tapOn(null)), null, 'no link around the tap');
  assert.equal(links.externalHref(null), null);
  assert.equal(links.externalHref({}), null, 'an old WebView without closest()');
});

test('with Pebble.openUrl a link to another site opens through the app, not in the page', () => {
  const opened = [];
  const pebble = { openUrl: (u) => { opened.push(u); return Promise.resolve(true); } };
  const e = click(tapOn('https://buymeacoffee.com/x'));
  assert.equal(links.openThroughApp(e, pebble), true);
  assert.deepEqual(opened, ['https://buymeacoffee.com/x']);
  assert.equal(e.prevented, 1, 'the page does not follow it');
});

test('without Pebble.openUrl, or off a link, or on a handled click, the tap is left alone', () => {
  const opened = [];
  const pebble = { openUrl: (u) => { opened.push(u); } };
  const cases = [
    [click(tapOn('https://a.b/c')), null, 'no Pebble global'],
    [click(tapOn('https://a.b/c')), {}, 'an app without openUrl'],
    [click(tapOn('#')), pebble, 'an in-page link'],
    [click(tapOn(null)), pebble, 'not a link'],
    [click(tapOn('https://a.b/c'), true), pebble, 'a control handled it']
  ];
  cases.forEach(([e, p, why]) => {
    assert.equal(links.openThroughApp(e, p), false, why);
    assert.equal(e.prevented, 0, why);
  });
  assert.deepEqual(opened, []);
});

test('a throwing or rejecting openUrl still keeps the page where it is', async () => {
  const e1 = click(tapOn('https://a.b/c'));
  assert.equal(links.openThroughApp(e1, { openUrl: () => { throw new Error('x'); } }), true);
  assert.equal(e1.prevented, 1);
  const e2 = click(tapOn('https://a.b/c'));
  assert.equal(links.openThroughApp(e2, { openUrl: () => Promise.reject(new Error('x')) }), true);
  await new Promise((r) => setImmediate(r));
});

test('wireLinks hooks the document\'s clicks and reads the Pebble global per tap', () => {
  let handler = null;
  const doc = { addEventListener: (type, fn) => { if (type === 'click') { handler = fn; } } };
  const win = {};
  links.wireLinks(doc, win);
  assert.equal(typeof handler, 'function');
  const e = click(tapOn('https://a.b/c'));
  handler(e);
  assert.equal(e.prevented, 0, 'no Pebble global yet');
  const opened = [];
  win.Pebble = { openUrl: (u) => opened.push(u) };
  const e2 = click(tapOn('https://a.b/c'));
  handler(e2);
  assert.deepEqual(opened, ['https://a.b/c'], 'the global the app hands the page later counts');
});

test('the page loads links.js before engine.js, whose boot wires it', () => {
  assert.ok(LIB_PAGE_FILES.indexOf('links.js') !== -1);
  assert.ok(LIB_PAGE_FILES.indexOf('links.js') < LIB_PAGE_FILES.indexOf('engine.js'));
  const engine = require('fs').readFileSync(require('path').join(__dirname, '../lib/engine.js'), 'utf8');
  assert.match(engine, /PConf\.links\.wireLinks\(document/);
});
