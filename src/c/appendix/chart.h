#pragma once
#include <pebble.h>
#include "c/appendix/slot_geometry.h"

// Chart engine — shared types and the one public entry point chart_draw().

// --- Frame ----------------------------------------------------------

typedef struct {
    int    width;     // border thickness in px; 0 = no border on this side
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
    int    length;       // px perpendicular to the side; 0 = side disabled
    GColor color;
    int    big_length;   // length for "big" ticks
    GColor big_color;
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
// A ChartLayer is NOT a Pebble Layer: no heap, no framebuffer, ~40 B of
// caller stack describing one draw pass.

#define CHART_MAX_SLOTS 32   // engine point-buffer cap; both charts use 24

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
    GraphSide            side;        // GRAPH_SIDE_BOTTOM / GRAPH_SIDE_TOP
    TickSide             style;       // small/big tick length+color
    const ChartAxisSlot *slots;       // exactly def->num_slots entries
    ChartSlotAlign       label_align; // text centered on slot start / middle
    ChartSlotAlign       tick_align;  // tick line on slot start / middle
} ChartAxisLayer;

typedef struct { int16_t from; GColor color; } ChartColorStop; // value-space threshold
typedef enum   { BAR_SOLID, BAR_OUTLINED } ChartBarStyle;      // OUTLINED: +1px theme_fg()
                                                               // silhouette, every theme
                                                               // but colour-dark
typedef struct {
    const int16_t        *values;
    int                   count;      // clamped to def->num_slots
    int                   lo, hi;     // linear range map; lo = baseline value
    const ChartColorStop *stops;      // >=1, ascending, stops[0].from <= lo: a negative
                                      // stop-0 threshold is a palette's "Bars from: Top"
                                      // flag (chart_flip_palette_top); the renderer
                                      // clamps every stop under lo to the zero row
    int                   num_stops;
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
    const int16_t *values;            // compute points from values...
    const GPoint  *points;            // ...OR consume precomputed points
    GPoint        *export_points;     // optional out: count points
    int            count;
    int            lo, hi;
    int            inset_top;         // top margin px: value==hi lands at plot_top + inset_top
    int            inset_bottom;      // bottom margin px: value==lo lands at plot_bottom -
                                      // inset_bottom. Set larger than inset_top to lift the
                                      // baseline clear of a bottom band (e.g. the health
                                      // sleep stripe). Equal top/bottom = a symmetric inset.
                                      // Hanging (from_top), the two swap edges: inset_bottom
                                      // is the margin at the zero edge (the top), inset_top
                                      // the one at the full edge (the bottom). Only the
                                      // temperature-axis lines carry insets, and they never
                                      // hang.
    GColor         color;
    int            width;
    uint8_t        style;             // ChartLineStyle — uint8_t so the layer keeps the
                                      // 1-byte slot the old `dotted` bool sat in
    uint8_t        zero_absent;       // nonzero: a value at or below `lo` draws nothing —
                                      // the SOLID path breaks into runs there, matching the
                                      // skip the mark styles have always applied. Set on the
                                      // metric lines, whose wire invariant reserves byte 0
                                      // for "nothing" (forecast-series.js metricBytes);
                                      // temp/feels leave it 0 — their byte 0 is the band
                                      // floor, real data. Sits in the struct's tail padding.
} ChartLineLayer;

typedef struct {
    const int16_t *values;
    GPoint        *export_points;     // optional out: count + 2 points (closing pts)
    int            count;
    int            lo, hi;
#if defined(WW_CURVE_INSET)
    int            inset_top;         // contour margins, matching ChartLineLayer's
    int            inset_bottom;      // mapping — so a fill under an inset line hugs
                                      // it exactly. The fill itself still drops to
                                      // its zero row (standing: the plot bottom,
                                      // which the axis closes; hanging: the row
                                      // above the plot).
                                      // aplite compiles them out entirely: no curve
                                      // insets there, and the union must not grow.
#endif
    GColor         fill_color;
} ChartAreaLayer;

typedef struct {
    int16_t x0, x1;            // absolute plot-x pixels (already clamped by the caller)
    bool    boundary0;         // draw a 1px boundary line at x0?
    bool    boundary1;         // draw a 1px boundary line at x1?
} ChartBand;

typedef struct {
    const ChartBand *bands;
    int              num_bands;
    GColor           hatch_color;
    GColor           boundary_color;
    int              spacing;            // hatch stride
    GColor           underlay_color;     // per-column solid fill before hatch (area re-shade)
    bool             has_underlay;
#if defined(WW_LINE_STYLE)
    int16_t          extend_top;         // full-height bands only: rows ABOVE the content
                                         // that the hatch and its boundary lines cover too
                                         // (the forecast's top stripe band), so the night
                                         // shading runs to the top of the graph. Sits in
                                         // padding; aplite compiles it out (no stripes).
#endif
    const GPoint    *contour;            // NULL => full-height bands; else per-column top y
    int              contour_count;
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
    int            count;
    int            lo, hi;
    GColor         color;             // the line colour; level 4 paints exactly this
    int16_t        y_offset;          // px in from the edge — stacks stripes sharing one
    int16_t        height;            // px
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
                               // every platform, in the short enum's padding (ChartLayer
                               // stays 48 B): rain_radar_layer.c still compiles on aplite,
                               // where nothing reads it.
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
