#pragma once

#include <pebble.h>

enum TimeFont {
    TIME_FONT_ROBOTO = 0,
    TIME_FONT_LECO = 1,
    TIME_FONT_BITHAM = 2,
};

// Wire/flash vocabulary only (CLAY_TOP_VIEW_MODE + Config.top_view_mode) — no C
// reader. Layout code speaks LayoutTier (windows/layout.h), which shares these values.
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

// Legacy per-slot content enum, superseded by the packed ViewSpec wire byte (decoded
// by view_spec_unpack() in windows/layout.c). Retained only to give the RETIRED
// view_content[] field below meaningful-looking defaults. VC_OFF is only valid for
// the two flick slots (the default view always renders something).
enum ViewContent {
    VC_OFF = 0,              // flick slot disabled / skipped
    VC_FORECAST_FULL = 1,    // 3-row calendar + forecast
    VC_FORECAST_COMPACT = 2, // 2-row calendar + forecast
    VC_FORECAST_NONE = 3,    // no calendar + big forecast
    VC_RADAR = 4,            // big rain radar
    VC_HEALTH_STATUS = 5,    // forecast + health status line
    VC_HEALTH_GRAPH = 6,     // health graph + health status line
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
    uint8_t top_view_mode;   // enum TopViewMode; wire/flash compat only — no C reader.
                             // The active view's tier is pushed by main_window instead
                             // (tier push; see render_active_view).
    bool dual_status;        // RETIRED (superseded by per-slot ViewSpec status); kept for persist offset stability
    // --- flick cycle (v1.7): three composed views + auto-return timer (append-only) ---
    uint8_t view_content[3]; // RETIRED (superseded by view_spec); kept for persist offset stability
    uint8_t view_reset_min;  // minutes of no-flick before returning to the default view; 0 = Never
    // --- adaptive presets (v1.8): packed per-slot ViewSpec bytes (append-only) ---
    uint8_t view_spec[3];    // [default, flick1, flick2] — packed byte (see view_spec_unpack); 0 = disabled slot
    // --- theme (v1.8): dark=0 (default) / light=1 / bw=2 / bw-light=3 — append-only.
    // B&W hardware treats any value other than 1 or 3 as dark (see theme.h); a
    // stray 2 or 3 reaching a B&W watch from a phone previously paired with a
    // color watch is harmless (2 renders dark, 3 renders light).
    uint8_t theme;
    // --- top-strip battery (v1.8): show the battery only below 10%, taking over
    // the top-right slot. Append-only; optional wire tuple (older phones omit it,
    // leaving the memset-zeroed default false). ---
    bool battery_low_only;
} Config;

// Read-only view of the loaded config. Non-NULL from config_load() until
// config_unload() (NULL outside that window) — code on the unload path must not
// call it: watchface.c's deinit() unloads config BEFORE main_window_destroy().
// Only config.c writes the struct; everyone else reads through this pointer.
const Config *config_get(void);

void config_load();

void config_refresh();

void config_unload();

int config_localize_temp(int temp_f);

int config_format_time(char *s, size_t maxsize, const struct tm * tm_p);

int config_axis_hour(int hour);

// Index of the calendar box holding today's date, for a calendar of
// `calendar_rows` rows (3 = full, else compact). The prev-week offset applies
// only to the 3-row calendar — compact is always current-week-first (matches
// the phone's holiday-mask anchor).
int config_n_today(uint8_t calendar_rows);

GFont config_time_font();

bool config_highlight_sundays();

bool config_highlight_saturdays();
