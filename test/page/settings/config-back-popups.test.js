'use strict';
// The header's popups, Support (support.js) and News (news.js), and the phone's Back
// (src/pkjs/config-ui/lib/back-steps.js): each popup open has a history entry, so Back closes it
// instead of leaving the settings page, and its × steps the history back. Both modules wire
// themselves into the page's header as they load, so this suite gives them a small one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { installHistory, nextTap } = require('../../../src/pkjs/config-ui/test/fake-history.js');

/**
 * An element as the two modules use one: style, children, listeners and the tree calls.
 * @param {string} tag Its tag.
 * @returns {Object}
 */
function node(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(), id: '', className: '', innerHTML: '', title: '', style: {}, children: [],
    parentNode: null, attrs: {},
    setAttribute(n, v) { el.attrs[n] = String(v); },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(el.attrs, n) ? el.attrs[n] : null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type, ev) { (listeners[type] || []).forEach((fn) => fn(ev)); },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    insertBefore(c) { return el.appendChild(c); },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
    querySelector() { return null; }
  };
  return el;
}

const made = [];
const hdr = node('div');
const title = node('h1');
hdr.querySelector = (sel) => (sel === 'h1' ? title : null);
global.document = {
  head: node('head'),
  body: node('body'),
  querySelector: (sel) => (sel === '.hdr' ? hdr : null),
  getElementById: (id) => (id === 'save' ? node('button') : null),
  createElement: (tag) => { const el = node(tag); made.push(el); return el; },
  createTextNode: (text) => ({ text })
};
global.INJECTED_USERDATA = { newsEndpoint: 'https://news.invalid/' };
// The page's window, with a history: back-steps.js keeps its entries there from its first require
// on (the two modules' own).
const phone = installHistory(global.window = {});
global.PConf = {};
require('../../../src/pkjs/page/notices/news.js');
require('../../../src/pkjs/page/settings/support.js');

const pill = (id) => made.find((el) => el.id === id);
const popups = () => document.body.children;
/** A tap on a popup's × (the attribute its click handler looks for). */
const tapX = (popup, attr) => popup.dispatch('click', { target: { closest: (sel) => (sel === '[' + attr + ']' ? {} : null) } });

[['Support', 'bmcHint', 'data-bmc-close'], ['News', 'newsHint', 'data-news-close']].forEach(([name, id, x]) => {
  test(name + ': Back closes the popup, and its × steps the history back', async () => {
    await nextTap();
    pill(id).onclick();
    const popup = popups()[popups().length - 1];
    phone.land();
    assert.equal(popup.style.display, 'flex', 'the popup is up');
    assert.equal(phone.layers, 1, 'with an entry');
    phone.back();
    assert.equal(popup.style.display, 'none', 'Back closed it');
    assert.equal(phone.left, false, 'the settings page stays');
    await nextTap();
    pill(id).onclick();
    phone.land();
    assert.equal(phone.layers, 1);
    tapX(popup, x);
    phone.land();
    assert.equal(popup.style.display, 'none');
    assert.equal(phone.layers, 0, 'the × stepped the history back');
  });
});
