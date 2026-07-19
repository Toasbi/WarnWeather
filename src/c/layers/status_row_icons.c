#include "status_row_icons.h"
#include "../appendix/status_line.h"
#include "../appendix/theme.h"
#include <limits.h>

#if !defined(PBL_PLATFORM_APLITE)

#define PRECISE_UNITS_PER_PX 8

// Glyph bounding box (in the PDC's point units), the height scale to apply, and the
// grid-snap parameters. Each point is scaled so the glyph HEIGHT maps to target_h px,
// then snapped to the 1px grid — which, for the 1px stroke, is the pixel-centre phase
// that renders crisp (matches the hand-authored sleep glyph's X.5 coords).
typedef struct {
    int16_t min_x, min_y, max_x, max_y;   // pass 1: raw ink bbox (PDC point units, 1/8px)
    int32_t num, den;                     // uniform height scale: * num / den
    int32_t sum_x, sum_y;                 // (min + max) per axis == 2× the master centre
    int32_t base_x, base_y;               // snapped origin (lands the min vertex on 4 = 0.5px)
    int16_t out_max_x, out_max_y;         // pass 2: max snapped output, for tight bounds
} IconNorm;

// Divide a / b (b > 0) rounding to nearest, half AWAY from zero. Odd in a.
static int32_t icon_div_round(int32_t a, int32_t b) {
    return (a >= 0) ? (a + b / 2) / b : -(((-a) + b / 2) / b);
}

// Snap one axis of a vertex. `d = 2*p - (min+max)` is the point's offset from the master
// centre, doubled to stay an exact INTEGER and exactly ANTISYMMETRIC (mirror points get
// opposite d). Scaling by num/den and rounding to the nearest whole pixel (via the odd
// icon_div_round) therefore lands a vertex and its mirror on mirror grid cells — symmetric
// AND on pixel centres (crisp for the 1px stroke). Result is in 1/8-px units, a multiple
// of PRECISE_UNITS_PER_PX. Computing the offset from the doubled centre — instead of
// rounding each point then subtracting a floored centre — is what keeps circles/curves
// from tilting a pixel when downscaled.
static int32_t icon_snap_off(int32_t d, int32_t num, int32_t den) {
    return icon_div_round(d * num, 2 * PRECISE_UNITS_PER_PX * den) * PRECISE_UNITS_PER_PX;
}

// First pass: accumulate the glyph's bounding box across every command's points.
static bool icon_bbox_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    IconNorm *b = (IconNorm *)context;
    uint16_t n = gdraw_command_get_num_points(command);
    for (uint16_t i = 0; i < n; i++) {
        GPoint p = gdraw_command_get_point(command, i);
        if (p.x < b->min_x) { b->min_x = p.x; }
        if (p.y < b->min_y) { b->min_y = p.y; }
        if (p.x > b->max_x) { b->max_x = p.x; }
        if (p.y > b->max_y) { b->max_y = p.y; }
    }
    return true;
}

// Second pass: recolor to white line-art (stroke white, fill cleared → light outlines;
// the sleep glyph's "Z" strokes then read white inside the unfilled pillow outline), then
// scale each point so the glyph HEIGHT maps to target_h px and snap it to the pixel-centre
// grid SYMMETRICALLY about the glyph centre (see icon_round_grid). Snapping about the
// centre — rather than rounding each point independently — keeps mirror vertices mirrored,
// so octagons/curves stay symmetric instead of tilting a pixel when downscaled. The scale
// itself rounds half-up (+den/2); the snap then quantises to the crisp phase.
static bool icon_normalize_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    IconNorm *b = (IconNorm *)context;
    gdraw_command_set_stroke_color(command, theme_fg());
    gdraw_command_set_fill_color(command, GColorClear);
    uint16_t n = gdraw_command_get_num_points(command);
    for (uint16_t i = 0; i < n; i++) {
        GPoint p = gdraw_command_get_point(command, i);
        p.x = (int16_t)(b->base_x + icon_snap_off(2 * (int32_t)p.x - b->sum_x, b->num, b->den));
        p.y = (int16_t)(b->base_y + icon_snap_off(2 * (int32_t)p.y - b->sum_y, b->num, b->den));
        if (p.x > b->out_max_x) { b->out_max_x = p.x; }
        if (p.y > b->out_max_y) { b->out_max_y = p.y; }
        gdraw_command_set_point(command, i, p);
    }
    uint8_t sw = gdraw_command_get_stroke_width(command);
    if (sw > 1) {
        int nw = ((int)sw * b->num + b->den / 2) / b->den;
        gdraw_command_set_stroke_width(command, (uint8_t)(nw < 1 ? 1 : nw));
    }
    return true;
}

static GDrawCommandImage *icon_load(uint32_t resource_id, int target_h) {
    GDrawCommandImage *image = gdraw_command_image_create_with_resource(resource_id);
    if (!image) { return NULL; }
    GDrawCommandList *list = gdraw_command_image_get_command_list(image);
    IconNorm b = { .min_x = INT16_MAX, .min_y = INT16_MAX, .max_x = INT16_MIN, .max_y = INT16_MIN };
    gdraw_command_list_iterate(list, icon_bbox_cb, &b);
    int glyph_h = b.max_y - b.min_y;
    if (glyph_h <= 0) { return image; }   // degenerate glyph; leave untouched
    int glyph_w = b.max_x - b.min_x;
    // Scale so the glyph's height maps to target_h px. Points are in 1/8-px units, so the
    // numerator carries the ×8; the max point then lands at target_h * 8 units == target_h px.
    b.num = (int32_t)target_h * PRECISE_UNITS_PER_PX;
    b.den = glyph_h;
    b.sum_x = (int32_t)b.min_x + b.max_x;
    b.sum_y = (int32_t)b.min_y + b.max_y;
    // Origin phased so the min vertex lands on 4 (0.5 px) — a pixel centre, so the 1px
    // stroke stays crisp and no vertex goes negative. base = 4 + snap(glyph extent), and
    // the min vertex's offset snaps to -snap(extent), so it lands exactly on 4.
    b.base_x = PRECISE_UNITS_PER_PX / 2 + icon_snap_off(glyph_w, b.num, b.den);
    b.base_y = PRECISE_UNITS_PER_PX / 2 + icon_snap_off(glyph_h, b.num, b.den);
    b.out_max_x = INT16_MIN;
    b.out_max_y = INT16_MIN;
    gdraw_command_list_iterate(list, icon_normalize_cb, &b);
    // Tight bounds from the snapped extent. The min vertex sits at 4 (0.5 px), so the point
    // span in px is (out_max - 4)/8; that reproduces the old ~target_h footprint (the 1px
    // stroke bleeds ≤0.5 px into the layer clip, as it always did).
    int bw = (b.out_max_x - PRECISE_UNITS_PER_PX / 2) / PRECISE_UNITS_PER_PX;
    int bh = (b.out_max_y - PRECISE_UNITS_PER_PX / 2) / PRECISE_UNITS_PER_PX;
    if (bw < 1) { bw = 1; }
    if (bh < 1) { bh = 1; }
    gdraw_command_image_set_bounds_size(image, GSize((int16_t)bw, (int16_t)bh));
    return image;
}

// Render height (px) at/above which an icon's DETAILED (_LG) variant is used. Below it, the
// base master is drawn — whose fine features (cap rounding, chamfers) are shaped generously
// enough to survive the downscale. A single uniformly-scaled master can't be both thin at the
// large tiers and survivable-with-rounding at the small ones, so icons that need it ship two
// variants and this threshold picks between them. Icons without a _LG variant ignore it.
#define ICON_DETAIL_MIN_H 15

static uint32_t icon_resource(uint8_t icon_id, bool detailed) {
    if (detailed) {
        switch (icon_id) {
            case STATUS_ICON_TEMP: return RESOURCE_ID_STATUS_TEMP_LG;
            default: break;   // no detailed variant → fall through to the base master
        }
    }
    switch (icon_id) {
        case STATUS_ICON_TEMP: return RESOURCE_ID_STATUS_TEMP;
        case STATUS_ICON_UV: return RESOURCE_ID_STATUS_UV;
        case STATUS_ICON_WIND: return RESOURCE_ID_STATUS_WIND;
        case STATUS_ICON_GUST: return RESOURCE_ID_STATUS_GUST;
        case STATUS_ICON_PRECIP: return RESOURCE_ID_STATUS_PRECIP;
        case STATUS_ICON_AQI: return RESOURCE_ID_STATUS_AQI;   // weather metric, all providers
        case STATUS_ICON_POLLEN: return RESOURCE_ID_STATUS_POLLEN;
#if defined(PBL_HEALTH)
        // Distance is a HealthService metric (steps → distance), so it lives with the
        // other health glyphs: no health service means no steps and no distance.
        case STATUS_ICON_DISTANCE: return RESOURCE_ID_STATUS_DISTANCE;
        case STATUS_ICON_STEPS: return RESOURCE_ID_HEALTH_STEPS;
        case STATUS_ICON_SLEEP: return RESOURCE_ID_HEALTH_SLEEP;
        case STATUS_ICON_HR: return RESOURCE_ID_HEALTH_HEART;
#endif
        default: return 0;
    }
}

// Per-glyph size trim, as a percent of the tier's target height. Most glyphs fill
// the slot, but a few read visually large at the shared target and get nudged down:
// the route (distance) sprawls to its bbox corners and the steps footprint is wide.
// 100 = no change; tune per icon.
static int icon_scale_pct(uint8_t icon_id) {
    switch (icon_id) {
        case STATUS_ICON_DISTANCE: return 95;
        case STATUS_ICON_WIND:     return 95;
        case STATUS_ICON_GUST:     return 95;
        case STATUS_ICON_UV:       return 95;
        case STATUS_ICON_AQI:      return 85;
        case STATUS_ICON_TEMP:     return 93;
        case STATUS_ICON_STEPS:    return 80;   // the 25x25 footprint glyph is wide
        default:                   return 100;
    }
}

GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h) {
    if (target_h <= 0) { return NULL; }
    int h = (target_h * icon_scale_pct(icon_id)) / 100;
    if (h < 1) { h = 1; }
    // Pick the variant from the FINAL render height (after the per-icon scale trim), so the
    // detailed master is used exactly when the glyph is actually drawn large enough for it.
    uint32_t resource = icon_resource(icon_id, h >= ICON_DETAIL_MIN_H);
    if (resource == 0) { return NULL; }
    return icon_load(resource, h);
}

void status_row_icons_destroy(GDrawCommandImage *image) {
    if (image) { gdraw_command_image_destroy(image); }
}

#else  // aplite: frozen lean fork, no PDC resources — every id is text-only.

GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h) {
    (void) icon_id;
    (void) target_h;
    return NULL;
}

void status_row_icons_destroy(GDrawCommandImage *image) { (void) image; }

#endif
