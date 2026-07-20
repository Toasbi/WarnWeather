// Lean aplite (Pebble Classic/Steel) twin of status_row.c.
//
// Frozen fork of status_row.c as of 5707b35. FEATURE-FROZEN, NOT CODE-FROZEN:
// preserve aplite's text/date/sun/battery behavior and hand-port bug
// fixes, but do not add the evolving PDC glyph, health, week, theme-polarity,
// or rain-alert pipeline. See docs/adr/0001-aplite-frozen-lean-fork.md.

#include "status_row.h"
#include "layer_util.h"
#include "../appendix/persist.h"
#include "../appendix/theme.h"
#include "../services/watch_services.h"
#include "../windows/layout.h"
#include "../appendix/status_row_alloc.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define STATUS_ROW_MARGIN 2
#define COMPACT_ROW_FONT_KEY FONT_KEY_GOTHIC_18
#define NONE_ROW_FONT_KEY FONT_KEY_GOTHIC_18
#define ARROW_H 8
#define ARROW_HEAD_H 3
#define ARROW_HEAD_W 2
#define ARROW_W 6
#define SLOT_GAP 2   /* px between a slot's icon and its text */

struct StatusRow {
    uint8_t line_id;
    uint8_t tier;
    GRect bounds;
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
    } else if (kind == SLOT_LIVE_BATTERY) {
        int level = watch_services_battery_state().charge_percent;
        if (level < 0) { level = 0; } else if (level > 100) { level = 100; }
        snprintf(buf, cap, "%d%%", level);
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
    }
    if (has_drawn_sun) {
        uint8_t sun_type = (uint8_t)persist_get_sun_event_start_type();
        sig = sig_fold(sig, &sun_type, 1);
    }
    sig = sig_fold(sig, &row->tier, 1);
    if (sig == row->content_sig) { return false; }
    row->content_sig = sig;
    return true;
}

// Weather-slot pictograms as bit-packed rows (bit x = column x). Monochrome,
// allocation-free; drawn by run-length below. Authored as ASCII in the design
// spec; keep these in sync with it.
static const uint16_t MASK_TEMP[]   = {0x01c,0x022,0x02a,0x02a,0x02a,0x02a,0x02a,0x02a,0x02a,0x05d,0x05d,0x022,0x01c};
static const uint16_t MASK_WIND[]   = {0x080,0x100,0x500,0x8fe,0x800,0x7ff,0x000,0x1fe,0x200,0x200,0x100};
static const uint16_t MASK_GUST[]   = {0x002,0x1fe,0x202,0x202,0x1fe,0x002,0x002,0x002,0x002,0x002,0x007};
static const uint16_t MASK_UV[]     = {0x040,0x842,0x404,0x0e0,0x110,0x1913,0x110,0x0e0,0x404,0x842,0x040};
static const uint16_t MASK_AQI[]    = {0x380,0xc40,0x1820,0x1810,0x1808,0xc04,0x622,0x192,0x0ca,0x03c,0x002,0x001};
static const uint16_t MASK_POLLEN[] = {0x020,0x124,0x0f8,0x326,0x1fc,0x326,0x0f8,0x124,0x020,0x010,0x008,0x004,0x002};

typedef struct { const uint16_t *rows; uint8_t n, w; } StatusMask;

// Returns the pictogram for a weather icon id, or NULL when the slot has none
// (Date/City text-only, DRAWN_SUN handled separately, health ids absent on aplite).
static const StatusMask *status_mask_for(uint8_t icon_id) {
    static const StatusMask temp   = { MASK_TEMP,   13,  7 };
    static const StatusMask wind   = { MASK_WIND,   11, 12 };
    static const StatusMask gust   = { MASK_GUST,   11, 11 };
    static const StatusMask uv     = { MASK_UV,     11, 13 };
    static const StatusMask aqi    = { MASK_AQI,    12, 13 };
    static const StatusMask pollen = { MASK_POLLEN, 13, 11 };
    switch (icon_id) {
        case STATUS_ICON_TEMP:   return &temp;
        case STATUS_ICON_WIND:   return &wind;
        case STATUS_ICON_GUST:   return &gust;
        case STATUS_ICON_UV:     return &uv;
        case STATUS_ICON_AQI:    return &aqi;
        case STATUS_ICON_POLLEN: return &pollen;
        default: return NULL;
    }
}

// Draw a mask with its occupied rows vertically centred on `cy`; each run of set
// pixels becomes one horizontal fill (no per-pixel calls, no allocation). The +1
// seats the glyph 1px lower: the tallest masks (n=12-13) otherwise clip against the
// tight top of the Gothic-14 forecast band, and even-height masks bias 1px high under
// the truncating `n/2`.
static void status_mask_draw(GContext *ctx, const StatusMask *m, int x0, int cy) {
    int y0 = cy - m->n / 2 + 1;
    for (int y = 0; y < m->n; y++) {
        uint16_t bits = m->rows[y];
        int x = 0;
        while (x < m->w) {
            if (bits & (1 << x)) {
                int run = 1;
                while (x + run < m->w && (bits & (1 << (x + run)))) { run++; }
                graphics_fill_rect(ctx, GRect(x0 + x, y0 + y, run, 1), 0, GCornerNone);
                x += run;
            } else {
                x++;
            }
        }
    }
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

    // Measure each slot as one contiguous group (icon + optional gap + text), then
    // allocate the three slot boxes with the lean allocator so an empty or short edge
    // yields its width to the middle instead of truncating it. Priority is right slot,
    // then left, then middle; a slot that cannot fit even an ellipsis is dropped rather
    // than drawn as an unreadable sliver.
    int ellipsis_w = graphics_text_layout_get_content_size(
        "\xE2\x80\xA6", font, GRect(0, 0, content_w, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).w;

    int16_t icon_w[STATUS_SLOT_COUNT];
    bool has_text[STATUS_SLOT_COUNT];
    int group_w[STATUS_SLOT_COUNT];
    int min_w[STATUS_SLOT_COUNT];
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        has_text[i] = texts[i][0] != '\0';
        const StatusMask *mask = (slots[i].kind != SLOT_EMPTY)
            ? status_mask_for(slots[i].icon) : NULL;
        icon_w[i] = (slots[i].icon == STATUS_ICON_DRAWN_SUN
                     && slots[i].kind != SLOT_EMPTY) ? ARROW_W
            : mask ? mask->w : 0;
        int tw = 0;
        if (has_text[i]) {
            tw = graphics_text_layout_get_content_size(
                texts[i], font, GRect(0, 0, content_w, 100),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).w;
        }
        int gap = (icon_w[i] && has_text[i]) ? SLOT_GAP : 0;
        group_w[i] = icon_w[i] + gap + tw;
        // Minimum renderable width: an icon-only slot needs its whole icon; a text slot
        // needs its icon + gap + at least an ellipsis; an empty slot needs nothing.
        min_w[i] = has_text[i] ? icon_w[i] + gap + ellipsis_w : icon_w[i];
    }

    int gx[STATUS_SLOT_COUNT], draw_w[STATUS_SLOT_COUNT];
    status_row_alloc(content_w, group_w, min_w, gx, draw_w);

    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        if (draw_w[i] == 0) { continue; }   // empty, or dropped for lack of space
        int16_t gxs = (int16_t)(x0 + gx[i]);
        if (slots[i].icon == STATUS_ICON_DRAWN_SUN && icon_w[i] > 0) {
            draw_sun_arrow(ctx, gxs + ARROW_W / 2, glyph_cy,
                           persist_get_sun_event_start_type() == 0);
        } else {
            const StatusMask *mask = (slots[i].kind != SLOT_EMPTY)
                ? status_mask_for(slots[i].icon) : NULL;
            if (mask) {
                graphics_context_set_fill_color(ctx, theme_fg());
                status_mask_draw(ctx, mask, gxs, glyph_cy);
            }
        }
        if (has_text[i]) {
            int16_t off = (int16_t)(icon_w[i] ? icon_w[i] + SLOT_GAP : 0);
            int16_t tw = (int16_t)(draw_w[i] - off);
            if (tw < 0) { tw = 0; }
            graphics_draw_text(ctx, texts[i], font,
                GRect(gxs + off, text_y, tw, row->bounds.size.h - text_y_rel),
                GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
        }
    }
}
