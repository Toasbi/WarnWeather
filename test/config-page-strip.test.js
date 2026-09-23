// test/config-page-strip.test.js
// build-page.js drops whole-line comments and indentation from every JS file it
// concatenates into the settings page (the page travels as one data: URL that
// Android's WebView refuses past 2 MiB). That is only safe if the program is
// untouched, so this proves it for every file that ships: the stripped source must
// tokenize to the same tokens, with a line break between the same pairs of tokens
// (automatic semicolon insertion depends on those), as the original.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const build = require('../src/pkjs/config-ui/scripts/build-page.js');
const APP_FILES = require('../scripts/build-config-page.js').APP_FILES;
const { tokenize } = require('./helpers/es5-lint.js');

const LIB = path.join(__dirname, '..', 'src', 'pkjs', 'config-ui', 'lib');

/**
 * Tokens of a source, each tagged with whether a line break precedes it.
 * @param {string} src JavaScript source.
 * @returns {string[]} One 'type value' entry per token, prefixed '\n' after a break.
 */
function tokenLines(src) {
  const problems = [];
  const tokens = tokenize(src, (pos, msg) => problems.push(msg));
  let prevEnd = 0;
  return tokens.map((tok, k) => {
    // Before the first token a break means nothing: the builder puts each file
    // on a fresh line behind its marker comment anyway.
    const brk = k > 0 && /[\n\r\u2028\u2029]/.test(src.slice(prevEnd, tok.pos));
    prevEnd = tok.pos + tok.value.length;
    return (brk ? '\n' : '') + tok.type + ' ' + tok.value;
  }).concat(problems.filter((m) => /unterminated/.test(m)).map((m) => 'problem ' + m));
}

const FILES = build.LIB_PAGE_FILES.map((f) => path.join(LIB, f)).concat(APP_FILES);

test('every page file tokenizes identically, line breaks included, after stripping', () => {
  assert.ok(FILES.length > 40, 'the lib and app file lists were found');
  let before = 0;
  let after = 0;
  FILES.forEach((file) => {
    const src = fs.readFileSync(file, 'utf8');
    const out = build.stripJs(src);
    before += src.length;
    after += out.length;
    assert.deepEqual(tokenLines(out), tokenLines(src), path.basename(file));
  });
  assert.ok(after < before * 0.8, 'stripping saves real space (' + before + ' -> ' + after + ')');
});

test('stripJs drops only what it can prove is a comment or indentation', () => {
  const cases = [
    // [input, expected]
    ['  // a\n  var x = 1;\n', 'var x = 1;\n'],
    ['/**\n * doc\n */\nfunction f() {}\n', 'function f() {}\n'],
    ['  /* one line */\nvar y;', 'var y;'],
    // Code after the close: the comment stays, only its indentation goes.
    ['  /* a\n  b */ var z;', '/* a\nb */ var z;'],
    // A '//' line that could be closing a block comment opened mid-line stays.
    ['var a; /* open\n// still */\nvar b;', 'var a; /* open\n// still */\nvar b;'],
    // A string continued across lines keeps its next line verbatim.
    ["var s = 'a\\\n    // b';\n", "var s = 'a\\\n    // b';\n"],
    // The page-host markers are never comments to drop.
    ['  /*__PCONF_INJECT__*/\n', '/*__PCONF_INJECT__*/\n'],
    // An unterminated block comment is left alone.
    ['/* open\nvar c;', '/* open\nvar c;'],
    // Removing a comment between two lines keeps a break between them (ASI).
    ['return\n// why\nx;', 'return\nx;'],
  ];
  cases.forEach(([input, expected]) => {
    assert.equal(build.stripJs(input), expected, JSON.stringify(input));
  });
});

test('the built page keeps the file markers other tests split on', () => {
  const html = build.buildPage({ appFiles: APP_FILES });
  APP_FILES.forEach((f) => {
    assert.ok(html.indexOf('/* app: ' + path.basename(f) + ' */') !== -1, path.basename(f));
  });
  assert.ok(html.indexOf('/*__PCONF_INJECT__*/') !== -1, 'inject marker preserved');
});
