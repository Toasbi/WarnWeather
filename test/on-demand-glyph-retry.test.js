'use strict';

// The On demand glyph cache (src/c/layers/status_on_demand.c ensure()) is SDK-bound —
// it loads PDC glyphs — so no host test runs it; this pins its one retry rule in the
// source, the top-status-snooze.test.js pattern. A glyph that fails to load (OOM on the
// 64 KB watches) must leave its cache slot free, so the next draw (the minute's redraw
// at the latest) tries again. A key kept beside a NULL image was never retried while
// its item stayed active: the Bluetooth-disconnected icon, which has no text, could
// vanish for a whole disconnect.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'layers', 'status_on_demand.c'), 'utf8');

test('a glyph that fails to load leaves its cache slot free for the next draw', () => {
  const ensure = /static void ensure\([\s\S]*?\n\}\n/.exec(SRC);
  assert.ok(ensure, 'ensure() found');
  assert.match(ensure[0],
    /cache->images\[slot\] = [^;]*;\s*if \(cache->images\[slot\]\) \{ cache->keys\[slot\] = key; \}/,
    'the key is committed only beside a loaded image');
  assert.doesNotMatch(ensure[0], /^\s*cache->keys\[slot\] = key;/m,
    'no unconditional key commit');
});
