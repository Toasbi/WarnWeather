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

typedef struct {
    GContext       *ctx;
    const ChartDef *def;
    GRect           outer;
    ChartGeometry   geo;
} ChartRender;

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
typedef enum   { BAR_SOLID, BAR_OUTLINED } ChartBarStyle;      // OUTLINED: +1px white
                                                               // silhouette (B&W)
typedef struct {
    const int16_t        *values;
    int                   count;      // clamped to def->num_slots
    int                   lo, hi;     // linear range map; lo = baseline value
    const ChartColorStop *stops;      // >=1, ascending, stops[0].from == lo
    int                   num_stops;
    ChartBarStyle         style;
} ChartBarsLayer;

// Sentinel marking "no value for this bucket" in a LINE layer's values[]. The
// solid line BREAKS across it (the polyline is drawn as separate segments)
// instead of plunging through it; the dotted path and BARS/AREA layers ignore
// it. Only emitters that can have genuine gaps (the health HR line) ever store
// it — temp/forecast values never equal INT16_MIN.
#define CHART_ABSENT INT16_MIN

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
    GColor         color;
    int            width;
    bool           dotted;            // true ⇒ stroke the line as square dots (second-metric line)
} ChartLineLayer;

typedef struct {
    const int16_t *values;
    GPoint        *export_points;     // optional out: count + 2 points (closing pts)
    int            count;
    int            lo, hi;
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
    const GPoint    *contour;            // NULL => full-height bands; else per-column top y
    int              contour_count;
} ChartHatchLayer;

typedef struct {
    void (*fn)(const ChartRender *r, void *user);
    void  *user;
} ChartCustomLayer;

typedef enum { CHART_LAYER_FRAME, CHART_LAYER_AXIS, CHART_LAYER_BARS,
               CHART_LAYER_LINE, CHART_LAYER_AREA, CHART_LAYER_HATCH,
               CHART_LAYER_CUSTOM } ChartLayerType;

typedef struct {
    ChartLayerType type;
    union {
        ChartFrameLayer  frame;
        ChartAxisLayer   axis;
        ChartBarsLayer   bars;
        ChartLineLayer   line;
        ChartAreaLayer   area;
        ChartHatchLayer  hatch;
        ChartCustomLayer custom;
    };
} ChartLayer;

void chart_draw(GContext *ctx, const ChartDef *def, GRect outer,
                const ChartLayer *layers, int num_layers);
