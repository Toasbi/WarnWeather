#pragma once

#include <pebble.h>

enum TimeFont {
    TIME_FONT_ROBOTO = 0,
    TIME_FONT_LECO = 1,
    TIME_FONT_BITHAM = 2,
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
    bool health_enabled;
    int16_t rain_countdown_horizon_min;
    bool compact_top_view;
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
