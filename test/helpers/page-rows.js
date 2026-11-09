// test/helpers/page-rows.js — reading the settings page's rendered markup the way the page
// tests do: one row's markup, the hint under it, and the open screen editor's body.
'use strict';
const assert = require('node:assert');

/**
 * The markup of one row, from its opening `<div class="row` to the next row's.
 * @param {string} html Rendered markup.
 * @param {string} needle A string unique to the row (e.g. its data-edit-sheet).
 * @returns {string} The row's markup, '' when absent.
 */
function rowOf(html, needle) {
  const at = html.indexOf(needle);
  if (at === -1) { return ''; }
  const start = html.lastIndexOf('<div class="row', at);
  const next = html.indexOf('<div class="row', at + 1);
  return html.slice(start, next === -1 ? html.length : next);
}

/**
 * The hint of the row holding a needle: a value row's hint or a nav row's summary, dimmed
 * ('hint faint') or not.
 * @param {string} html Rendered markup.
 * @param {string} needle A string unique to the row.
 * @returns {string} The hint's inner markup, '' for none.
 */
function hintOf(html, needle) {
  const m = /<div class="hint[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(rowOf(html, needle));
  return m ? m[1] : '';
}

/**
 * The open screen editor's body.
 * @param {Object} page A bootGeneratedPage handle (test/helpers/page-harness.js).
 * @returns {string} Its markup.
 */
function editorBody(page) {
  const ed = page.editor();
  assert.ok(ed, 'the screen editor is open');
  return ed.querySelector('[data-se-body]').innerHTML;
}

module.exports = { rowOf, hintOf, editorBody };
