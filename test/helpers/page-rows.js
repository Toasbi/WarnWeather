// test/helpers/page-rows.js — reading the settings page's rendered markup the way the page
// tests do: one row's markup, the hint under it, the open screen editor's body and its rows,
// and the open select sheet's title and options.
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

/**
 * The open screen editor's rows, top to bottom: each row's name, then what its dropdown shows
 * (screens-page.js rowHtml: the calendar's rows, a graph's size), joined by ' · ':
 * "Calendar · 2 rows".
 * @param {string} html The editor's body.
 * @returns {Array<string>}
 */
function editorRows(html) {
  return html.split('<div class="se-row" role="listitem"').slice(1).map((row) => {
    const name = /<span class="se-name">([^<]*)<\/span>/.exec(row);
    assert.ok(name, 'each row has its name');
    const out = [name[1]];
    const re = /<button type="button" class="sel-wrap"[^>]*><span>([^<]*)<\/span>/g;
    let m;
    while ((m = re.exec(row))) { out.push(m[1]); }
    return out.join(' · ');
  });
}

/**
 * The open screen editor's Add chips, by what they say (screens-page.js addOffers): a row each,
 * a status bar by its name, New status bar, and with several graphs a graph each by its name;
 * " (off)" after a greyed-out one.
 * @param {string} html The editor's body.
 * @returns {Array<string>}
 */
function editorAddChips(html) {
  const at = html.indexOf('<div class="ui-chips se-adds">');
  if (at === -1) { return []; }
  const out = [];
  const re = /<button type="button" class="ui-chip"([^>]*)><svg[\s\S]*?<\/svg>([^<]*)<\/button>/g;
  const row = html.slice(at);
  let m;
  while ((m = re.exec(row))) { out.push(m[2] + (/ disabled(?=\s|$)/.test(m[1]) ? ' (off)' : '')); }
  return out;
}

/**
 * The line under the open screen editor's Add chips: why a graph's chip is greyed out
 * (graph-styles-page.js limitNote).
 * @param {string} html The editor's body.
 * @returns {string} '' for none
 */
function editorAddNote(html) {
  const m = /<div class="ui-d se-limit">([^<]*)<\/div>/.exec(html);
  return m ? m[1] : '';
}

/**
 * One editor row's markup, from its start to the next row's (to the body's end for the last).
 * @param {string} html The editor's body.
 * @param {number} j The row.
 * @returns {string}
 */
function editorRow(html, j) {
  const at = html.indexOf('<div class="se-row" role="listitem" data-j="' + j + '">');
  assert.ok(at !== -1, 'row ' + j + ' drawn');
  const next = html.indexOf('<div class="se-row"', at + 1);
  return html.slice(at, next === -1 ? html.length : next);
}

/**
 * The open select sheet's title.
 * @param {Object} page A bootGeneratedPage handle.
 * @param {string} key The select's key.
 * @returns {string}
 */
function sheetTitle(page, key) {
  const m = new RegExp('id="ssel-ttl-' + key + '"[^>]*>([^<]*)<').exec(page.modal.innerHTML);
  return m ? m[1] : '';
}

/**
 * The open select sheet's options (ones without a picture), a line each: the name, a ✓ on the
 * one picked, then the line under it in brackets, "off: " first on a greyed-out one:
 * "2 rows (off: Too small for the high and low temperatures)".
 * @param {Object} page A bootGeneratedPage handle.
 * @returns {Array<string>}
 */
function sheetOptions(page) {
  const out = [];
  const re = new RegExp('<button type="button" class="ssel-opt[^"]*" role="option" aria-selected="(true|false)"([^>]*)>'
    + '(?:<span class="ssel-opt-txt"><span class="ssel-opt-name">([^<]*)</span><span class="ssel-opt-desc">([^<]*)</span>'
    + '</span>|<span>([^<]*)</span>)', 'g');
  let m;
  while ((m = re.exec(page.modal.innerHTML))) {
    const off = / disabled/.test(m[2]);
    const line = m[4] ? ' (' + (off ? 'off: ' : '') + m[4] + ')' : (off ? ' (off)' : '');
    out.push((m[3] || m[5]) + (m[1] === 'true' ? ' ✓' : '') + line);
  }
  return out;
}

module.exports = { rowOf, hintOf, editorBody, editorRows, editorAddChips, editorAddNote, editorRow, sheetTitle, sheetOptions };
