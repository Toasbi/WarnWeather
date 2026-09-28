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
// The Alerts row's modules, included unguarded although every use below sits behind
// WW_ALERT_ROW: waf's dependency scanner does not evaluate -D macros, so a guarded
// include is invisible to it (night_light.c records the flaky build that caused).
// A header emits no code.
#include "status_alerts.h"
#include "../appendix/alert_set.h"
#include "../appendix/rain_countdown.h"
#include "../appendix/rain_tier.h"
#if defined(PBL_HEALTH)
#include "../services/health_summary.h"
#include "../services/health.h"
#endif
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
    bool battery_override;
    GDrawCommandImage *glyphs[STATUS_SLOT_COUNT];
    uint8_t glyph_icons[STATUS_SLOT_COUNT];
    int16_t glyph_h;
    GColor glyph_fg;
    uint16_t content_sig;
    bool uses_live_health;
#if defined(WW_ALERT_ROW)
    // The Alerts row's glyph cache: allocated by the first draw that has entries to
    // show, freed by the first refresh that finds the bar's placement Off
    // (derive_alerts_place) and with the row. Its glyphs come and go with their
    // alerts (status_alerts_ensure), so an idle Alerts row keeps only the cache struct.
    StatusAlertsCache *alerts;
    uint8_t alerts_place;   // ThreshAlertsPlace, derived from the blob on every refresh
#endif
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
// Packed weather threshold-levels value (STATUS_LEVELS_UINT8, 2 wire bytes LE —
// UV rides bits 8-9), reloaded once per refresh/draw pass alongside the blob
// above (persist_get_status_levels() is persist_exists + persist_read_int;
// reading it once per pass instead of once per weather slot avoids redundant
// flash-backed reads across a row).
static int s_levels_word;

#ifdef PBL_PLATFORM_APLITE
// aplite: primitive lines avoid GPath's code and transient draw allocation.
static void draw_sun_arrow(GContext *ctx, int cx, int cy, bool up) {
    const int h2 = ARROW_H / 2;
    const int apex_y = up ? (cy - h2) : (cy + h2);
    const int dir = up ? 1 : -1;
    graphics_context_set_stroke_color(ctx, theme_fg());
    graphics_draw_line(ctx, GPoint(cx, up ? cy + h2 : cy - h2),
                       GPoint(cx, apex_y + dir * ARROW_HEAD_H));
    for (int i = 0; i <= ARROW_HEAD_H; ++i) {
        const int hw = (ARROW_HEAD_W * i) / ARROW_HEAD_H;
        graphics_draw_line(ctx, GPoint(cx - hw, apex_y + dir * i),
                           GPoint(cx + hw, apex_y + dir * i));
    }
}
#else
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
#endif

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

#if defined(WW_THRESHOLD_HIGHLIGHT)
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
#endif

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
#if !defined(PBL_PLATFORM_APLITE)
        // aplite: excluded to stay within its frozen image budget; the phone
        // never offers/sends the calendar-week slot to aplite (catalog gate).
        case SLOT_LIVE_WEEK: {
            struct tm tm_now = watch_services_localtime();
            snprintf(buf, cap, "W%d",
                     iso_week(tm_now.tm_year + 1900, tm_now.tm_yday, tm_now.tm_wday));
            return;
        }
#endif
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

// The low-battery takeover: force the right slot to render as the battery glyph
// (icon-only, no text) without touching the packed blob. No-op for other slots.
static void apply_battery_override(const StatusRow *row, int slot_index, StatusSlotView *slot) {
    if (row->battery_override && slot_index == STATUS_SLOT_COUNT - 1) {
        slot->kind = SLOT_LIVE_BATTERY;
        slot->icon = STATUS_ICON_NONE;
        slot->value_len = 0;
        slot->value = NULL;
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

static uint16_t sig_fold(uint16_t sig, const uint8_t *data, size_t len) {
    for (size_t i = 0; i < len; i++) {
        sig = (uint16_t)((sig * 31) + data[i]);
    }
    return sig;
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
// and load whatever the line holds: the refresh derives the bar's Alerts placement
// from them even for a line with nothing to render.
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
    StatusSlotView slot;                    // the battery override already applied
    GFont          font;                    // regular, or the bold companion
    char    text[STATUS_TEXT_MID_MAX + 1];  // direction sentinel already stripped
    int8_t  dir;                            // wind sector 0..15, -1 = none
    uint8_t level;                          // ThreshLevel, gated on the Highlight switch
    ThreshLook look;                        // box, bold bit, RAW accent byte at `level`
} ResolvedSlot;

// Resolve slot `i` of an already-loaded pass (load_pass filled `view`). `base` is
// the row's regular font; a slot whose bold verdict is set takes the bold
// companion instead.
static void resolve_slot(const StatusRow *row, int i, GFont base,
                         const StatusSlotView *view, ResolvedSlot *out) {
    out->slot = *view;
    apply_battery_override(row, i, &out->slot);
    out->dir = resolve_slot_text(row, &out->slot, out->text, sizeof(out->text));
    // AFTER the battery override, which rewrites the slot's kind/icon.
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
        resolve_slot(row, i, base, &views[i], &out[i]);
    }
}

#if defined(WW_ALERT_ROW)
// The Alerts row resolved for one pass: the entries (the phone-baked metric alerts,
// with the watch-resolved rain entry in front) and what their text lanes print.
// The metric entries' values point into `bytes` — the stored tuple is read into the
// struct itself — so the set lives exactly as long as this struct, a pass-local.
typedef struct {
    uint8_t bytes[ALERT_ENTRIES_MAX_BYTES];    // the stored ALERT_ENTRIES tuple
    AlertSet set;
    char rain_text[RAIN_COUNTDOWN_TEXT_CAP];   // countdown text; "" = no rain entry
    int rain_display;                          // ThreshRainDisplay, from the blob
} ResolvedAlerts;

// Resolve the Alerts row against an already-loaded pass (load_pass: the thresholds
// blob behind the rain look): the metric entries from the stored tuple (one flash
// read — app_message.c has already checked it with alert_set_bytes_ok), the rain
// entry derived here, every pass, from the radar cache rain_countdown_refresh()
// keeps — O(1) and flash-free — which is why a row with a placement must be
// refreshed on the minute tick and after a radar rescan (status_row_uses_alerts).
// The tier is collapsed to its drop bucket HERE, on the SDK side: rain_tier.h pulls
// <pebble.h>, which the pure alert_set.c must not (it host-compiles).
static void resolve_alerts(ResolvedAlerts *out) {
    int len = persist_get_alert_entries(out->bytes, sizeof(out->bytes));
    alert_set_parse(out->bytes, len > 0 ? (size_t)len : 0, &out->set);
    bool rain = rain_countdown_format(out->rain_text, sizeof(out->rain_text),
                                      watch_services_now());
    if (!rain) { out->rain_text[0] = '\0'; }
    int tier = rain ? rain_countdown_peak_tier() : 0;
    alert_set_prepend_rain(&out->set, rain, rain_tier_to_bucket3(tier), tier);
    out->rain_display = status_threshold_rain_display(s_thresh_scratch,
                                                      (size_t)s_thresh_len);
}

// Fold everything the Alerts row paints into the row signature, so a changed set is
// a content change: which entries, their levels and baked values, the look each one
// reads from the blob at its level (status_threshold_look — a Clay save that only
// recolours or re-looks must repaint, as for a slot's look; the kind's slot Highlight
// switch does not touch an entry, so it is not folded), the rain look, the drop's
// bucket and tier (its glyph and tint), and the countdown text — but the text only
// when a look prints it, or an icon-only rain alert would repaint every minute for
// nothing.
static uint16_t fold_alerts(uint16_t sig, const ResolvedAlerts *a) {
    sig = sig_fold(sig, &a->set.count, 1);
    for (int i = 0; i < a->set.count; i++) {
        const AlertEntry *e = &a->set.entries[i];
        uint8_t head[5] = { (uint8_t)e->rain, e->kind, e->level, e->rain_bucket,
                            e->rain_tier };
        sig = sig_fold(sig, head, sizeof(head));
        if (e->rain) { continue; }
        sig = sig_fold(sig, (const uint8_t *)e->value, e->value_len);
        ThreshLook look = status_threshold_look(s_thresh_scratch, (size_t)s_thresh_len,
                                                e->kind, e->level);
        sig = sig_fold(sig, (const uint8_t *)&look, sizeof(look));
    }
    uint8_t display = (uint8_t)a->rain_display;
    sig = sig_fold(sig, &display, 1);
    if (a->rain_display != THRESH_RAIN_DISPLAY_ICON) {
        sig = sig_fold(sig, (const uint8_t *)a->rain_text, strlen(a->rain_text));
    }
    return sig;
}
#endif

StatusRow *status_row_create(uint8_t line_id) {
    StatusRow *row = malloc(sizeof(StatusRow));
    if (!row) { return NULL; }
    memset(row, 0, sizeof(StatusRow));
    row->line_id = line_id;
    row->glyph_fg = theme_fg();
    s_row_count++;
#ifndef PBL_PLATFORM_APLITE
    if (!s_arrow_path) {
        s_arrow_path = gpath_create(&ARROW_PATH_INFO);
        if (!s_arrow_path) {
            APP_LOG(APP_LOG_LEVEL_ERROR, "status_row_create: failed to allocate arrow path");
        }
    }
#endif
    return row;
}

void status_row_destroy(StatusRow *row) {
    if (!row) { return; }
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        status_row_icons_destroy(row->glyphs[i]);
    }
#if defined(WW_ALERT_ROW)
    status_alerts_destroy(row->alerts);
#endif
    free(row);
    s_row_count--;
#ifndef PBL_PLATFORM_APLITE
    if (s_row_count == 0 && s_arrow_path) {
        gpath_destroy(s_arrow_path);
        s_arrow_path = NULL;
    }
#endif
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

void status_row_set_battery_override(StatusRow *row, bool active) {
    if (row && row->battery_override != active) {
        row->battery_override = active;
        row->content_sig = 0;   // force the next refresh to report a change
    }
}

bool status_row_uses_live_health(const StatusRow *row) {
    return row && row->uses_live_health;
}

#if defined(WW_ALERT_ROW)
// Read the bar's Alerts placement from the thresholds blob the pass just loaded:
// the row's own cell of the placement byte. Every refresh reads it, so every
// checkpoint that re-resolves the row — a settings save's among them — also picks
// up a moved placement, and nothing outside the row has to push it in.
static void derive_alerts_place(StatusRow *row) {
    // load_thresholds() normalises an invalid blob to len 0, which the accessor
    // answers with the pre-placement default (strip left, the rest off).
    row->alerts_place = (uint8_t)status_threshold_bar_alerts(s_thresh_scratch,
        (size_t)s_thresh_len, status_threshold_bar_of_line(row->line_id));
    // Off: give the cache and whatever glyphs it still holds back now rather than
    // at row teardown. Any other placement keeps it — the same entries draw there.
    if (row->alerts_place == THRESH_ALERTS_OFF && row->alerts) {
        status_alerts_destroy(row->alerts);
        row->alerts = NULL;
    }
}

bool status_row_uses_alerts(const StatusRow *row) {
    return row && row->alerts_place != THRESH_ALERTS_OFF;
}
#endif

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
    // the Alerts placement below is current even when the line has nothing to render.
    StatusSlotView views[STATUS_SLOT_COUNT];
    const bool has_line = load_pass(row->line_id, views) > 0;
#if defined(WW_ALERT_ROW)
    derive_alerts_place(row);
    // Folded whatever it is, Off included: the same entries moved from the left to
    // the right are a new paint, and so is a row that stops drawing them.
    sig = sig_fold(sig, &row->alerts_place, 1);
#endif
    // All three slots, always — including the ones the Alerts row may take over at
    // paint time: which slots it takes is a paint decision (it depends on measured
    // widths), not a content rule, and a signature describing only part of the row
    // would let a slot that moved while replaced come back stale.
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
#if defined(WW_ALERT_ROW)
        // The Alerts row's entries fold only while the bar has a placement — Off
        // draws none of them, so they are not this row's content.
        if (row->alerts_place != THRESH_ALERTS_OFF) {
            ResolvedAlerts alerts;
            resolve_alerts(&alerts);
            sig = fold_alerts(sig, &alerts);
        }
#endif
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

// `views` are the caller's already-walked slots (load_pass filled them); the
// battery override is deliberately NOT applied here — glyph_icons[] tracks the
// PACKED icon, and the override's glyph is drawn by battery_draw(), not a PDC.
// The row's icon tier: a fraction of the font's content height (smaller on the top
// strip), capped at the band. Shared by the slot glyphs and the Alerts row's, so an
// alert icon is exactly the size the same icon has in a slot beside it.
static int16_t icon_target_h(const StatusRow *row, int content_h) {
    bool top = (row->line_id == STATUS_LINE_TOP);
    int rn = top ? TOP_ICON_RATIO_NUM : ICON_RATIO_NUM;
    int rd = top ? TOP_ICON_RATIO_DEN : ICON_RATIO_DEN;
    int16_t target_h = (int16_t)((content_h * rn) / rd);
    int16_t band_cap = (int16_t)(row->bounds.size.h - ICON_BAND_MARGIN);
    if (target_h > band_cap) { target_h = band_cap; }
    return target_h;
}

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
    int16_t text_w = 0;
    if (text[0] != '\0' && content_w > 0 && row->bounds.size.h > 0) {
        text_w = graphics_text_layout_get_content_size(
            text, font, GRect(0, 0, content_w, row->bounds.size.h),
            GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).w;
    }
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
    int16_t start = (int16_t)(x0 + (m->icon_w > 0 ? place->icon_x : place->text_x));
    int16_t end = place->text_visible
        ? (int16_t)(x0 + place->text_x + place->text_w)
        : (int16_t)(x0 + place->icon_x + m->icon_w);
    // The wind arrow is the slot's LAST ink, past the text — a box that stopped at
    // the text would let a fill clip it. Gated on text_visible for exactly
    // the condition the arrow itself draws under, so the box never reserves room
    // for ink that isn't there; suffix_w is 0 on every other slot, so no plain slot
    // widens by so much as a pixel.
    if (m->suffix_w > 0 && place->text_visible) {
        int16_t suffix_end = (int16_t)(x0 + place->suffix_x + m->suffix_w);
        if (suffix_end > end) { end = suffix_end; }
    }
    StatusHighlightExtent v = status_highlight_extent(
        row->bounds.origin.y, row->bounds.size.h, (int16_t)cap_cy,
        (int16_t)content_h, row->line_id == STATUS_LINE_TOP,
        place->text_visible && status_text_has_descender(text));
    return GRect((int16_t)(start - 2), v.y, (int16_t)((end - start) + 4), v.h);
}

#if defined(WW_ALERT_ROW)
// The Alerts row's share of one draw pass: its resolved entries, the text lanes they
// print (after the lane ladder), their measured widths, how many of them fit and
// where the row starts (content-relative, like a StatusSlotPlace).
typedef struct {
    int n;                             // entries that fit (alert_set_fit); 0 = none
    int16_t x;                         // left edge of the row inside the content
    ResolvedAlerts r;
    StatusAlertsText text;
    int16_t widths[ALERT_SET_MAX];
} AlertsPass;

// A placed slot's ink extent end: its suffix lane, else its text, else its icon —
// the right edge slot_highlight_box() frames. (Its start is always icon_x:
// place_group puts the group there whether or not it has an icon.)
static int16_t place_end(const StatusSlotPlace *p, const StatusSlotMeasure *m) {
    if (m->suffix_w > 0 && p->text_visible) { return (int16_t)(p->suffix_x + m->suffix_w); }
    if (p->text_visible) { return (int16_t)(p->text_x + p->text_w); }
    return (int16_t)(p->icon_x + m->icon_w);
}

// Resolve and measure the Alerts row at its full lanes. False = nothing to draw
// (no alert active, or OOM for the cache): the bar then lays out exactly as it
// would without the feature.
//
// Also where the glyph cache lives: created by the first pass that has an entry to
// draw, and emptied (status_alerts_ensure evicts what the set no longer holds) by
// every pass after, so an idle row holds no glyph heap. It is freed by the refresh
// that finds the placement Off (derive_alerts_place) and with the row.
static bool alerts_prepare(StatusRow *row, AlertsPass *a, int content_h, GFont font) {
    resolve_alerts(&a->r);
    const AlertSet *set = &a->r.set;
    if (!row->alerts && set->count > 0) { row->alerts = status_alerts_create(); }
    if (!row->alerts) { return false; }
    int rain_tier = (set->count > 0 && set->entries[0].rain) ? set->entries[0].rain_tier : 0;
    status_alerts_ensure(row->alerts, set, icon_target_h(row, content_h),
                         row->line_id == STATUS_LINE_TOP, theme_fg(),
                         status_alerts_rain_tint(rain_tier), theme_is_light());
    if (set->count == 0) { return false; }
    a->text = (StatusAlertsText){
        .font = font,
        .bold = row_font_bold(row->tier, row->line_id),
        .blob = s_thresh_scratch,
        .blob_len = (size_t)s_thresh_len,
        .rain_display = a->r.rain_display,
        .values = true,
        .rain_text = a->r.rain_text[0] != '\0' ? a->r.rain_text : NULL
    };
    status_alerts_measure(row->alerts, set, &a->text, a->widths);
    return true;
}

// The takeover (spec 4.1): choose the slots the row replaces, lay out the rest as
// usual, then fit the row into the span they leave.
//  1. alert_set_choose_slots — the anchor slot of the bar's placement, plus one
//     neighbour when the row at its FULL lanes does not fit the anchor's room
//     (LEFT/RIGHT borrow the middle slot, MIDDLE the left one; never more).
//  2. Those slots' measures are zeroed and status_row_layout places the remaining
//     ones exactly where they would sit anyway — a slot the row did not take draws
//     normally, in its usual place (the middle one stays centred).
//  3. The span is what the placed slots leave around the anchor
//     (alert_set_free_span). Within it the lanes degrade before any entry drops
//     (rain text -> minutes, then every value off; alert_set_degrade), and only
//     then does the tail go (alert_set_fit: pollen first, rain last).
//  4. The row sits left-aligned (LEFT), centred on the row (MIDDLE) or against the
//     right edge (RIGHT) inside the span (alert_set_row_x).
// A RIGHT row moves to the MIDDLE while the low-battery warning holds the right
// slot (alert_set_place), for every step above. And when not even the first entry
// fits the freed span, the taken slots come back (alert_set_taken_slots): their
// saved measures are restored and the bar lays out as if the row were not there —
// a slot is replaced only by alerts it actually shows, never by a blank gap.
static void alerts_layout(const StatusRow *row, AlertsPass *a,
                          StatusSlotMeasure measures[STATUS_SLOT_COUNT],
                          StatusSlotPlace places[STATUS_SLOT_COUNT], int16_t content_w) {
    const AlertSet *set = &a->r.set;
    const int place = alert_set_place(row->alerts_place, row->battery_override);
    int need = alert_set_row_w(a->widths, set->count, STATUS_ALERTS_ENTRY_GAP);
    int mask = alert_set_choose_slots(place, need, content_w,
        status_slot_desired_w(&measures[0]), status_slot_desired_w(&measures[1]),
        status_slot_desired_w(&measures[2]), STATUS_ROW_GROUP_GAP);
    StatusSlotMeasure saved[STATUS_SLOT_COUNT];
    memcpy(saved, measures, sizeof(saved));
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        if (mask & (1 << i)) { measures[i] = (StatusSlotMeasure){0}; }
    }
    status_row_layout(content_w, measures, places);

    int visible = 0;
    int16_t lo[STATUS_SLOT_COUNT];
    int16_t hi[STATUS_SLOT_COUNT];
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        lo[i] = places[i].icon_x;
        hi[i] = place_end(&places[i], &measures[i]);
        if (places[i].visible) { visible |= 1 << i; }
    }
    int x0;
    int x1;
    alert_set_free_span(place, visible, content_w, STATUS_ROW_GROUP_GAP,
                        lo, hi, &x0, &x1);
    int budget = x1 - x0;

    while (need > budget && alert_set_degrade(&a->text.rain_display, &a->text.values)) {
        status_alerts_measure(row->alerts, set, &a->text, a->widths);
        need = alert_set_row_w(a->widths, set->count, STATUS_ALERTS_ENTRY_GAP);
    }
    a->n = alert_set_fit(a->widths, set->count, STATUS_ALERTS_ENTRY_GAP, budget);
    if (alert_set_taken_slots(mask, a->n) != mask) {
        // Nothing fits (a long City left beside the anchor, say): hand the slots
        // back rather than paint a blank gap where they were. a->n stays 0, so the
        // draw paints no entry.
        memcpy(measures, saved, sizeof(saved));
        status_row_layout(content_w, measures, places);
        return;
    }
    int w = alert_set_row_w(a->widths, a->n, STATUS_ALERTS_ENTRY_GAP);
    a->x = (int16_t)alert_set_row_x(place, x0, x1, content_w, w);
}
#endif

void status_row_draw(StatusRow *row, GContext *ctx) {
    if (!row || !ctx) { return; }
    StatusSlotView views[STATUS_SLOT_COUNT];
    if (load_pass(row->line_id, views) == 0) { return; }

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
        resolve_slot(row, i, font, &views[i], &slots[i]);
        // The resolver's font, not `font`: a bold slot's glyphs are wider, so it
        // must MEASURE with the font it is about to be drawn with.
        measures[i] = measure_slot(row, i, slots[i].font, content_w,
                                   &slots[i].slot, slots[i].text, slots[i].dir);
    }

    StatusSlotPlace places[STATUS_SLOT_COUNT];
#if defined(WW_ALERT_ROW)
    // The Alerts row, measured against the three slots: with a placement and an
    // active alert it takes its slots out of the layout; otherwise the bar lays out
    // exactly as it would without the feature.
    AlertsPass alerts;
    alerts.n = 0;
    if (row->alerts_place != THRESH_ALERTS_OFF
            && alerts_prepare(row, &alerts, content_h, font)) {
        alerts_layout(row, &alerts, measures, places, content_w);
    } else {
        status_row_layout(content_w, measures, places);
    }
#else
    status_row_layout(content_w, measures, places);
#endif

    int text_y_rel = row_text_y(row, font);
    int text_y = row->bounds.origin.y + text_y_rel;
    int glyph_cy = row->bounds.origin.y
        + status_glyph_center_y(text_y_rel, content_h);
    int16_t x0 = (int16_t)(row->bounds.origin.x + STATUS_ROW_MARGIN);

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

#if defined(WW_ALERT_ROW)
    // The Alerts row paints its entries itself — each its own mini slot with its own
    // box — from the left edge alerts_layout gave it. The slots it replaced were
    // zeroed out of the layout, so neither pass here touches them.
    if (alerts.n > 0) {
        StatusAlertsPlace place = {
            .band = row->bounds,
            .x = (int16_t)(x0 + alerts.x),
            .glyph_cy = (int16_t)glyph_cy,
            .text_y = (int16_t)text_y,
            .content_h = (int16_t)content_h,
            .top_strip = row->line_id == STATUS_LINE_TOP
        };
        status_alerts_draw(ctx, row->alerts, &alerts.r.set, alerts.n, alerts.widths,
                           &alerts.text, &place);
    }
#endif

    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        if (!places[i].visible) { continue; }
        // Filled slots (danger, or a warn look of fill) draw legible over the fill;
        // outlined and plain slots keep the theme foreground.
        const GColor ink = inks[i];
        graphics_context_set_text_color(ctx, ink);
        int16_t icon_x = (int16_t)(x0 + places[i].icon_x);
        if (slots[i].slot.kind == SLOT_LIVE_BATTERY) {
            battery_draw(ctx, GRect(icon_x, glyph_cy - BATTERY_GLYPH_H / 2,
                                    BATTERY_GLYPH_W, BATTERY_GLYPH_H), ink);
        } else if (row->glyphs[i]) {
            GSize gs = gdraw_command_image_get_bounds_size(row->glyphs[i]);
            // Seat the glyph on the cap centre at its per-icon optical-centre
            // weight (status_icon_weight.h). Every weight ships at 50 today,
            // which reduces this to the historical `glyph_cy - gs.h / 2`.
            // glyph_icons[i] — not the resolved slot's icon — is the id whose PDC
            // is in glyphs[i] (the battery override rewrites the resolved icon).
            status_highlight_draw_glyph(ctx, row->glyphs[i],
                GPoint(icon_x, status_icon_top_y(glyph_cy, gs.h,
                    status_icon_weight_pct(row->glyph_icons[i]))), ink);
        } else if (slots[i].slot.icon == STATUS_ICON_DRAWN_SUN
                   && measures[i].icon_w > 0) {
            bool arrow_up = persist_get_sun_event_start_type() == 0;
            int arrow_x = icon_x + ARROW_W / 2;
#ifdef PBL_PLATFORM_APLITE
            draw_sun_arrow(ctx, arrow_x, glyph_cy, arrow_up);
#else
            if (s_arrow_path) {
                gpath_rotate_to(s_arrow_path, arrow_up ? TRIG_MAX_ANGLE / 2 : 0);
                gpath_move_to(s_arrow_path, GPoint(arrow_x, glyph_cy));
                graphics_context_set_stroke_color(ctx, theme_fg());
                graphics_context_set_fill_color(ctx, theme_fg());
                gpath_draw_outline_open(ctx, s_arrow_path);
                gpath_draw_filled(ctx, s_arrow_path);
            }
#endif
        }
        if (places[i].text_visible) {
            graphics_draw_text(ctx, slots[i].text, slots[i].font,
                GRect(x0 + places[i].text_x, text_y, places[i].text_w,
                      row->bounds.size.h - text_y_rel),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
        }
#ifndef PBL_PLATFORM_APLITE
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
        // colour would disappear into it.
        if (places[i].text_visible && slots[i].dir >= 0 && s_arrow_path) {
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
#endif
    }
}
