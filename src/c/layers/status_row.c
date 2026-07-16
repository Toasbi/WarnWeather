#include "status_row.h"
#include "status_row_icons.h"
#include "status_row_layout.h"
#include "layer_util.h"
#include "../appendix/persist.h"
#include "../appendix/theme.h"
#include "../appendix/config.h"
#include "../appendix/snooze.h"
#include "../services/watch_services.h"
#if defined(PBL_HEALTH)
#include "../services/health_summary.h"
#include "../services/health.h"
#endif
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define STATUS_ROW_MARGIN 2
#define SNOOZE_BOX_W 24
#define ICON_RATIO_NUM 5
#define ICON_RATIO_DEN 9
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
    bool sleeping;
    bool full_date;
    GDrawCommandImage *glyphs[STATUS_SLOT_COUNT];
    uint8_t glyph_icons[STATUS_SLOT_COUNT];
    int16_t glyph_h;
    GColor glyph_fg;
    uint16_t content_sig;
    bool uses_live_health;
};

// Main-app drawing and refresh callbacks are serialized, so all row instances can
// reuse these buffers without retaining expanded copies of their packed blobs.
static uint8_t s_blob_scratch[STATUS_LINE_MAX_BYTES];
static char s_text_scratch[STATUS_TEXT_MID_MAX + 1];

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

static GFont row_font(uint8_t tier) {
    switch (tier) {
        case TOP_VIEW_NONE:
            return fonts_get_system_font(NONE_ROW_FONT_KEY);
        case TOP_VIEW_COMPACT:
            return fonts_get_system_font(COMPACT_ROW_FONT_KEY);
        default:
            return fonts_get_system_font(STATUS_FULL_TIER_FONT_KEY);
    }
}

static void format_status_date(bool full_date, char *buf, size_t cap) {
    struct tm tm_now = watch_services_localtime();
    if (full_date) {
        char mon[8];
        strftime(mon, sizeof(mon), "%b", &tm_now);
        int mday = tm_now.tm_mday;
        if (mday < 1) { mday = 1; } else if (mday > 31) { mday = 31; }
        int year = tm_now.tm_year + 1900;
        if (year < 0) { year = 0; } else if (year > 9999) { year = 9999; }
        const char *loc = i18n_get_system_locale();
        if (loc && strncmp(loc, "en_US", 5) == 0) {
            snprintf(buf, cap, "%s %d. %d", mon, mday, year);
        } else {
            snprintf(buf, cap, "%d. %s %d", mday, mon, year);
        }
    } else {
        strftime(buf, cap, "%b %Y", &tm_now);
    }
}

static void format_live_value(const StatusRow *row, uint8_t kind, char *buf, size_t cap) {
    switch (kind) {
        case SLOT_LIVE_DATE:
            format_status_date(row->full_date, buf, cap);
            return;
#if defined(PBL_HEALTH)
        case SLOT_LIVE_STEPS: {
            int steps = health_summary_steps();
            if (steps < 0) { steps = 0; }
            if (steps > 999999) { steps = 999999; }
            snprintf(buf, cap, "%d", steps);
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
        case SLOT_LIVE_DISTANCE: {
            int m = health_summary_distance_m();
            if (m < 0) { snprintf(buf, cap, "--"); return; }
            bool imperial = health_distance_units() == MeasurementSystemImperial;
            int tenths;
            if (imperial && m > (999 * 1609) / 10) {
                tenths = 999;
            } else {
                tenths = imperial ? (m * 10) / 1609 : m / 100;
                if (tenths > 999) { tenths = 999; }
            }
            snprintf(buf, cap, "%d.%d%s", tenths / 10, tenths % 10,
                     imperial ? "mi" : "km");
            return;
        }
#endif
        default:
            snprintf(buf, cap, "--");
            return;
    }
}

static void resolve_slot_text(const StatusRow *row, const StatusSlotView *slot, char *buf, size_t cap) {
    if (cap == 0) { return; }
    if (slot->kind == SLOT_TEXT) {
        size_t n = slot->value_len;
        if (n > cap - 1) { n = cap - 1; }
        memcpy(buf, slot->value, n);
        buf[n] = '\0';
    } else if (slot->kind == SLOT_EMPTY) {
        buf[0] = '\0';
    } else {
        format_live_value(row, slot->kind, buf, cap);
    }
}

static uint16_t sig_fold(uint16_t sig, const uint8_t *data, size_t len) {
    for (size_t i = 0; i < len; i++) {
        sig = (uint16_t)((sig * 31) + data[i]);
    }
    return sig;
}

static int load_blob(uint8_t line_id) {
    int len = persist_get_status_line(line_id, s_blob_scratch, sizeof(s_blob_scratch));
    if (len <= 0 || !status_line_validate(s_blob_scratch, (size_t)len)) { return 0; }
    return len;
}

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

void status_row_set_sleeping(StatusRow *row, bool sleeping) {
    if (row) { row->sleeping = sleeping; }
}

void status_row_set_full_date(StatusRow *row, bool full_date) {
    if (row) { row->full_date = full_date; }
}

bool status_row_uses_live_health(const StatusRow *row) {
    return row && row->uses_live_health;
}

bool status_row_refresh(StatusRow *row) {
    if (!row) { return false; }
    uint16_t sig = 5381;
    bool has_drawn_sun = false;
    row->uses_live_health = false;
    int len = load_blob(row->line_id);
    if (len > 0) {
        for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
            StatusSlotView slot;
            if (!status_line_slot(s_blob_scratch, (size_t)len, i, &slot)) { break; }
            resolve_slot_text(row, &slot, s_text_scratch, sizeof(s_text_scratch));
            sig = sig_fold(sig, &slot.kind, 1);
            sig = sig_fold(sig, &slot.icon, 1);
            sig = sig_fold(sig, (const uint8_t *)s_text_scratch,
                           strlen(s_text_scratch));
            if (slot.kind != SLOT_EMPTY && slot.icon == STATUS_ICON_DRAWN_SUN) {
                has_drawn_sun = true;
            }
            if (slot.kind >= SLOT_LIVE_STEPS) { row->uses_live_health = true; }
        }
    }
    if (has_drawn_sun) {
        uint8_t sun_event_start_type = (uint8_t)persist_get_sun_event_start_type();
        sig = sig_fold(sig, &sun_event_start_type, 1);
    }
    uint8_t tail[2] = { row->tier, (uint8_t)row->sleeping };
    sig = sig_fold(sig, tail, 2);
    if (sig == row->content_sig) { return false; }
    row->content_sig = sig;
    return true;
}

static void ensure_glyphs(StatusRow *row, int len, GFont font) {
    int content_h = graphics_text_layout_get_content_size(
        "0", font, GRect(0, 0, 100, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).h;
    int16_t target_h = (int16_t)((content_h * ICON_RATIO_NUM) / ICON_RATIO_DEN);
    int16_t band_cap = (int16_t)(row->bounds.size.h - ICON_BAND_MARGIN);
    if (target_h > band_cap) { target_h = band_cap; }

    GColor fg = theme_fg();
    bool env_changed = target_h != row->glyph_h || !gcolor_equal(fg, row->glyph_fg);
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        StatusSlotView slot;
        uint8_t wanted = STATUS_ICON_NONE;
        if (len > 0 && status_line_slot(s_blob_scratch, (size_t)len, i, &slot)
                && slot.kind != SLOT_EMPTY
                && slot.icon != STATUS_ICON_NONE
                && slot.icon != STATUS_ICON_DRAWN_SUN) {
            wanted = slot.icon;
        }
        if (!env_changed && wanted == row->glyph_icons[i]) { continue; }
        status_row_icons_destroy(row->glyphs[i]);
        row->glyphs[i] = wanted != STATUS_ICON_NONE
            ? status_row_icons_load(wanted, target_h)
            : NULL;
        row->glyph_icons[i] = wanted;
    }
    row->glyph_h = target_h;
    row->glyph_fg = fg;
}

void status_row_draw(StatusRow *row, GContext *ctx) {
    if (!row || !ctx) { return; }
    int len = load_blob(row->line_id);
    if (len == 0) { return; }

    GFont font = row_font(row->tier);
    ensure_glyphs(row, len, font);

    int16_t content_w = (int16_t)(row->bounds.size.w - 2 * STATUS_ROW_MARGIN);
    if (content_w < 0) { content_w = 0; }
    StatusSlotMeasure measures[STATUS_SLOT_COUNT];
    StatusSlotView slots[STATUS_SLOT_COUNT];
    char texts[STATUS_SLOT_COUNT][STATUS_TEXT_MID_MAX + 1];

    bool weather_line = row->line_id == STATUS_LINE_FORECAST
                     || row->line_id == STATUS_LINE_RADAR;
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        if (!status_line_slot(s_blob_scratch, (size_t)len, i, &slots[i])) { return; }
        resolve_slot_text(row, &slots[i], texts[i], sizeof(texts[i]));
        if (row->sleeping && weather_line && i == 0) {
            measures[i].present = true;
            measures[i].icon_w = SNOOZE_BOX_W;
            measures[i].text_w = 0;
            continue;
        }
        int16_t icon_w = 0;
        if (row->glyphs[i]) {
            icon_w = gdraw_command_image_get_bounds_size(row->glyphs[i]).w;
        } else if (slots[i].icon == STATUS_ICON_DRAWN_SUN
                   && slots[i].kind != SLOT_EMPTY) {
            icon_w = ARROW_W;
        }
        int16_t text_w = 0;
        if (texts[i][0] != '\0' && content_w > 0 && row->bounds.size.h > 0) {
            text_w = graphics_text_layout_get_content_size(
                texts[i], font, GRect(0, 0, content_w, row->bounds.size.h),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).w;
        }
        measures[i].present = icon_w > 0 || text_w > 0;
        measures[i].icon_w = icon_w;
        measures[i].text_w = text_w;
    }

    StatusSlotPlace places[STATUS_SLOT_COUNT];
    status_row_layout(content_w, measures, places);

    int content_h = graphics_text_layout_get_content_size(
        "0", font, GRect(0, 0, 100, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).h;
    int text_y_rel = status_text_y(row->bounds.size.h, font);
    int text_y = row->bounds.origin.y + text_y_rel;
    int glyph_cy = row->bounds.origin.y
        + status_glyph_center_y(text_y_rel, content_h);
    int16_t x0 = (int16_t)(row->bounds.origin.x + STATUS_ROW_MARGIN);

    graphics_context_set_text_color(ctx, theme_fg());
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        if (!places[i].visible) { continue; }
        int16_t icon_x = (int16_t)(x0 + places[i].icon_x);
        if (row->sleeping && weather_line && i == 0) {
            snooze_draw(ctx,
                        GRect(icon_x, row->bounds.origin.y + 2,
                              SNOOZE_BOX_W, row->bounds.size.h - 4),
                        theme_fg());
        } else if (row->glyphs[i]) {
            GSize gs = gdraw_command_image_get_bounds_size(row->glyphs[i]);
            gdraw_command_image_draw(ctx, row->glyphs[i],
                GPoint(icon_x, glyph_cy - gs.h / 2));
        } else if (slots[i].icon == STATUS_ICON_DRAWN_SUN && measures[i].icon_w > 0) {
            bool arrow_up = persist_get_sun_event_start_type() == 0;
            int arrow_x = icon_x + ARROW_W / 2;
#ifdef PBL_PLATFORM_APLITE
            draw_sun_arrow(ctx, arrow_x, glyph_cy, arrow_up);
#else
            if (s_arrow_path) {
                gpath_rotate_to(s_arrow_path, arrow_up ? TRIG_MAX_ANGLE / 2 : 0);
                gpath_move_to(s_arrow_path, GPoint(arrow_x, glyph_cy));
                graphics_context_set_stroke_color(ctx, theme_fg());
                gpath_draw_outline_open(ctx, s_arrow_path);
                graphics_context_set_fill_color(ctx, theme_fg());
                gpath_draw_filled(ctx, s_arrow_path);
            }
#endif
        }
        if (places[i].text_visible) {
            graphics_draw_text(ctx, texts[i], font,
                GRect(x0 + places[i].text_x, text_y, places[i].text_w,
                      row->bounds.size.h - text_y_rel),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
        }
    }
}
