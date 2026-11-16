#pragma once
#include <pebble.h>
#include "c/appendix/slot_geometry.h"
#if defined(PBL_PLATFORM_EMERY)
// emery: the one slot/time -> x mapping (slot_x.h).
#include "c/appendix/slot_x.h"
#endif

// Chart engine — shared types and the one public entry point chart_draw().

// The layer records below hold px sizes, slot counts and value ranges in the narrowest
// type that fits them, pointers first: a ChartLayer is 28 B, and the forecast keeps
// twelve in the paint scratch (paint_scratch.h), which is RAM on every watch.

// --- Frame ----------------------------------------------------------

typedef struct {
    uint8_t width;    // border thickness in px; 0 = no border on this side
    GColor color;
} Border;

typedef struct {
    Border left;
    Border right;
    Border top;
    Border bottom;
} GraphFrame;

// --- Ticks ----------------------------------------------------------

typedef struct {
    uint8_t length;      // px perpendicular to the side; 0 = side disabled
    GColor  color;
    uint8_t big_length;  // length for "big" ticks
    GColor  big_color;
} TickSide;

typedef enum {
    GRAPH_SIDE_LEFT,
    GRAPH_SIDE_RIGHT,
    GRAPH_SIDE_TOP,
    GRAPH_SIDE_BOTTOM,
} GraphSide;

typedef struct {
    int          anchor_x;  // outer.origin.x — THE column anchor
    GRect        content;   // rect inside the frame's borders
    SlotGeometry slots;     // num_slots, pitch, bar_dx, bar_w
} ChartGeometry;

// =====================================================================
// One public entry point: chart_draw(). A chart is a ChartDef (grid) plus
// an ordered list of ChartLayers — z-order IS array order, bottom first.
// A ChartLayer is NOT a Pebble Layer: no heap, no framebuffer, 28 B of the
// caller's memory describing one draw pass.

typedef struct {
    int num_slots;
    int tick_w;        // horizontal px of a tick column (feeds pitch)
    int bar_pad;       // px each side of a bar inside its slot
    int bar_w;         // bar width px
    // Content insets: rows/cols of `outer` reserved for chart chrome
    // (the FRAME layer paints borders there). Plot height/baseline are
    // derived from the content rect, so these are grid geometry, not
    // frame styling.
    int inset_left, inset_right, inset_top, inset_bottom;
} ChartDef;

// Pitch math lives here exactly once; callers size their outer rect from
// it (e.g. forecast: outer.w = num_slots * pitch + 1).
static inline int chart_def_pitch(const ChartDef *d) {
    return d->tick_w + 2 * d->bar_pad + d->bar_w;
}

#if defined(PBL_PLATFORM_EMERY)
// emery: the def's pitch in 1/256 px, the unit slot_x.h maps in: chart_def_pitch() px.
static inline int chart_def_pitch_q(const ChartDef *d) {
    return SLOT_X_PITCH_Q(chart_def_pitch(d));
}
// emery: slot i's tick column, px right of the def's anchor (slot_x.h, the one mapping).
static inline int chart_def_slot_x(const ChartDef *d, int i) {
    return slot_x(chart_def_pitch_q(d), i);
}
#endif

// Every renderer takes a slot's x from these two: slot i's tick column, and its bar bar_dx
// (tick + pad) right of it. Every pitch is whole px (emery: forecast_span.h), so every column,
// every bar (bar_w) and every gap (pad + tick + pad) is one width, and on emery these land
// exactly where slot_x.h puts the axis, the night shading and the numbers On graph.
static inline int chart_slot_tick_x(const ChartGeometry *g, int i) {
    return g->anchor_x + i * g->slots.pitch;
}
static inline int chart_slot_bar_x(const ChartGeometry *g, int i) {
    return g->anchor_x + i * g->slots.pitch + g->slots.bar_dx;
}

// The vertical rule every value-mapped renderer shares (Bottom | Top, chart_flip.h).
#include "c/appendix/chart_flip.h"

typedef struct {
    GContext       *ctx;
    const ChartDef *def;
    GRect           outer;
    ChartGeometry   geo;
#if defined(WW_LINE_STYLE)
    int16_t         zero;   // the current layer's zero row and direction (chart_flip.h),
    int8_t          dir;    // set by chart_draw from ChartLayer.from_top
#endif
} ChartRender;

// The zero row and direction of the layer being drawn, for every renderer and for a
// CUSTOM layer's own bars (the radar's nearby-area pass), so they all hang by the one
// rule. aplite has no Top (WW_LINE_STYLE): the bottom edge and -1, constant-folded,
// which is today's "baseline minus height" there.
#if defined(WW_LINE_STYLE)
#define CHART_ZERO(r) ((r)->zero)
#define CHART_DIR(r)  ((r)->dir)
#define CHART_VERTEX_Y(zero, dir, h, held) chart_flip_vertex_y((zero), (dir), (h), (held))
#else
#define CHART_ZERO(r) ((r)->geo.content.origin.y + (r)->geo.content.size.h)
#define CHART_DIR(r)  (-1)
#define CHART_VERTEX_Y(zero, dir, h, held) ((void)(dir), (void)(held), (zero) - (h))
#endif

typedef enum { TICK_NONE, TICK_SMALL, TICK_BIG } ChartTickKind;
typedef enum { ALIGN_START, ALIGN_MIDDLE }       ChartSlotAlign;

typedef struct {
    char          label[4];  // "" = no label
    ChartTickKind tick;
} ChartAxisSlot;

typedef struct {
    GraphFrame frame;
} ChartFrameLayer;

typedef struct {
    const ChartAxisSlot *slots;       // exactly def->num_slots entries
    TickSide             style;       // small/big tick length+color
    GraphSide            side;        // GRAPH_SIDE_BOTTOM / GRAPH_SIDE_TOP
    ChartSlotAlign       label_align; // text centered on slot start / middle
    ChartSlotAlign       tick_align;  // tick line on slot start / middle
} ChartAxisLayer;

typedef struct { int16_t from; GColor color; } ChartColorStop; // value-space threshold
typedef enum   { BAR_SOLID, BAR_OUTLINED } ChartBarStyle;      // OUTLINED: +1px theme_fg()
                                                               // silhouette, every theme
                                                               // but colour-dark
typedef struct {
    const int16_t        *values;
    const ChartColorStop *stops;      // >=1, ascending, stops[0].from <= lo: a negative
                                      // stop-0 threshold is a palette's "Bars from: Top"
                                      // flag (chart_flip_palette_top); the renderer
                                      // clamps every stop under lo to the zero row
    int                   lo, hi;     // linear range map; lo = baseline value. An int:
                                      // the step bars' top passes 32767 (step_scale_hi)
    uint16_t              count;      // clamped to def->num_slots
    uint8_t               num_stops;
    ChartBarStyle         style;
} ChartBarsLayer;

// CHART_ABSENT and the solid line's gap/run kernel live in chart_runs.h — an
// SDK-free header so the host suite can pin them (chart.h itself pulls in
// pebble.h and cannot host-compile; the hr_scale.h param-passing precedent).
#include "c/appendix/chart_runs.h"

// How a LINE layer strokes its series. SOLID is the polyline (width = stroke
// px); DOTS and X are per-slot marks aligned to the bar columns (width = mark
// box px). STRIPE is not drawn by a LINE layer at all: the caller turns such a
// series into a CHART_LAYER_STRIPE (forecast_layer.c). The X and STRIPE arms
// are compiled out of aplite (WW_LINE_STYLE, wscript) — aplite's two lines only
// ever carry SOLID/DOTS. Values are also the wire/persist encoding's kind bits
// (persist.h LINE_STYLE_KIND_MASK), so never renumber.
typedef enum { CHART_LINE_SOLID = 0, CHART_LINE_DOTS = 1, CHART_LINE_X = 2,
               CHART_LINE_STRIPE = 3 } ChartLineStyle;

typedef struct {
    const int16_t *values;            // the points are computed from these
    GPoint        *points;            // a SOLID line's vertices, count of them: the caller's
                                      // buffer (the engine keeps none; a point array is too
                                      // large for aplite's stack). Layers drawn one after
                                      // another may share one, since each computes its points
                                      // before it uses them; a contour HATCH reads the buffer
                                      // of the AREA drawn before it. The mark styles need none.
    uint16_t       count;
    int16_t        lo, hi;
    uint16_t       inset_top;         // top margin px: value==hi lands at plot_top + inset_top
    uint16_t       inset_bottom;      // bottom margin px: value==lo lands at plot_bottom -
                                      // inset_bottom. Set larger than inset_top to lift the
                                      // baseline clear of a bottom band (e.g. the health
                                      // sleep stripe). Equal top/bottom = a symmetric inset.
                                      // Hanging (from_top), the two swap edges: inset_bottom
                                      // is the margin at the zero edge (the top), inset_top
                                      // the one at the full edge (the bottom). Only the
                                      // health HR line and aplite's temperature curve
                                      // carry insets, and they never hang.
    GColor         color;
    uint8_t        width;
    uint8_t        style;             // ChartLineStyle
    uint8_t        zero_absent;       // CHART_ZERO_* (chart_runs.h): GAP or JOIN, a value
                                      // at or below `lo` draws nothing — the SOLID path
                                      // breaks into runs there, matching the skip the mark
                                      // styles have always applied — and on a JOIN line the
                                      // stroke still comes down to such a zero next to a
                                      // reading. Set on the metric lines, whose wire
                                      // invariant reserves byte 0 for "nothing"
                                      // (forecast-series.js metricBytes); the temperature
                                      // curve and the HR line leave it DATA (0) — their
                                      // floor is real data.
} ChartLineLayer;

typedef struct {
    const int16_t *values;
    GPoint        *points;            // the caller's buffer, count + 2 points (closing pts)
    uint16_t       count;
    int16_t        lo, hi;            // no insets: the contour maps lo..hi over the whole
                                      // plot, as an uninset line does (a temperature-axis
                                      // line's rows are fitted before it reaches a layer)
    GColor         fill_color;
} ChartAreaLayer;

typedef struct {
    int16_t x0, x1;            // absolute plot-x pixels (already clamped by the caller)
} ChartBand;

typedef struct {
    const ChartBand *bands;
    const GPoint    *contour;            // NULL => full-height bands; else per-column top y
    uint16_t         contour_count;
    uint16_t         spacing;            // hatch stride
#if defined(WW_LINE_STYLE)
    int16_t          extend_top;         // full-height bands only: rows ABOVE the content
                                         // that the hatch covers too
                                         // (the forecast's top stripe band), so the night
                                         // shading runs to the top of the graph. aplite
                                         // compiles it out (no stripes).
#endif
    uint8_t          num_bands;
    GColor           hatch_color;
    GColor           underlay_color;     // per-column solid fill before hatch (area re-shade)
    bool             has_underlay;
} ChartHatchLayer;

typedef struct {
    void (*fn)(const ChartRender *r, void *user);
    void  *user;
} ChartCustomLayer;

#if defined(WW_LINE_STYLE)
// A metric as a thin band of per-slot cells along the top or bottom edge of the
// plot, each shaded by its value (chart_stripe.h): a colour ramp from the
// background toward `color`, or a B&W dither density. aplite compiles it out
// (WW_LINE_STYLE) — its lines have no selectable styles.
typedef struct {
    const int16_t *values;
    uint16_t       count;
    int16_t        lo, hi;
    int16_t        y_offset;          // px in from the edge — stacks stripes sharing one
    int16_t        height;            // px
    GColor         color;             // the line colour; level 4 paints exactly this
    bool           top;               // top edge (else bottom, over the baseline)
} ChartStripeLayer;
#endif

typedef enum { CHART_LAYER_FRAME, CHART_LAYER_AXIS, CHART_LAYER_BARS,
               CHART_LAYER_LINE, CHART_LAYER_AREA, CHART_LAYER_HATCH,
               CHART_LAYER_CUSTOM, CHART_LAYER_STRIPE } ChartLayerType;

typedef struct {
    ChartLayerType type;
    uint8_t        from_top;   // nonzero: BARS, LINE, AREA and a contour HATCH (and a CUSTOM
                               // layer through CHART_ZERO/CHART_DIR) hang from the content's
                               // top instead of standing on its bottom (chart_flip.h).
                               // FRAME, AXIS, STRIPE and a full-height HATCH ignore it. On
                               // every platform, in the padding after the short enum:
                               // rain_radar_layer.c still compiles on aplite, where nothing
                               // reads it.
    union {
        ChartFrameLayer  frame;
        ChartAxisLayer   axis;
        ChartBarsLayer   bars;
        ChartLineLayer   line;
        ChartAreaLayer   area;
        ChartHatchLayer  hatch;
        ChartCustomLayer custom;
#if defined(WW_LINE_STYLE)
        ChartStripeLayer stripe;
#endif
    };
} ChartLayer;

void chart_draw(GContext *ctx, const ChartDef *def, GRect outer,
                const ChartLayer *layers, int num_layers);

#if defined(WW_LINE_STYLE) || defined(WW_RAIN_RADAR)
// One stripe cell at `level` (0..4, chart_stripe.h — 0 draws nothing): the
// shared look of the forecast's stripe style and the radar's sky rows.
void chart_stripe_fill_cell(GContext *ctx, GRect cell, GColor color, int level);
#endif
