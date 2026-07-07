#include "time_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/theme.h"
#include "c/layers/layer_util.h"
#include "c/services/watch_services.h"

// MT = Margin Top
#define MT_TIME 14
#define MT_AM_PM 7
#define MT_TIME_LECO 2
#define MT_AM_PM_LECO 2
// emery: per-font vertical nudge (px, positive = up) for the enlarged custom
// Roboto/Montserrat fonts. The centering math centers each font's *content box*, but
// text_layer_get_content_size() under-reports these TTF fonts' line box and the digit ink
// sits high within it, so the unaided result lands bottom-heavy. These constants are
// measured on the emulator to give equal top/bottom padding around the digit ink.
#define MT_TIME_ROBOTO 2
#define MT_TIME_BITHAM 2


static Layer *s_container_layer;
static TextLayer *s_time_layer;
static TextLayer *s_am_pm_layer;

void time_layer_create(Layer* parent_layer, GRect frame) {
    s_container_layer = layer_create(frame);
    s_time_layer = text_layer_create(GRect(0, 0, frame.size.w, frame.size.h));
    s_am_pm_layer = text_layer_create(GRect(0, 0, 30, frame.size.h));

    // Main time formatting
    text_layer_set_background_color(s_time_layer, GColorClear);
    text_layer_set_text(s_time_layer, "00:00");
    text_layer_set_text_alignment(s_time_layer, GTextAlignmentLeft);

    // AM/PM formatting
    text_layer_set_font(s_am_pm_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
    text_layer_set_background_color(s_am_pm_layer, GColorClear);
    text_layer_set_text_color(s_am_pm_layer, theme_fg());
    text_layer_set_text(s_am_pm_layer, "PM");
    text_layer_set_text_alignment(s_am_pm_layer, GTextAlignmentLeft);

    layer_add_child(s_container_layer, text_layer_get_layer(s_time_layer));
    layer_add_child(text_layer_get_layer(s_time_layer), text_layer_get_layer(s_am_pm_layer));
    layer_add_child(parent_layer, s_container_layer);
    MEMORY_LOG_HEAP("after_time_layer_create");

}

Layer *time_layer_get_root(void) {
    return s_container_layer;
}

// 12:30 -> 12:30
// 13:30 -> 1:30
// 00:30 -> 12:30

void time_layer_tick() {
    struct tm tick_time = watch_services_localtime();

    static char s_buffer[8];
    config_format_time(s_buffer, sizeof(s_buffer), &tick_time);

    text_layer_set_text(s_time_layer, s_buffer);
    if (g_config->show_am_pm)
        text_layer_set_text(s_am_pm_layer, tick_time.tm_hour < 12 ? "AM" : "PM");
    
    GRect bounds = layer_get_bounds(s_container_layer);
    text_layer_move_frame(s_time_layer, GRect(0, 0, bounds.size.w, bounds.size.h)); // Reset for size calculation
    GSize time_size = text_layer_get_content_size(s_time_layer);
    GSize am_pm_size = text_layer_get_content_size(s_am_pm_layer);

    int content_w = time_size.w + (g_config->show_am_pm ? am_pm_size.w : 0);
    int text_h = time_size.h - MT_TIME; // Remove top margin, approximately
    int text_top = -MT_TIME + (bounds.size.h/2 - text_h/2);
    int text_left = bounds.size.w / 2 - content_w / 2;

    // emery: nudge custom/LECO time text vertically to keep optical centering, since each
    // font's metrics differ from the stock-49 MT_TIME calibration.
#ifdef PBL_PLATFORM_EMERY
    if (g_config->time_font == TIME_FONT_LECO) {
        text_top -= MT_TIME_LECO;
    } else if (g_config->time_font == TIME_FONT_ROBOTO) {
        text_top -= MT_TIME_ROBOTO;
    } else if (g_config->time_font == TIME_FONT_BITHAM) {
        text_top -= MT_TIME_BITHAM;
    }
#endif

    // Update layer positions and visibility. Height spans from text_top down to the
    // container bottom rather than time_size.h: text_layer_get_content_size() under-reports
    // the line box of the enlarged custom TTF fonts (e.g. ~58px for the size-58 Montserrat
    // whose real ascent+descent is ~68px), so a content-sized frame clips the bottom few px
    // of round digits. These are descenderless numeric fonts and the container clips us, so
    // extending the frame downward only reclaims the clipped glyph bottoms.
    text_layer_move_frame(s_time_layer, GRect(text_left, text_top, content_w, bounds.size.h - text_top));
    if (g_config->show_am_pm) {
        int am_pm_y = MT_TIME - MT_AM_PM;
        // emery: nudge LECO AM/PM down slightly to align with larger time numerals.
#ifdef PBL_PLATFORM_EMERY
        if (g_config->time_font == TIME_FONT_LECO) {
            am_pm_y += MT_AM_PM_LECO;
        }
#endif
        text_layer_move_frame(s_am_pm_layer, GRect(time_size.w, am_pm_y, 30, time_size.h));
    }
    layer_set_hidden(text_layer_get_layer(s_am_pm_layer), !g_config->show_am_pm);
}

void time_layer_refresh() {
    text_layer_set_font(s_time_layer, config_time_font());
    text_layer_set_text_color(s_time_layer, PBL_IF_COLOR_ELSE(g_config->color_time, theme_fg()));
    time_layer_tick();  // Update main time text and layer positions
}

void time_layer_destroy() {
    MEMORY_LOG_HEAP("time_layer_destroy:before");
    text_layer_destroy(s_am_pm_layer);
    text_layer_destroy(s_time_layer);
    layer_destroy(s_container_layer);
    MEMORY_LOG_HEAP("time_layer_destroy:after");
}
