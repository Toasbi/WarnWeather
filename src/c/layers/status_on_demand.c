// Every include stays ABOVE the WW_ON_DEMAND guard, on purpose: waf's dependency
// scanner does not evaluate -D macros, so an `#include <pebble.h>` inside the guard
// would be invisible to it and this file could compile before the generated
// src/resource_ids.auto.h exists (night_light.c records the failure). Including a
// header emits no code, so aplite still compiles this file to an empty object.
#include <pebble.h>
#include <stdio.h>
#include <string.h>
#include "status_on_demand.h"
#include "../appendix/battery_glyph.h"
#include "battery_item.h"
#include "status_highlight.h"
#include "status_row.h"
#include "status_row_icons.h"
#include "c/appendix/status_row_layout.h"
#include "status_sig.h"
#include "../appendix/config.h"
#include "../appendix/persist.h"
#include "../appendix/rain_countdown.h"
#include "../appendix/snooze.h"
#include "../appendix/status_short_text.h"
#include "../appendix/status_threshold.h"
#include "../appendix/theme.h"
#include "../services/watch_services.h"

#if defined(WW_ON_DEMAND)

// Glyph keys: the metric icons are their StatusIconId (to STATUS_ICON_MAX), the system
// glyphs and Heavy rain their in-memory ids (status_icon_size.h); the rain alert's glyph is
// its bucket's (status_rain_glyph), so drizzle -> rain swaps the glyph, and a Rain alert
// shares the condition icon's drawing.
// Quiet time, one Bluetooth variant, rain and the five metric kinds.
#define GLYPH_SLOTS 8

struct StatusOnDemandCache {
    GDrawCommandImage *images[GLYPH_SLOTS];
    uint8_t keys[GLYPH_SLOTS];   // 0 = free
    int16_t target_h;
    GColor fg;
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
    if (!row->cache) { return; }
    for (int i = 0; i < GLYPH_SLOTS; i++) { evict(row->cache, i); }
    free(row->cache);
    row->cache = NULL;
}

// The Bluetooth glyph's ink, `hue` PictonBlue connected and red disconnected. The
// light theme draws it in the foreground — a saturated blue reads poorly on a white
// strip; a dark colour theme keeps the hue, and B&W collapses to the foreground
// through theme_pick().
static GColor bt_ink(GColor hue) {
    return theme_is_light() ? theme_fg() : theme_pick(hue, theme_fg());
}

static int find_key(const StatusOnDemandCache *cache, uint8_t key) {
    for (int i = 0; i < GLYPH_SLOTS; i++) {
        if (cache->keys[i] == key) { return i; }
    }
    return -1;
}

// Make the cache hold exactly the glyphs in `keys` (n of them, 0 for none): load each at
// `target_h` (the row's icon tier, through status_row_icons_load) and EVICT every cached glyph no
// longer wanted — resident only while its item is active, so an idle bar holds no
// glyph heap. The foreground and the icon height are part of the key: a theme or tier
// change reloads the glyphs.
static void ensure(StatusOnDemandCache *cache, const uint8_t *keys, int n, int target_h) {
    GColor fg = theme_fg();
    bool env = target_h != cache->target_h || !gcolor_equal(fg, cache->fg);
    for (int i = 0; i < GLYPH_SLOTS; i++) {
        uint8_t key = cache->keys[i];
        if (key == 0) { continue; }
        bool wanted = false;
        for (int k = 0; k < n; k++) {
            if (keys[k] == key) { wanted = true; }
        }
        if (env || !wanted) { evict(cache, i); }
    }
    cache->target_h = (int16_t)target_h;
    cache->fg = fg;
    for (int k = 0; k < n; k++) {
        uint8_t key = keys[k];
        if (key == 0 || find_key(cache, key) >= 0) { continue; }
        int slot = find_key(cache, 0);
        if (slot < 0) { break; }   // unreachable: at most GLYPH_SLOTS distinct keys
        // A failed load (OOM) leaves the slot free, so the next draw — the minute's
        // redraw at the latest — tries again, as the old strip's indicator icons did;
        // until then the item measures text-only, or not at all (Bluetooth, Quiet time).
        cache->images[slot] = status_row_icons_load(key, target_h);
        if (cache->images[slot]) { cache->keys[slot] = key; }
    }
}

static GDrawCommandImage *image_for(const StatusOnDemandCache *cache, uint8_t key) {
    if (!cache || key == 0) { return NULL; }
    int slot = find_key(cache, key);
    return slot >= 0 ? cache->images[slot] : NULL;
}

// Everything that decides what the bar's items draw: which item sits on which side
// of `bar`, which of them are active, what they show and the glyph each draws (the
// Bluetooth rune or its crossed one, Quiet time's, the rain's drops by their bucket, a
// metric alert's icon; none for the drawn Battery and Sleep). Beside the battery state
// (the Battery item's charge, and whether the slots' battery glyph keeps its bolt
// lane), only what an assigned item needs is read — the link for Bluetooth, the radar
// cache for Rain, the entries for a metric alert — so a bar without items costs ten
// cell reads and a battery peek.
// The rain alert comes from the cache rain_countdown_refresh() keeps, every pass —
// O(1) and flash-free — which is why a bar with items is refreshed on the minute tick
// and after a radar rescan; the metric alerts from the stored tuple (one flash read —
// app_message.c has already checked it with alert_set_bytes_ok). Returns the tuple
// bytes read into s->bytes: 0 when none is stored, or the bar has no metric item; -1
// when the bar has no item at all.
static int collect(StatusOnDemandState *s, int bar, const uint8_t blob[THRESH_SCRATCH_BYTES]) {
    memset(&s->set, 0, sizeof(s->set));
    memset(s->key, 0, sizeof(s->key));
    s->rain_display = THRESH_RAIN_DISPLAY_TEXT;
    s->battery_value = false;
    s->rain_replaces = status_threshold_rain_replaces(blob);
    BatteryChargeState bs = watch_services_battery_state();
    s->charge = bs.charge_percent;
    s->charging = bs.is_charging || bs.is_plugged;
    int assigned = 0;   // bit 0: an item sits on this bar; bit 1: a metric item does
    for (int item = 0; item < OD_ITEM_COUNT; item++) {
        s->side[item] = (uint8_t)status_threshold_on_demand_side(blob, bar, item);
        s->active[item] = false;
        if (s->side[item] != OD_SIDE_NONE) { assigned |= item >= OD_GUST ? 3 : 1; }
    }
    if (s->side[OD_BATTERY] != OD_SIDE_NONE) {
        s->battery_value = status_threshold_battery_value(blob);
        s->active[OD_BATTERY] = status_threshold_battery_low(s->charge,
                                                             status_threshold_battery_level(blob));
    }
    if (s->side[OD_BLUETOOTH] != OD_SIDE_NONE) {
        const Config *cfg = config_get();
        bool connected = connection_service_peek_pebble_app_connection();
        bool show = cfg && (connected ? cfg->show_bt : cfg->show_bt_disconnect);
        s->key[OD_BLUETOOTH] = show ? (connected ? STATUS_ROW_ICON_BT : STATUS_ROW_ICON_BT_OFF) : 0;
        s->active[OD_BLUETOOTH] = show;
    }
    if (s->side[OD_QUIET_TIME] != OD_SIDE_NONE) {
        s->active[OD_QUIET_TIME] = quiet_time_is_active();
        s->key[OD_QUIET_TIME] = s->active[OD_QUIET_TIME] ? STATUS_ROW_ICON_QUIET : 0;
    }
    if (s->side[OD_SLEEP] != OD_SIDE_NONE) {
        s->active[OD_SLEEP] = persist_get_is_sleeping();
    }
    if (s->side[OD_RAIN] != OD_SIDE_NONE) {
        s->rain_display = status_threshold_rain_display(blob);
        s->active[OD_RAIN] = rain_countdown_get(&s->rain, watch_services_now());
        s->key[OD_RAIN] = s->active[OD_RAIN] ? status_rain_glyph(s->rain.bucket) : 0;
    }
    if (!(assigned & 2)) { return assigned - 1; }   // no metric item: 0, or -1 for none
    const int n = persist_get_alert_entries(s->bytes, sizeof(s->bytes));   // >= 0
    alert_set_parse(s->bytes, (size_t)n, &s->set);
    for (int item = OD_GUST; item < OD_ITEM_COUNT; item++) {
        const AlertEntry *e = alert_set_entry(&s->set, item);
        s->active[item] = s->side[item] != OD_SIDE_NONE && e;
        s->key[item] = s->active[item] ? alert_set_item_icon(item) : 0;
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
        return env->fonts[0];
    }
    if (item == OD_RAIN) {
        if (rd != THRESH_RAIN_DISPLAY_ICON) {
            alert_set_rain_text(&s->rain, rd == THRESH_RAIN_DISPLAY_MINUTES, buf, cap);
        }
        return env->fonts[0];
    }
    const AlertEntry *e = alert_set_entry(&s->set, item);
    if (!e) { return env->fonts[0]; }
    alert_set_lane(e, values, buf, cap);
    return status_threshold_look(env->blob, e->kind, e->level).bold
        ? env->fonts[1] : env->fonts[0];
}

// The width of active item `item`'s glyph: the battery's, Sleep's square, a cached
// glyph's bounds; 0 = no glyph. Needs the glyphs, so ensure() runs first. The measure
// and the paint both ask it, in the same draw, so they agree.
static int16_t item_icon_w(const StatusOnDemandRow *row, const StatusOnDemandState *s,
                           const StatusOnDemandEnv *env, int item) {
    if (item == OD_BATTERY) { return battery_item_width(env->icon_h, s->charging); }
    if (item == OD_SLEEP) { return env->icon_h; }
    GDrawCommandImage *image = image_for(row->cache, s->key[item]);
    return image ? gdraw_command_image_get_bounds_size(image).w : 0;
}

// The width of a lane's text `buf` in `font`. A lane's text is never cut: measured in a
// box no text reaches. The measure takes it into the footprint, and the paint reads it
// back out of that (paint_item), so it draws each lane at the width the layout placed.
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
                               const uint8_t blob[THRESH_SCRATCH_BYTES]) {
    StatusOnDemandState s;
    const int n = collect(&s, bar, blob);
    row->assigned = n >= 0;
    if (n < 0) {
        // Nothing can draw here: give the glyphs back now rather than at teardown.
        status_on_demand_release(row);
        return sig;
    }
    // One fold: what an inactive item would add stays 0, so it changes nothing.
    const bool batt = s.active[OD_BATTERY];
    const bool rain = s.active[OD_RAIN];
    const bool text = rain && s.rain_display != THRESH_RAIN_DISPLAY_ICON;
    uint8_t live[10] = { (uint8_t)batt, s.key[OD_BLUETOOTH], (uint8_t)s.active[OD_QUIET_TIME],
                         (uint8_t)s.active[OD_SLEEP], (uint8_t)rain,
                         batt ? s.charge : 0, (uint8_t)(batt && s.charging),
                         rain ? s.rain.bucket : 0, text ? s.rain.mins : 0,
                         (uint8_t)(text && s.rain.raining) };
    sig = sig_fold(sig, live, sizeof(live));
    return sig_fold(sig, s.bytes, (size_t)n);
}

// One draw's short forms: the three slots' families as the layout takes them, and the
// one input their members take beside the slot itself, so the member a slot ends up
// drawing can be derived again. On the draw's stack, used only while a side has an
// item.
typedef struct {
    OdSlotIn in[3];
    bool charging;   // the watch is charging: the battery glyph keeps its bolt lane
} Families;

// Member `v` of slot `slot`'s short family into `buf` (status_short_member: the short form
// it brought, else the ones its text derives). Its flags, 0 for none. `suffix`: the slot's
// full form draws the wind arrow.
static uint8_t family_member(const Families *f, const StatusRowSlot *slot, bool suffix,
                             uint8_t v, char *buf) {
    return status_short_member(slot->slot.kind, slot->slot.icon, slot->text, slot->alt, suffix,
                               f->charging, v, buf, STATUS_SHORT_CAP);
}

// Slot i's short family (status_short_text.h), measured into f->in[i]: member v sits
// at m[v], the full measure with its own text width, without the suffix (the wind
// arrow) or the battery glyph's bolt lane where it drops them, and the elastic city's
// floor ("Fra…") is measured too. m[] holds the full form and OD_VARIANTS - 1
// members, as many as any family has (test/c/status_short_text_test.c holds every
// kind to that). Run only once a side has an item to show, so a quiet bar measures
// nothing extra.
static void measure_family(Families *f, int i, const StatusRowSlot *slot,
                           const StatusSlotMeasure *full, const StatusOnDemandEnv *env,
                           int16_t content_w) {
    OdSlotIn *in = &f->in[i];
    memset(in, 0, sizeof(*in));
    in->m[0] = *full;
    if (!full->present) { return; }
    const int16_t h = env->band.size.h;
    const GFont font = env->fonts[slot->look.bold];   // the slot's, as the row draws it
    char buf[STATUS_SHORT_CAP];
    uint8_t v = 1;
    while (v < OD_VARIANTS) {
        uint8_t flags = family_member(f, slot, full->suffix_w > 0, v, buf);
        if (!flags) { break; }
        StatusSlotMeasure m = *full;
        m.text_w = status_row_text_w(buf, font, content_w, h);
        if (flags & SST_NO_SUFFIX) { m.suffix_w = 0; }
        if (flags & SST_NO_LANE) { m.icon_w = (int16_t)(m.icon_w - BATTERY_BOLT_LANE_W); }
        if ((flags & SST_ELASTIC) && status_short_floor(slot->text, buf, sizeof(buf))) {
            in->floor_w = status_row_text_w(buf, font, content_w, h);
        }
        in->m[v++] = m;
    }
    in->n = v;
}

void status_on_demand_collect(const StatusOnDemandRow *row, StatusOnDemandPass *pass,
                              int bar, const uint8_t blob[THRESH_SCRATCH_BYTES]) {
    if (row->assigned && bar >= 0) {
        collect(&pass->state, bar, blob);
    } else {
        memset(&pass->state.set, 0, sizeof(pass->state.set));   // no slot merges an alert
    }
}

void status_on_demand_layout(StatusOnDemandRow *row, StatusOnDemandPass *pass,
                             const StatusOnDemandEnv *env, StatusRowSlot slots[3],
                             StatusSlotMeasure m[3], StatusSlotPlace places[3],
                             int16_t content_w) {
    pass->any = false;
    if (!row->assigned || env->bar < 0) {
        status_row_layout(content_w, m, places);
        return;
    }
    StatusOnDemandState *s = &pass->state;
    // The glyphs the active items need (s->key: at most GLYPH_SLOTS distinct ones, the
    // rest 0); the cache is created by the first draw that has one, and emptied of the
    // rest by every draw.
    bool any_key = false;
    for (int item = 0; item < OD_ITEM_COUNT; item++) { any_key |= s->key[item] != 0; }
    if (!row->cache && any_key) { row->cache = cache_create(); }
    if (row->cache) {
        ensure(row->cache, s->key, OD_ITEM_COUNT, env->icon_h);
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
        // The alert the side's own slot (0 left, 2 right) merged stands in for that slot
        // only (on_demand.h).
        if (item == slots[2 * d].merged_item) { side->merged = (uint8_t)(i + 1); }
        side->rank[i] = (uint8_t)item;
        for (int lane = 0; lane < OD_LANES; lane++) { side->w[lane][i] = w[lane]; }
    }
    if (pass->sides[0].n == 0 && pass->sides[1].n == 0) {
        status_row_layout(content_w, m, places);
        return;
    }
    // The slots' short forms, measured now that a side has something to show.
    Families f;
    f.charging = s->charging;
    for (int i = 0; i < 3; i++) { measure_family(&f, i, &slots[i], &m[i], env, content_w); }
    // A rain alert that replaces its side's slot: that slot is laid out as empty, so it
    // does not show and the side's items start at the edge.
    if (s->rain_replaces) { od_replace_slots(f.in, pass->sides); }
    const int8_t bleed[2] = { env->bleed_left, 0 };
    // W7: a slot of this bar that shows the watch battery (the glyph or the Battery %,
    // anywhere) already says what the Battery item would, whatever its Look, so the
    // item stands in only once the layout has hidden every such slot.
    uint8_t battery_slots = 0;
    for (int i = 0; i < 3 && s->active[OD_BATTERY]; i++) {
        if (od_slot_shows_battery(slots[i].slot.kind)) { battery_slots |= (uint8_t)(1 << i); }
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
        _Static_assert(sizeof(buf) <= sizeof(slots[i].text), "a member fits the slot's text");
        if (family_member(&f, &slots[i], f.in[i].m[0].suffix_w > 0, v, buf)) {
            strcpy(slots[i].text, buf);
        }
        m[i] = f.in[i].m[v];
    }
    pass->any = true;
}

// Paint one item at content-absolute `x`, `w` wide (its footprint on `lane`). Its parts
// are derived again as measure() derived them: the same state, glyphs and text; the
// text's width from `w`.
static void paint_item(GContext *ctx, const StatusOnDemandRow *row,
                       const StatusOnDemandState *s, const StatusOnDemandEnv *env,
                       int item, int lane, int16_t x, int16_t w) {
    char buf[ALERT_SET_LANE_CAP];
    GFont font = item_text(s, item, lane, env, buf, sizeof(buf));
    int16_t icon_w = item_icon_w(row, s, env, item);
    int16_t icon_x = (int16_t)(x + (od_item_boxed(item) ? STATUS_ON_DEMAND_BOX_PAD_X : 0));
    int16_t text_x = (int16_t)(icon_x + icon_w + (icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0));
    // The text's width is what the footprint leaves it (od_item_footprint backwards):
    // the measure took the footprint from this same text in this draw.
    int16_t text_w = buf[0] == '\0' ? 0 : (int16_t)(x + w - text_x - (od_item_boxed(item)
        ? STATUS_ON_DEMAND_BOX_PAD_X - OD_TEXT_TRAIL_SPACING : 0));
    int16_t icon_top = (int16_t)(env->glyph_cy - env->icon_h / 2);
    StatusPaint paint = status_paint_theme();
    // A metric entry is boxed at DANGER always (filled) and at WARN per its kind's
    // warn look, painted as its slot would be (status_highlight_paint), judged at the
    // entry's real level — the slot's Highlight switch does not touch the alert. The
    // box IS the footprint: the padding was measured in either way, so the widths do
    // not shift when a box appears.
    if (od_item_boxed(item)) {
        const AlertEntry *e = alert_set_entry(&s->set, item);
        ThreshLook look = status_threshold_look(env->blob, e->kind, e->level);
        if (look.box != THRESH_BOX_NONE) {
            StatusHighlightExtent v = status_highlight_extent(
                env->band.origin.y, env->band.size.h, env->glyph_cy, env->content_h,
                env->top_strip, text_w > 0 && status_text_has_descender(buf));
            paint = status_highlight_paint(ctx, GRect(x, v.y, w, v.h), look);
        }
    }
    if (item == OD_BATTERY) {
        battery_item_draw(ctx, GPoint(icon_x, icon_top), env->icon_h, s->charge, s->charging, paint.ink);
    } else if (item == OD_SLEEP) {
        snooze_draw(ctx, GRect(icon_x, icon_top, env->icon_h, env->icon_h), paint.ink);
    } else {
        const uint8_t key = s->key[item];
        GDrawCommandImage *image = image_for(row->cache, key);
        if (image) {
            StatusPaint glyph = paint;
            if (item == OD_BLUETOOTH) {
                glyph.ink = bt_ink(key == STATUS_ROW_ICON_BT ? GColorPictonBlue : GColorRed);
            }
            status_row_icons_draw(ctx, image, icon_x, env->glyph_cy, glyph);
        }
    }
    if (text_w > 0 && buf[0] != '\0') {
        // The frame is the lane's whole measured width: the trailing letter spacing a
        // boxed footprint leaves out is blank and sits inside the pad, so the text
        // never ellipsises against the width it was measured at.
        int16_t band_bottom = (int16_t)(env->band.origin.y + env->band.size.h);
        graphics_context_set_text_color(ctx, paint.ink);
        graphics_draw_text(ctx, buf, font,
            GRect(text_x, env->text_y, text_w, (int16_t)(band_bottom - env->text_y)),
            GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    }
}

void status_on_demand_paint(GContext *ctx, const StatusOnDemandRow *row,
                            const StatusOnDemandPass *pass, const StatusOnDemandEnv *env) {
    if (!pass->any) { return; }
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
