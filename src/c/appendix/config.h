#pragma once

#include <pebble.h>

enum TimeFont {
    TIME_FONT_ROBOTO = 0,
    TIME_FONT_LECO = 1,
    TIME_FONT_BITHAM = 2,
};

enum TopViewMode {
    TOP_VIEW_FULL = 0,     // classic 3-row calendar
    TOP_VIEW_COMPACT = 1,  // 2-row calendar + larger status (default)
    TOP_VIEW_NONE = 2,     // no calendar; big time / status / forecast
};

enum HealthMode {
    HEALTH_OFF = 0,     // health view off (default)
    HEALTH_STATUS = 1,  // flick swaps only the bottom status line to health
    HEALTH_ALL = 2,     // flick also swaps the forecast graph to the health graph (beta)
};

typedef struct {
    bool celsius;
    bool time_lead_zero;
    bool axis_12h;
    bool start_mon;
    bool prev_week;
    bool show_qt;
    bool show_bt;
    bool show_bt_disconnect;
    bool vibe;
    bool show_am_pm;
    int16_t time_font;
    GColor color_today;
    GColor color_saturday;
    GColor color_sunday;
    GColor color_us_federal;
    GColor color_time;
    bool day_night_shading;
    int16_t fetch_interval_min;
    uint8_t health_mode;   // enum HealthMode; reinterprets the old bool health_enabled byte (0=off,1=status)
    int16_t rain_countdown_horizon_min;
    uint8_t top_view_mode;   // enum TopViewMode; reuses the old compact_top_view byte
    bool dual_status;        // Status mode only: show health + weather status together (append-only — keep last)
} Config;

extern Config *g_config;

void config_load();

void config_refresh();

void config_unload();

int config_localize_temp(int temp_f);

int config_format_time(char *s, size_t maxsize, const struct tm * tm_p);

int config_axis_hour(int hour);

int config_n_today();

int config_calendar_rows(void);

GFont config_time_font();

bool config_highlight_sundays();

bool config_highlight_saturdays();
