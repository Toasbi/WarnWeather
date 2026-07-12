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

test('shell.html keeps literal fallbacks before var() for var-less WebViews', () => {
  // background/color declared as a literal first, then overridden with var().
  assert.ok(/background:\s*#333333;\s*background:\s*var\(--bg\)/.test(shell),
    'missing --bg literal fallback');
  assert.ok(/color:\s*#F0F2F6;\s*color:\s*var\(--fg\)/.test(shell),
    'missing --fg literal fallback');
});
