#include "watch_services.h"

#ifdef WW_FIXTURE_NOW_YEAR
static bool is_leap_year(int year) {
    return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
}

static int fixture_day_of_year(int year, int month, int day) {
    static const int days_before_month[] = {
        0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334
    };
    int yday = days_before_month[month - 1] + day - 1;
    if (month > 2 && is_leap_year(year)) {
        yday += 1;
    }

    return yday;
}

static int fixture_weekday(int year, int month, int day) {
    if (month < 3) {
        month += 12;
        year -= 1;
    }

    int k = year % 100;
    int j = year / 100;
    int h = (day + (13 * (month + 1)) / 5 + k + k / 4 + j / 4 + 5 * j) % 7;
    return (h + 6) % 7;
}
#endif

time_t watch_services_now(void) {
#ifdef WW_FIXTURE_NOW_YEAR
    struct tm fixture_time = watch_services_localtime();
    return mktime(&fixture_time);
#else
    return time(NULL);
#endif
}

struct tm watch_services_localtime(void) {
#ifdef WW_FIXTURE_NOW_YEAR
    struct tm fixture_time = (struct tm) {
        .tm_year = WW_FIXTURE_NOW_YEAR - 1900,
        .tm_mon = WW_FIXTURE_NOW_MONTH - 1,
        .tm_mday = WW_FIXTURE_NOW_DAY,
        .tm_hour = WW_FIXTURE_NOW_HOUR,
        .tm_min = WW_FIXTURE_NOW_MINUTE,
        .tm_sec = WW_FIXTURE_NOW_SECOND,
        .tm_wday = fixture_weekday(WW_FIXTURE_NOW_YEAR, WW_FIXTURE_NOW_MONTH, WW_FIXTURE_NOW_DAY),
        .tm_yday = fixture_day_of_year(WW_FIXTURE_NOW_YEAR, WW_FIXTURE_NOW_MONTH, WW_FIXTURE_NOW_DAY),
        .tm_isdst = 0
    };
    return fixture_time;
#else
    time_t now = watch_services_now();
    struct tm *local_time = localtime(&now);
    return *local_time;
#endif
}

bool watch_services_clock_is_24h_style(void) {
#ifdef WW_FIXTURE_CLOCK_24H
    return WW_FIXTURE_CLOCK_24H;
#else
    return clock_is_24h_style();
#endif
}

BatteryChargeState watch_services_battery_state(void) {
#ifdef WW_FIXTURE_BATTERY_PERCENT
    return (BatteryChargeState) {
        .charge_percent = WW_FIXTURE_BATTERY_PERCENT,
        .is_charging = WW_FIXTURE_BATTERY_CHARGING,
        .is_plugged = WW_FIXTURE_BATTERY_CHARGING
    };
#else
    return battery_state_service_peek();
#endif
}

bool watch_services_battery_is_fixture(void) {
#ifdef WW_FIXTURE_BATTERY_PERCENT
    return true;
#else
    return false;
#endif
}
