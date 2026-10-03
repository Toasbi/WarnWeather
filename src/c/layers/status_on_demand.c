// Every include stays ABOVE the WW_ON_DEMAND guard, on purpose: waf's dependency
// scanner does not evaluate -D macros, so an `#include <pebble.h>` inside the guard
// would be invisible to it and this file could compile before the generated
// src/resource_ids.auto.h exists (night_light.c records the failure). Including a
// header emits no code, so aplite still compiles this file to an empty object.
#include <pebble.h>
#include <stdio.h>
#include <string.h>
#include "status_on_demand.h"
#include "battery_glyph.h"
#include "battery_item.h"
#include "status_highlight.h"
#include "status_row.h"
#include "status_row_icons.h"
#include "status_row_layout.h"
#include "status_sig.h"
#include "../appendix/config.h"
#include "../appendix/palette.h"
#include "../appendix/persist.h"
#include "../appendix/rain_countdown.h"
#include "../appendix/snooze.h"
#include "../appendix/status_short_text.h"
#include "../appendix/status_threshold.h"
#include "../appendix/theme.h"
#include "../services/watch_services.h"

#if defined(WW_ON_DEMAND)

// Glyph keys: the metric icons are their StatusIconId (to STATUS_ICON_MAX), the system
// glyphs their in-memory ids (status_row_icons.h), and the rain drops the flag bit
// plus the drop bucket, so drizzle -> rain swaps the glyph.
#define RAIN_KEY_FLAG 0x80
// Quiet time, one Bluetooth variant, rain and the five metric kinds.
#define GLYPH_SLOTS 8

struct StatusOnDemandCache {
    GDrawCommandImage *images[GLYPH_SLOTS];
    uint8_t keys[GLYPH_SLOTS];   // 0 = free
    int16_t target_h;
    bool top_strip;
    GColor fg;
    GColor rain_tint;
    bool rain_outline;
};

// NULL on OOM: the glyph items then measure text-only (or not at all) until a later
// draw manages to allocate; the procedural Battery and Sleep need no glyph.
static StatusOnDemandCache *cache_create(void) {
    StatusOnDemandCache *cache = malloc(sizeof(StatusOnDemandCache));
    if (cache) { memset(cache, 0, sizeof(*cache)); }
    return cache;
}

static void evict(StatusOnDemandCache *cache, int slot) {
    status_row_icons_destroy(cache->images[slot]);
    cache->images[slot] = NULL;
    cache->keys[slot] = 0;
}

void status_on_demand_release(StatusOnDemandRow *row) {
    if (!row || !row->cache) { return; }
    for (int i = 0; i < GLYPH_SLOTS; i++) { evict(row->cache, i); }
    free(row->cache);
    row->cache = NULL;
}

// The drops' tint for a radar tier: the radar palette's colour on a colour theme,
// the foreground on B&W (palette_radar_color() hands B&W the strip's own background
// there, which would paint the drops invisibly).
static GColor rain_tint(int tier) {
#ifdef PBL_COLOR
    if (!theme_is_bw()) { return palette_radar_color(tier); }
#endif
    (void)tier;
    return theme_fg();
}

// The Bluetooth glyph's ink, `hue` PictonBlue connected and red disconnected. The
// light theme draws it in the foreground — a saturated blue reads poorly on a white
// strip; a dark colour theme keeps the hue, and B&W collapses to the foreground
// through theme_pick().
static GColor bt_ink(GColor hue) {
    return theme_is_light() ? theme_fg() : theme_pick(hue, theme_fg());
}

static uint32_t rain_resource(uint8_t bucket) {
    switch (bucket) {
        case 1:  return RESOURCE_ID_RAIN_DRIZZLE;
        case 2:  return RESOURCE_ID_RAIN_RAIN;
        default: return RESOURCE_ID_RAIN_DOWNPOUR;   // bucket 3 (emery-only)
    }
}

static int find_key(const StatusOnDemandCache *cache, uint8_t key) {
    for (int i = 0; i < GLYPH_SLOTS; i++) {
        if (cache->keys[i] == key) { return i; }
    }
    return -1;
}

// Make the cache hold exactly the glyphs in `keys` (n of them): load each at
// `target_h` (the row's icon tier; outline art through status_row_icons_load, the
// rain drops through status_row_icons_load_filled) and EVICT every cached glyph no
// longer wanted — resident only while its item is active, so an idle bar holds no
// glyph heap. The foreground, the rain tint and the light theme's edge on the drops
// are part of the key: a theme or tier change reloads just the glyphs it affects.
static void ensure(StatusOnDemandCache *cache, const uint8_t *keys, int n, int tier,
                   int target_h, bool top_strip) {
    GColor fg = theme_fg();
    GColor tint = rain_tint(tier);
    bool outline = theme_is_light();
    bool env = target_h != cache->target_h || top_strip != cache->top_strip
        || !gcolor_equal(fg, cache->fg);
    bool rain_env = env || !gcolor_equal(tint, cache->rain_tint) || outline != cache->rain_outline;
    for (int i = 0; i < GLYPH_SLOTS; i++) {
        uint8_t key = cache->keys[i];
        if (key == 0) { continue; }
        bool wanted = false;
        for (int k = 0; k < n; k++) {
            if (keys[k] == key) { wanted = true; }
        }
        bool stale = (key & RAIN_KEY_FLAG) ? rain_env : env;
        if (stale || !wanted) { evict(cache, i); }
    }
    cache->target_h = (int16_t)target_h;
    cache->top_strip = top_strip;
    cache->fg = fg;
    cache->rain_tint = tint;
    cache->rain_outline = outline;
    for (int k = 0; k < n; k++) {
        uint8_t key = keys[k];
        if (key == 0 || find_key(cache, key) >= 0) { continue; }
        int slot = find_key(cache, 0);
        if (slot < 0) { break; }   // unreachable: at most GLYPH_SLOTS distinct keys
        // A failed load (OOM) leaves the slot free, so the next draw — the minute's
        // redraw at the latest — tries again, as the old strip's indicator icons did;
        // until then the item measures text-only, or not at all (Bluetooth, Quiet time).
        cache->images[slot] = (key & RAIN_KEY_FLAG)
            ? status_row_icons_load_filled(rain_resource(key & ~RAIN_KEY_FLAG), target_h,
                                           tint, outline)
            : status_row_icons_load(key, target_h, top_strip);
        if (cache->images[slot]) { cache->keys[slot] = key; }
    }
}

static GDrawCommandImage *image_for(const StatusOnDemandCache *cache, uint8_t key) {
    if (!cache || key == 0) { return NULL; }
    int slot = find_key(cache, key);
    return slot >= 0 ? cache->images[slot] : NULL;
}

// The entry of metric item `item`: the first of its kind in the set (the phone bakes at
// most one per kind); NULL for none, and for every other item.
static const AlertEntry *item_entry(const StatusOnDemandState *s, int item) {
    for (int i = 0; i < s->set.count; i++) {
        if (alert_set_item(s->set.entries[i].kind) == item) { return &s->set.entries[i]; }
    }
    return NULL;
}

// Everything that decides what the bar's items draw: which item sits on which side
// of `bar`, which of them are active, and what they show. Only what an assigned item
// needs is read — the charge for Battery, the link for Bluetooth, the radar cache for
// Rain, the entries for a metric alert — so a bar without items costs ten cell reads.
// The rain alert comes from the cache rain_countdown_refresh() keeps, every pass —
// O(1) and flash-free — which is why a bar with items is refreshed on the minute tick
// and after a radar rescan; the metric alerts from the stored tuple (one flash read —
// app_message.c has already checked it with alert_set_bytes_ok). Returns the tuple
// bytes read into s->bytes: 0 when none is stored, or the bar has no metric item.
static size_t collect(StatusOnDemandState *s, int bar, const uint8_t blob[THRESH_SETTINGS_BYTES]) {
    s->set.count = 0;
    s->rain_display = THRESH_RAIN_DISPLAY_TEXT;
    s->bt_key = 0;
    s->charge = 0;
    s->charging = false;
    s->battery_value = false;
    bool metric = false;
    for (int item = 0; item < OD_ITEM_COUNT; item++) {
        s->side[item] = (uint8_t)status_threshold_on_demand_side(blob, bar, item);
        s->active[item] = false;
        if (item >= OD_GUST && s->side[item] != OD_SIDE_NONE) { metric = true; }
    }
    if (s->side[OD_BATTERY] != OD_SIDE_NONE) {
        BatteryChargeState bs = watch_services_battery_state();
        s->charge = bs.charge_percent;
        s->charging = bs.is_charging || bs.is_plugged;
        s->battery_value = status_threshold_battery_value(blob);
        s->active[OD_BATTERY] = status_threshold_battery_low(s->charge,
                                                             status_threshold_battery_level(blob));
    }
    if (s->side[OD_BLUETOOTH] != OD_SIDE_NONE) {
        const Config *cfg = config_get();
        bool connected = connection_service_peek_pebble_app_connection();
        bool show = cfg && (connected ? cfg->show_bt : cfg->show_bt_disconnect);
        s->bt_key = show ? (connected ? STATUS_ROW_ICON_BT : STATUS_ROW_ICON_BT_OFF) : 0;
        s->active[OD_BLUETOOTH] = show;
    }
    if (s->side[OD_QUIET_TIME] != OD_SIDE_NONE) {
        s->active[OD_QUIET_TIME] = quiet_time_is_active();
    }
    if (s->side[OD_SLEEP] != OD_SIDE_NONE) {
        s->active[OD_SLEEP] = persist_get_is_sleeping();
    }
    if (s->side[OD_RAIN] != OD_SIDE_NONE) {
        s->rain_display = status_threshold_rain_display(blob);
        s->active[OD_RAIN] = rain_countdown_get(&s->rain, watch_services_now());
    }
    if (!metric) { return 0; }
    size_t n = (size_t)persist_get_alert_entries(s->bytes, sizeof(s->bytes));
    alert_set_parse(s->bytes, n, &s->set);
    for (int item = OD_GUST; item < OD_ITEM_COUNT; item++) {
        s->active[item] = s->side[item] != OD_SIDE_NONE && item_entry(s, item);
    }
    return n;
}

// The active item's text on `lane` into `buf` ("" = none), and the font it prints in:
// the Battery's "8%" with the Look Icon + value (off with the values), the rain
// alert's text or its minutes (alert_set_rain_text), and a metric entry's
// alert_set_lane — its value inside tomorrow's mark, in bold when its look says so
// (danger, warn per the kind's Bold mode, 'Always'). Bluetooth, Quiet time and Sleep
// have no text; the rain text never bolds.
static GFont item_text(const StatusOnDemandState *s, int item, int lane,
                       const StatusOnDemandEnv *env, char *buf, size_t cap) {
    buf[0] = '\0';
    int rd;
    bool values;
    od_lane_look(s->rain_display, lane, &rd, &values);
    if (item == OD_BATTERY) {
        if (s->battery_value && values) { snprintf(buf, cap, "%d%%", s->charge); }
        return env->font;
    }
    if (item == OD_RAIN) {
        if (rd != THRESH_RAIN_DISPLAY_ICON) {
            alert_set_rain_text(&s->rain, rd == THRESH_RAIN_DISPLAY_MINUTES, buf, cap);
        }
        return env->font;
    }
    const AlertEntry *e = item_entry(s, item);
    if (!e) { return env->font; }
    alert_set_lane(e, values, buf, cap);
    return status_threshold_look(env->blob, e->kind, e->level).bold
        ? env->bold : env->font;
}

// The glyph an active item draws; 0 for the procedural Battery and Sleep.
static uint8_t item_key(const StatusOnDemandState *s, int item) {
    switch (item) {
        case OD_BATTERY:
        case OD_SLEEP:      return 0;
        case OD_BLUETOOTH:  return s->bt_key;
        case OD_QUIET_TIME: return STATUS_ROW_ICON_QUIET;
        case OD_RAIN:       return (uint8_t)(RAIN_KEY_FLAG | s->rain.bucket);
        default: {
            const AlertEntry *e = item_entry(s, item);
            return e ? alert_set_icon(e->kind) : 0;
        }
    }
}

// The width of active item `item`'s glyph: the battery's, Sleep's square, a cached
// glyph's bounds; 0 = no glyph. Needs the glyphs, so ensure() runs first. The measure
// and the paint both ask it, in the same draw, so they agree.
static int16_t item_icon_w(const StatusOnDemandRow *row, const StatusOnDemandState *s,
                           const StatusOnDemandEnv *env, int item) {
    if (item == OD_BATTERY) { return battery_item_width(env->icon_h, s->charging); }
    if (item == OD_SLEEP) { return env->icon_h; }
    GDrawCommandImage *image = image_for(row->cache, item_key(s, item));
    return image ? gdraw_command_image_get_bounds_size(image).w : 0;
}

// The width of a lane's text `buf` in `font`. A lane's text is never cut: measured in a
// box no text reaches. The measure and the paint both take it, on the same text in the
// same draw, so the paint draws each lane at the width the layout placed.
static int16_t lane_text_w(const char *buf, GFont font) {
    return status_row_text_w(buf, font, 1000, 100);
}

// Measure `item`'s footprint on every lane into `w` (od_item_footprint: a boxed metric
// entry pads STATUS_ON_DEMAND_BOX_PAD_X a side).
static void measure(const StatusOnDemandState *s, const StatusOnDemandRow *row,
                    const StatusOnDemandEnv *env, int item, int16_t w[OD_LANES]) {
    const int16_t icon_w = item_icon_w(row, s, env, item);
    for (int lane = 0; lane < OD_LANES; lane++) {
        char buf[ALERT_SET_LANE_CAP];
        GFont font = item_text(s, item, lane, env, buf, sizeof(buf));
        int16_t tw = lane_text_w(buf, font);
        int16_t fw = od_item_footprint(icon_w, tw, od_item_boxed(item),
                                       STATUS_ON_DEMAND_BOX_PAD_X);
        // A lane with nothing left to draw keeps the lane before's width: it can give
        // nothing more.
        if (fw <= 0 && lane > 0) { fw = w[lane - 1]; }
        w[lane] = fw;
    }
}

// The items' inputs beyond the blob, as an explicit list: the live state, the entries
// tuple as stored, and the rain alert's numbers. The charge only while Battery is
// active, and the minutes and whether it rains only while the rain look prints them,
// or an idle Battery or an icon-only rain alert would repaint every minute for nothing.
uint16_t status_on_demand_fold(StatusOnDemandRow *row, uint16_t sig, int bar,
                               const uint8_t blob[THRESH_SETTINGS_BYTES]) {
    if (!row) { return sig; }
    StatusOnDemandState s;
    size_t n = collect(&s, bar, blob);
    bool assigned = false;
    for (int item = 0; item < OD_ITEM_COUNT; item++) {
        if (s.side[item] != OD_SIDE_NONE) { assigned = true; }
    }
    row->assigned = assigned;
    if (!assigned) {
        // Nothing can draw here: give the glyphs back now rather than at teardown.
        status_on_demand_release(row);
        return sig;
    }
    // One fold: what an inactive item would add stays 0, so it changes nothing.
    const bool batt = s.active[OD_BATTERY];
    const bool rain = s.active[OD_RAIN];
    const bool text = rain && s.rain_display != THRESH_RAIN_DISPLAY_ICON;
    uint8_t live[10] = { (uint8_t)batt, s.bt_key, (uint8_t)s.active[OD_QUIET_TIME],
                         (uint8_t)s.active[OD_SLEEP], (uint8_t)rain,
                         batt ? s.charge : 0, (uint8_t)(batt && s.charging),
                         rain ? s.rain.tier : 0, text ? s.rain.mins : 0,
                         (uint8_t)(text && s.rain.raining) };
    sig = sig_fold(sig, live, sizeof(live));
    return sig_fold(sig, s.bytes, n);
}

// One draw's short forms: the three slots' families as the layout takes them, and the
// one input their members take beside the slot itself, so the member a slot ends up
// drawing can be derived again. On the draw's stack, used only while a side has an
// item.
typedef struct {
    OdSlotIn in[3];
    bool charging;   // the watch is charging: the battery glyph keeps its bolt lane
} Families;

// Member `v` of slot `slot`'s short family into `buf` (status_short_member): its
// flags, 0 for none. `suffix`: the slot's full form draws the wind arrow.
static uint8_t family_member(const Families *f, const StatusOnDemandSlot *slot, bool suffix,
                             uint8_t v, char *buf) {
    return status_short_member(slot->kind, slot->icon, slot->text, suffix, f->charging, v,
                               buf, STATUS_SHORT_CAP);
}

// Slot i's short family (status_short_text.h), measured into f->in[i]: member v sits
// at m[v], the full measure with its own text width, without the suffix (the wind
// arrow) or the battery glyph's bolt lane where it drops them, and the elastic city's
// floor ("Fra…") is measured too. m[] holds the full form and OD_VARIANTS - 1
// members, as many as any family has (test/c/status_short_text_test.c holds every
// kind to that). Run only once a side has an item to show, so a quiet bar measures
// nothing extra.
static void measure_family(Families *f, int i, const StatusOnDemandSlot *slot,
                           const StatusSlotMeasure *full, const StatusOnDemandEnv *env,
                           int16_t content_w) {
    OdSlotIn *in = &f->in[i];
    memset(in, 0, sizeof(*in));
    in->m[0] = *full;
    if (!full->present) { return; }
    const int16_t h = env->band.size.h;
    char buf[STATUS_SHORT_CAP];
    uint8_t v = 1;
    while (v < OD_VARIANTS) {
        uint8_t flags = family_member(f, slot, full->suffix_w > 0, v, buf);
        if (!flags) { break; }
        StatusSlotMeasure m = *full;
        m.text_w = status_row_text_w(buf, slot->font, content_w, h);
        if (flags & SST_NO_SUFFIX) { m.suffix_w = 0; }
        if (flags & SST_NO_LANE) { m.icon_w = (int16_t)(m.icon_w - BATTERY_BOLT_LANE_W); }
        if ((flags & SST_ELASTIC) && status_short_floor(slot->text, buf, sizeof(buf))) {
            in->floor_w = status_row_text_w(buf, slot->font, content_w, h);
        }
        in->m[v++] = m;
    }
    in->n = v;
}

void status_on_demand_collect(const StatusOnDemandRow *row, StatusOnDemandPass *pass,
                              int bar, const uint8_t blob[THRESH_SETTINGS_BYTES]) {
    pass->state.set.count = 0;
    if (row->assigned && bar >= 0) { collect(&pass->state, bar, blob); }
}

void status_on_demand_layout(StatusOnDemandRow *row, StatusOnDemandPass *pass,
                             const StatusOnDemandEnv *env, const StatusOnDemandSlot slots[3],
                             StatusSlotMeasure m[3], StatusSlotPlace places[3],
                             int16_t content_w) {
    pass->any = false;
    if (!row->assigned || env->bar < 0) {
        status_row_layout(content_w, m, places);
        return;
    }
    StatusOnDemandState *s = &pass->state;
    // The glyphs the active items need; the cache is created by the first draw that
    // has one, and emptied of the rest by every draw.
    uint8_t keys[GLYPH_SLOTS];
    int nkeys = 0;
    for (int item = 0; item < OD_ITEM_COUNT; item++) {
        uint8_t key = s->active[item] ? item_key(s, item) : 0;
        if (key != 0 && nkeys < GLYPH_SLOTS) { keys[nkeys++] = key; }
    }
    if (!row->cache && nkeys > 0) { row->cache = cache_create(); }
    if (row->cache) {
        ensure(row->cache, keys, nkeys, s->active[OD_RAIN] ? s->rain.tier : 0, env->icon_h,
               env->top_strip);
    }
    // Each side's active items, nearest the side's own slot first: the item order is
    // the priority.
    memset(pass->sides, 0, sizeof(pass->sides));
    for (int item = 0; item < OD_ITEM_COUNT; item++) {
        if (!s->active[item]) { continue; }
        int16_t w[OD_LANES];
        measure(s, row, env, item, w);
        if (w[0] <= 0) { continue; }   // nothing to draw (a glyph that failed to load)
        const int d = s->side[item] == OD_SIDE_LEFT ? 0 : 1;
        OdSideIn *side = &pass->sides[d];
        int i = side->n++;
        // The alert its own slot (0 left, 2 right) merged stands in for that slot only
        // (on_demand.h). By alert_set_merge's rule that is the item of the metric the slot
        // shows, active (its entry is in the set) on the slot's side, as this one is.
        const StatusOnDemandSlot *own = &slots[2 * d];
        if (item == alert_set_item(status_threshold_kind_for_slot(own->kind, own->icon))) {
            side->merged = (uint8_t)(i + 1);
        }
        side->rank[i] = (uint8_t)item;
        for (int lane = 0; lane < OD_LANES; lane++) { side->w[lane][i] = w[lane]; }
    }
    if (pass->sides[0].n == 0 && pass->sides[1].n == 0) {
        status_row_layout(content_w, m, places);
        return;
    }
    // The slots' short forms, measured now that a side has something to show.
    Families f;
    BatteryChargeState bs = watch_services_battery_state();
    f.charging = bs.is_charging || bs.is_plugged;
    for (int i = 0; i < 3; i++) { measure_family(&f, i, &slots[i], &m[i], env, content_w); }
    const int8_t bleed[2] = { env->bleed_left, 0 };
    // W7: a slot of this bar that shows the watch battery (the glyph or the Battery %,
    // anywhere) already says what the Battery item would, whatever its Look, so the
    // item stands in only once the layout has hidden every such slot.
    uint8_t battery_slots = 0;
    for (int i = 0; i < 3 && s->active[OD_BATTERY]; i++) {
        if (od_slot_shows_battery(slots[i].kind)) { battery_slots |= (uint8_t)(1 << i); }
    }
    od_layout(content_w, f.in, pass->sides, bleed, battery_slots, &pass->layout);
    // Each slot draws the member the layout picked: its measure (the boxes and the
    // paint read it) and its text, derived again as measure_family() derived it and
    // written over the full one.
    for (int i = 0; i < 3; i++) {
        places[i] = pass->layout.place[i];
        uint8_t v = pass->layout.variant[i];
        if (v == 0 || v >= f.in[i].n) { continue; }
        char buf[STATUS_SHORT_CAP];
        if (family_member(&f, &slots[i], f.in[i].m[0].suffix_w > 0, v, buf)) {
            snprintf(slots[i].text, slots[i].cap, "%s", buf);
        }
        m[i] = f.in[i].m[v];
    }
    pass->any = true;
}

// Paint one item at content-absolute `x`, `w` wide (its footprint on `lane`). Its parts
// are derived again as measure() derived them: the same state, glyphs and text.
static void paint_item(GContext *ctx, const StatusOnDemandRow *row,
                       const StatusOnDemandState *s, const StatusOnDemandEnv *env,
                       int item, int lane, int16_t x, int16_t w) {
    char buf[ALERT_SET_LANE_CAP];
    GFont font = item_text(s, item, lane, env, buf, sizeof(buf));
    int16_t text_w = lane_text_w(buf, font);
    int16_t icon_w = item_icon_w(row, s, env, item);
    int16_t icon_x = (int16_t)(x + (od_item_boxed(item) ? STATUS_ON_DEMAND_BOX_PAD_X : 0));
    int16_t text_x = (int16_t)(icon_x + icon_w + (icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0));
    int16_t icon_top = (int16_t)(env->glyph_cy - env->icon_h / 2);
    GColor ink = theme_fg();
    // A metric entry is boxed at DANGER always (filled) and at WARN per its kind's
    // warn look, painted as its slot would be (status_highlight_paint), judged at the
    // entry's real level — the slot's Highlight switch does not touch the alert. The
    // box IS the footprint: the padding was measured in either way, so the widths do
    // not shift when a box appears.
    if (od_item_boxed(item)) {
        const AlertEntry *e = item_entry(s, item);
        ThreshLook look = status_threshold_look(env->blob, e->kind, e->level);
        if (look.box != THRESH_BOX_NONE) {
            StatusHighlightExtent v = status_highlight_extent(
                env->band.origin.y, env->band.size.h, env->glyph_cy, env->content_h,
                env->top_strip, text_w > 0 && status_text_has_descender(buf));
            ink = status_highlight_paint(ctx, GRect(x, v.y, w, v.h), look);
        }
    }
    if (item == OD_BATTERY) {
        battery_item_draw(ctx, GPoint(icon_x, icon_top), env->icon_h, s->charge, s->charging, ink);
    } else if (item == OD_SLEEP) {
        snooze_draw(ctx, GRect(icon_x, icon_top, env->icon_h, env->icon_h), ink);
    } else {
        uint8_t key = item_key(s, item);
        GDrawCommandImage *image = image_for(row->cache, key);
        if (image) {
            // The system and rain glyphs are no StatusIconId: they seat on the centre.
            status_highlight_draw_glyph(ctx, image, icon_x, env->glyph_cy, key,
                item != OD_BLUETOOTH ? ink
                    : bt_ink(key == STATUS_ROW_ICON_BT ? GColorPictonBlue : GColorRed));
        }
    }
    if (text_w > 0 && buf[0] != '\0') {
        // The frame is the lane's whole measured width: the trailing letter spacing a
        // boxed footprint leaves out is blank and sits inside the pad, so the text
        // never ellipsises against the width it was measured at.
        int16_t band_bottom = (int16_t)(env->band.origin.y + env->band.size.h);
        graphics_context_set_text_color(ctx, ink);
        graphics_draw_text(ctx, buf, font,
            GRect(text_x, env->text_y, text_w, (int16_t)(band_bottom - env->text_y)),
            GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    }
}

void status_on_demand_paint(GContext *ctx, const StatusOnDemandRow *row,
                            const StatusOnDemandPass *pass, const StatusOnDemandEnv *env) {
    if (!ctx || !row || !pass || !env || !pass->any) { return; }
    const OdLayout *l = &pass->layout;
    for (int d = 0; d < 2; d++) {
        const OdSideIn *side = &pass->sides[d];
        for (int k = l->first[d]; k < l->first[d] + l->n[d]; k++) {
            if (k + 1 == l->skip[d]) { continue; }   // the merged alert its slot says
            paint_item(ctx, row, &pass->state, env, side->rank[k], l->lane[d],
                       (int16_t)(env->x + l->item_x[d][k]), side->w[l->lane[d]][k]);
        }
    }
}

#endif
