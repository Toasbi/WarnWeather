// src/pkjs/config-ui/scripts/build-page.js — plain node, no deps.
var fs = require('fs');
var path = require('path');
var configUi = require('../index.js');
var LIB = path.join(__dirname, '..', 'lib');
// ui.js (the shared parts) reads html.js's esc while its body runs and engine.js reads PConf.ui
// while its own runs, so it sits between them. color.js is the phone app's shared library
// (src/pkjs/lib), which the engine uses as PConf.color.
var LIB_PAGE_FILES = ['schema-walk.js', '../../lib/color.js', 'show-when.js', 'html.js', 'ui.js', 'date-picker.js', 'range-control.js',
  'rgb-control.js', 'checklist.js', 'links.js', 'back-steps.js', 'engine.js'];

/**
 * Drop the whole-line comments, the blank lines, the leading indentation and the blanks
 * beside punctuation of one JS file.
 *
 * The page reaches a real phone as ONE data: URL, which Android's WebView refuses past
 * 2 MiB, and every comment character, indentation space and line break costs URL budget
 * (a space encodes as '%20', a line break as '%0A'). Line-based and conservative, so the
 * program is untouched:
 *  - a blank line goes (the file's last line break stays);
 *  - a line whose first non-blank text is '//' goes, unless it also holds a '*' + '/'
 *    (it could be closing a block comment opened mid-line above);
 *  - a comment after code goes too, with the blanks before it, and so do the blanks beside
 *    punctuation outside the strings, where nothing in the line can be a regex literal
 *    (compactLine);
 *  - a block comment goes when it starts a line and nothing but blanks follows its
 *    close; one with code after the close stays as written;
 *  - a line after one ending in a backslash (a string continued across lines) is
 *    kept verbatim, since its leading blanks are part of the string;
 *  - removing whole lines keeps a line break between the code on either side, so
 *    automatic semicolon insertion sees the same breaks.
 * test/page/settings/config-page-strip.test.js proves every shipped file tokenizes identically,
 * line breaks included, before and after.
 *
 * @param {string} src JavaScript source.
 * @returns {string} The same program without those comments, blank lines and blanks.
 */
function stripJs(src) {
  var lines = src.split('\n');
  var out = [];
  var continued = false;
  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i];
    if (continued) {
      out.push(line);
      continued = /\\\r?$/.test(line);
      continue;
    }
    var t = line.trim();
    if (t === '' && i < lines.length - 1) { continue; }
    if (t.slice(0, 2) === '//' && t.indexOf('*/') === -1) { continue; }
    if (t.slice(0, 2) === '/*' && t.indexOf('__PCONF_') === -1) {
      var j = i;
      var close = lines[i].indexOf('*/', lines[i].indexOf('/*') + 2);
      while (close === -1 && j + 1 < lines.length) {
        j += 1;
        close = lines[j].indexOf('*/');
      }
      if (close !== -1 && lines[j].slice(close + 2).trim() === '') {
        i = j;
        continue;
      }
    }
    out.push(compactLine(line.replace(/^[ \t]+/, '')));
    continued = /\\\r?$/.test(line);
  }
  return out.join('\n');
}

// What a blank may go beside: no token runs on into a punctuator or a quote that starts or ends a
// string, but for the pairs blankKept keeps apart.
var PUNCTUATORS = '=,:;{}()[]+-*%<>!&|^~?\'"';

/**
 * @param {string} a The character before a run of blanks.
 * @param {string} b The character after it.
 * @returns {boolean} Whether the blanks between them stay (as one): between two characters of
 *   names, keywords or numbers, between two of a token that would run on into another ('+ +',
 *   '- -'), and where a comment ('<!' + '--', '--' + '>') or '?.' would start.
 */
function blankKept(a, b) {
  if (PUNCTUATORS.indexOf(a) === -1 && PUNCTUATORS.indexOf(b) === -1) { return true; }
  return (a === b && (a === '+' || a === '-')) || a + b === '<!' || a + b === '->' || a + b === '?.';
}

/**
 * A line of code without the comment after it, the blanks before it, and the blanks beside
 * punctuation (blankKept), outside the quoted strings. Only where every '/' outside them starts
 * that comment, so none can start or be in a regex literal, and the line holds no backtick and
 * no '*' + '/' (it could be closing a block comment opened above, or be inside one). Any other
 * line stays as it is.
 * @param {string} line A line of code, its indentation gone.
 * @returns {string} The line without its comment and those blanks.
 */
function compactLine(line) {
  var out = '';
  var quote = null;
  var blank = false;
  if (line.indexOf('*/') !== -1 || line.indexOf('`') !== -1) { return line; }
  for (var k = 0; k < line.length; k += 1) {
    var c = line.charAt(k);
    if (quote) {
      out += c;
      if (c === '\\') { k += 1; out += line.charAt(k); } else if (c === quote) { quote = null; }
    } else if (c === ' ' || c === '\t') {
      blank = true;
    } else if (c === '/') {
      return line.charAt(k + 1) === '/' ? out : line;
    } else {
      if (blank && blankKept(out.charAt(out.length - 1), c)) { out += ' '; }
      blank = false;
      if (c === '"' || c === '\'') { quote = c; }
      out += c;
    }
  }
  return out;
}

/**
 * Fill the shell's own font in: Inter's Latin variable face (lib/fonts, from
 * @fontsource-variable/inter 5.3.0) as a base64 data URI in its @font-face, and the font's
 * licence (SIL OFL 1.1, lib/fonts/OFL.txt) as a comment beside it, since every copy of the
 * font carries its notice and licence. The page then requests no font from anywhere.
 * @param {string} shell shell.html's text.
 * @returns {string} The shell with the font and its licence in place.
 */
function inlineFont(shell) {
  if (shell.indexOf('__PCONF_FONT_INTER__') === -1 || shell.indexOf('/*__PCONF_FONT_LICENSE__*/') === -1) {
    throw new Error('shell.html missing the font markers (__PCONF_FONT_INTER__, /*__PCONF_FONT_LICENSE__*/)');
  }
  var font = fs.readFileSync(path.join(LIB, 'fonts', 'inter-latin-wght-normal.woff2')).toString('base64');
  var licence = fs.readFileSync(path.join(LIB, 'fonts', 'OFL.txt'), 'utf8').trim().replace(/\*\//g, '* /');
  return shell
    .replace('/*__PCONF_FONT_LICENSE__*/', function () { return '/* ' + licence + ' */'; })
    .replace('__PCONF_FONT_INTER__', function () { return font; });
}

function buildPage(opts) {
  opts = opts || {};
  var shell = inlineFont(fs.readFileSync(path.join(LIB, 'shell.html'), 'utf8'));
  if (shell.indexOf('/*__PCONF_CONCAT__*/') === -1) { throw new Error('shell.html missing /*__PCONF_CONCAT__*/'); }
  var parts = LIB_PAGE_FILES.map(function (f) { return '/* ' + f + ' */\n' + stripJs(fs.readFileSync(path.join(LIB, f), 'utf8')); });
  (opts.appFiles || []).forEach(function (f) {
    var abs = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
    parts.push('/* app: ' + path.basename(f) + ' */\n' + stripJs(fs.readFileSync(abs, 'utf8')));
  });
  parts.push('\nPConf.engine.boot();');
  return shell.replace('/*__PCONF_CONCAT__*/', function () { return parts.join('\n'); });
}

function writeGenerated(opts) {
  var html = buildPage(opts);
  // Write to a per-process temp file then rename into place. rename(2) is atomic,
  // so a concurrent reader — e.g. another parallel `node --test` worker requiring
  // page.generated.js while config-integration-build.test.js regenerates it — always
  // sees a complete file, never a half-written one that fails to parse (SyntaxError).
  // The plain O_TRUNC writeFileSync exposed that truncation window and flaked the build.
  var tmp = opts.out + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, 'module.exports = ' + JSON.stringify(html) + ';\n');
  fs.renameSync(tmp, opts.out);
  return opts.out;
}

// Build the page and fill the INJECTED_* runtime marker, yielding a standalone HTML page that
// renders itself in a browser (no watch / Clay host needed). schema/cfg/env/userData are
// written by the same writer the page a phone opens gets (config-ui/index.js injectPage).
// For dev preview, not shipping.
function previewPage(opts) {
  opts = opts || {};
  var page = buildPage({ appFiles: opts.appFiles });
  if (page.indexOf('/*__PCONF_INJECT__*/') === -1) { throw new Error('shell.html missing /*__PCONF_INJECT__*/'); }
  return configUi.injectPage(page, { schema: opts.schema || null, cfg: opts.cfg || {},
    env: opts.env || null, userData: opts.userData || {}, returnTo: opts.returnTo || '#' });
}

if (require.main === module) {
  // CLI: node build-page.js <out> <appFile...>
  var out = process.argv[2], appFiles = process.argv.slice(3);
  console.log('wrote ' + writeGenerated({ out: out, appFiles: appFiles }));
}
module.exports = { buildPage: buildPage, writeGenerated: writeGenerated, previewPage: previewPage,
  stripJs: stripJs, LIB_PAGE_FILES: LIB_PAGE_FILES };
