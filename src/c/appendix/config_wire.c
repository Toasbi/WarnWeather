#include <string.h>

#include "config_wire.h"

#if !defined(PBL_PLATFORM_APLITE)
// One CLAY_VIEW_n tuple → the view's 16-bit spec (low half) and its 16-bit EXT word
// (high half: custom layout v2's sizes / top-graph kind / Position — view-cycle.js
// packWire). PKJS sends every JS number as a 4-byte int (pypkjs Int32; libpebble3
// createInt; the colour and HR-scale tuples on this very message rely on it), so the
// high half was always on the wire and simply discarded. The low half is read exactly
// as before (int16 over a little-endian int32 = its low bytes). The guard is on LENGTH
// only: a runtime that packed a 2-byte int yields ext 0 (= before v2), never an
// over-read; a TUPLE_INT type check is deliberately absent — nothing establishes that
// every phone app tags a positive number INT rather than UINT, and the shipped int32
// reads below check no type either. ext keeps its memset 0 when the tuple is short.
static void read_view_tuple(const Tuple *t, int i, uint16_t *spec, uint16_t *ext) {
    if (!t) { return; }
    *spec = (uint16_t) t->value->int16;
    if (t->length >= 4) {
        *ext = (uint16_t)(((uint32_t) t->value->int32) >> 16);
    }
#if defined(WW_ENABLE_MEMORY_LOGGING)
    // Dev-only carrier proof (ENABLE_MEMORY_LOGGING=1 builds): shows the ext word that
    // arrived for each view, so an emulator/phone run can confirm the high half survives.
    APP_LOG(APP_LOG_LEVEL_DEBUG, "view_ext[%d]=0x%04x", i, *ext);
#else
    (void) i;
#endif
}
#endif

bool config_parse_wire(DictionaryIterator *iterator, Config *out) {
    Tuple *clay_celsius_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_CELSIUS);
    Tuple *clay_time_lead_zero_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_TIME_LEAD_ZERO);
    Tuple *clay_axis_12h_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_AXIS_12H);
    Tuple *clay_start_mon_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_START_MON);
    Tuple *clay_prev_week_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_PREV_WEEK);
    Tuple *clay_color_today_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_COLOR_TODAY);
    Tuple *clay_time_font_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_TIME_FONT);
    Tuple *clay_vibe_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_VIBE);
    Tuple *clay_show_qt_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_SHOW_QT);
    Tuple *clay_show_bt_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_SHOW_BT);
    Tuple *clay_show_bt_disconnect_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_SHOW_BT_DISCONNECT);
    Tuple *clay_show_am_pm_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_SHOW_AM_PM);
    Tuple *clay_color_saturday_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_COLOR_SATURDAY);
    Tuple *clay_color_sunday_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_COLOR_SUNDAY);
    Tuple *clay_color_us_federal_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_COLOR_US_FEDERAL);
    Tuple *clay_color_time_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_COLOR_TIME);
    Tuple *clay_day_night_shading_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_DAY_NIGHT_SHADING);
    Tuple *clay_fetch_interval_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_FETCH_INTERVAL_MIN);
    Tuple *clay_health_mode_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_HEALTH_MODE);
    Tuple *clay_rain_countdown_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_RAIN_COUNTDOWN_HORIZON);
    Tuple *clay_top_view_mode_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_TOP_VIEW_MODE);
    // Optional (older phone builds omit these); view_spec2 then keeps its seeded
    // default (the phone re-sends the real cycle on connect).
    Tuple *clay_view_0_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_VIEW_0);
    Tuple *clay_view_1_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_VIEW_1);
    Tuple *clay_view_2_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_VIEW_2);
    Tuple *clay_view_reset_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_VIEW_RESET_MIN);
    // Optional (older phone builds omit it); config.theme then stays 0 = dark.
    Tuple *clay_theme_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_THEME);
    // Optional (older phone builds omit it); battery_low_only then stays false.
    Tuple *clay_battery_low_only_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_BATTERY_LOW_ONLY);
    // Optional (older phone builds omit it); date_month_first then stays false = day-first.
    Tuple *clay_date_month_first_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_DATE_MONTH_FIRST);
#if defined(PBL_PLATFORM_EMERY)
    // Optional (older phone builds omit it); large_graph_font then stays false.
    // emery-only, like the field (config.h): the tuple still RIDES to every platform,
    // but only emery pays the dict_find to look it up.
    Tuple *clay_large_graph_font_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_LARGE_GRAPH_FONT);
#endif
#if !defined(PBL_PLATFORM_APLITE)
    // Optional (older phone builds omit it); both date formats then stay 0 = Auto.
    // Not on aplite, like the fields (config.h): the phone omits the tuple for an
    // aplite watch too (clay-payload gates it with the threshold blob).
    Tuple *clay_date_format_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_DATE_FORMAT_UINT8);
#endif
#if defined(PBL_HEALTH)
    // Optional (older phone builds omit it); hr_scale then stays 0 = unset, and
    // health_graph_layer falls back to its own HEALTH_HR_LO/HEALTH_HR_HI.
    Tuple *clay_hr_scale_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_HR_SCALE);
#endif

    // The core-key presence chain — see config_wire.h. New keys go in the
    // optional block above, never in here.
    if (!(clay_celsius_tuple && clay_time_lead_zero_tuple && clay_axis_12h_tuple && clay_start_mon_tuple
        && clay_prev_week_tuple && clay_color_today_tuple && clay_time_font_tuple && clay_vibe_tuple
        && clay_show_qt_tuple && clay_show_bt_tuple && clay_show_bt_disconnect_tuple && clay_show_am_pm_tuple
        && clay_color_saturday_tuple && clay_color_sunday_tuple && clay_color_us_federal_tuple
        && clay_color_time_tuple && clay_day_night_shading_tuple && clay_fetch_interval_tuple
        && clay_health_mode_tuple && clay_rain_countdown_tuple && clay_top_view_mode_tuple)) {
        return false;
    }

    // Zero the struct first so padding bytes compare deterministically in
    // persist_set_config's change detection.
    memset(out, 0, sizeof(*out));
    out->celsius = (bool) (clay_celsius_tuple->value->int16);
    out->time_lead_zero = (bool) (clay_time_lead_zero_tuple->value->int16);
    out->axis_12h = (bool) (clay_axis_12h_tuple->value->int16);
    out->start_mon = (bool) (clay_start_mon_tuple->value->int16);
    out->prev_week = (bool) (clay_prev_week_tuple->value->int16);
    out->vibe = (bool) (clay_vibe_tuple->value->int16);
    out->show_qt = (bool) (clay_show_qt_tuple->value->int16);
    out->show_bt = (bool) (clay_show_bt_tuple->value->int16);
    out->show_bt_disconnect = (bool) (clay_show_bt_disconnect_tuple->value->int16);
    out->show_am_pm = (bool) (clay_show_am_pm_tuple->value->int16);
    out->day_night_shading = (bool) (clay_day_night_shading_tuple->value->int16);
    out->health_mode = (uint8_t) (clay_health_mode_tuple->value->int16);
    out->fetch_interval_min = clay_fetch_interval_tuple->value->int16;
    out->rain_countdown_horizon_min = clay_rain_countdown_tuple->value->int16;
    out->top_view_mode = (uint8_t) (clay_top_view_mode_tuple->value->int16);
    // Packed view slots — read the full int16 tuple as uint16 (NOT truncated to a byte;
    // the tier bits 8-9 live above the low byte). See config.h view_spec2 / view_spec_unpack.
    // Off aplite the high half carries the view's ext word too (read_view_tuple above).
#if !defined(PBL_PLATFORM_APLITE)
    read_view_tuple(clay_view_0_tuple, 0, &out->view_spec2[0], &out->view_ext[0]);
    read_view_tuple(clay_view_1_tuple, 1, &out->view_spec2[1], &out->view_ext[1]);
    read_view_tuple(clay_view_2_tuple, 2, &out->view_spec2[2], &out->view_ext[2]);
#else
    if (clay_view_0_tuple) { out->view_spec2[0] = (uint16_t) clay_view_0_tuple->value->int16; }
    if (clay_view_1_tuple) { out->view_spec2[1] = (uint16_t) clay_view_1_tuple->value->int16; }
    if (clay_view_2_tuple) { out->view_spec2[2] = (uint16_t) clay_view_2_tuple->value->int16; }
#endif
    if (clay_view_reset_tuple) { out->view_reset_min = (uint8_t) clay_view_reset_tuple->value->int16; }
    if (clay_theme_tuple) { out->theme = (uint8_t) clay_theme_tuple->value->int16; }
    if (clay_battery_low_only_tuple) {
        out->battery_low_only = (bool) (clay_battery_low_only_tuple->value->int16);
    }
    if (clay_date_month_first_tuple) {
        out->date_month_first = (bool) (clay_date_month_first_tuple->value->int16);
    }
#if defined(PBL_PLATFORM_EMERY)
    if (clay_large_graph_font_tuple) {
        // Booleans arrive as int16 (like every other CLAY_ toggle above) -- NOT int32,
        // which is the colour / hr_scale idiom.
        out->large_graph_font = (bool) (clay_large_graph_font_tuple->value->int16);
    }
#endif
#if !defined(PBL_PLATFORM_APLITE)
    if (clay_date_format_tuple && clay_date_format_tuple->type == TUPLE_BYTE_ARRAY
        && clay_date_format_tuple->length >= 2) {
        // [0] month-year format, [1] full-date format (date_format.h wire
        // vocabulary). Length is a MINIMUM, the line-style tuple's growth
        // contract: a future byte appends with its own check.
        out->date_month_format = clay_date_format_tuple->value->data[0];
        out->date_full_format = clay_date_format_tuple->value->data[1];
    }
#endif
#if defined(PBL_HEALTH)
    if (clay_hr_scale_tuple) {
        // Read as int32 (like the colour tuples): PKJS sends numbers as 32-bit,
        // and the packed value can exceed int16's range (hi 220 -> 56 3xx).
        out->hr_scale = (uint16_t) clay_hr_scale_tuple->value->int32;
    }
#endif
    out->time_font = clay_time_font_tuple->value->int16;
    out->color_today = GColorFromHEX(clay_color_today_tuple->value->int32);
    out->color_saturday = GColorFromHEX(clay_color_saturday_tuple->value->int32);
    out->color_sunday = GColorFromHEX(clay_color_sunday_tuple->value->int32);
    out->color_us_federal = GColorFromHEX(clay_color_us_federal_tuple->value->int32);
    out->color_time = GColorFromHEX(clay_color_time_tuple->value->int32);
    return true;
}
