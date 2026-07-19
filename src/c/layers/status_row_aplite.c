// Lean aplite (Pebble Classic/Steel) twin of status_row.c.
//
// Frozen fork of status_row.c as of 5707b35. FEATURE-FROZEN, NOT CODE-FROZEN:
// preserve aplite's text/date/sun/battery/snooze behavior and hand-port bug
// fixes, but do not add the evolving PDC glyph, health, week, theme-polarity,
// or rain-alert pipeline. See docs/adr/0001-aplite-frozen-lean-fork.md.

#include "status_row.h"
#include "battery_draw.h"
#include "layer_util.h"
#include "../appendix/persist.h"
#include "../appendix/snooze.h"
#include "../appendix/theme.h"
#include "../services/watch_services.h"
#include "../windows/layout.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define STATUS_ROW_MARGIN 2
#define SNOOZE_BOX_W 24
#define COMPACT_ROW_FONT_KEY FONT_KEY_GOTHIC_18
#define NONE_ROW_FONT_KEY FONT_KEY_GOTHIC_18
#define ARROW_H 8
#define ARROW_HEAD_H 3
#define ARROW_HEAD_W 2
#define ARROW_W 6
#define SLOT_GAP 3

struct StatusRow {
    uint8_t line_id;
    uint8_t tier;
    GRect bounds;
    bool sleeping;
    bool full_date;
    bool battery_override;
    uint16_t content_sig;
};

// Main-app drawing and refresh callbacks are serialized, so every row instance
// can share the packed-blob and signature text scratch.
static uint8_t s_blob_scratch[STATUS_LINE_MAX_BYTES];
static char s_text_scratch[STATUS_TEXT_MID_MAX + 1];

static GFont row_font(uint8_t tier, uint8_t line_id) {
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

static void format_status_date(bool full_date, char *buf, size_t cap) {
    struct tm tm_now = watch_services_localtime();
    if (!full_date) {
        strftime(buf, cap, "%b %Y", &tm_now);
        return;
    }

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
}

static void format_live_value(const StatusRow *row, uint8_t kind,
                              char *buf, size_t cap) {
    if (kind == SLOT_LIVE_DATE) {
        format_status_date(row->full_date, buf, cap);
    } else {
        snprintf(buf, cap, "--");
    }
}

static void apply_battery_override(const StatusRow *row, int slot_index,
                                   StatusSlotView *slot) {
    if (row->battery_override && slot_index == STATUS_SLOT_COUNT - 1) {
        slot->kind = SLOT_LIVE_BATTERY;
        slot->icon = STATUS_ICON_NONE;
        slot->value_len = 0;
        slot->value = NULL;
    }
}

static void resolve_slot_text(const StatusRow *row, const StatusSlotView *slot,
                              char *buf, size_t cap) {
    if (cap == 0) { return; }
    if (slot->kind == SLOT_TEXT) {
        size_t n = slot->value_len;
        if (n > cap - 1) { n = cap - 1; }
        memcpy(buf, slot->value, n);
        buf[n] = '\0';
    } else if (slot->kind == SLOT_EMPTY || slot->kind == SLOT_LIVE_BATTERY) {
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
    int len = persist_get_status_line(line_id, s_blob_scratch,
                                      sizeof(s_blob_scratch));
    if (len <= 0 || !status_line_validate(s_blob_scratch, (size_t)len)) {
        return 0;
    }
    return len;
}

// Primitive lines avoid the transient allocation used by a transformed path.
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

StatusRow *status_row_create(uint8_t line_id) {
    StatusRow *row = malloc(sizeof(StatusRow));
    if (!row) { return NULL; }
    memset(row, 0, sizeof(StatusRow));
    row->line_id = line_id;
    return row;
}

void status_row_destroy(StatusRow *row) {
    free(row);
}

void status_row_apply(StatusRow *row, GRect bounds, uint8_t tier,
                      uint8_t line_id) {
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

void status_row_set_battery_override(StatusRow *row, bool active) {
    if (row && row->battery_override != active) {
        row->battery_override = active;
        row->content_sig = 0;
    }
}

void status_row_set_suppress_edges(StatusRow *row, bool suppress) {
    (void)row;
    (void)suppress;
}

int16_t status_row_right_slot_width(StatusRow *row) {
    (void)row;
    return 0;
}

bool status_row_uses_live_health(const StatusRow *row) {
    (void)row;
    return false;
}

bool status_row_refresh(StatusRow *row) {
    if (!row) { return false; }
    uint16_t sig = 5381;
    bool has_drawn_sun = false;
    int len = load_blob(row->line_id);
    for (int i = 0; i < STATUS_SLOT_COUNT && len > 0; i++) {
        StatusSlotView slot;
        if (!status_line_slot(s_blob_scratch, (size_t)len, i, &slot)) { break; }
        apply_battery_override(row, i, &slot);
        resolve_slot_text(row, &slot, s_text_scratch, sizeof(s_text_scratch));
        sig = sig_fold(sig, &slot.kind, 1);
        sig = sig_fold(sig, &slot.icon, 1);
        sig = sig_fold(sig, (const uint8_t *)s_text_scratch,
                       strlen(s_text_scratch));
        if (slot.kind != SLOT_EMPTY && slot.icon == STATUS_ICON_DRAWN_SUN) {
            has_drawn_sun = true;
        }
        if (slot.kind == SLOT_LIVE_BATTERY) {
            BatteryChargeState bs = watch_services_battery_state();
            uint8_t battery[2] = {
                (uint8_t)bs.charge_percent,
                (uint8_t)(bs.is_charging || bs.is_plugged)
            };
            sig = sig_fold(sig, battery, sizeof(battery));
        }
    }
    if (has_drawn_sun) {
        uint8_t sun_type = (uint8_t)persist_get_sun_event_start_type();
        sig = sig_fold(sig, &sun_type, 1);
    }
    uint8_t tail[2] = { row->tier, (uint8_t)row->sleeping };
    sig = sig_fold(sig, tail, sizeof(tail));
    if (sig == row->content_sig) { return false; }
    row->content_sig = sig;
    return true;
}

void status_row_draw(StatusRow *row, GContext *ctx) {
    if (!row || !ctx) { return; }
    int len = load_blob(row->line_id);
    if (len == 0) { return; }

    GFont font = row_font(row->tier, row->line_id);
    int content_h = graphics_text_layout_get_content_size(
        "0", font, GRect(0, 0, 100, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).h;
    int16_t content_w = (int16_t)(row->bounds.size.w - 2 * STATUS_ROW_MARGIN);
    if (content_w < 0) { content_w = 0; }

    StatusSlotView slots[STATUS_SLOT_COUNT];
    char texts[STATUS_SLOT_COUNT][STATUS_TEXT_MID_MAX + 1];
    bool weather_line = row->line_id == STATUS_LINE_FORECAST
                     || row->line_id == STATUS_LINE_RADAR;

    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        if (!status_line_slot(s_blob_scratch, (size_t)len, i, &slots[i])) {
            return;
        }
        apply_battery_override(row, i, &slots[i]);
        resolve_slot_text(row, &slots[i], texts[i], sizeof(texts[i]));
    }

    int text_y_rel = status_text_y(row->bounds.size.h, font);
    int text_y = row->bounds.origin.y + text_y_rel;
    int glyph_cy = row->bounds.origin.y
        + status_glyph_center_y(text_y_rel, content_h);
    int16_t x0 = (int16_t)(row->bounds.origin.x + STATUS_ROW_MARGIN);

    graphics_context_set_text_color(ctx, theme_fg());
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        // Aplite keeps the pre-configurable-row layout style: three dynamic
        // bands, with Pebble's text renderer handling ellipsis inside each band.
        int16_t cell_x = (int16_t)((content_w * i) / STATUS_SLOT_COUNT);
        int16_t cell_right = (int16_t)((content_w * (i + 1)) / STATUS_SLOT_COUNT);
        bool snoozing = row->sleeping && weather_line && i == 0;
        bool has_text = texts[i][0] != '\0' && !snoozing;
        int16_t icon_w = snoozing ? SNOOZE_BOX_W
            : slots[i].kind == SLOT_LIVE_BATTERY ? BATTERY_GLYPH_W
            : (slots[i].icon == STATUS_ICON_DRAWN_SUN
               && slots[i].kind != SLOT_EMPTY) ? ARROW_W : 0;
        if (!has_text && icon_w == 0) { continue; }

        int16_t icon_x = cell_x;
        if (!has_text && i == 1) {
            icon_x = (int16_t)((cell_x + cell_right - icon_w) / 2);
        } else if (!has_text && i == 2) {
            icon_x = (int16_t)(cell_right - icon_w);
        }
        icon_x = (int16_t)(x0 + icon_x);
        if (slots[i].kind == SLOT_LIVE_BATTERY) {
            battery_draw(ctx, GRect(icon_x, glyph_cy - BATTERY_GLYPH_H / 2,
                                    BATTERY_GLYPH_W, BATTERY_GLYPH_H),
                         theme_fg());
        } else if (row->sleeping && weather_line && i == 0) {
            snooze_draw(ctx,
                        GRect(icon_x, row->bounds.origin.y + 2,
                              SNOOZE_BOX_W, row->bounds.size.h - 4),
                        theme_fg());
        } else if (slots[i].icon == STATUS_ICON_DRAWN_SUN
                   && icon_w > 0) {
            bool arrow_up = persist_get_sun_event_start_type() == 0;
            draw_sun_arrow(ctx, icon_x + ARROW_W / 2, glyph_cy, arrow_up);
        }
        if (has_text) {
            int16_t text_x = (int16_t)(cell_x + (icon_w ? icon_w + SLOT_GAP : 0));
            int16_t text_w = (int16_t)(cell_right - text_x);
            GTextAlignment align = i == 0 ? GTextAlignmentLeft
                : i == 1 ? GTextAlignmentCenter : GTextAlignmentRight;
            graphics_draw_text(ctx, texts[i], font,
                GRect(x0 + text_x, text_y, text_w,
                      row->bounds.size.h - text_y_rel),
                GTextOverflowModeTrailingEllipsis, align, NULL);
        }
    }
}
