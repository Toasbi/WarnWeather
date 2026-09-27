// Every include stays ABOVE the WW_ALERT_ROW guard, on purpose: waf's dependency
// scanner does not evaluate -D macros, so an `#include <pebble.h>` inside the guard
// would be invisible to it and this file could compile before the generated
// src/resource_ids.auto.h exists (night_light.c records the failure). Including a
// header emits no code, so aplite still compiles this file to an empty object.
#include <pebble.h>
#include <string.h>
#include "status_alerts.h"
#include "status_icon_weight.h"
#include "status_row_icons.h"
#include "status_row_layout.h"
#include "../appendix/palette.h"
#include "../appendix/status_threshold.h"
#include "../appendix/theme.h"

#if defined(WW_ALERT_ROW)

// Rain entries are keyed apart from the metric icons (StatusIconId, all < 0x80):
// the flag bit plus the drop bucket, so drizzle -> rain swaps the glyph.
#define RAIN_KEY_FLAG 0x80
// rain_countdown_format()'s buffer contract: "Downpour for +99'" + NUL fits 20.
#define LANE_CAP 20

struct StatusAlertsCache {
    GDrawCommandImage *images[ALERT_SET_MAX];
    uint8_t keys[ALERT_SET_MAX];   // 0 = free; see entry_key()
    int16_t target_h;
    bool top_strip;
    GColor fg;
    GColor rain_tint;
    bool rain_outline;
};

StatusAlertsCache *status_alerts_create(void) {
    StatusAlertsCache *cache = malloc(sizeof(StatusAlertsCache));
    if (cache) { memset(cache, 0, sizeof(*cache)); }
    return cache;
}

static void evict(StatusAlertsCache *cache, int slot) {
    status_row_icons_destroy(cache->images[slot]);
    cache->images[slot] = NULL;
    cache->keys[slot] = 0;
}

void status_alerts_destroy(StatusAlertsCache *cache) {
    if (!cache) { return; }
    for (int i = 0; i < ALERT_SET_MAX; i++) { evict(cache, i); }
    free(cache);
}

GColor status_alerts_rain_tint(int tier) {
#ifdef PBL_COLOR
    if (!theme_is_bw()) { return palette_radar_color(tier); }
#endif
    (void)tier;
    return theme_fg();
}

static uint8_t entry_key(const AlertEntry *e) {
    return e->rain ? (uint8_t)(RAIN_KEY_FLAG | e->rain_bucket) : alert_set_icon(e->kind);
}

static int find_key(const StatusAlertsCache *cache, uint8_t key) {
    for (int i = 0; i < ALERT_SET_MAX; i++) {
        if (cache->keys[i] == key) { return i; }
    }
    return -1;
}

static bool set_has_key(const AlertSet *set, uint8_t key) {
    for (int i = 0; i < set->count; i++) {
        if (entry_key(&set->entries[i]) == key) { return true; }
    }
    return false;
}

static uint32_t rain_resource(uint8_t bucket) {
    switch (bucket) {
        case 1:  return RESOURCE_ID_RAIN_DRIZZLE;
        case 2:  return RESOURCE_ID_RAIN_RAIN;
        default: return RESOURCE_ID_RAIN_DOWNPOUR;   // bucket 3 (emery-only)
    }
}

void status_alerts_ensure(StatusAlertsCache *cache, const AlertSet *set,
                          int target_h, bool top_strip, GColor fg,
                          GColor rain_tint, bool rain_outline) {
    if (!cache || !set) { return; }
    // What a glyph was built for is part of its key: the tier's size and the
    // foreground stroke for every glyph, the tint and light-theme edge for the drops.
    bool env = target_h != cache->target_h || top_strip != cache->top_strip
        || !gcolor_equal(fg, cache->fg);
    bool rain_env = env || !gcolor_equal(rain_tint, cache->rain_tint)
        || rain_outline != cache->rain_outline;
    for (int i = 0; i < ALERT_SET_MAX; i++) {
        uint8_t key = cache->keys[i];
        if (key == 0) { continue; }
        bool stale = (key & RAIN_KEY_FLAG) ? rain_env : env;
        if (stale || !set_has_key(set, key)) { evict(cache, i); }
    }
    cache->target_h = (int16_t)target_h;
    cache->top_strip = top_strip;
    cache->fg = fg;
    cache->rain_tint = rain_tint;
    cache->rain_outline = rain_outline;
    for (int i = 0; i < set->count; i++) {
        const AlertEntry *e = &set->entries[i];
        uint8_t key = entry_key(e);
        if (key == 0 || find_key(cache, key) >= 0) { continue; }
        int slot = find_key(cache, 0);
        if (slot < 0) { break; }   // unreachable: at most ALERT_SET_MAX distinct keys
        // A failed load keeps its key with a NULL image — the entry measures
        // text-only and the load is not retried every frame (ensure_glyphs' rule).
        cache->images[slot] = e->rain
            ? status_row_icons_load_filled(rain_resource(e->rain_bucket), target_h,
                                           rain_tint, rain_outline)
            : status_row_icons_load(key, target_h, top_strip);
        cache->keys[slot] = key;
    }
}

static GDrawCommandImage *image_for(const StatusAlertsCache *cache, const AlertEntry *e) {
    int slot = find_key(cache, entry_key(e));
    return slot >= 0 ? cache->images[slot] : NULL;
}

// The entry's text lane into `buf` ("" = none), and the font it prints in.
static GFont lane_text(const AlertEntry *e, const StatusAlertsText *text,
                       char *buf, size_t cap) {
    buf[0] = '\0';
    if (e->rain) {
        if (text->rain_text && text->rain_display == THRESH_RAIN_DISPLAY_MINUTES) {
            alert_set_rain_minutes(text->rain_text, buf, cap);
        } else if (text->rain_text && text->rain_display != THRESH_RAIN_DISPLAY_ICON) {
            strncpy(buf, text->rain_text, cap - 1);
            buf[cap - 1] = '\0';
        }
        return text->font;
    }
    if (text->values && e->value_len > 0 && e->value) {
        size_t n = e->value_len < cap - 1 ? e->value_len : cap - 1;
        memcpy(buf, e->value, n);
        buf[n] = '\0';
    }
    return status_threshold_is_bold(text->blob, text->blob_len, e->kind, e->level)
        ? text->bold : text->font;
}

static int16_t text_width(const char *s, GFont font) {
    if (s[0] == '\0') { return 0; }
    return graphics_text_layout_get_content_size(s, font, GRect(0, 0, 1000, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).w;
}

static int16_t icon_width(GDrawCommandImage *image) {
    return image ? gdraw_command_image_get_bounds_size(image).w : 0;
}

void status_alerts_measure(StatusAlertsCache *cache, const AlertSet *set,
                           const StatusAlertsText *text, int16_t *widths_out) {
    if (!cache || !set || !text || !widths_out) { return; }
    for (int i = 0; i < set->count; i++) {
        const AlertEntry *e = &set->entries[i];
        char buf[LANE_CAP];
        GFont font = lane_text(e, text, buf, sizeof(buf));
        int16_t icon_w = icon_width(image_for(cache, e));
        int16_t text_w = text_width(buf, font);
        widths_out[i] = (int16_t)(icon_w + (text_w > 0
            ? (icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0) + text_w : 0));
    }
}

// The kind's accent at `level`, drawable. An alert has no bold to fall back on, so
// the slots' 0x00 "no outline" sentinel outlines in the foreground instead of
// vanishing. On B&W the escalation is polarity, not hue (status_row.c's rule).
static GColor alert_accent(const StatusAlertsText *text, const AlertEntry *e) {
#ifdef PBL_COLOR
    uint8_t c8 = status_threshold_color8(text->blob, text->blob_len, e->kind, e->level);
    if (c8 == 0) { return theme_fg(); }
    return theme_pick((GColor){ .argb = c8 }, theme_fg());
#else
    (void)text;
    (void)e;
    return theme_fg();
#endif
}

static bool glyph_stroke_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void)index;
    gdraw_command_set_stroke_color(command, *(GColor *)context);
    return true;
}

// Restroke a cached outline glyph for a danger fill, and back (status_row.c's
// glyph_set_stroke): the cache holds the foreground between draws.
static void glyph_set_stroke(GDrawCommandImage *image, GColor color) {
    gdraw_command_list_iterate(gdraw_command_image_get_command_list(image),
                               glyph_stroke_cb, &color);
}

void status_alerts_draw(GContext *ctx, StatusAlertsCache *cache, const AlertSet *set,
                        int n, const int16_t *widths, const StatusAlertsText *text,
                        const StatusAlertsPlace *place) {
    if (!ctx || !cache || !set || !widths || !text || !place) { return; }
    if (n > set->count) { n = set->count; }
    GColor fg = theme_fg();
    int16_t x = place->x;
    int16_t band_bottom = (int16_t)(place->band.origin.y + place->band.size.h);
    for (int i = 0; i < n; i++) {
        int16_t w = widths[i];
        if (w <= 0) { continue; }   // no room, no gap (alert_set_row_w)
        const AlertEntry *e = &set->entries[i];
        GDrawCommandImage *image = image_for(cache, e);
        int16_t icon_w = icon_width(image);
        char buf[LANE_CAP];
        GFont font = lane_text(e, text, buf, sizeof(buf));
        int16_t text_x = (int16_t)(x + icon_w + (icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0));
        int16_t text_w = (int16_t)(x + w - text_x);

        GColor ink = fg;
        bool danger = !e->rain && e->level == THRESH_LEVEL_DANGER;
        if (!e->rain) {
            // The box hugs the entry, 1 px out each side — two neighbouring boxes
            // still keep 2 px of air across the 4-px entry gap. Its height is the
            // slots' font-derived extent, so an entry's box matches a slot's.
            StatusHighlightExtent v = status_highlight_extent(
                place->band.origin.y, place->band.size.h, place->glyph_cy,
                place->content_h, place->top_strip,
                text_w > 0 && buf[0] != '\0' && status_text_has_descender(buf));
            GRect box = GRect((int16_t)(x - 1), v.y, (int16_t)(w + 2), v.h);
            GColor accent = alert_accent(text, e);
            if (danger) {
                graphics_context_set_fill_color(ctx, accent);
                graphics_fill_rect(ctx, box, 2, GCornersAll);
                ink = gcolor_legible_over(accent);
            }
            graphics_context_set_stroke_color(ctx, accent);
            graphics_draw_round_rect(ctx, box, 2);
        }

        if (image) {
            GSize gs = gdraw_command_image_get_bounds_size(image);
            int weight = e->rain ? STATUS_ICON_WEIGHT_CENTRE
                                 : status_icon_weight_pct(alert_set_icon(e->kind));
            if (danger) { glyph_set_stroke(image, ink); }
            gdraw_command_image_draw(ctx, image,
                GPoint(x, status_icon_top_y(place->glyph_cy, gs.h, weight)));
            if (danger) { glyph_set_stroke(image, fg); }
        }
        if (text_w > 0 && buf[0] != '\0') {
            graphics_context_set_text_color(ctx, ink);
            graphics_draw_text(ctx, buf, font,
                GRect(text_x, place->text_y, text_w, (int16_t)(band_bottom - place->text_y)),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
        }
        x = (int16_t)(x + w + STATUS_ROW_GROUP_GAP);
    }
}

#endif
