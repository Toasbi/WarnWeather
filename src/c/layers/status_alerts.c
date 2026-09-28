// Every include stays ABOVE the WW_ALERT_ROW guard, on purpose: waf's dependency
// scanner does not evaluate -D macros, so an `#include <pebble.h>` inside the guard
// would be invisible to it and this file could compile before the generated
// src/resource_ids.auto.h exists (night_light.c records the failure). Including a
// header emits no code, so aplite still compiles this file to an empty object.
#include <pebble.h>
#include <string.h>
#include "status_alerts.h"
#include "status_highlight.h"
#include "status_icon_weight.h"
#include "status_row_icons.h"
#include "status_row_layout.h"
#include "status_sig.h"
#include "../appendix/palette.h"
#include "../appendix/persist.h"
#include "../appendix/rain_countdown.h"
#include "../appendix/rain_tier.h"
#include "../appendix/status_threshold.h"
#include "../appendix/theme.h"
#include "../services/watch_services.h"

#if defined(WW_ALERT_ROW)

// Rain entries are keyed apart from the metric icons (StatusIconId, all < 0x80):
// the flag bit plus the drop bucket, so drizzle -> rain swaps the glyph.
#define RAIN_KEY_FLAG 0x80
// A text lane's buffer: the longest lane is the full rain countdown.
#define LANE_CAP RAIN_COUNTDOWN_TEXT_CAP
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

// NULL on OOM: the row then draws as without the feature until a later draw
// manages to allocate.
static StatusAlertsCache *cache_create(void) {
    StatusAlertsCache *cache = malloc(sizeof(StatusAlertsCache));
    if (cache) { memset(cache, 0, sizeof(*cache)); }
    return cache;
}

static void evict(StatusAlertsCache *cache, int slot) {
    status_row_icons_destroy(cache->images[slot]);
    cache->images[slot] = NULL;
    cache->keys[slot] = 0;
}

void status_alerts_release(StatusAlertsRow *row) {
    if (!row || !row->cache) { return; }
    for (int i = 0; i < ALERT_SET_MAX; i++) { evict(row->cache, i); }
    free(row->cache);
    row->cache = NULL;
}

// The rain drops' tint for a radar tier: the radar palette's colour on a colour
// theme, the foreground on B&W (palette_radar_color() hands B&W the strip's own
// background there, which would paint the drops invisibly).
static GColor status_alerts_rain_tint(int tier) {
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

// Make the cache hold exactly the glyphs `set` needs: load each entry's PDC at
// `target_h` (the row's icon tier; metric icons through status_row_icons_load, the
// rain drops through status_row_icons_load_filled) and EVICT every cached glyph no
// longer in the set — the rain-glyph model: resident only while its alert is up, so
// an idle row holds no heap at all. The foreground (the metric icons' stroke), the
// rain entry's tint and the light theme's edge on the drops are part of the cache
// key: a theme or tier change reloads just the glyphs it affects. Runs before every
// measure; a steady state is all cache hits.
static void status_alerts_ensure(StatusAlertsCache *cache, const AlertSet *set,
                                 int target_h, bool top_strip) {
    GColor fg = theme_fg();
    int rain_tier = (set->count > 0 && set->entries[0].rain) ? set->entries[0].rain_tier : 0;
    GColor rain_tint = status_alerts_rain_tint(rain_tier);
    bool rain_outline = theme_is_light();
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

// The entry's text lane into `buf` ("" = none), and the font it prints in. A metric
// entry's lane is alert_set_lane's: its value while text->values, inside tomorrow's
// mark ("»8", "8*") — the mark alone with the Icon look or once the ladder drops the
// values, so it is measured, boxed and fitted as part of the text like a value. It
// prints bold when its look says so (`bold` — the kind's ladder at the entry's real
// level: danger bold, warn per the kind's Bold mode, and Bold 'Always', which the
// 'Bold values: All' master packs), the mark with it, as the slot bolds its "»8";
// the rain text never bolds. The slot's Highlight switch does not touch it: the
// alert's look is its own.
static GFont lane_text(const AlertEntry *e, const StatusAlertsText *text, bool bold,
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
    alert_set_lane(e, text->values, buf, cap);
    return bold ? text->bold : text->font;
}

// The entry's look at its REAL level (status_threshold_look — the decision its
// kind's slot makes at the same level). The rain entry is ALERT_KIND_RAIN at
// NORMAL, which draws no box and never bolds.
static ThreshLook entry_look(const AlertEntry *e, const StatusAlertsText *text) {
    return status_threshold_look(text->blob, text->blob_len, e->kind, e->level);
}

static int16_t text_width(const char *s, GFont font) {
    if (s[0] == '\0') { return 0; }
    return graphics_text_layout_get_content_size(s, font, GRect(0, 0, 1000, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).w;
}

static int16_t icon_width(GDrawCommandImage *image) {
    return image ? gdraw_command_image_get_bounds_size(image).w : 0;
}

// Width of every entry of `set` into widths_out[0..count-1]: icon + (text ?
// STATUS_ROW_ICON_TEXT_GAP + text : 0), plus 2 * STATUS_ALERTS_BOX_PAD_X for a boxed
// (metric) entry — whose group is measured by its ink (a last icon's one-column
// overhang in, a last text's trailing letter spacing out), so its air to the box
// stroke is equal on both sides — where the text is the entry's lane under `text`
// (a metric value when text->values, inside a tomorrow entry's mark, which stays
// without it; the rain minutes or full countdown per text->rain_display). So a
// tomorrow entry's box wraps icon + mark + value as a today entry's wraps icon +
// value. 0 for an entry with neither a glyph nor text. The parts the
// width is summed from go into cells_out[i], for the paint. Needs the glyphs, so
// status_alerts_ensure() runs first.
static void status_alerts_measure(const StatusAlertsCache *cache, const AlertSet *set,
                                  const StatusAlertsText *text, int16_t *widths_out,
                                  StatusAlertsCell *cells_out) {
    for (int i = 0; i < set->count; i++) {
        const AlertEntry *e = &set->entries[i];
        char buf[LANE_CAP];
        GFont font = lane_text(e, text, entry_look(e, text).bold, buf, sizeof(buf));
        StatusAlertsCell *c = &cells_out[i];
        c->icon_w = icon_width(image_for(cache, e));
        c->text_w = text_width(buf, font);
        // A boxed entry's content sits inside its padding; the rain drop has none.
        c->pad = e->rain ? 0 : STATUS_ALERTS_BOX_PAD_X;
        int16_t w = (int16_t)(c->icon_w + (c->text_w > 0
            ? (c->icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0) + c->text_w : 0));
        // The box's padding is part of the footprint — but only around something:
        // an entry with nothing to draw stays 0 wide and is skipped with its gap.
        // Inside a box the group is measured by its INK, so the air to the stroke is
        // the same on both sides: the icon's ink starts on its left bounds column,
        // but a last icon inks GLYPH_INK_OVERHANG past its bounds and a last text
        // lane ends in TEXT_TRAIL_SPACING of blank letter spacing.
        if (w > 0 && !e->rain) {
            w = (int16_t)(w + 2 * c->pad
                + (c->text_w > 0 ? -TEXT_TRAIL_SPACING : GLYPH_INK_OVERHANG));
        }
        widths_out[i] = w;
    }
}

// Resolve the entries against the thresholds `blob` (the rain look): the metric
// entries from the stored tuple (one flash read — app_message.c has already checked
// it with alert_set_bytes_ok), the rain entry derived here, every pass, from the
// radar cache rain_countdown_refresh() keeps — O(1) and flash-free — which is why a
// row with a placement must be refreshed on the minute tick and after a radar rescan
// (status_row_uses_alerts). The tier is collapsed to its drop bucket HERE, on the SDK
// side: rain_tier.h pulls <pebble.h>, which the pure alert_set.c must not (it
// host-compiles).
static void resolve(StatusAlertsEntries *out, const uint8_t *blob, size_t len) {
    int n = persist_get_alert_entries(out->bytes, sizeof(out->bytes));
    alert_set_parse(out->bytes, n > 0 ? (size_t)n : 0, &out->set);
    bool rain = rain_countdown_format(out->rain_text, sizeof(out->rain_text),
                                      watch_services_now());
    if (!rain) { out->rain_text[0] = '\0'; }
    int tier = rain ? rain_countdown_peak_tier() : 0;
    alert_set_prepend_rain(&out->set, rain, rain_tier_to_bucket3(tier), tier);
    out->rain_display = status_threshold_rain_display(blob, len);
}

// The fold covers the look each entry reads from the blob at its level
// (status_threshold_look — a Clay save that only recolours or re-looks must repaint,
// as for a slot's look; the kind's slot Highlight switch does not touch an entry, so
// it is not folded), its day — today's, or tomorrow's with its mark, so a flip
// between the two or a new mark repaints even when the value and level stay — and
// the drop's bucket and tier (its glyph and tint). The countdown text only when a
// look prints it, or an icon-only rain alert would repaint every minute for nothing.
uint16_t status_alerts_fold(const StatusAlertsRow *row, uint16_t sig,
                            const uint8_t *blob, size_t len) {
    if (!row || row->place == THRESH_ALERTS_OFF) { return sig; }
    StatusAlertsEntries a;
    resolve(&a, blob, len);
    sig = sig_fold(sig, &a.set.count, 1);
    for (int i = 0; i < a.set.count; i++) {
        const AlertEntry *e = &a.set.entries[i];
        uint8_t head[6] = { (uint8_t)e->rain, e->kind, e->level, e->day, e->rain_bucket,
                            e->rain_tier };
        sig = sig_fold(sig, head, sizeof(head));
        if (e->rain) { continue; }
        sig = sig_fold(sig, (const uint8_t *)e->value, e->value_len);
        ThreshLook look = status_threshold_look(blob, len, e->kind, e->level);
        sig = sig_fold(sig, (const uint8_t *)&look, sizeof(look));
    }
    uint8_t display = (uint8_t)a.rain_display;
    sig = sig_fold(sig, &display, 1);
    if (a.rain_display != THRESH_RAIN_DISPLAY_ICON) {
        sig = sig_fold(sig, (const uint8_t *)a.rain_text, strlen(a.rain_text));
    }
    return sig;
}

// Resolve and measure the entries at their full lanes. False = nothing to draw (no
// alert active, or OOM for the cache): the bar then lays out exactly as it would
// without the feature. Also where the glyph cache lives: created by the first pass
// that has an entry to draw, and emptied (status_alerts_ensure evicts what the set no
// longer holds) by every pass after.
static bool prepare(StatusAlertsRow *row, StatusAlertsPass *p, const StatusAlertsEnv *env) {
    resolve(&p->r, env->blob, env->blob_len);
    const AlertSet *set = &p->r.set;
    if (!row->cache && set->count > 0) { row->cache = cache_create(); }
    if (!row->cache) { return false; }
    status_alerts_ensure(row->cache, set, env->icon_h, env->top_strip);
    if (set->count == 0) { return false; }
    p->text = (StatusAlertsText){
        .font = env->font,
        .bold = env->bold,
        .blob = env->blob,
        .blob_len = env->blob_len,
        .rain_display = p->r.rain_display,
        .values = true,
        .rain_text = p->r.rain_text[0] != '\0' ? p->r.rain_text : NULL
    };
    status_alerts_measure(row->cache, set, &p->text, p->widths, p->cells);
    return true;
}

// The takeover (spec 4.1): lay the bar out without the slots the row replaces, then
// fit the row into the span they leave.
//  1. alert_set_take — the anchor slot of the bar's placement, plus one neighbour
//     when the row at its FULL lanes does not fit the span the anchor leaves
//     (LEFT/RIGHT borrow the middle slot, MIDDLE the left one; never more). The
//     slots it keeps sit exactly where they would anyway (the middle one stays
//     centred), and a RIGHT row lays out as a MIDDLE one while the low-battery
//     warning holds the right slot.
//  2. Within the span the lanes degrade before any entry drops (rain text ->
//     minutes, then every value off; alert_set_degrade), and only then does the
//     tail go (alert_set_fit: pollen first, rain last).
//  3. The row sits left-aligned (LEFT), centred on the row (MIDDLE) or against the
//     right edge (RIGHT) inside the span (alert_set_row_x).
// And when not even the first entry fits, the taken slots come back: the bar lays
// out as if the row were not there — a slot is replaced only by alerts it actually
// shows, never by a blank gap.
void status_alerts_layout(StatusAlertsRow *row, StatusAlertsPass *pass,
                          const StatusAlertsEnv *env, const StatusSlotMeasure m[3],
                          StatusSlotPlace places[3], int16_t content_w) {
    pass->n = 0;
    if (row->place == THRESH_ALERTS_OFF || !prepare(row, pass, env)) {
        status_row_layout(content_w, m, places);
        return;
    }
    const AlertSet *set = &pass->r.set;
    int need = alert_set_row_w(pass->widths, set->count, STATUS_ALERTS_ENTRY_GAP);
    int x0;
    int x1;
    alert_set_take(row->place, env->battery, need, content_w, m, places, &x0, &x1);
    int budget = x1 - x0;

    while (need > budget
            && alert_set_degrade(&pass->text.rain_display, &pass->text.values)) {
        status_alerts_measure(row->cache, set, &pass->text, pass->widths, pass->cells);
        need = alert_set_row_w(pass->widths, set->count, STATUS_ALERTS_ENTRY_GAP);
    }
    pass->n = alert_set_fit(pass->widths, set->count, STATUS_ALERTS_ENTRY_GAP, budget);
    if (pass->n == 0) {
        // Nothing fits (a long City left beside the anchor, say): hand the slots
        // back rather than paint a blank gap where they were. pass->n stays 0, so
        // the paint draws no entry.
        status_row_layout(content_w, m, places);
        return;
    }
    int w = alert_set_row_w(pass->widths, pass->n, STATUS_ALERTS_ENTRY_GAP);
    pass->x = (int16_t)alert_set_row_x(row->place, env->battery, x0, x1, content_w, w);
}

// Each entry paints as its own mini slot with its own box. The slots the row replaced
// were zeroed out of the layout, so neither of the row's slot passes touches them.
void status_alerts_paint(GContext *ctx, const StatusAlertsRow *row,
                         const StatusAlertsPass *pass, const StatusAlertsEnv *env) {
    if (!ctx || !row || !pass || !env || pass->n <= 0 || !row->cache) { return; }
    const StatusAlertsCache *cache = row->cache;
    const AlertSet *set = &pass->r.set;
    const StatusAlertsText *text = &pass->text;
    int n = pass->n > set->count ? set->count : pass->n;
    int16_t x = (int16_t)(env->x + pass->x);
    int16_t band_bottom = (int16_t)(env->band.origin.y + env->band.size.h);
    for (int i = 0; i < n; i++) {
        int16_t w = pass->widths[i];
        if (w <= 0) { continue; }   // no room, no gap (alert_set_row_w)
        const AlertEntry *e = &set->entries[i];
        const StatusAlertsCell *c = &pass->cells[i];
        GDrawCommandImage *image = image_for(cache, e);
        const ThreshLook look = entry_look(e, text);
        char buf[LANE_CAP];
        GFont font = lane_text(e, text, look.bold, buf, sizeof(buf));
        int16_t icon_x = (int16_t)(x + c->pad);
        int16_t text_x = (int16_t)(icon_x + c->icon_w
            + (c->icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0));
        // The frame is the lane's whole measured width: the trailing letter spacing
        // a boxed footprint leaves out is blank and sits inside the pad, so the text
        // never ellipsises against the width it was measured at.
        int16_t text_w = c->text_w;

        GColor ink = theme_fg();
        // A metric entry is boxed at DANGER always (filled) and at WARN per its
        // kind's warn look — none (the icon alone is the alert), outline or fill —
        // and painted as its slot would be (status_highlight_paint). Judged at the
        // entry's real level: the slot's Highlight switch does not touch the alert.
        // The padding is measured in either way, so the row's widths do not shift
        // when a box appears.
        if (look.box != THRESH_BOX_NONE) {
            // The box IS the footprint: the padding was measured in, so it spans
            // exactly [x, x + w). Its height is the slots' font-derived extent.
            StatusHighlightExtent v = status_highlight_extent(
                env->band.origin.y, env->band.size.h, env->glyph_cy,
                env->content_h, env->top_strip,
                text_w > 0 && buf[0] != '\0' && status_text_has_descender(buf));
            ink = status_highlight_paint(ctx, GRect(x, v.y, w, v.h), look);
        }

        if (image) {
            GSize gs = gdraw_command_image_get_bounds_size(image);
            int weight = e->rain ? STATUS_ICON_WEIGHT_CENTRE
                                 : status_icon_weight_pct(alert_set_icon(e->kind));
            status_highlight_draw_glyph(ctx, image,
                GPoint(icon_x, status_icon_top_y(env->glyph_cy, gs.h, weight)), ink);
        }
        if (text_w > 0 && buf[0] != '\0') {
            graphics_context_set_text_color(ctx, ink);
            graphics_draw_text(ctx, buf, font,
                GRect(text_x, env->text_y, text_w, (int16_t)(band_bottom - env->text_y)),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
        }
        x = (int16_t)(x + w + STATUS_ALERTS_ENTRY_GAP);
    }
}

#endif
