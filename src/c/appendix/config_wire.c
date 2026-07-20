#include <string.h>

#include "config_wire.h"

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
    // Optional (older phone builds omit these); view_spec then stays 0 (all slots
    // disabled → producer renders the default view).
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
    if (clay_view_0_tuple) { out->view_spec[0] = (uint8_t) clay_view_0_tuple->value->int16; }
    if (clay_view_1_tuple) { out->view_spec[1] = (uint8_t) clay_view_1_tuple->value->int16; }
    if (clay_view_2_tuple) { out->view_spec[2] = (uint8_t) clay_view_2_tuple->value->int16; }
    if (clay_view_reset_tuple) { out->view_reset_min = (uint8_t) clay_view_reset_tuple->value->int16; }
    if (clay_theme_tuple) { out->theme = (uint8_t) clay_theme_tuple->value->int16; }
    if (clay_battery_low_only_tuple) {
        out->battery_low_only = (bool) (clay_battery_low_only_tuple->value->int16);
    }
    if (clay_date_month_first_tuple) {
        out->date_month_first = (bool) (clay_date_month_first_tuple->value->int16);
    }
    out->time_font = clay_time_font_tuple->value->int16;
    out->color_today = GColorFromHEX(clay_color_today_tuple->value->int32);
    out->color_saturday = GColorFromHEX(clay_color_saturday_tuple->value->int32);
    out->color_sunday = GColorFromHEX(clay_color_sunday_tuple->value->int32);
    out->color_us_federal = GColorFromHEX(clay_color_us_federal_tuple->value->int32);
    out->color_time = GColorFromHEX(clay_color_time_tuple->value->int32);
    return true;
}
