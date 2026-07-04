#include "layout.h"

#define FORECAST_HEIGHT 51
#define WEATHER_STATUS_HEIGHT 14
#define TIME_HEIGHT 45
#define CALENDAR_HEIGHT 45
// Compact + single-status (dual off): the lone status band sits directly above the
// clock, so nudge it down a couple px to close the gap and sit it snug under the
// clock. Dual status keeps the health band where it is (weather rides a separate
// lower band), and full/none aren't affected — see the guarded use in compute_layout.
#define COMPACT_SINGLE_STATUS_NUDGE 3
#define EMERY_WINDOW_PAD_X 2
#define EMERY_WINDOW_PAD_TOP 2
#define EMERY_WINDOW_PAD_BOTTOM 4
// emery: increase top calendar status row height to fit larger month and icon alignment.
#ifdef PBL_PLATFORM_EMERY
#define CALENDAR_STATUS_HEIGHT 20
// none: status band sized for the one-notch-larger Gothic-28 line (tune visually).
#define NONE_STATUS_HEIGHT 30
// none: drop the clock a few px so its gap to the date strip above matches its gap to the status
// line below. The status text seats low in its tall band, so a clock centred flush under the strip
// reads high; this rebalances it. Tune visually (grows with the taller emery status band/fonts).
#define NONE_TIME_DROP 3
#else
#define CALENDAR_STATUS_HEIGHT 13
// none: status band sized for the one-notch-larger Gothic-24 line (tune visually).
#define NONE_STATUS_HEIGHT 22
// none: drop the clock a couple px so its gap to the date strip above matches its gap to the status
// line below. The status text seats low in its tall band, so a clock centred flush under the strip
// reads high; this rebalances it. Tune visually.
#define NONE_TIME_DROP 2
#endif

#ifdef PBL_PLATFORM_EMERY
// emery: scale the main content bands proportionally to fill the taller screen
// while preserving the legacy calendar/time/forecast balance.
static void compute_content_layout(int content_h, int *calendar_h, int *time_h, int *forecast_h) {
    const int weight_sum = CALENDAR_HEIGHT + TIME_HEIGHT + FORECAST_HEIGHT;

    *calendar_h = (content_h * CALENDAR_HEIGHT) / weight_sum;
    *time_h = (content_h * TIME_HEIGHT) / weight_sum;
    *forecast_h = content_h - *calendar_h - *time_h;
}
#endif

// Single source of truth for the vertical band geometry, for both the window
// load path and main_window_relayout(). Compact top view shrinks the calendar to
// 2 rows, moves the status band into the freed 3rd-row slot (larger font handled
// in the status layers), grows the bottom band up to the fixed time band, and the
// radar (which shares the calendar frame) shrinks with it. The top-status band is
// identical in every mode. None drops the calendar entirely (zero-height top band),
// moves the time band up under the strip, and rides the radar on the bottom band
// instead — see the mode-specific branches below.
MainLayout layout_compute(GRect bounds, uint8_t mode, bool dual, int fc_band_h) {
    bool compact = (mode != LAYOUT_TIER_FULL);
    int w = bounds.size.w;
    int h = bounds.size.h;
    MainLayout L;
    // Height of the status band that abuts the forecast (full mode both rows; dual-status compact
    // the weather row), derived from the full-tier row font so the line clears the graph by a
    // constant margin on every platform — see status_forecast_band_h() / the uses below.
#ifdef PBL_PLATFORM_EMERY
    // emery: bands are proportional; keep calendar_y/time_y/time_h fixed and
    // repartition the calendar band (2/3 dates + 1/3 status) while the forecast
    // absorbs the weather-status gap between time and forecast.
    int content_x = EMERY_WINDOW_PAD_X;
    int content_y = EMERY_WINDOW_PAD_TOP;
    int content_w = w - EMERY_WINDOW_PAD_X * 2;
    int forecast_w = w - content_x;
    int content_h = h - EMERY_WINDOW_PAD_TOP - EMERY_WINDOW_PAD_BOTTOM - CALENDAR_STATUS_HEIGHT - WEATHER_STATUS_HEIGHT;
    int calendar_h, time_h, forecast_h;
    compute_content_layout(content_h, &calendar_h, &time_h, &forecast_h);

    int calendar_y = content_y + CALENDAR_STATUS_HEIGHT;
    int time_y = calendar_y + calendar_h;

    L.top_status = GRect(content_x, content_y, content_w, CALENDAR_STATUS_HEIGHT + 1);
    if (mode == LAYOUT_TIER_NONE) {
        // emery: no calendar — time sits directly under the strip, status one notch
        // taller, forecast fills the rest; keep proportional time_h for the big clock.
        int strip_h     = CALENDAR_STATUS_HEIGHT + 1;   // 21
        int none_time_y = content_y + strip_h;          // 2 + 21 = 23
        int status_h    = NONE_STATUS_HEIGHT;           // 30 (fits Gothic 28; tune)
        int status_y    = none_time_y + time_h;
        int forecast_y  = status_y + status_h;
        int fc_h        = h - EMERY_WINDOW_PAD_BOTTOM - forecast_y;

        L.top     = GRect(content_x, calendar_y, content_w, 0);
        L.status  = GRect(content_x, status_y, content_w, status_h);
        // Drop only the clock (not the status/forecast below) to balance its top/bottom gaps.
        L.time    = GRect(content_x, none_time_y + NONE_TIME_DROP, content_w, time_h);
        L.bottom  = GRect(content_x, forecast_y, forecast_w, fc_h);
        L.loading = L.bottom;
        L.radar   = L.bottom;
    } else {
        int cal_h      = compact ? (calendar_h - calendar_h / 3) : calendar_h;
        int forecast_y = compact ? (time_y + time_h)             : (time_y + time_h + WEATHER_STATUS_HEIGHT);
        // full: the status band rides directly above the forecast — size it from the font
        // (fc_band_h) and pin its bottom to the forecast top so the line clears the graph by a
        // constant margin, rising up into the clock band's slack. compact: the band drops into the
        // freed part of the calendar band and abuts the calendar, so keep the carved-row height.
        int status_h   = compact ? (calendar_h - cal_h)          : fc_band_h;
        int status_y   = compact ? (calendar_y + cal_h)          : (forecast_y - fc_band_h);
        int fc_h       = compact ? (forecast_h + WEATHER_STATUS_HEIGHT) : forecast_h;
        // Single-status compact: drop the lone band toward the clock just below it.
        if (compact && !dual) { status_y += COMPACT_SINGLE_STATUS_NUDGE; }

        L.top        = GRect(content_x, calendar_y, content_w, cal_h);
        L.status     = GRect(content_x, status_y, content_w, status_h);
        L.time       = GRect(content_x, time_y, content_w, time_h);
        L.bottom     = GRect(content_x, forecast_y, forecast_w, fc_h);
        L.loading    = compact
            ? GRect(content_x, forecast_y, content_w, fc_h)
            : GRect(content_x, time_y + time_h, content_w, h - EMERY_WINDOW_PAD_BOTTOM - (time_y + time_h));
        L.radar      = L.top;
    }
#else
    int cal_full = CALENDAR_HEIGHT;                     // 45
    int cal_row  = CALENDAR_HEIGHT / 3;                 // 15 (one calendar row)
    int cal_y    = CALENDAR_STATUS_HEIGHT;              // 13
    int time_y   = cal_y + cal_full;                    // 58 (fixed anchor; == 13+30+15 compact)

    L.top_status = GRect(0, 0, w, CALENDAR_STATUS_HEIGHT + 1);
    if (mode == LAYOUT_TIER_NONE) {
        // No calendar: time rises directly under the strip, the status sits one
        // notch taller beneath it, and the forecast fills everything below.
        int strip_h    = CALENDAR_STATUS_HEIGHT + 1;    // 14
        int none_time_y = strip_h;                      // time directly under the strip
        int status_h   = NONE_STATUS_HEIGHT;            // 22 (fits Gothic 24; tune)
        int status_y   = none_time_y + TIME_HEIGHT;     // 14 + 45 = 59
        int forecast_y = status_y + status_h;           // 81
        int fc_h       = h - forecast_y;                // 87 on a 168px screen

        L.top     = GRect(0, cal_y, w, 0);              // calendar hidden; zero-height band
        L.status  = GRect(0, status_y, w, status_h);
        // Drop only the clock (not the status/forecast below) to balance its top/bottom gaps.
        L.time    = GRect(0, none_time_y + NONE_TIME_DROP, w, TIME_HEIGHT);
        L.bottom  = GRect(0, forecast_y, w, fc_h);
        L.loading = L.bottom;
        L.radar   = L.bottom;                           // radar rides the bottom band
    } else {
        int cal_h      = compact ? (2 * cal_row)          : CALENDAR_HEIGHT;                         // 30 vs 45
        // full: the status band rides directly above the forecast. Size it from the font
        // (fc_band_h) and pin its bottom to the forecast top (h - FORECAST_HEIGHT), so the centred
        // line clears the graph by a constant margin and rises up into the clock band's slack.
        // compact: the band drops into the freed 3rd calendar row and abuts the calendar, so keep
        // the calendar-row height there.
        int status_h   = compact ? cal_row                : fc_band_h;                              // 15 vs 20
        int status_y   = compact ? (cal_y + cal_h)        : (h - FORECAST_HEIGHT - fc_band_h);       // 43 vs 97
        int forecast_y = compact ? (time_y + TIME_HEIGHT) : (h - FORECAST_HEIGHT);                   // 103 vs 117
        int fc_h       = h - forecast_y;                                                             // 65 vs 51
        // Single-status compact: drop the lone band toward the clock just below it.
        if (compact && !dual) { status_y += COMPACT_SINGLE_STATUS_NUDGE; }

        L.top        = GRect(0, cal_y, w, cal_h);
        L.status     = GRect(0, status_y, w, status_h);
        L.time       = GRect(0, time_y, w, TIME_HEIGHT);
        L.bottom     = GRect(0, forecast_y, w, fc_h);
        L.loading    = compact
            ? GRect(0, forecast_y, w, fc_h)
            : GRect(0, h - FORECAST_HEIGHT - fc_band_h, w, FORECAST_HEIGHT + fc_band_h);
        L.radar      = L.top;                           // radar shares the calendar frame
    }
#endif
    // Dual status: health keeps L.status; carve a weather band (L.status_lower) from
    // the top of the forecast and shrink the forecast. dual is only ever true in
    // compact/none (never full) — see dual_active().
    L.status_lower = L.status;
#if defined(PBL_HEALTH)
    if (dual) {
        if (mode == LAYOUT_TIER_NONE) {
            // none: carve a full-height weather band off the top of the bottom (radar/forecast) band.
            int lower_h = NONE_STATUS_HEIGHT;
            L.status_lower = GRect(L.bottom.origin.x, L.bottom.origin.y, L.bottom.size.w, lower_h);
            L.bottom.origin.y += lower_h;
            L.bottom.size.h   -= lower_h;
            L.radar = L.bottom;
        } else {
            // compact: the weather row rides the SAME forecast-abutting band as full mode, so the
            // line lands identically whether the top view is full or compact. The forecast gives up
            // WEATHER_STATUS_HEIGHT from its top — landing it exactly where full mode pins it — while
            // the taller fc_band_h band sits with its bottom on that forecast top and rises up into
            // the clock's slack above. Health keeps the compact top band L.status.
            int forecast_top = L.bottom.origin.y + WEATHER_STATUS_HEIGHT;
            L.status_lower = GRect(L.bottom.origin.x, forecast_top - fc_band_h, L.bottom.size.w, fc_band_h);
            L.bottom.origin.y  = forecast_top;
            L.bottom.size.h   -= WEATHER_STATUS_HEIGHT;
        }
        L.loading = L.bottom;
    }
#endif
    return L;
}
