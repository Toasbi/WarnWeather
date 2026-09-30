#include "status_row.h"
#include "status_row_icons.h"
#include "status_icon_weight.h"
#include "status_row_direction.h"
#include "status_row_layout.h"
#include "status_highlight.h"
#include "battery_draw.h"
#include "layer_util.h"
#include "../appendix/persist.h"
#include "../appendix/config.h"
#include "../appendix/date_format.h"
#include "../appendix/theme.h"
#include "../appendix/status_threshold.h"
#include "../windows/layout.h"   // LayoutTier (row_font)
#include "../services/watch_services.h"
#include "status_on_demand.h"
#include "status_sig.h"
#if defined(PBL_HEALTH)
#include "../services/health_summary.h"
#include "../services/health.h"
#endif
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Never compiled on aplite — wscript builds status_row_aplite.c in its place — and
// every other platform has both features, so nothing below is guarded on them, nor
// on PBL_PLATFORM_APLITE.
#if !defined(WW_ON_DEMAND) || !defined(WW_THRESHOLD_HIGHLIGHT)
#error "status_row.c needs WW_ON_DEMAND and WW_THRESHOLD_HIGHLIGHT; aplite builds its twin"
#endif

#define STATUS_ROW_MARGIN 2
// Icon height as a fraction of the status text's content height. Bumped 5/9 -> 6/9
// (~2/3) so the glyphs read heftier at every tier (they were noticeably timid at 5/9);
// still capped at the row band via ICON_BAND_MARGIN. One knob — tune for weight.
#define ICON_RATIO_NUM 6
#define ICON_RATIO_DEN 9
// The top strip abuts the calendar/date, so its glyphs use a smaller ratio than the
// weather/health rows to avoid crowding the month text — the third (smallest) size.
#define TOP_ICON_RATIO_NUM 5
#define TOP_ICON_RATIO_DEN 9
#define ICON_BAND_MARGIN 2

#ifdef PBL_PLATFORM_EMERY
#define COMPACT_ROW_FONT_KEY FONT_KEY_GOTHIC_24
#define NONE_ROW_FONT_KEY FONT_KEY_GOTHIC_24
#define ARROW_H 10
#define ARROW_HEAD_H 4
#define ARROW_HEAD_W 3
#define ARROW_W 8
#else
#define COMPACT_ROW_FONT_KEY FONT_KEY_GOTHIC_18
#define NONE_ROW_FONT_KEY FONT_KEY_GOTHIC_18
#define ARROW_H 8
#define ARROW_HEAD_H 3
#define ARROW_HEAD_W 2
#define ARROW_W 6
#endif

struct StatusRow {
    uint8_t line_id;
    uint8_t tier;
    GRect bounds;
    bool full_date;
    GDrawCommandImage *glyphs[STATUS_SLOT_COUNT];
    uint8_t glyph_icons[STATUS_SLOT_COUNT];
    int16_t glyph_h;
    GColor glyph_fg;
    uint16_t content_sig;
    bool uses_live_health;
    // On demand: the items' glyph cache, and whether any item sits on this row's
    // bar, which every refresh reads from the blob (status_on_demand_fold).
    StatusOnDemandRow od;
};

// Main-app drawing and refresh callbacks are serialized, so all row instances can
// reuse this buffer without retaining expanded copies of their packed blobs. The
// resolved slot TEXT has no such shared buffer: it rides the caller's transient
// ResolvedSlot, so a pass takes exactly the slots it needs — all three to fold or
// paint a row.
static uint8_t s_blob_scratch[STATUS_LINE_MAX_BYTES];
// Threshold-highlight settings blob (CLAY_THRESHOLDS_UINT8), reloaded per
// refresh/draw like the packed line blobs; len 0 = nothing configured yet.
static uint8_t s_thresh_scratch[THRESH_SETTINGS_BYTES];
static int s_thresh_len;
// One draw's On demand pass (status_on_demand.h): the resolved items, their measures
// and the layout. Too big for the app stack beside the rest of a draw, and draws are
// serialized, so every row's draw reuses this one.
static StatusOnDemandPass s_od_pass;
// Packed weather threshold-levels value (STATUS_LEVELS_UINT8, 2 wire bytes LE —
// UV rides bits 8-9), reloaded once per refresh/draw pass alongside the blob
// above (persist_get_status_levels() is persist_exists + persist_read_int;
// reading it once per pass instead of once per weather slot avoids redundant
// flash-backed reads across a row).
static int s_levels_word;

// The sunrise/sunset arrow, turned for the wind-direction arrow too: one GPath every
// row shares, created with the first row and destroyed with the last (s_row_count).
// (The aplite twin draws its sun arrow from primitive lines instead.)
static GPath *s_arrow_path;
static const GPathInfo ARROW_PATH_INFO = {
    .num_points = 6,
    .points = (GPoint[]) {
        {0, -ARROW_H / 2},
        {0, ARROW_H / 2 - ARROW_HEAD_H},
        {-ARROW_HEAD_W, ARROW_H / 2 - ARROW_HEAD_H},
        {0, ARROW_H / 2},
        {ARROW_HEAD_W, ARROW_H / 2 - ARROW_HEAD_H},
        {0, ARROW_H / 2 - ARROW_HEAD_H}
    }
};

static int s_row_count;

// Seat this row's line in its band. Every row cap-centres (status_text_y) EXCEPT the top
// strip, which rides STATUS_TOP_STRIP_LIFT rows higher inside an unchanged band — its top edge
// is the screen edge, so the air above the line is invisible while the gap below, down to the
// calendar, is what reads. Line-id-keyed like row_font() just below, for the same reason.
// Written as one seat plus a conditional subtract rather than picking between status_text_y and
// status_strip_text_y: both are inline, and branching between them duplicated the whole
// measure-and-seat body in the image (measured ~100 B on aplite, which has none to spare).
static int row_text_y(const StatusRow *row, GFont font) {
    int y = status_text_y(row->bounds.size.h, font);
    return (row->line_id == STATUS_LINE_TOP) ? y - STATUS_TOP_STRIP_LIFT : y;
}

static GFont row_font(uint8_t tier, uint8_t line_id) {
    // The top strip keeps its own (larger) font at all times; it always renders
    // the FULL tier but must not share the weather/health full-tier size.
    if (line_id == STATUS_LINE_TOP) {
        return fonts_get_system_font(STATUS_TOP_TIER_FONT_KEY);
    }
    switch (tier) {
        case LAYOUT_TIER_NONE:
            return fonts_get_system_font(NONE_ROW_FONT_KEY);
        case LAYOUT_TIER_COMPACT:
            return fonts_get_system_font(COMPACT_ROW_FONT_KEY);
        default:
            return fonts_get_system_font(STATUS_FULL_TIER_FONT_KEY);
    }
}

// The bold companion of row_font(), for slots whose threshold is crossed — the
// calendar's today-highlight pattern (CALENDAR_FONT_KEY_BOLD) applied to slots. The
// Gothic bolds share their regular siblings' metrics (MEASURED for 18 in
// weather_status_layer.c; nominal size == content height family-wide), so the seat,
// cap-centre and box math are untouched — only glyph WIDTHS change, which is why a
// crossed slot must measure with the same font it draws.
static GFont row_font_bold(uint8_t tier, uint8_t line_id) {
    if (line_id == STATUS_LINE_TOP) {
#ifdef PBL_PLATFORM_EMERY
        return fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
#else
        return fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
#endif
    }
    switch (tier) {
        case LAYOUT_TIER_NONE:
        case LAYOUT_TIER_COMPACT:
#ifdef PBL_PLATFORM_EMERY
            return fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
#else
            return fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
#endif
        default:
#ifdef PBL_PLATFORM_EMERY
            return fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
#else
            return fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
#endif
    }
}

static void format_status_date(bool full_date, char *buf, size_t cap) {
    struct tm tm_now = watch_services_localtime();
    const Config *cfg = config_get();
    if (!full_date) {
        // Calendar views already show the day; the slot only needs month + year.
        date_format_month_year(buf, cap, &tm_now,
                               cfg ? cfg->date_month_format : DATE_MONTH_AUTO);
        return;
    }
    // No-calendar view: the slot carries the full date, in the user's chosen
    // format (Date slot edit sheet). Day/month order comes from the phone
    // (config.date_month_first, US -> month first), not the watch system locale.
    date_format_full(buf, cap, &tm_now,
                     cfg ? cfg->date_full_format : DATE_FULL_AUTO,
                     cfg && cfg->date_month_first);
}

#if defined(PBL_HEALTH)
// Shared walked-distance formatter for both distance slot kinds. Integer-only
// (no FP): km = metres/100 tenths, mi = metres*10/1609 tenths, each clamped to
// 999 tenths (99.9). The unit comes from the packed slot kind the phone chose
// (SLOT_LIVE_DISTANCE = km, SLOT_LIVE_DISTANCE_MI = mi), NOT the firmware system
// Units setting, so the in-app Distance choice drives it.
static void format_distance_value(char *buf, size_t cap, bool imperial) {
    int m = health_summary_distance_m();
    if (m < 0) { snprintf(buf, cap, "--"); return; }
    int tenths;
    if (imperial && m > (999 * 1609) / 10) {
        tenths = 999;
    } else {
        tenths = imperial ? (m * 10) / 1609 : m / 100;
        if (tenths > 999) { tenths = 999; }
    }
    snprintf(buf, cap, "%d.%d%s", tenths / 10, tenths % 10, imperial ? "mi" : "km");
}
#endif

static void format_live_value(const StatusRow *row, uint8_t kind, char *buf, size_t cap) {
    switch (kind) {
        case SLOT_LIVE_DATE:
            format_status_date(row->full_date, buf, cap);
            return;
        case SLOT_LIVE_WEEK: {
            struct tm tm_now = watch_services_localtime();
            snprintf(buf, cap, "W%d",
                     iso_week(tm_now.tm_year + 1900, tm_now.tm_yday, tm_now.tm_wday));
            return;
        }
        // Not health data: state read on-device like the glyph battery slot
        // (SLOT_LIVE_BATTERY), which renders icon-only; this kind renders text.
        case SLOT_LIVE_BATTERY_PCT:
            snprintf(buf, cap, "%d%%", watch_services_battery_state().charge_percent);
            return;
#if defined(PBL_HEALTH)
        case SLOT_LIVE_STEPS: {
            int steps = health_summary_steps();
            if (steps < 0) { steps = 0; }
            if (steps > 999999) { steps = 999999; }
            if (steps < 1000) {
                snprintf(buf, cap, "%d", steps);
            } else {
                // Abbreviate to thousands with one decimal (integer math, no
                // float): 1150 -> "1.1k", 12345 -> "12.3k". Whole thousands drop
                // the ".0" ("5k"), matching the graph's step_mark_label. Truncates
                // rather than rounds so a live count never overstates progress.
                int tk = steps / 100;          // tenths of a thousand (max 9999)
                if (tk % 10 == 0) {
                    snprintf(buf, cap, "%dk", tk / 10);
                } else {
                    snprintf(buf, cap, "%d.%dk", tk / 10, tk % 10);
                }
            }
            return;
        }
        case SLOT_LIVE_SLEEP: {
            int secs = health_summary_sleep_seconds();
            if (secs <= 0) { snprintf(buf, cap, "--"); return; }
            int hours = secs / 3600;
            int mins = (secs % 3600) / 60;
            if (hours > 99) { hours = 99; }
            snprintf(buf, cap, "%dh%02d", hours, mins);
            return;
        }
        case SLOT_LIVE_HR: {
            int bpm = health_summary_hr_bpm();
            if (bpm <= 0) { snprintf(buf, cap, "--"); return; }
            if (bpm > 999) { bpm = 999; }
            snprintf(buf, cap, "%d", bpm);
            return;
        }
        case SLOT_LIVE_DISTANCE:
            format_distance_value(buf, cap, false);
            return;
        case SLOT_LIVE_DISTANCE_MI:
            format_distance_value(buf, cap, true);
            return;
#endif
        default:
            snprintf(buf, cap, "--");
            return;
    }
}

// The phone-battery slots. Three icon ids mark a slot whose text the PHONE baked
// from its OWN charge; there is no kind-level marker, the kind is plain SLOT_TEXT
// exactly like a city name, so the icon id is the only discriminator. Ids 16/17 are
// the same catalog item (the phone picks the charging glyph at bake time, which is
// why charging costs no wire field); id 18 is the no-icon variant.
static bool is_phone_battery_slot(const StatusSlotView *slot) {
    return slot->kind == SLOT_TEXT
        && (slot->icon == STATUS_ICON_PHONE_BATTERY
            || slot->icon == STATUS_ICON_PHONE_BATTERY_CHG
            || slot->icon == STATUS_ICON_PHONE_BATTERY_PLAIN);
}

// Materialise one slot's display text, and report the wind-direction sector
// (0..15, -1 = none) the phone baked into its trailing byte.
//
// This is the ONE place a slot's text is materialised, which is exactly why the
// sentinel is stripped here: shortening the copy by a byte at the single source
// means the control byte can never reach a measurement, graphics_draw_text, or the
// content signature. Every caller gets the sector back instead — it is content
// (the arrow's heading), not decoration, so refresh folds it and draw paints it.
static int8_t resolve_slot_text(const StatusRow *row, const StatusSlotView *slot,
                                char *buf, size_t cap) {
    if (cap == 0) { return -1; }
    if (slot->kind == SLOT_TEXT) {
        // The Bluetooth freshness rule: the link IS the phone-battery reading's
        // timestamp. Every other slot's text is either read live on-device or
        // refreshed by a phone that is, by definition, still alive to send it —
        // this one is neither. Its text is already on flash
        // (persist_set_status_line) and re-renders every minute forever, surviving
        // a watch relaunch, so a phone that DIED would leave the face confidently
        // showing "8%" indefinitely. A dead phone drops the link, so no link means
        // the charge is unknowable: render "--" and ignore what was persisted.
        // Costs no wire byte, no timestamp and no age arithmetic. The peek is
        // reached only by a phone-battery slot, so no other slot pays for it.
        if (is_phone_battery_slot(slot)
                && !connection_service_peek_pebble_app_connection()) {
            snprintf(buf, cap, "--");
            return -1;   // a phone-battery slot never carries a wind sentinel
        }
        int8_t dir = status_slot_direction(slot);
        size_t n = slot->value_len;
        if (dir >= 0) { n--; }   // drop the sentinel; see status_row_direction.h
        if (n > cap - 1) { n = cap - 1; }
        memcpy(buf, slot->value, n);
        buf[n] = '\0';
        return dir;
    } else if (slot->kind == SLOT_EMPTY || slot->kind == SLOT_LIVE_BATTERY) {
        // Glyph battery is icon-only; SLOT_LIVE_BATTERY_PCT must NOT join this
        // arm — it renders its charge as text via format_live_value below.
        buf[0] = '\0';
    } else {
        format_live_value(row, slot->kind, buf, cap);
    }
    return -1;
}

static void load_thresholds(void) {
    s_thresh_len = persist_get_threshold_settings(s_thresh_scratch,
                                                  sizeof(s_thresh_scratch));
    // Judge the blob ONCE per refresh/draw pass: an invalid length collapses to
    // 0 ("nothing configured") here, so the per-slot accessor calls below all
    // see an already-normalized (blob, len) pair.
    if (s_thresh_len < 0
        || !status_threshold_settings_validate(s_thresh_scratch,
                                               (size_t)s_thresh_len)) {
        s_thresh_len = 0;
    }
    s_levels_word = persist_get_status_levels();
}

// Load everything a refresh/draw/measure pass resolves against: the threshold
// settings + packed levels, AND the line's packed blob into the shared scratch,
// walked ONCE into all three slot views. Returns the blob length, or 0 when there
// is nothing renderable (absent key, or a malformed blob) — `out` is then
// indeterminate and must not be read. Every caller loads exactly once per pass
// and consumes the views before returning, which is what keeps the views (which
// alias s_blob_scratch) valid: see the contract in status_line.h.
//
// The two loads are ONE call on purpose. This is the only producer of the views
// resolve_slot() needs, so a pass cannot reach a slot resolution without the
// thresholds behind it — which is exactly what the (since retired) right-slot
// width query used to do: it loaded the blob, skipped load_thresholds(), and so measured with the
// regular font a slot the draw pass then painted bold. The thresholds come first
// and load whatever the line holds: the bar's On demand items are read from them
// even for a line with nothing to render.
static int load_pass(uint8_t line_id, StatusSlotView out[STATUS_SLOT_COUNT]) {
    load_thresholds();
    int len = persist_get_status_line(line_id, s_blob_scratch, sizeof(s_blob_scratch));
    if (len <= 0) { return 0; }
    if (status_line_slots(s_blob_scratch, (size_t)len, out) != STATUS_SLOT_COUNT) {
        return 0;
    }
    return len;
}

// The live reading a slot of `kind` (a ThreshKind, -1 = no threshold-capable
// content) is judged against, in the blob's wire units (steps / minutes / 100 m) —
// or -1 for every non-health kind and on a watch without HealthService. The half of
// the slot's level that needs health_summary, which the host-compiled
// status_threshold_slot_level() must not call.
static int slot_health_value(int kind) {
#if defined(PBL_HEALTH)
    if (status_threshold_is_health_kind(kind)) {
        return status_threshold_health_value(kind, health_summary_steps(),
            health_summary_sleep_seconds(), health_summary_distance_m());
    }
#else
    (void)kind;
#endif
    return -1;
}

// One slot resolved to everything a pass needs that does NOT depend on
// measurement. The refresh pass folds these fields into the content signature,
// the draw pass measures and paints them — one resolution, every consumer. They
// used to be three hand-copied resolutions on eight parallel arrays, and one copy
// (the retired right-slot width query) silently omitted the threshold load (see
// load_pass).
//
// NO measurement here, deliberately: measure_slot() reads row->glyphs[i], which is
// only valid after ensure_glyphs(), and a resolver that measured would drag PDC
// glyph loads onto every minute tick's refresh. Each DRAWING caller runs
// ensure_glyphs() and then measures with this struct's `font` — the same font it
// goes on to draw with, which is the whole reason the font is resolved here.
typedef struct {
    StatusSlotView slot;                    // the packed slot
    GFont          font;                    // regular, or the bold companion
    char    text[STATUS_TEXT_MID_MAX + 1];  // direction sentinel already stripped
    int8_t  dir;                            // wind sector 0..15, -1 = none
    uint8_t level;                          // ThreshLevel, gated on the Highlight switch
    ThreshLook look;                        // box, bold bit, RAW accent byte at `level`
} ResolvedSlot;

// Resolve one slot of an already-loaded pass (load_pass filled `view`). `base` is
// the row's regular font; a slot whose bold verdict is set takes the bold
// companion instead.
static void resolve_slot(const StatusRow *row, GFont base, const StatusSlotView *view,
                         ResolvedSlot *out) {
    out->slot = *view;
    out->dir = resolve_slot_text(row, &out->slot, out->text, sizeof(out->text));
    // The ThreshKind is scaffolding, not a result: every consumer of it lives in
    // this function, so it stays a local. (The array it replaced carried it across
    // two loops, which is why the first cut made it a field.)
    const int thresh_kind = status_threshold_kind_for_slot(out->slot.kind,
                                                              out->slot.icon);
    // NORMAL while the kind's Highlight switch is off; weather kinds read the
    // phone-computed levels word (the watch has no raw AQI/wind ints), health kinds
    // compare the live reading against the Clay-sent pair.
    out->level = (uint8_t)status_threshold_slot_level(s_thresh_scratch,
        (size_t)s_thresh_len, s_levels_word, thresh_kind, slot_health_value(thresh_kind));
    // The box (none at NORMAL, filled at DANGER, the kind's warn look at WARN), the
    // bold bit and the accent byte — the function the alert icon of the same kind
    // asks at its level, so the two cannot disagree. Bold is its own per-kind
    // setting, NOT a function of the level alone: "always" bolds the normal zone
    // too, even for a kind whose thresholds are switched off entirely. ALWAYS
    // resolved, for every slot and every level: an accent nobody paints costs one
    // blob read, while one left unwritten on some paths is the uninitialised-read
    // bug this struct exists to make impossible.
    out->look = status_threshold_look(s_thresh_scratch, (size_t)s_thresh_len,
                                      thresh_kind, out->level);
    // A crossed slot renders BOLD — the calendar's today-highlight pattern applied
    // to slots. The bold Gothic shares its regular sibling's metrics, so only
    // glyph WIDTHS change, which is why the font has to travel with the slot:
    // whoever measures must measure with the font that will be drawn.
    out->font = out->look.bold ? row_font_bold(row->tier, row->line_id) : base;
}

// Resolve all three slots of an already-loaded pass (load_pass filled `views`). The
// refresh path's resolver — the draw path resolves per slot itself, so it can
// measure each one as it goes.
static void resolve_row(const StatusRow *row, const StatusSlotView views[STATUS_SLOT_COUNT],
                        ResolvedSlot out[STATUS_SLOT_COUNT]) {
    GFont base = row_font(row->tier, row->line_id);
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        resolve_slot(row, base, &views[i], &out[i]);
    }
}

StatusRow *status_row_create(uint8_t line_id) {
    StatusRow *row = malloc(sizeof(StatusRow));
    if (!row) { return NULL; }
    memset(row, 0, sizeof(StatusRow));
    row->line_id = line_id;
    row->glyph_fg = theme_fg();
    s_row_count++;
    if (!s_arrow_path) {
        s_arrow_path = gpath_create(&ARROW_PATH_INFO);
        if (!s_arrow_path) {
            APP_LOG(APP_LOG_LEVEL_ERROR, "status_row_create: failed to allocate arrow path");
        }
    }
    return row;
}

void status_row_destroy(StatusRow *row) {
    if (!row) { return; }
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        status_row_icons_destroy(row->glyphs[i]);
    }
    status_on_demand_release(&row->od);
    free(row);
    s_row_count--;
    if (s_row_count == 0 && s_arrow_path) {
        gpath_destroy(s_arrow_path);
        s_arrow_path = NULL;
    }
}

void status_row_apply(StatusRow *row, GRect bounds, uint8_t tier, uint8_t line_id) {
    if (!row) { return; }
    row->bounds = bounds;
    row->tier = tier;
    row->line_id = line_id;
}

void status_row_set_full_date(StatusRow *row, bool full_date) {
    if (row) { row->full_date = full_date; }
}

bool status_row_uses_live_health(const StatusRow *row) {
    return row && row->uses_live_health;
}

bool status_row_uses_on_demand(const StatusRow *row) {
    return row && row->od.assigned;
}

// The slot kinds whose value is read from HealthService — the ones that put a row
// into the minute handler's health work. A POSITIVE list on purpose: it used to be
// a range test (every kind from SLOT_LIVE_STEPS up, minus the two battery kinds),
// so each appended kind fell into it by default — the calendar week did, putting
// HealthService reads back on every tick of the strip for every health-enabled
// user.
static bool is_live_health_kind(uint8_t kind) {
    switch (kind) {
        case SLOT_LIVE_STEPS:
        case SLOT_LIVE_HR:
        case SLOT_LIVE_SLEEP:
        case SLOT_LIVE_DISTANCE:
        case SLOT_LIVE_DISTANCE_MI:
            return true;
        default:
            return false;
    }
}

bool status_row_refresh(StatusRow *row) {
    if (!row) { return false; }
    uint16_t sig = 5381;
    bool has_drawn_sun = false;
    row->uses_live_health = false;
    // The pass load comes first: it reads the thresholds whatever the line holds, so
    // the bar's On demand items are current even when the line has nothing to render
    // — a fresh install with no phone yet still shows Bluetooth disconnected.
    StatusSlotView views[STATUS_SLOT_COUNT];
    const bool has_line = load_pass(row->line_id, views) > 0;
    // The bar's cells and every assigned item's state, folded whatever they are: the
    // same item moved to the other side is a new paint, and so is a bar that stops
    // drawing one. Also where row->od.assigned is derived.
    sig = status_on_demand_fold(&row->od, sig, status_threshold_bar_of_line(row->line_id),
                                s_thresh_scratch, (size_t)s_thresh_len);
    // All three slots, always — including the ones On demand may slide, shorten or
    // hide at paint time: how the slots make room is a paint decision (it depends on
    // measured widths), not a content rule, and a signature describing only part of
    // the row would let a slot that changed while hidden come back stale.
    if (has_line) {
        ResolvedSlot resolved[STATUS_SLOT_COUNT];
        resolve_row(row, views, resolved);
        for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
            const ResolvedSlot *r = &resolved[i];
            const StatusSlotView *slot = &r->slot;
            sig = sig_fold(sig, &slot->kind, 1);
            sig = sig_fold(sig, &slot->icon, 1);
            sig = sig_fold(sig, (const uint8_t *)r->text, strlen(r->text));
            // The signature folds the RESOLVED text, and the resolver has already
            // stripped the direction sentinel out of it — so the sector has to be
            // folded on its own or a wind that veers without changing speed would
            // leave a stale arrow on screen until some other slot moved.
            uint8_t dir_byte = (uint8_t)r->dir;
            sig = sig_fold(sig, &dir_byte, 1);
            // Fold the highlight level so a crossing (new levels byte, a health
            // value moving, changed settings) is itself a content change, and the
            // whole look: the RESOLVED bold bit so a bold-mode-only settings change
            // (e.g. Always on a kind whose thresholds are off — no level moves)
            // repaints now instead of riding the next minute tick; the resolved
            // BOX because a Clay save that only changes the warn look (none /
            // outline / fill) moves neither of those; and the RAW accent byte
            // because a save that only recolours warn/danger moves none of the
            // others, and the box would keep its old colour until unrelated
            // content happened to move.
            sig = sig_fold(sig, &r->level, 1);
            sig = sig_fold(sig, (const uint8_t *)&r->look, sizeof(r->look));
            if (slot->kind != SLOT_EMPTY && slot->icon == STATUS_ICON_DRAWN_SUN) {
                has_drawn_sun = true;
            }
            if (slot->kind == SLOT_LIVE_BATTERY || slot->kind == SLOT_LIVE_BATTERY_PCT) {
                BatteryChargeState bs = watch_services_battery_state();
                uint8_t bt[2] = { (uint8_t) bs.charge_percent,
                                  (uint8_t) (bs.is_charging || bs.is_plugged) };
                sig = sig_fold(sig, bt, 2);
            }
            // The phone-battery slots' companion fold, the same treatment the
            // watch battery gets just above. resolve_slot_text has already folded
            // "--" in place of the persisted text while the link is down, so the
            // common case is covered by the text alone — but a slot whose baked
            // text IS "--" (no reading yet, or the user moved to a phone without
            // the API) folds identically connected or not, and would sit there
            // unrepainted through a transition. Fold the state itself and the row
            // cannot miss one.
            //
            // Deliberately NO connection_service_subscribe() here: the SDK keeps a
            // single app-wide ConnectionHandlers struct, so a second subscribe
            // would silently replace top_status_layer.c's handler (the BT icon and
            // the disconnect vibe) — and a row is a multi-instance object whose
            // destroy would then unsubscribe on the others' behalf. The strip's
            // existing callback repaints the strip, and every other row picks the
            // change up on the next minute tick.
            if (is_phone_battery_slot(slot)) {
                uint8_t connected =
                    (uint8_t)connection_service_peek_pebble_app_connection();
                sig = sig_fold(sig, &connected, 1);
            }
            // Off the FULLY resolved slot and blind to displacement like the folds
            // above: this gates whether health updates reach the row at all.
            if (is_live_health_kind(slot->kind)) {
                row->uses_live_health = true;
            }
        }
    }
    if (has_drawn_sun) {
        uint8_t sun_event_start_type = (uint8_t)persist_get_sun_event_start_type();
        sig = sig_fold(sig, &sun_event_start_type, 1);
    }
    sig = sig_fold(sig, &row->tier, 1);
    if (sig == row->content_sig) { return false; }
    row->content_sig = sig;
    return true;
}

// The row's icon tier: a fraction of the font's content height (smaller on the top
// strip), capped at the band. Shared by the slot glyphs and the On demand items, so
// an alert icon is exactly the size the same icon has in a slot beside it.
static int16_t icon_target_h(const StatusRow *row, int content_h) {
    bool top = (row->line_id == STATUS_LINE_TOP);
    int rn = top ? TOP_ICON_RATIO_NUM : ICON_RATIO_NUM;
    int rd = top ? TOP_ICON_RATIO_DEN : ICON_RATIO_DEN;
    int16_t target_h = (int16_t)((content_h * rn) / rd);
    int16_t band_cap = (int16_t)(row->bounds.size.h - ICON_BAND_MARGIN);
    if (target_h > band_cap) { target_h = band_cap; }
    return target_h;
}

// `views` are the caller's already-walked slots (load_pass filled them);
// glyph_icons[] tracks the PACKED icon.
static void ensure_glyphs(StatusRow *row, const StatusSlotView *views, int content_h) {
    bool top = (row->line_id == STATUS_LINE_TOP);
    int16_t target_h = icon_target_h(row, content_h);

    GColor fg = theme_fg();
    bool env_changed = target_h != row->glyph_h || !gcolor_equal(fg, row->glyph_fg);
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        const StatusSlotView *slot = &views[i];
        uint8_t wanted = STATUS_ICON_NONE;
        if (slot->kind != SLOT_EMPTY
                && slot->icon != STATUS_ICON_NONE
                && slot->icon != STATUS_ICON_DRAWN_SUN
                // PRESSURE is text-only by contract (status_line.h): no PDC
                // exists, so never attempt a load and reserve no icon width.
                && slot->icon != STATUS_ICON_PRESSURE
                // Same contract for the no-icon phone-battery variant: the id
                // exists only to keep it off THRESH_CITY's bold row, and no
                // glyph may load for it.
                && slot->icon != STATUS_ICON_PHONE_BATTERY_PLAIN) {
            wanted = slot->icon;
        }
        if (!env_changed && wanted == row->glyph_icons[i]) { continue; }
        status_row_icons_destroy(row->glyphs[i]);
        row->glyphs[i] = wanted != STATUS_ICON_NONE
            ? status_row_icons_load(wanted, target_h, top)
            : NULL;
        row->glyph_icons[i] = wanted;
    }
    row->glyph_h = target_h;
    row->glyph_fg = fg;
}

int16_t status_row_text_w(const char *text, GFont font, int16_t content_w, int16_t h) {
    if (text[0] == '\0' || content_w <= 0 || h <= 0) { return 0; }
    return graphics_text_layout_get_content_size(text, font, GRect(0, 0, content_w, h),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).w;
}

// Measured footprint of one slot: icon width (battery = fixed glyph, loaded PDC,
// or the drawn-sun arrow) + text width + the trailing wind-direction arrow's lane.
// The draw pass feeds it a ResolvedSlot's font/slot/text/dir — the resolver's font
// above all, since a bold slot's glyphs are wider than the regular font would
// measure.
static StatusSlotMeasure measure_slot(StatusRow *row, int i, GFont font,
                                      int16_t content_w, const StatusSlotView *slot,
                                      const char *text, int8_t dir) {
    // Zero-init, not field-by-field: an unassigned field here is indeterminate
    // stack memory that status_row_layout would read as a real reserve.
    StatusSlotMeasure m = {0};
    int16_t icon_w = 0;
    if (slot->kind == SLOT_LIVE_BATTERY) {
        icon_w = BATTERY_GLYPH_W;
    } else if (row->glyphs[i]) {
        icon_w = gdraw_command_image_get_bounds_size(row->glyphs[i]).w;
    } else if (slot->icon == STATUS_ICON_DRAWN_SUN && slot->kind != SLOT_EMPTY) {
        icon_w = ARROW_W;
    }
    int16_t text_w = status_row_text_w(text, font, content_w, row->bounds.size.h);
    m.present = icon_w > 0 || text_w > 0;
    m.icon_w = icon_w;
    m.text_w = text_w;
    // Reserve ARROW_H, not ARROW_W. ARROW_W (6, emery 8) is the arrow's width in
    // the only two headings the sun slot ever draws — straight up and straight
    // down — and this arrow turns to any of 16. At 45 degrees the shape's extent
    // across x is its LONG axis, so the lane is an ARROW_H square: the box a
    // rotation can never push the path out of.
    m.suffix_w = (dir >= 0) ? ARROW_H : 0;
    return m;
}

// The slot's occupied box (icon through text), padded 2 px each side — the
// outline/fill target. Pure geometry from the same places/measures the content
// draw uses. Vertically it is seated on `cap_cy`, the glyph cap centre the
// icons and the sun arrow already co-centre on, sized from the row's font and
// clamped to the row band; status_highlight_extent() owns that arithmetic (and
// is host-tested).
static GRect slot_highlight_box(const StatusRow *row, const StatusSlotPlace *place,
                                const StatusSlotMeasure *m, int16_t x0, int cap_cy,
                                int content_h, const char *text) {
    // status_slot_ink reaches to the wind arrow, the slot's LAST ink past the text, so a
    // fill cannot clip it; and only while the arrow draws, so the box never reserves
    // room for ink that isn't there (suffix_w is 0 on every other slot).
    int16_t lo;
    int16_t hi;
    status_slot_ink(place, m, &lo, &hi);
    StatusHighlightExtent v = status_highlight_extent(
        row->bounds.origin.y, row->bounds.size.h, (int16_t)cap_cy,
        (int16_t)content_h, row->line_id == STATUS_LINE_TOP,
        place->text_visible && status_text_has_descender(text));
    return GRect((int16_t)(x0 + lo - 2), v.y, (int16_t)((hi - lo) + 4), v.h);
}

void status_row_draw(StatusRow *row, GContext *ctx) {
    if (!row || !ctx) { return; }
    StatusSlotView views[STATUS_SLOT_COUNT];
    if (load_pass(row->line_id, views) == 0) {
        // No line to render. A bar with On demand items still draws them — a fresh
        // install with no phone yet must show Bluetooth disconnected — over three
        // empty slots; any other bar draws nothing, as before.
        if (!row->od.assigned) { return; }
        memset(views, 0, sizeof(views));
    }

    GFont font = row_font(row->tier, row->line_id);
    int content_h = graphics_text_layout_get_content_size(
        "0", font, GRect(0, 0, 100, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).h;
    ensure_glyphs(row, views, content_h);

    int16_t content_w = (int16_t)(row->bounds.size.w - 2 * STATUS_ROW_MARGIN);
    if (content_w < 0) { content_w = 0; }
    ResolvedSlot slots[STATUS_SLOT_COUNT];
    StatusSlotMeasure measures[STATUS_SLOT_COUNT];

    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        resolve_slot(row, font, &views[i], &slots[i]);
        // The resolver's font, not `font`: a bold slot's glyphs are wider, so it
        // must MEASURE with the font it is about to be drawn with.
        measures[i] = measure_slot(row, i, slots[i].font, content_w,
                                   &slots[i].slot, slots[i].text, slots[i].dir);
    }

    int text_y_rel = row_text_y(row, font);
    int text_y = row->bounds.origin.y + text_y_rel;
    int glyph_cy = row->bounds.origin.y
        + status_glyph_center_y(text_y_rel, content_h);
    int16_t x0 = (int16_t)(row->bounds.origin.x + STATUS_ROW_MARGIN);

    // On demand, measured against the three slots: with an active item the slots make
    // room for it (on_demand.c's ladder), down to their short forms, and a slot that
    // takes one comes back with that member's measure and text; otherwise the bar lays
    // out exactly as it would without the feature. The top strip's left run may reach
    // STATUS_ROW_MARGIN into the margin, so its first item sits where the old
    // indicators drew (screen x 4) while its content rect stays the quiet one.
    const bool top = row->line_id == STATUS_LINE_TOP;
    const StatusOnDemandEnv od_env = {
        .font = font,
        .bold = row_font_bold(row->tier, row->line_id),
        .blob = s_thresh_scratch,
        .blob_len = (size_t)s_thresh_len,
        .band = row->bounds,
        .x = x0,
        .glyph_cy = (int16_t)glyph_cy,
        .text_y = (int16_t)text_y,
        .content_h = (int16_t)content_h,
        .icon_h = icon_target_h(row, content_h),
        .bar = (int8_t)status_threshold_bar_of_line(row->line_id),
        .bleed_left = top ? STATUS_ROW_MARGIN : 0,
        .top_strip = top,
        .right_is_battery = views[STATUS_SLOT_COUNT - 1].kind == SLOT_LIVE_BATTERY,
        .full_date = row->full_date
    };
    StatusOnDemandSlot od_slots[STATUS_SLOT_COUNT];
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        od_slots[i] = (StatusOnDemandSlot) { slots[i].slot.kind, slots[i].slot.icon,
                                             slots[i].font, slots[i].text,
                                             sizeof(slots[i].text) };
    }
    StatusSlotPlace places[STATUS_SLOT_COUNT];
    status_on_demand_layout(&row->od, &s_od_pass, &od_env, od_slots, measures, places,
                            content_w);

    // Threshold-highlight pass: paint each crossed slot's box — an outline, or a
    // filled box + outline — UNDER its icon + text (calendar today-box precedent),
    // as the resolver's look says: filled at danger, and at warn the kind's warn look
    // (none: the bold text IS the highlight, no box). Every box goes down before any
    // slot's content; the paint hands back the ink that slot's content then draws
    // in, so ink and fill cannot disagree. Paint-only — no allocations.
    GColor inks[STATUS_SLOT_COUNT];
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        inks[i] = theme_fg();
        if (!places[i].visible || slots[i].look.box == THRESH_BOX_NONE) { continue; }
        GRect box = slot_highlight_box(row, &places[i], &measures[i], x0, glyph_cy,
                                       content_h, slots[i].text);
        inks[i] = status_highlight_paint(ctx, box, slots[i].look);
    }

    // The On demand items, over the slot boxes and under the slot content. A slot the
    // layout hid is not visible, so neither slot pass here touches it.
    status_on_demand_paint(ctx, &row->od, &s_od_pass, &od_env);

    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        if (!places[i].visible) { continue; }
        // Filled slots (danger, or a warn look of fill) draw legible over the fill;
        // outlined and plain slots keep the theme foreground.
        const GColor ink = inks[i];
        graphics_context_set_text_color(ctx, ink);
        int16_t icon_x = (int16_t)(x0 + places[i].icon_x);
        if (slots[i].slot.kind == SLOT_LIVE_BATTERY) {
            // The short battery (On demand) is measured without its bolt lane, which
            // is empty while the watch is not charging: the glyph draws that much
            // further left, so its body lands where the slot was placed.
            int16_t lane = (int16_t)(BATTERY_GLYPH_W - measures[i].icon_w);
            battery_draw(ctx, GRect(icon_x - lane, glyph_cy - BATTERY_GLYPH_H / 2,
                                    BATTERY_GLYPH_W, BATTERY_GLYPH_H), ink);
        } else if (row->glyphs[i]) {
            GSize gs = gdraw_command_image_get_bounds_size(row->glyphs[i]);
            // Seat the glyph on the cap centre at its per-icon optical-centre
            // weight (status_icon_weight.h). Every weight ships at 50 today,
            // which reduces this to the historical `glyph_cy - gs.h / 2`.
            // glyph_icons[i] is the id whose PDC is in glyphs[i] (ensure_glyphs
            // keeps the two together).
            status_highlight_draw_glyph(ctx, row->glyphs[i],
                GPoint(icon_x, status_icon_top_y(glyph_cy, gs.h,
                    status_icon_weight_pct(row->glyph_icons[i]))), ink);
        } else if (slots[i].slot.icon == STATUS_ICON_DRAWN_SUN
                   && measures[i].icon_w > 0) {
            bool arrow_up = persist_get_sun_event_start_type() == 0;
            int arrow_x = icon_x + ARROW_W / 2;
            if (s_arrow_path) {
                gpath_rotate_to(s_arrow_path, arrow_up ? TRIG_MAX_ANGLE / 2 : 0);
                gpath_move_to(s_arrow_path, GPoint(arrow_x, glyph_cy));
                graphics_context_set_stroke_color(ctx, theme_fg());
                graphics_context_set_fill_color(ctx, theme_fg());
                gpath_draw_outline_open(ctx, s_arrow_path);
                gpath_draw_filled(ctx, s_arrow_path);
            }
        }
        if (places[i].text_visible) {
            graphics_draw_text(ctx, slots[i].text, slots[i].font,
                GRect(x0 + places[i].text_x, text_y, places[i].text_w,
                      row->bounds.size.h - text_y_rel),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
        }
        // The wind-direction arrow — the first ink this watchface draws AFTER a
        // slot's text, which is the point: it reads as a modifier on the speed
        // rather than a second icon. The shape is the sunrise/sunset arrow's shared
        // GPath, turned; only a heading distinguishes the two uses.
        //
        // Gated on text_visible so the arrow follows its reading: a slot squeezed
        // until its number is gone would otherwise show a bare heading with nothing
        // to modify. (The phone applies the same rule at bake time — no number, no
        // sentinel.) `ink`, not theme_fg(): a filled wind slot draws its
        // text and its glyph legible OVER the fill, and an arrow in the foreground
        // colour would disappear into it. The measure has the final say: a wind slot
        // in its last short form (On demand) drops the arrow's lane.
        if (places[i].text_visible && slots[i].dir >= 0 && measures[i].suffix_w > 0
                && s_arrow_path) {
            gpath_rotate_to(s_arrow_path, (int32_t)((TRIG_MAX_ANGLE
                * status_dir_turn_sixteenths(slots[i].dir)) / 16));
            // Centred in its ARROW_H-square lane, seated on the same cap centre the
            // icons, the battery glyph and the sun arrow all co-centre on.
            gpath_move_to(s_arrow_path,
                GPoint(x0 + places[i].suffix_x + ARROW_H / 2, glyph_cy));
            graphics_context_set_stroke_color(ctx, ink);
            graphics_context_set_fill_color(ctx, ink);
            gpath_draw_outline_open(ctx, s_arrow_path);
            gpath_draw_filled(ctx, s_arrow_path);
        }
    }
}
