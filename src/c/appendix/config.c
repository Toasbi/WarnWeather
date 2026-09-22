#include "config.h"
#include "date_format.h"
#include "persist.h"
#include "math.h"
#include "memory_log.h"
#include "theme.h"
#include "c/services/watch_services.h"

static Config *s_config;

const Config *config_get(void) {
    return s_config;
}

// Returns defaults as a function (not a static const) because GColor values like
// GColorBlack expand to "compound literals" — C's syntax for inline struct values.
// The C standard doesn't allow these in static variable initializers, so we use a
// function instead. See: https://gcc.gnu.org/onlinedocs/gcc/Compound-Literals.html
static Config config_defaults(void) {
    return (Config) {
        .celsius = false,
        .time_lead_zero = false,
        .axis_12h = false,
        .start_mon = true,
        .prev_week = true,
        .show_qt = true,
        .show_bt = false,
        .show_bt_disconnect = true,
        .vibe = false,
        .show_am_pm = false,
        .time_font = TIME_FONT_ROBOTO,
        .color_today = GColorBlack,
        .color_saturday = GColorFolly,
        .color_sunday = GColorFolly,
        .color_us_federal = GColorBlueMoon,
        .color_time = GColorWhite,
        .day_night_shading = true,
        .health_mode = HEALTH_OFF,
        .rain_countdown_horizon_min = 60,
        .top_view_mode = TOP_VIEW_COMPACT,
        .dual_status = false,
        // Retired; superseded by view_spec. Left initialised for determinism.
        .view_content = { VC_FORECAST_COMPACT, VC_RADAR, VC_OFF },
        .view_reset_min = 0,
        // Retired view_spec seed, left for determinism (no C reader).
        .view_spec = { 0x90, 0x00, 0x00 },
        // Default view cycle: compactCal + forecast in the upper status band, flick slots
        // disabled. 0x244 = pack(compact, cal, forecast-body, forecast-upper, none) =
        // (2<<8)|(1<<6)|(0<<4)|(1<<2)|0. The phone re-sends the real cycle on connect; this
        // only covers the first boot / a phone that predates the view keys.
        .view_spec2 = { 0x244, 0x000, 0x000 },
        .theme = 0,   // dark — today's look, unchanged until the user picks otherwise
        .battery_low_only = true,
        .date_month_first = false,  // day-first (dd.mm.yy); phone overrides per holiday country
#if defined(PBL_PLATFORM_EMERY)
        // emery: on out of the box, matching the phone's schema default -- this covers
        // only the window before the first Clay message (a fresh install, or a phone
        // that predates the key), and starting it false would flip the axis labels
        // small -> large a moment after boot. Guarded because the field itself is
        // (see config.h).
        .large_graph_font = true,
#endif
#if !defined(PBL_PLATFORM_APLITE)
        // Auto — today's formats ("%b %Y" / dd.mm.yy per date_month_first) until
        // the user picks otherwise on the Date slot's edit sheet.
        .date_month_format = DATE_MONTH_AUTO,
        .date_full_format = DATE_FULL_AUTO,
#endif
    };
}

static void config_read_or_default(Config *config) {
    *config = config_defaults();
    persist_get_config(config);
}

void config_load() {
    s_config = (Config*) malloc(sizeof(Config));
    config_read_or_default(s_config);
    MEMORY_LOG_HEAP("after_config_load");
}

void config_refresh() {
    // Reload in place — same-size struct, so a free/malloc round-trip would only
    // churn the allocator.
    config_read_or_default(s_config);
    MEMORY_LOG_HEAP("after_config_refresh");
}

void config_unload() {
    free(s_config);
    s_config = NULL;   // config_get() must never hand out a dangling pointer
}

int config_localize_temp(int temp_f) {
    return s_config->celsius ? f_to_c(temp_f) : temp_f;
}

int config_format_time(char *s, size_t maxsize, const struct tm * tm_p) {
    int res = strftime(s, maxsize, watch_services_clock_is_24h_style() ? "%H:%M" : "%I:%M", tm_p);
    if (!s_config->time_lead_zero) {
        // Remove leading zero if configured as such
        if (s[0] == '0')
            memmove(s, s+1, strlen(s));
    }
    return res;
}

int config_axis_hour(int hour) {
    if (s_config->axis_12h) {
        hour = hour % 12;
        hour = hour == 0 ? 12 : hour;
    }
    else
        hour = hour % 24;
    return hour;
}

int config_n_today(uint8_t calendar_rows) {
    // Returns the index of the calendar box that holds today's date

    struct tm tm_today = watch_services_localtime();
    int wday = tm_today.tm_wday;
    // Offset if user wants to start the week on monday
    wday = s_config->start_mon ? (wday + 6) % 7 : wday;
    // Offset if user wants to show the previous week first — only the 3-row
    // (full) calendar renders the previous week; compact is always
    // current-week-first (matches the phone's holiday-mask anchor).
    if (s_config->prev_week && calendar_rows == 3)
        wday += 7;
    return wday;
}

// On the colour platforms only LECO is drawn with this font: Roboto and Bitham draw their
// anti-aliased digits from layers/clock_glyphs.c instead (time_layer.c hides the text layer
// then), which is also what gives emery its larger Roboto and Bitham — no stock face goes past
// 49/42.
GFont config_time_font() {
    int16_t font_index = s_config->time_font;
    if (font_index < 0 || font_index > TIME_FONT_BITHAM)
        font_index = TIME_FONT_ROBOTO;

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
    return !gcolor_equal(s_config->color_sunday, theme_fg());
}

bool config_highlight_saturdays() {
    return !gcolor_equal(s_config->color_saturday, theme_fg());
}
