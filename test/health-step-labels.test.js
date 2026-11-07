'use strict';

// The health graph's step labels (src/c/layers/health_graph_layer.c). test/c/step_scale_test.c
// holds the spacing rule (step_scale.h step_scale_labels_clear) to a model of how the graph seats
// a label; this holds that model to the graph's source: the font's height named by its size, and
// a label held by its ink, not its box.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HEALTH_C = read('src/c/layers/health_graph_layer.c');

test('the label font\'s height names the font bottom_view resolves', () => {
  // A Gothic line's content height is its nominal size (layers/layer_util.h status_content_h).
  assert.match(read('src/c/appendix/bottom_view.c'),
    /config_large_graph_font\(\) \? FONT_KEY_GOTHIC_24\s*: FONT_KEY_GOTHIC_18/);
  assert.match(HEALTH_C, /static inline int step_label_font_h\(void\) \{\s*return config_large_graph_font\(\) \? 24 : 18;/);
});

test('a label is held on the plot by its ink, the lines and labels on one set of rows', () => {
  // The graph seats a label in ink terms: the ink's top `ink_lift` rows over its line, held on
  // row 0, the box its blank rows (status_ink_top) above that. step_scale_test.c drawn_label
  // derives the same seat from the box, held no higher than leaves the ink on row 0.
  assert.match(HEALTH_C, /int ink = rows\[i\] - ink_lift;\s*if \(ink < 0\) \{ ink = 0; \}/);
  assert.match(HEALTH_C, /GRect\(0, ink - blank, strip_w, box_h\)/);
  assert.match(HEALTH_C, /const int\s+blank\s*= status_ink_top\(content_h\);/);
  assert.match(HEALTH_C, /return status_cap_h\(content_h\) - 1 - status_glyph_below\(content_h\);/);
  // The lift and gap the host test's both_drawn hands step_scale_labels_clear are the graph's.
  assert.match(HEALTH_C, /#define STEP_LABEL_GAP\s+2\b/);
  assert.match(read('test/c/step_scale_test.c'),
    /status_cap_h\(content_h\) - 1 - status_glyph_below\(content_h\), 2\);/);
  // One row per mark for the dashed line and its label (step_marks_shown).
  assert.match(HEALTH_C, /StepGrid\s+grid\s+= \{ \.rows = step_rows, \.n = marks_n \};/);
  assert.match(HEALTH_C, /draw_left_axis\(ctx, h, step_rows, marks_n\);/);
});
