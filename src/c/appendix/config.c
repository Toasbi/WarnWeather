#include "config.h"
#include "persist.h"
#include "math.h"
#include "memory_log.h"
#include "c/services/watch_services.h"

Config *g_config;

// Returns defaults as a function (not a static const) because GColor values like
// GColorBlack expand to "compound literals" — C's syntax for inline struct values.
// The C standard doesn't allow these in static variable initializers, so we use a
// function instead. See: https://gcc.gnu.org/onlinedocs/gcc/Compound-Literals.html
static Config config_defaults(void) {
    return (Config) {
        .celsius = false,
        .time_lead_zero = false,
        .axis_12h = false,
        .start_mon = false,
        .prev_week = true,
        .show_qt = true,
        .show_bt = true,
        .show_bt_disconnect = true,
        .vibe = false,
        .show_am_pm = false,
        .time_font = TIME_FONT_ROBOTO,
        .color_today = GColorBlack,
        .color_saturday = GColorFolly,
        .color_sunday = GColorFolly,
        .color_us_federal = GColorFolly,
        .color_time = GColorWhite,
        .day_night_shading = true,
        .health_enabled = true,
        .rain_countdown_horizon_min = 60
    };
}

static void config_read_or_default(Config *config) {
    *config = config_defaults();
    persist_get_config(config);
}

void config_load() {
    g_config = (Config*) malloc(sizeof(Config));
    config_read_or_default(g_config);
    MEMORY_LOG_HEAP("after_config_load");
}

void config_refresh() {
    free(g_config);  // Clear out the old config
    g_config = (Config*) malloc(sizeof(Config));
    config_read_or_default(g_config);  // Then reload
    MEMORY_LOG_HEAP("after_config_refresh");
}

void config_unload() {
    free(g_config);
}

int config_localize_temp(int temp_f) {
    // Convert temperatures as desired
    int result;
    if (g_config->celsius)
        result = f_to_c(temp_f);
    else
        result = temp_f;
    return result;
}

int config_format_time(char *s, size_t maxsize, const struct tm * tm_p) {
    int res = strftime(s, maxsize, watch_services_clock_is_24h_style() ? "%H:%M" : "%I:%M", tm_p);
    if (!g_config->time_lead_zero) {
        // Remove leading zero if configured as such
        if (s[0] == '0')
            memmove(s, s+1, strlen(s));
    }
    return res;
}

int config_axis_hour(int hour) {
    if (g_config->axis_12h) {
        hour = hour % 12;
        hour = hour == 0 ? 12 : hour;
    }
    else
        hour = hour % 24;
    return hour;
}

int config_n_today() {
    // Returns the index of the calendar box that holds today's date

    struct tm tm_today = watch_services_localtime();
    int wday = tm_today.tm_wday;
    // Offset if user wants to start the week on monday
    wday = g_config->start_mon ? (wday + 6) % 7 : wday;
    // Offset if user wants to show the previous week first
    if (g_config->prev_week)
        wday += 7;
    return wday;
}

#ifdef PBL_PLATFORM_EMERY
// emery: no stock Roboto/Bitham font is larger than 49/42, so on Emery's larger screen
// these options render via enlarged custom font resources (LECO uses stock LECO_60). The
// selected custom font is lazy-loaded and cached; the previously cached font is unloaded
// when the selection changes, so only one custom font is ever resident.
static GFont s_custom_time_font = NULL;
static int s_custom_time_font_for = -1;  // TimeFont currently cached, or -1 for none

static void config_unload_custom_time_font(void) {
    if (s_custom_time_font) {
        fonts_unload_custom_font(s_custom_time_font);
        s_custom_time_font = NULL;
        s_custom_time_font_for = -1;
    }
}

// Returns the enlarged custom font for ROBOTO/BITHAM, or NULL for LECO (caller falls back
// to the stock system font). Loads lazily and caches the handle across calls.
static GFont config_emery_custom_time_font(int16_t font_index) {
    uint32_t res_id = 0;
    if (font_index == TIME_FONT_ROBOTO)
        res_id = RESOURCE_ID_FONT_ROBOTO_BOLD_62;
    else if (font_index == TIME_FONT_BITHAM)
        res_id = RESOURCE_ID_FONT_MONTSERRAT_MEDIUM_62;
    if (res_id == 0) {                 // LECO: no custom font
        config_unload_custom_time_font();
        return NULL;
    }
    if (s_custom_time_font_for != font_index) {
        config_unload_custom_time_font();
        s_custom_time_font = fonts_load_custom_font(resource_get_handle(res_id));
        s_custom_time_font_for = font_index;
    }
    return s_custom_time_font;
}
#endif

GFont config_time_font() {
    int16_t font_index = g_config->time_font;
    if (font_index < 0 || font_index > TIME_FONT_BITHAM)
        font_index = TIME_FONT_ROBOTO;

#ifdef PBL_PLATFORM_EMERY
    GFont custom = config_emery_custom_time_font(font_index);
    if (custom)
        return custom;
#endif

    const char *font_keys[] = {
        [TIME_FONT_ROBOTO] = FONT_KEY_ROBOTO_BOLD_SUBSET_49,
#ifdef PBL_PLATFORM_EMERY
        // emery: use larger LECO font size
        [TIME_FONT_LECO] = FONT_KEY_LECO_60_NUMBERS_AM_PM,
#else
        [TIME_FONT_LECO] = FONT_KEY_LECO_42_NUMBERS,
#endif
        [TIME_FONT_BITHAM] = FONT_KEY_BITHAM_42_MEDIUM_NUMBERS
    };
    return fonts_get_system_font(font_keys[font_index]);
}

bool config_highlight_sundays() {
    return !gcolor_equal(g_config->color_sunday, GColorWhite);
}

bool config_highlight_saturdays() {
    return !gcolor_equal(g_config->color_saturday, GColorWhite);
}
