#include "calendar_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/persist.h"
#include "c/services/watch_services.h"
#include <time.h>

#define DAYS_PER_WEEK 7
#define FONT_OFFSET 5
#define EMERY_CALENDAR_TEXT_SHIFT_Y 5
#define EMERY_CALENDAR_TEXT_SHIFT_X 1

// emery: render calendar dates with larger fonts
#ifdef PBL_PLATFORM_EMERY
#define CALENDAR_FONT_KEY FONT_KEY_GOTHIC_24
#define CALENDAR_FONT_KEY_BOLD FONT_KEY_GOTHIC_24_BOLD
#else
#define CALENDAR_FONT_KEY FONT_KEY_GOTHIC_18
#define CALENDAR_FONT_KEY_BOLD FONT_KEY_GOTHIC_18_BOLD
#endif

static Layer *s_calendar_layer;

// Cached once per redraw from persist so per-cell holiday checks don't re-read
// storage. Populated at the top of calendar_update_proc.
static uint32_t s_holiday_mask = 0;
static int32_t s_holiday_anchor = 0;

static GRect calendar_cell_rect(GRect bounds, int i, int rows) {
    const int box_w = bounds.size.w / DAYS_PER_WEEK;
    const int box_h = bounds.size.h / rows;
    return GRect((i % DAYS_PER_WEEK) * bounds.size.w / DAYS_PER_WEEK,
                 (i / DAYS_PER_WEEK) * bounds.size.h / rows,
                 box_w, box_h);
}

#ifdef PBL_PLATFORM_EMERY
// Apply a tiny Emery-only horizontal tweak for two-digit dates that start with "1"
// to ensure they stay visually centered within calendar boxes.
static int emery_calendar_text_shift_x(const char *text) {
    if (text[1] != '\0' && text[0] == '1') {
        return EMERY_CALENDAR_TEXT_SHIFT_X;
    }

    return 0;
}
#endif

#ifdef PBL_PLATFORM_EMERY
static GRect calendar_text_rect(GRect cell_rect, const char *text, GFont font) {
    // emery: measure real glyph bounds and vertically center text in each date cell.
    const GRect measure_box = GRect(0, 0, cell_rect.size.w, cell_rect.size.h);
    const GSize text_size = graphics_text_layout_get_content_size(
        text, font, measure_box, GTextOverflowModeFill, GTextAlignmentCenter);
    const int text_top = cell_rect.origin.y + (cell_rect.size.h - text_size.h) / 2 - EMERY_CALENDAR_TEXT_SHIFT_Y;
    return GRect(cell_rect.origin.x - emery_calendar_text_shift_x(text), text_top, cell_rect.size.w, text_size.h);
}
#else
static GRect calendar_text_rect(GRect cell_rect, const char *text, GFont font) {
    (void)text;
    (void)font;
    return GRect(cell_rect.origin.x,
                 cell_rect.origin.y - FONT_OFFSET,
                 cell_rect.size.w,
                 cell_rect.size.h + FONT_OFFSET);
}
#endif

/* Copy struct tm out of localtime's static buffer — see localtime(3). */
static struct tm relative_tm(int days_from_today)
{
    /* Get a time structure for n days from today (only accurate to the day)
    Use this function to avoid edge cases from daylight savings time
    */
    struct tm base_time = watch_services_localtime();
    // Set arbitrary hour so there's no daylight savings rounding error:
    base_time.tm_hour = 5;
    time_t timestamp = mktime(&base_time) + days_from_today * SECONDS_PER_DAY;
    struct tm *result = localtime(&timestamp);
    struct tm out = *result;
    return out;
}

// Days-from-civil (Howard Hinnant) — must match src/pkjs/holidays/serial-day.js
// exactly so the watch and PKJS agree on the anchor's day numbering. Integer
// only (no floating point).
static int32_t days_from_civil(int year, int month, int day) {
    int y = year - (month <= 2 ? 1 : 0);
    int era = (y >= 0 ? y : y - 399) / 400;
    int yoe = y - era * 400;                                   // [0, 399]
    int doy = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1; // [0, 365]
    int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;           // [0, 146096]
    return (int32_t) (era * 146097 + doe - 719468);
}

// A cell is a holiday when its date falls inside the anchored mask window and
// the corresponding bit is set. PKJS owns the holiday rules and the enable
// (it sends mask 0 when highlighting is disabled).
static bool cell_is_holiday(struct tm *t) {
    int32_t serial = days_from_civil(t->tm_year + 1900, t->tm_mon + 1, t->tm_mday);
    int32_t bit = serial - s_holiday_anchor;
    return bit >= 0 && bit < 28 && ((s_holiday_mask >> bit) & 1u);
}

#ifdef PBL_COLOR
static GColor date_color(struct tm *t) {
    if (cell_is_holiday(t))
        return g_config->color_us_federal;
    if (t->tm_wday == 0)
        return g_config->color_sunday;
    if (t->tm_wday == 6)
        return g_config->color_saturday;
    return GColorWhite;
}
#endif

static GColor today_color() {
    // Either follow the date color or override to configured value
#ifdef PBL_COLOR
    struct tm t = relative_tm(0);
    return gcolor_equal(g_config->color_today, GColorBlack) ? date_color(&t) : g_config->color_today;
#else
    return GColorWhite;
#endif
}

static void calendar_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    int w = bounds.size.w;
    int h = bounds.size.h;
    const int rows = config_calendar_rows();
    const int box_w = w / DAYS_PER_WEEK;
    const int box_h = h / rows;
    s_holiday_mask = persist_get_holiday_mask();
    s_holiday_anchor = persist_get_holiday_anchor();

    // Calculate which box holds today's date
    const int i_today = config_n_today();

    graphics_context_set_fill_color(ctx, today_color());
    graphics_fill_rect(ctx,
        GRect((i_today % DAYS_PER_WEEK) * w / DAYS_PER_WEEK, (i_today / DAYS_PER_WEEK) * h / rows,
        box_w, box_h), 1, GCornersAll);

    for (int i = 0; i < rows * DAYS_PER_WEEK; ++i) {
        struct tm t = relative_tm(i - i_today);
        bool highlight_holiday = cell_is_holiday(&t);
        bool highlight_sunday = (config_highlight_sundays() && t.tm_wday == 0);
        bool highlight_saturday = (config_highlight_saturdays() && t.tm_wday == 6);
        bool bold = (i == i_today) || highlight_holiday || highlight_sunday || highlight_saturday;
        GColor text_color = (i == i_today) ? gcolor_legible_over(today_color())
                                           : PBL_IF_COLOR_ELSE(date_color(&t), GColorWhite);
        char buffer[4];
        GFont font = fonts_get_system_font(bold ? CALENDAR_FONT_KEY_BOLD : CALENDAR_FONT_KEY);
        GRect cell_rect = calendar_cell_rect(bounds, i, rows);

        graphics_context_set_text_color(ctx, text_color);
        graphics_draw_text(ctx,
            (snprintf(buffer, sizeof(buffer), "%d", t.tm_mday), buffer),
            font,
            calendar_text_rect(cell_rect, buffer, font), GTextOverflowModeFill, GTextAlignmentCenter, NULL);
    }
}

void calendar_layer_create(Layer* parent_layer, GRect frame) {
    s_calendar_layer = layer_create(frame);
    layer_set_update_proc(s_calendar_layer, calendar_update_proc);
    calendar_layer_refresh();
    layer_add_child(parent_layer, s_calendar_layer);
    MEMORY_LOG_HEAP("after_calendar_layer_create");
}


void calendar_layer_refresh() {
    // Request redraw (of today's highlight)
    layer_mark_dirty(s_calendar_layer);
}

void calendar_layer_destroy() {
    MEMORY_LOG_HEAP("calendar_layer_destroy:before");
    layer_destroy(s_calendar_layer);
    MEMORY_LOG_HEAP("calendar_layer_destroy:after");
}

Layer *calendar_layer_get_root(void) {
    return s_calendar_layer;
}
