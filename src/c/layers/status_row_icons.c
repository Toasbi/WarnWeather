#include "status_row_icons.h"
#include "../appendix/status_line.h"
#include "../appendix/theme.h"
#include <limits.h>

#if !defined(PBL_PLATFORM_APLITE)

#define PRECISE_UNITS_PER_PX 8

// Glyph bounding box (in the PDC's point units) plus the scale ratio to apply.
typedef struct {
    int16_t min_x, min_y, max_x, max_y;
    int16_t num, den;   // transform each point: (p - min) * num / den
} IconNorm;

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
// the sleep glyph's "Z" strokes then read white inside the unfilled pillow outline), and
// normalize each point to the origin-anchored, target-sized box (translate the bbox to
// 0,0, then scale by num/den — the same ratio scales width and stroke width).
// Scaling rounds to nearest (+den/2) rather than truncating: floor biased every
// coordinate ~0.08px toward the origin, which unevened the downscaled strokes. All
// inputs are non-negative (points are pre-translated by min; num,den > 0), so a plain
// +den/2 is a correct round-half-up.
static bool icon_normalize_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    IconNorm *b = (IconNorm *)context;
    gdraw_command_set_stroke_color(command, theme_fg());
    gdraw_command_set_fill_color(command, GColorClear);
    uint16_t n = gdraw_command_get_num_points(command);
    for (uint16_t i = 0; i < n; i++) {
        GPoint p = gdraw_command_get_point(command, i);
        p.x = (int16_t)(((p.x - b->min_x) * b->num + b->den / 2) / b->den);
        p.y = (int16_t)(((p.y - b->min_y) * b->num + b->den / 2) / b->den);
        gdraw_command_set_point(command, i, p);
    }
    uint8_t sw = gdraw_command_get_stroke_width(command);
    if (sw > 1) {
        int nw = (sw * b->num + b->den / 2) / b->den;
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
    b.num = (int16_t)(target_h * PRECISE_UNITS_PER_PX);
    b.den = (int16_t)glyph_h;
    gdraw_command_list_iterate(list, icon_normalize_cb, &b);
    // Tight bounds: height == target_h px; width scaled by the same ratio so the layout
    // reserves the glyph's real footprint (width + gap before the value).
    gdraw_command_image_set_bounds_size(image, GSize((glyph_w * target_h) / glyph_h, target_h));
    return image;
}

static uint32_t icon_resource(uint8_t icon_id) {
    switch (icon_id) {
        case STATUS_ICON_TEMP: return RESOURCE_ID_STATUS_TEMP;
        case STATUS_ICON_UV: return RESOURCE_ID_STATUS_UV;
        case STATUS_ICON_WIND: return RESOURCE_ID_STATUS_WIND;
        case STATUS_ICON_GUST: return RESOURCE_ID_STATUS_GUST;
        case STATUS_ICON_PRECIP: return RESOURCE_ID_STATUS_PRECIP;
        case STATUS_ICON_AQI: return RESOURCE_ID_STATUS_AQI;   // weather metric, all providers
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
        case STATUS_ICON_HR:       return 92;
        case STATUS_ICON_WIND:     return 95;
        case STATUS_ICON_GUST:     return 95;
        case STATUS_ICON_STEPS:    return 80;   // the 25x25 footprint glyph is wide
        default:                   return 100;
    }
}

GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h) {
    uint32_t resource = icon_resource(icon_id);
    if (resource == 0 || target_h <= 0) { return NULL; }
    int h = (target_h * icon_scale_pct(icon_id)) / 100;
    if (h < 1) { h = 1; }
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
