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
// A status glyph inks one column past its bounds: icon_load (status_row_icons.c)
// snaps its vertices to pixel centres 0.5 .. w + 0.5 px, and the 1-px stroke covers
// both end columns — w + 1 columns of ink for bounds w.
#define GLYPH_INK_OVERHANG 1
// A text lane's measured width (graphics_text_layout_get_content_size) ends in the
// font's one blank column of letter spacing after its last glyph.
#define TEXT_TRAIL_SPACING 1

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

// The entry's text lane into `buf` ("" = none), and the font it prints in: a
// metric value bolds on its kind's ladder at the entry's real level
// (status_threshold_is_bold — danger bold, warn per the kind's Bold mode, and Bold
// 'Always', which the 'Bold values: All' master packs). The slot's Highlight switch
// does not touch it: the alert's look is its own (alert_set_box).
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
        int16_t w = (int16_t)(icon_w + (text_w > 0
            ? (icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0) + text_w : 0));
        // The box's padding is part of the footprint — but only around something:
        // an entry with nothing to draw stays 0 wide and is skipped with its gap.
        // Inside a box the group is measured by its INK, so the air to the stroke is
        // the same on both sides: the icon's ink starts on its left bounds column,
        // but a last icon inks GLYPH_INK_OVERHANG past its bounds and a last text
        // lane ends in TEXT_TRAIL_SPACING of blank letter spacing.
        if (w > 0 && !e->rain) {
            w = (int16_t)(w + 2 * STATUS_ALERTS_BOX_PAD_X
                + (text_w > 0 ? -TEXT_TRAIL_SPACING : GLYPH_INK_OVERHANG));
        }
        widths_out[i] = w;
    }
}

// The drawable colour for an accent byte. On B&W the escalation is polarity, not
// hue (status_row.c's rule): every accent is the foreground — so a warn look of
// fill draws a solid foreground box there, as picked.
static GColor accent_color(uint8_t c8) {
#ifdef PBL_COLOR
    return theme_pick((GColor){ .argb = c8 }, theme_fg());
#else
    (void)c8;
    return theme_fg();
#endif
}

static bool glyph_stroke_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void)index;
    gdraw_command_set_stroke_color(command, *(GColor *)context);
    return true;
}

// Restroke a cached outline glyph for a filled box, and back (status_row.c's
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
        // A boxed entry's content sits inside its padding; the rain drop has none.
        int16_t pad = e->rain ? 0 : STATUS_ALERTS_BOX_PAD_X;
        int16_t icon_x = (int16_t)(x + pad);
        int16_t text_x = (int16_t)(icon_x + icon_w
            + (icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0));
        // A metric entry's measure dropped the text's trailing letter spacing; the
        // frame gets it back (it is blank, inside the pad), so the text never
        // ellipsises against the width it was measured at.
        int16_t text_w = (int16_t)(x + w - pad - text_x
            + (e->rain ? 0 : TEXT_TRAIL_SPACING));

        GColor ink = fg;
        // A metric entry is boxed at DANGER always (filled) and at WARN per its
        // kind's warn look — none (the icon alone is the alert), outline or fill —
        // through status_threshold_box, the decision its slot makes too. Judged at
        // the entry's real level (alert_set_box): the slot's Highlight switch does
        // not touch the alert. The padding is measured in either way, so the row's
        // widths do not shift when a box appears.
        uint8_t c8 = 0;
        int box = alert_set_box(text->blob, text->blob_len, e, &c8);
        bool filled = box == THRESH_BOX_FILL;
        if (box != THRESH_BOX_NONE) {
            // The box IS the footprint: the padding was measured in, so it spans
            // exactly [x, x + w). Its height is the slots' font-derived extent
            // (status_highlight_extent_pad with a 0 pad is that extent, clamped).
            StatusHighlightExtent v = status_highlight_extent_pad(
                status_highlight_extent(place->band.origin.y, place->band.size.h,
                    place->glyph_cy, place->content_h, place->top_strip,
                    text_w > 0 && buf[0] != '\0' && status_text_has_descender(buf)),
                place->band.origin.y, place->band.size.h, place->top_strip,
                STATUS_ALERTS_BOX_PAD_Y);
            GRect box = GRect(x, v.y, w, v.h);
            GColor accent = accent_color(c8);
            if (filled) {
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
            if (filled) { glyph_set_stroke(image, ink); }
            gdraw_command_image_draw(ctx, image,
                GPoint(icon_x, status_icon_top_y(place->glyph_cy, gs.h, weight)));
            if (filled) { glyph_set_stroke(image, fg); }
        }
        if (text_w > 0 && buf[0] != '\0') {
            graphics_context_set_text_color(ctx, ink);
            graphics_draw_text(ctx, buf, font,
                GRect(text_x, place->text_y, text_w, (int16_t)(band_bottom - place->text_y)),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
        }
        x = (int16_t)(x + w + STATUS_ALERTS_ENTRY_GAP);
    }
}

#endif
