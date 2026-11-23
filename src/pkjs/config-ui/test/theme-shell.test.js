const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shell = fs.readFileSync(
  path.resolve(__dirname, '..', 'lib', 'shell.html'), 'utf8');

test('shell.html defines theme tokens and a light override', () => {
  ['--bg', '--fg', '--card', '--ctl', '--lbl', '--hint', '--link'].forEach((tok) => {
    assert.ok(shell.indexOf(tok) !== -1, 'missing token ' + tok);
  });
  assert.ok(/body\.light\b/.test(shell), 'missing body.light override');
});

/**
 * The declarations of a theme's token block.
 * @param {string} selector Regex source of the block's selector.
 * @returns {Object} Token name to value.
 */
function tokens(selector) {
  const m = new RegExp(selector + '\\s*\\{([^}]*)\\}').exec(shell);
  assert.ok(m, 'missing block ' + selector);
  const out = {};
  m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';').forEach((d) => {
    const i = d.indexOf(':');
    if (i > 0 && d.indexOf('--') !== -1) { out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
  });
  return out;
}

test('shell.html has a black override that changes the surfaces only', () => {
  const dark = tokens('\\n  body');
  const black = tokens('body\\.black');
  ['--bg', '--card', '--ctl', '--tab', '--sw-track'].forEach((t) => {
    assert.ok(black[t], 'black must override ' + t);
    assert.notEqual(black[t], dark[t], t + ' must differ from dark');
  });
  assert.equal(black['--bg'], '#000000');
  assert.equal(black['--card'], '#141414');
  assert.equal(black['--ctl'], '#1F1F1F');
  // Text, accent and the amber keep dark's values: black sets none of them.
  ['--fg', '--lbl', '--muted', '--hint', '--ttl', '--link', '--info-rule'].forEach((t) => {
    assert.equal(black[t], undefined, 'black must not restyle ' + t);
  });
  // Dark stays the classless default, so the two themes are not one block.
  assert.equal(dark['--bg'], '#333333');
  assert.equal(dark['--card'], '#3A3B3F');
});

test('shell.html leaves the light and dark tokens as they were', () => {
  const light = tokens('body\\.light');
  assert.equal(light['--bg'], '#FFFFFF');
  assert.equal(light['--card'], '#F4F5F7');
  assert.equal(light['--ctl'], '#E9EBEF');
  assert.equal(light['--sw-track'], '#C9CCD2');
  const dark = tokens('\\n  body');
  assert.equal(dark['--ctl'], '#46474C');
  assert.equal(dark['--tab'], '#3D3E42');
  assert.equal(dark['--sw-track'], '#5A5B61');
});

test('shell.html styles the chevron for rows as well as card headers', () => {
  // The button/sheet trigger rows reuse .chev. Scoped to .cardHdr (or inlined on the
  // row), the chevron kept the DARK --link value after the page flipped to light.
  assert.ok(/(^|[},;])\s*\.chev\s*\{[^}]*color:\s*var\(--link\)/m.test(shell),
    'missing an unscoped .chev rule taking its colour from --link');
  assert.equal(/\.cardHdr\s+\.chev/.test(shell), false,
    '.chev must not be scoped to card headers');
});

test('shell.html keeps literal fallbacks before var() for var-less WebViews', () => {
  // background/color declared as a literal first, then overridden with var().
  assert.ok(/background:\s*#333333;\s*background:\s*var\(--bg\)/.test(shell),
    'missing --bg literal fallback');
  assert.ok(/color:\s*#F0F2F6;\s*color:\s*var\(--fg\)/.test(shell),
    'missing --fg literal fallback');
});

test('shell.html names the badge dots by shape, not by threshold vocabulary', () => {
  // The shared library carries no app-specific words: a dot is outlined or filled.
  assert.ok(/\.pen-dot\.ring\s*\{[^}]*border:\s*2px solid var\(--th-c\)/.test(shell),
    '.pen-dot.ring must be the OUTLINE dot');
  assert.ok(/\.pen-dot\.fill\s*\{[^}]*background:\s*var\(--th-c\)/.test(shell),
    '.pen-dot.fill must be the FILLED dot');
  assert.equal(/\.pen-dot\.warn\b/.test(shell), false, '.pen-dot.warn is threshold vocabulary');
  assert.equal(/\.pen-dot\.danger\b/.test(shell), false, '.pen-dot.danger is threshold vocabulary');
});

test('shell.html sizes the colour readout to fit a row beside the Edit button', () => {
  // One fragment renders in two places (html.js swatchReadout): centered above the rgb
  // sliders in a sheet, and inside .thr-swatch on a row. Node has no layout engine, so
  // what is checkable here is the arithmetic the rules encode — a 24px chip with the
  // sheet's 5px/6px padding and 1px borders is 36px, taller than the 33px floor every
  // other Edit row stands at, which would make this one row the odd one out. The row
  // copy trims ONLY the padding (3px → 32px) and keeps the chip at the sheet's size.
  assert.ok(/\.sw-wrap\.sw-ro\s*\{[^}]*cursor:\s*default/.test(shell),
    '.sw-ro is a readout, not a trigger: it must drop the pointer cursor');
  const rowRule = /\.thr-swatch \.sw-wrap\.sw-ro\s*\{([^}]*)\}/.exec(shell);
  assert.ok(rowRule, 'missing the row-scoped .sw-ro rule');
  assert.match(rowRule[1], /padding:\s*3px 9px 3px 4px/, 'the row copy trims the padding');
  assert.equal(/\.thr-swatch \.sw-wrap\.sw-ro[^}]*(width|height|font)\s*:/.test(shell), false,
    'the chip and the hex keep the SHEET\'s size — only the padding differs');
  // The base chrome the trim leans on, so a change there cannot silently break the fit.
  assert.ok(/\.sw-wrap b\s*\{[^}]*width:\s*24px/.test(shell), '.sw-wrap b is the 24px chip');
  assert.ok(/\.thr-btn\s*\{[^}]*min-height:\s*33px/.test(shell),
    'and 33px is the height the trimmed readout has to fit inside');
});

test('shell.html gives the Edit button a height floor so a control-less row matches the slots', () => {
  // `.row .rgt.has-pen` stretches the button to whatever control sits beside it, but a
  // type:'sheet' row has an EMPTY control cell — without this floor its Edit button
  // collapsed to its own 16px content box and read half-height next to the status slots'.
  // 33px is .sel-wrap's measured box, so the two now render identically.
  assert.ok(/\.thr-btn\s*\{[^}]*min-height:\s*33px/.test(shell),
    '.thr-btn must carry the min-height floor');
  assert.ok(/\.row \.rgt\.has-pen\s*\{[^}]*align-items:\s*stretch/.test(shell),
    'a floor, not a replacement: rows WITH a control still stretch to it');
});

test('shell.html lets a .grp sub-header own the line above it', () => {
  // A group sub-header can no longer borrow the preceding group's last-row divider:
  // when a group's master switch is off it renders NO rows, and the next group then ran
  // straight into it with nothing between them. So .subhdr.grp draws its own border-top
  // (the engine joins the row above loosely, so only one 1px line is ever drawn), and a
  // sub-header that OPENS its card body drops it — nothing above it to separate from.
  assert.ok(/\.subhdr\.grp\s*\{[^}]*border-top:\s*1px solid var\(--row-line\)/.test(shell),
    '.subhdr.grp must carry its own top rule');
  assert.ok(/\.subhdr\.grp:first-child\s*\{[^}]*border-top:\s*none/.test(shell),
    'a leading sub-header must not draw a line under the card header');
  assert.ok(shell.indexOf('.subhdr.grp:first-child') > shell.indexOf('.subhdr.grp { border-top'),
    'the :first-child reset must follow the rule it overrides');
  // The PLAIN .subhdr (a groupCard section title) keeps the borrowed-divider deal: those
  // sections always end in rows, and a border there would double up with one.
  assert.equal(/\.subhdr\s*\{[^}]*border-top/.test(shell), false,
    'only the .grp flavour owns a line');
});

test('shell.html loads nothing remote that could block boot', () => {
  // A pending stylesheet blocks every later script, and the whole page is one inline
  // <script> ending in boot(). Where fonts.googleapis.com was blackholed (not refused)
  // the page stayed blank until the connect timed out, tens of seconds. The font is now
  // bundled in the page (build-page.js inlineFont), so the shell links no stylesheet,
  // preconnects nowhere and loads no script from anywhere.
  const links = shell.match(/<link\b[^>]*>/gi) || [];
  assert.deepEqual(links.filter((l) => /href="https?:/i.test(l)), [], 'no remote stylesheet or preconnect');
  assert.equal(/@import\s+url\(\s*['"]?https?:/i.test(shell), false, 'no remote @import');
  assert.equal(/<script\b[^>]*\bsrc=/i.test(shell), false, 'no external script gates boot either');
});
