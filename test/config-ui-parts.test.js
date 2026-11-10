'use strict';
// test/config-ui-parts.test.js — one copy of each of the settings page's shared parts. The
// markup of the red arrow, the fold ▸/▾, Delete, the Undo after it, a list's New row, a chip, a
// dropdown, an Edit button, the pencil, the name field and its OK, a note, the line icons, a
// full-screen view's header and a popup's header lives in config-ui/lib/ui.js alone, and every
// other page file draws them through it (the owner's ask, 2026-11-09: no copies of a part in the
// pages, the part in the engine). A file that writes one out by hand fails here, by file and part. Only string
// literals count: a comment may name a part.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tokenize } = require('./helpers/es5-lint.js');

const ROOT = path.resolve(__dirname, '..');
const PKJS = path.join(ROOT, 'src', 'pkjs');
const UI = path.join(PKJS, 'config-ui', 'lib', 'ui.js');
const SHELL = path.join(PKJS, 'config-ui', 'lib', 'shell.html');

// Each part's markup, and the ui.js builder that draws it.
const PARTS = [
  [/class="chev(?![\w-])/, 'the red arrow or the fold ▸/▾: navArrow, foldChev'],
  [/&#8250;|&#9656;|&#9662;|[▸▾]/, 'the red arrow or the fold ▸/▾: navArrow, foldChev'],
  [/class="ui-del"/, 'Delete: deleteButton'],
  [/class="ui-(?:toast|undo)"|>Undo</, 'the Undo after a delete: undoToast'],
  [/class="ui-row ui-new"/, 'a list\'s New row: newRow'],
  [/class="ui-chip(?![\w-])/, 'a chip: chip'],
  [/class="sel-wrap"/, 'a dropdown: dropdown'],
  [/class="thr-btn"/, 'an Edit button: editButton'],
  [/class="ui-pen"|aria-label="Rename /, 'the pencil: penButton'],
  [/class="ui-rn-in"|>OK<\/button>/, 'the name field and its OK: renameField'],
  [/class="ui-note"/, 'a note: note'],
  [/class="ui-ic"/, 'a line icon: icon'],
  [/class="dlg-(?:hdr|x|done|kick|ttl)/, 'a full-screen view\'s header: header'],
  [/class="ui-pop-(?:hdr|x)"/, 'a popup\'s header: popupHeader']
];

/**
 * Every hand-written page and watch-side file under src/pkjs (the generated ones, the tests and
 * the dev config left out, as config-es5.test.js walks it).
 * @param {string} dir Where to start.
 * @returns {string[]} Paths.
 */
function walk(dir) {
  let out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'test' && ent.name !== 'tests') { out = out.concat(walk(full)); }
      return;
    }
    if (!ent.name.endsWith('.js') || ent.name.endsWith('.test.js') || ent.name.endsWith('.generated.js')
      || ent.name === 'dev-config.js') { return; }
    out.push(full);
  });
  return out;
}

/**
 * A file's string literals, as written (quotes and escapes kept).
 * @param {string} file Path.
 * @returns {string[]}
 */
function strings(file) {
  return tokenize(fs.readFileSync(file, 'utf8'), () => {}).filter((t) => t.type === 'str').map((t) => t.value);
}

/**
 * The parts a piece of source writes out, by name.
 * @param {string[]} texts Its strings.
 * @returns {string[]}
 */
function partsIn(texts) {
  return PARTS.filter(([re]) => texts.some((s) => re.test(s))).map(([, name]) => name);
}

test('only ui.js writes the shared parts out; every other file draws them through it', () => {
  const files = walk(PKJS).filter((f) => f !== UI);
  assert.ok(files.length > 50, 'premise: the walk finds the page and watch files');
  const copies = [];
  files.forEach((f) => {
    partsIn(strings(f)).forEach((part) => copies.push(path.relative(ROOT, f) + ': ' + part));
  });
  // The page's skeleton too: its markup, without its styles and comments.
  const shell = fs.readFileSync(SHELL, 'utf8').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  partsIn([shell]).forEach((part) => copies.push('shell.html: ' + part));
  assert.deepEqual(copies, [], 'draw these with lib/ui.js instead');
});

test('the guard is live: ui.js itself writes every part it looks for', () => {
  const own = strings(UI);
  PARTS.forEach(([re, name]) => {
    assert.ok(own.some((s) => re.test(s)), name);
  });
});

test('a page\'s own styles leave the page-wide rules alone: .sr-only is shell.html\'s', () => {
  const restyled = walk(PKJS).filter((f) => strings(f).some((s) => /\.sr-only\s*\{/.test(s)))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(restyled, []);
  assert.match(fs.readFileSync(SHELL, 'utf8'), /\.sr-only \{/, 'premise: the page defines it once');
});
