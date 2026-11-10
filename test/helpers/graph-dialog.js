// test/helpers/graph-dialog.js — the graph dialog as the schema writes it (schema.js graphDialog):
// the dialog's section and its cards, each the items between one subheader and the next, so a
// test reads a card's rows by its title as it read the Forecast pane's sections before they moved
// into the dialog.
'use strict';
const assert = require('node:assert');

/**
 * The graph dialog's section.
 * @param {Object} schema The settings schema.
 * @returns {Object} The sheetOnly section.
 */
function graphDialog(schema) {
  const graphs = schema.tabs.find((t) => t.id === 'graphs');
  const sec = graphs.sections.find((s) => s.sheetOnly && s.sheetId === 'graph');
  assert.ok(sec, 'the Graphs tab has the graph dialog');
  return sec;
}

/**
 * The dialog's cards in order: each subheader with the items under it.
 * @param {Object} schema The settings schema.
 * @returns {Array<{head: Object, items: Array<Object>}>}
 */
function dialogCards(schema) {
  const out = [];
  graphDialog(schema).items.forEach((it) => {
    if (it.type === 'subheader') { out.push({ head: it, items: [] }); return; }
    assert.ok(out.length, 'every item of the dialog sits under a subheader');
    out[out.length - 1].items.push(it);
  });
  return out;
}

/**
 * One card of the dialog by its title.
 * @param {Object} schema The settings schema.
 * @param {string} title The subheader's text ('' for the Graph colors card).
 * @returns {{head: Object, items: Array<Object>}}
 */
function dialogCard(schema, title) {
  const card = dialogCards(schema).find((c) => c.head.text === title);
  assert.ok(card, 'the graph dialog has a "' + title + '" card');
  return card;
}

module.exports = { graphDialog, dialogCards, dialogCard };
