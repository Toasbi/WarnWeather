// Every include stays ABOVE the WW_ON_DEMAND guard, on purpose: waf's dependency
// scanner does not evaluate -D macros, so an `#include <pebble.h>` inside the guard
// would be invisible to it and this file could compile before the generated
// src/resource_ids.auto.h exists (night_light.c records the failure). Including a
// header emits no code, so aplite still compiles this file to an empty object.
#include <pebble.h>
#include <stdio.h>
#include <string.h>
#include "status_on_demand.h"
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
// app_message.c has already checked it with alert_set_bytes_ok).
static void collect(StatusOnDemandState *s, int bar, const uint8_t blob[THRESH_SETTINGS_BYTES]) {
    s->set.count = 0;
    s->rain_display = THRESH_RAIN_DISPLAY_TEXT;
    s->bt_key = 0;
    s->charge = 0;
    s->level = THRESH_BATTERY_LEVEL_DEFAULT;
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
        s->level = status_threshold_battery_level(blob);
        s->battery_value = status_threshold_battery_value(blob);
        s->active[OD_BATTERY] = status_threshold_battery_low(s->charge, s->level);
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
    if (!metric) { return; }
    int n = persist_get_alert_entries(s->bytes, sizeof(s->bytes));
    alert_set_parse(s->bytes, n > 0 ? (size_t)n : 0, &s->set);
    for (int item = OD_GUST; item < OD_ITEM_COUNT; item++) {
        s->active[item] = s->side[item] != OD_SIDE_NONE && item_entry(s, item);
    }
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

static int16_t icon_width(GDrawCommandImage *image) {
    return image ? gdraw_command_image_get_bounds_size(image).w : 0;
}

// Measure `item` on every lane into its cell, and its footprint per lane into `w`
// (od_item_footprint: a boxed metric entry pads STATUS_ON_DEMAND_BOX_PAD_X a side).
// Needs the glyphs, so ensure() runs first.
static void measure(StatusOnDemandPass *p, const StatusOnDemandRow *row,
                    const StatusOnDemandEnv *env, int item, int16_t w[OD_LANES]) {
    const StatusOnDemandState *s = &p->state;
    StatusOnDemandCell *c = &p->cells[item];
    if (item == OD_BATTERY) {
        c->icon_w = battery_item_width(env->icon_h, s->charging);
    } else if (item == OD_SLEEP) {
        c->icon_w = env->icon_h;
    } else {
        c->icon_w = icon_width(image_for(row->cache, item_key(s, item)));
    }
    c->pad = od_item_boxed(item) ? STATUS_ON_DEMAND_BOX_PAD_X : 0;
    for (int lane = 0; lane < OD_LANES; lane++) {
        char buf[ALERT_SET_LANE_CAP];
        GFont font = item_text(s, item, lane, env, buf, sizeof(buf));
        // A lane's text is never cut: measured in a box no text reaches.
        int16_t tw = status_row_text_w(buf, font, 1000, 100);
        c->text_w[lane] = tw;
        int16_t fw = od_item_footprint(c->icon_w, tw, od_item_boxed(item), c->pad);
        // A lane with nothing left to draw keeps the lane before's width: it can give
        // nothing more.
        if (fw <= 0 && lane > 0) { fw = w[lane - 1]; }
        w[lane] = fw;
    }
}

// The fold covers what the items paint (see status_on_demand.h): the bar's cells,
// every assigned system item's state, each active metric alert's entry — its day
// (today's, or tomorrow's with its mark), value, level and the look it reads from the
// blob at that level (a Clay save that only recolours or re-looks must repaint) —
// and the active rain alert: its look and tier (the drops' bucket and tint, and the
// noun, follow the tier), and its minutes and whether it rains only while a look
// prints them, or an icon-only rain alert would repaint every minute for nothing.
uint16_t status_on_demand_fold(StatusOnDemandRow *row, uint16_t sig, int bar,
                               const uint8_t blob[THRESH_SETTINGS_BYTES]) {
    if (!row) { return sig; }
    StatusOnDemandState s;
    collect(&s, bar, blob);
    bool assigned = false;
    for (int item = 0; item < OD_ITEM_COUNT; item++) {
        if (s.side[item] != OD_SIDE_NONE) { assigned = true; }
    }
    row->assigned = assigned;
    sig = sig_fold(sig, s.side, OD_ITEM_COUNT);
    if (!assigned) {
        // Nothing can draw here: give the glyphs back now rather than at teardown.
        status_on_demand_release(row);
        return sig;
    }
    uint8_t sys[6] = { (uint8_t)s.active[OD_BATTERY], s.bt_key, (uint8_t)s.active[OD_QUIET_TIME],
                       (uint8_t)s.active[OD_SLEEP], s.level, (uint8_t)s.battery_value };
    sig = sig_fold(sig, sys, sizeof(sys));
    if (s.active[OD_BATTERY]) {
        uint8_t charge[2] = { s.charge, (uint8_t)s.charging };
        sig = sig_fold(sig, charge, sizeof(charge));
    }
    for (int item = OD_GUST; item < OD_ITEM_COUNT; item++) {
        const AlertEntry *e = s.active[item] ? item_entry(&s, item) : NULL;
        if (!e) { continue; }
        uint8_t head[3] = { e->kind, e->level, e->day };
        sig = sig_fold(sig, head, sizeof(head));
        sig = sig_fold(sig, (const uint8_t *)e->value, e->value_len);
        ThreshLook look = status_threshold_look(blob, e->kind, e->level);
        sig = sig_fold(sig, (const uint8_t *)&look, sizeof(look));
    }
    if (s.active[OD_RAIN]) {
        bool text = s.rain_display != THRESH_RAIN_DISPLAY_ICON;
        uint8_t rain[4] = { (uint8_t)s.rain_display, s.rain.tier, text ? s.rain.mins : 0,
                            (uint8_t)(text && s.rain.raining) };
        sig = sig_fold(sig, rain, sizeof(rain));
    }
    return sig;
}

// One draw's short forms: the three slots' families as the layout takes them, and
// which member each is, so the one a slot ends up drawing can be written out again.
// On the draw's stack, used only while a side has an item.
typedef struct {
    OdSlotIn in[3];
    StatusShortMember member[3][STATUS_SHORT_MEMBERS];
    uint8_t mday;   // the day of the month a date's family ends on (0: a calendar
                    // view, whose date has no day-number member)
} Families;

// measure_family() writes a slot's full form to m[0] and its short members after it.
_Static_assert(STATUS_SHORT_MEMBERS + 1 == OD_VARIANTS,
               "a slot's full form and its short members fill OdSlotIn.m exactly");

// Member `step` of slot `slot`'s text family into `buf` (status_short_text).
static bool family_text(const Families *f, const StatusOnDemandEnv *env,
                        const StatusOnDemandSlot *slot, uint8_t step, char *buf) {
    return status_short_text(slot->kind, slot->icon, env->full_date, f->mday, slot->text, step,
                             buf, STATUS_SHORT_CAP);
}

// Slot i's short family (status_short_text.h), measured into f->in[i]: each member is
// the full measure with its own text width, without the suffix (the wind arrow) or
// the battery glyph's bolt lane where it drops them, and the elastic city's floor
// ("Fra…") is measured too. Run only once a side has an item to show, so a quiet bar
// measures nothing extra.
static void measure_family(Families *f, int i, const StatusOnDemandSlot *slot,
                           const StatusSlotMeasure *full, const StatusOnDemandEnv *env,
                           int16_t content_w) {
    OdSlotIn *in = &f->in[i];
    memset(in, 0, sizeof(*in));
    in->m[0] = *full;
    if (!full->present) { return; }
    BatteryChargeState bs = watch_services_battery_state();
    StatusShortMember *fam = f->member[i];
    uint8_t k = status_short_family(slot->kind, slot->icon, env->full_date, f->mday,
                                    slot->text, full->suffix_w > 0,
                                    bs.is_charging || bs.is_plugged, fam);
    const int16_t h = env->band.size.h;
    char buf[STATUS_SHORT_CAP];
    for (uint8_t j = 0; j < k; j++) {
        StatusSlotMeasure m = *full;
        if (fam[j].step > 0 && family_text(f, env, slot, fam[j].step, buf)) {
            m.text_w = status_row_text_w(buf, slot->font, content_w, h);
        }
        if (fam[j].no_suffix) { m.suffix_w = 0; }
        if (fam[j].no_lane) { m.icon_w = (int16_t)(m.icon_w - STATUS_SHORT_BATTERY_LANE_W); }
        in->m[1 + j] = m;
        if (fam[j].elastic && status_short_floor(slot->text, buf, sizeof(buf))) {
            in->floor_w = status_row_text_w(buf, slot->font, content_w, h);
        }
    }
    in->n = (uint8_t)(1 + k);
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
    collect(s, env->bar, env->blob);
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
    // Each side's active items, outermost first: the item order is the priority.
    memset(pass->sides, 0, sizeof(pass->sides));
    for (int item = 0; item < OD_ITEM_COUNT; item++) {
        if (!s->active[item]) { continue; }
        int16_t w[OD_LANES];
        measure(pass, row, env, item, w);
        if (w[0] <= 0) { continue; }   // nothing to draw (a glyph that failed to load)
        OdSideIn *side = &pass->sides[s->side[item] == OD_SIDE_LEFT ? 0 : 1];
        int i = side->n++;
        side->rank[i] = (uint8_t)item;
        for (int lane = 0; lane < OD_LANES; lane++) { side->w[lane][i] = w[lane]; }
        side->padded[i] = od_item_boxed(item);
    }
    if (pass->sides[0].n == 0 && pass->sides[1].n == 0) {
        status_row_layout(content_w, m, places);
        return;
    }
    // The slots' short forms, measured now that a side has something to show. The
    // date's family ends on the clock's day of the month, which its text alone does
    // not give ("07.09.26").
    Families f;
    f.mday = (uint8_t)(env->full_date ? watch_services_localtime().tm_mday : 0);
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
    // paint read it) and its text, written over the full one.
    for (int i = 0; i < 3; i++) {
        places[i] = pass->layout.place[i];
        uint8_t v = pass->layout.variant[i];
        if (v == 0 || v >= f.in[i].n) { continue; }
        m[i] = f.in[i].m[v];
        char buf[STATUS_SHORT_CAP];
        uint8_t step = f.member[i][v - 1].step;
        if (step > 0 && family_text(&f, env, &slots[i], step, buf)) {
            snprintf(slots[i].text, slots[i].cap, "%s", buf);
        }
    }
    pass->any = true;
}

// Paint one item at content-absolute `x`, `w` wide (its footprint on `lane`).
static void paint_item(GContext *ctx, const StatusOnDemandRow *row,
                       const StatusOnDemandPass *p, const StatusOnDemandEnv *env,
                       int item, int lane, int16_t x, int16_t w) {
    const StatusOnDemandState *s = &p->state;
    const StatusOnDemandCell *c = &p->cells[item];
    char buf[ALERT_SET_LANE_CAP];
    GFont font = item_text(s, item, lane, env, buf, sizeof(buf));
    int16_t text_w = c->text_w[lane];
    int16_t icon_x = (int16_t)(x + c->pad);
    int16_t text_x = (int16_t)(icon_x + c->icon_w + (c->icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0));
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
            paint_item(ctx, row, pass, env, side->rank[k], l->lane[d],
                       (int16_t)(env->x + l->item_x[d][k]), side->w[l->lane[d]][k]);
        }
    }
}

#endif
