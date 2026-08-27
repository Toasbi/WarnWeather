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

test('shell.html raises the sheet cap while a palette is open (.picking)', () => {
  // Source-order test only — Node has no layout engine, so whether 94dvh is ENOUGH for
  // an 8-row palette is a browser question (see the plan's headless-Chrome measurements).
  // What is checkable here: the rule exists, keeps the vh fallback for dvh-less WebViews,
  // and sits after the equal-specificity 80dvh cap so it actually wins the cascade.
  const rule = /dialog#modal\.picking\s*\{([^}]*)\}/.exec(shell);
  assert.ok(rule, 'missing the dialog#modal.picking rule');
  assert.ok(/max-height:\s*94vh/.test(rule[1]), 'missing the 94vh fallback declaration');
  assert.ok(/max-height:\s*94dvh/.test(rule[1]), 'missing the 94dvh declaration');
  assert.ok(rule[1].indexOf('94vh') < rule[1].indexOf('94dvh'),
    'the vh fallback must come FIRST, so a dvh-aware WebView overrides it');
  assert.ok(shell.indexOf('dialog#modal.picking') > shell.indexOf('dialog#modal.date'),
    '.picking must follow the base/date caps it has to override at equal specificity');
  assert.equal(/dialog#modal\.picking[^}]*transition/.test(shell), false,
    'no max-height transition: the swipe handlers overwrite the inline transition shorthand');
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
