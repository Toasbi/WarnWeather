// Host test for the Clay bundle's parse (appendix/config_wire.c config_parse_wire): the
// core keys all or nothing, and each optional key read as sent, absent (its field keeps
// the memset's 0), or at the edges of the int its read takes. Built once per platform arm
// of config.h by scripts/test-c.sh: no platform define (basalt's fields, with health),
// PBL_PLATFORM_EMERY, and PBL_PLATFORM_APLITE without PBL_HEALTH.
#include <stdio.h>
#include <string.h>

#include "c/appendix/config_wire.h"
#include "message_key_ids.auto.h"

static int s_failures;

static void expect(const char *name, long got, long want) {
    if (got != want) {
        printf("FAIL %s: got %ld want %ld\n", name, got, want);
        s_failures++;
    }
}

// The fake message: its tuples in the order they were put.
struct DictionaryIterator {
    Tuple tuples[40];
    int n;
};

Tuple *dict_find(const DictionaryIterator *iter, const uint32_t key) {
    for (int i = 0; i < iter->n; i++) {
        if (iter->tuples[i].key == key) { return (Tuple *) &iter->tuples[i]; }
    }
    return NULL;
}

// An int tuple as PKJS sends every number: 4 bytes, read as int16 through its low half.
static void put_int(DictionaryIterator *d, uint32_t key, int32_t v) {
    Tuple *t = &d->tuples[d->n++];
    memset(t, 0, sizeof(*t));
    t->key = key;
    t->type = TUPLE_INT;
    t->length = 4;
    t->value->int32 = v;
}

// A 2-byte int tuple, as a runtime that packs a short int would send it.
static void put_int16(DictionaryIterator *d, uint32_t key, int16_t v) {
    Tuple *t = &d->tuples[d->n++];
    memset(t, 0, sizeof(*t));
    t->key = key;
    t->type = TUPLE_INT;
    t->length = 2;
    t->value->int16 = v;
}

#if !defined(PBL_PLATFORM_APLITE)
static void put_bytes(DictionaryIterator *d, uint32_t key, const uint8_t *bytes, uint16_t n) {
    Tuple *t = &d->tuples[d->n++];
    memset(t, 0, sizeof(*t));
    t->key = key;
    t->type = TUPLE_BYTE_ARRAY;
    t->length = n;
    memcpy(t->value->data, bytes, n);
}
#endif

static void drop(DictionaryIterator *d, uint32_t key) {
    for (int i = 0; i < d->n; i++) {
        if (d->tuples[i].key == key) {
            memmove(&d->tuples[i], &d->tuples[i + 1], (size_t) (d->n - i - 1) * sizeof(Tuple));
            d->n--;
            return;
        }
    }
}

// The core keys, in the order config_wire.c reads them.
static const uint32_t CORE[] = {
    MESSAGE_KEY_CLAY_CELSIUS, MESSAGE_KEY_CLAY_TIME_LEAD_ZERO, MESSAGE_KEY_CLAY_AXIS_12H,
    MESSAGE_KEY_CLAY_START_MON, MESSAGE_KEY_CLAY_PREV_WEEK, MESSAGE_KEY_CLAY_VIBE,
    MESSAGE_KEY_CLAY_SHOW_QT, MESSAGE_KEY_CLAY_SHOW_BT, MESSAGE_KEY_CLAY_SHOW_BT_DISCONNECT,
    MESSAGE_KEY_CLAY_SHOW_AM_PM, MESSAGE_KEY_CLAY_DAY_NIGHT_SHADING, MESSAGE_KEY_CLAY_HEALTH_MODE,
    MESSAGE_KEY_CLAY_TOP_VIEW_MODE, MESSAGE_KEY_CLAY_FETCH_INTERVAL_MIN,
    MESSAGE_KEY_CLAY_RAIN_COUNTDOWN_HORIZON, MESSAGE_KEY_CLAY_TIME_FONT,
    MESSAGE_KEY_CLAY_COLOR_TODAY, MESSAGE_KEY_CLAY_COLOR_SATURDAY, MESSAGE_KEY_CLAY_COLOR_SUNDAY,
    MESSAGE_KEY_CLAY_COLOR_US_FEDERAL, MESSAGE_KEY_CLAY_COLOR_TIME,
};
#define CORE_COUNT ((int) (sizeof(CORE) / sizeof(CORE[0])))

// A message with every core key and no optional one. The values probe each read: a flag
// is any non-zero int16 (0x100 is on, 0x10000 off: its low half is 0), a byte the int16's
// low byte, an int16 the low half, a colour its 0xRRGGBB int.
static void put_core(DictionaryIterator *d) {
    d->n = 0;
    put_int(d, MESSAGE_KEY_CLAY_CELSIUS, 1);
    put_int(d, MESSAGE_KEY_CLAY_TIME_LEAD_ZERO, 0);
    put_int(d, MESSAGE_KEY_CLAY_AXIS_12H, 2);
    put_int(d, MESSAGE_KEY_CLAY_START_MON, 0x100);
    put_int(d, MESSAGE_KEY_CLAY_PREV_WEEK, 0x10000);
    put_int(d, MESSAGE_KEY_CLAY_VIBE, 1);
    put_int(d, MESSAGE_KEY_CLAY_SHOW_QT, -1);
    put_int(d, MESSAGE_KEY_CLAY_SHOW_BT, 0);
    put_int(d, MESSAGE_KEY_CLAY_SHOW_BT_DISCONNECT, 1);
    put_int(d, MESSAGE_KEY_CLAY_SHOW_AM_PM, 1);
    put_int(d, MESSAGE_KEY_CLAY_DAY_NIGHT_SHADING, 0);
    put_int(d, MESSAGE_KEY_CLAY_HEALTH_MODE, 0x1FF);
    put_int(d, MESSAGE_KEY_CLAY_TOP_VIEW_MODE, 2);
    put_int(d, MESSAGE_KEY_CLAY_FETCH_INTERVAL_MIN, 30);
    put_int(d, MESSAGE_KEY_CLAY_RAIN_COUNTDOWN_HORIZON, -5);
    put_int(d, MESSAGE_KEY_CLAY_TIME_FONT, 0x10003);
    put_int(d, MESSAGE_KEY_CLAY_COLOR_TODAY, 0xFF0000);
    put_int(d, MESSAGE_KEY_CLAY_COLOR_SATURDAY, 0x00FF00);
    put_int(d, MESSAGE_KEY_CLAY_COLOR_SUNDAY, 0x0000FF);
    put_int(d, MESSAGE_KEY_CLAY_COLOR_US_FEDERAL, 0x555555);
    put_int(d, MESSAGE_KEY_CLAY_COLOR_TIME, 0xFFFFFF);
}

static void core_keys_read_each_field(void) {
    DictionaryIterator d;
    Config c;
    put_core(&d);
    expect("core.parsed", config_parse_wire(&d, &c), 1);
    expect("core.celsius", c.celsius, 1);
    expect("core.time_lead_zero", c.time_lead_zero, 0);
    expect("core.axis_12h", c.axis_12h, 1);
    expect("core.start_mon.high_byte", c.start_mon, 1);
    expect("core.prev_week.high_half", c.prev_week, 0);
    expect("core.vibe", c.vibe, 1);
    expect("core.show_qt.negative", c.show_qt, 1);
    expect("core.show_bt", c.show_bt, 0);
    expect("core.show_bt_disconnect", c.show_bt_disconnect, 1);
    expect("core.show_am_pm", c.show_am_pm, 1);
    expect("core.day_night_shading", c.day_night_shading, 0);
    expect("core.health_mode.low_byte", c.health_mode, 0xFF);
    expect("core.top_view_mode", c.top_view_mode, 2);
    expect("core.fetch_interval_min", c.fetch_interval_min, 30);
    expect("core.rain_countdown_horizon_min", c.rain_countdown_horizon_min, -5);
    expect("core.time_font.low_half", c.time_font, 3);
    expect("core.color_today", c.color_today.argb, 0xF0);
    expect("core.color_saturday", c.color_saturday.argb, 0xCC);
    expect("core.color_sunday", c.color_sunday.argb, 0xC3);
    expect("core.color_us_federal", c.color_us_federal.argb, 0xD5);
    expect("core.color_time", c.color_time.argb, 0xFF);
    // No optional key: each field keeps its zero.
    expect("core.theme.absent", c.theme, 0);
    expect("core.battery_low_only.absent", c.battery_low_only, 0);
    expect("core.date_month_first.absent", c.date_month_first, 0);
    expect("core.view_reset_min.absent", c.view_reset_min, 0);
    for (int i = 0; i < 3; i++) { expect("core.view_spec2.absent", c.view_spec2[i], 0); }
#if !defined(PBL_PLATFORM_APLITE)
    for (int i = 0; i < 3; i++) { expect("core.view_ext.absent", c.view_ext[i], 0); }
    expect("core.view_double_flick.absent", c.view_double_flick, 0);
    expect("core.date_month_format.absent", c.date_month_format, 0);
    expect("core.date_full_format.absent", c.date_full_format, 0);
#endif
#if defined(PBL_HEALTH)
    expect("core.hr_scale.absent", c.hr_scale, 0);
#endif
#if defined(PBL_PLATFORM_EMERY)
    expect("core.large_graph_font.absent", c.large_graph_font, 0);
    expect("core.forecast_axis.absent", c.forecast_axis, 0);
#endif
}

// Without any one core key the message carries no config, whatever else it holds.
static void a_missing_core_key_drops_the_config(void) {
    for (int k = 0; k < CORE_COUNT; k++) {
        DictionaryIterator d;
        Config c;
        put_core(&d);
        put_int(&d, MESSAGE_KEY_CLAY_THEME, 1);
        drop(&d, CORE[k]);
        char name[32];
        snprintf(name, sizeof(name), "core.missing%d", k);
        expect(name, config_parse_wire(&d, &c), 0);
    }
    DictionaryIterator none = { .n = 0 };
    Config c;
    expect("core.empty_message", config_parse_wire(&none, &c), 0);
}

// The plain optional keys: the theme's low byte, and two flags that are any non-zero int16.
static void plain_optional_keys(void) {
    static const int32_t sent[] = { 0, 1, 3, 0x100, 0x1FF, -1, 0x10000 };
    static const uint8_t theme[] = { 0, 1, 3, 0, 0xFF, 0xFF, 0 };
    static const bool flag[] = { false, true, true, true, true, true, false };
    for (unsigned i = 0; i < sizeof(sent) / sizeof(sent[0]); i++) {
        DictionaryIterator d;
        Config c;
        put_core(&d);
        put_int(&d, MESSAGE_KEY_CLAY_THEME, sent[i]);
        put_int(&d, MESSAGE_KEY_CLAY_BATTERY_LOW_ONLY, sent[i]);
        put_int(&d, MESSAGE_KEY_CLAY_DATE_MONTH_FIRST, sent[i]);
        char name[40];
        snprintf(name, sizeof(name), "optional.%u.parsed", i);
        expect(name, config_parse_wire(&d, &c), 1);
        snprintf(name, sizeof(name), "optional.%u.theme", i);
        expect(name, c.theme, theme[i]);
        snprintf(name, sizeof(name), "optional.%u.battery_low_only", i);
        expect(name, c.battery_low_only, flag[i]);
        snprintf(name, sizeof(name), "optional.%u.date_month_first", i);
        expect(name, c.date_month_first, flag[i]);
    }
    // Each one alone: the others keep their zero.
    DictionaryIterator d;
    Config c;
    put_core(&d);
    put_int(&d, MESSAGE_KEY_CLAY_DATE_MONTH_FIRST, 1);
    config_parse_wire(&d, &c);
    expect("optional.alone.theme", c.theme, 0);
    expect("optional.alone.battery_low_only", c.battery_low_only, 0);
    expect("optional.alone.date_month_first", c.date_month_first, 1);
}

// The views and the flick word: each view's spec is its low half, and off aplite its ext
// word the high half of a 4-byte tuple (0 from a 2-byte one); the reset word's low byte is
// the minutes and, off aplite, bit 8 the double flick.
static void view_keys(void) {
    DictionaryIterator d;
    Config c;
    put_core(&d);
    put_int(&d, MESSAGE_KEY_CLAY_VIEW_0, 0x12345678);
    put_int16(&d, MESSAGE_KEY_CLAY_VIEW_1, (int16_t) 0x8301);
    put_int(&d, MESSAGE_KEY_CLAY_VIEW_2, 0x0000FFFF);
    put_int(&d, MESSAGE_KEY_CLAY_VIEW_RESET_MIN, 0x0105);
    expect("view.parsed", config_parse_wire(&d, &c), 1);
    expect("view.0.spec", c.view_spec2[0], 0x5678);
    expect("view.1.spec", c.view_spec2[1], 0x8301);
    expect("view.2.spec", c.view_spec2[2], 0xFFFF);
    expect("view.reset_min", c.view_reset_min, 5);
#if !defined(PBL_PLATFORM_APLITE)
    expect("view.0.ext", c.view_ext[0], 0x1234);
    expect("view.1.ext.short_tuple", c.view_ext[1], 0);
    expect("view.2.ext", c.view_ext[2], 0);
    expect("view.double_flick", c.view_double_flick, 1);
#endif
    // One view alone: the others keep their zero.
    put_core(&d);
    put_int(&d, MESSAGE_KEY_CLAY_VIEW_1, 0x0042);
    config_parse_wire(&d, &c);
    expect("view.alone.0", c.view_spec2[0], 0);
    expect("view.alone.1", c.view_spec2[1], 0x42);
    expect("view.alone.2", c.view_spec2[2], 0);
}

// The rest of the optional keys, each on the platforms whose Config has its field.
static void platform_keys(void) {
    DictionaryIterator d;
    Config c;
#if !defined(PBL_PLATFORM_APLITE)
    // The date formats: a byte array of at least two bytes, else nothing.
    static const uint8_t formats[] = { 7, 9, 4 };
    put_core(&d);
    put_bytes(&d, MESSAGE_KEY_CLAY_DATE_FORMAT_UINT8, formats, 3);
    config_parse_wire(&d, &c);
    expect("date_format.month", c.date_month_format, 7);
    expect("date_format.full", c.date_full_format, 9);
    put_core(&d);
    put_bytes(&d, MESSAGE_KEY_CLAY_DATE_FORMAT_UINT8, formats, 1);
    config_parse_wire(&d, &c);
    expect("date_format.short.month", c.date_month_format, 0);
    expect("date_format.short.full", c.date_full_format, 0);
    put_core(&d);
    put_int(&d, MESSAGE_KEY_CLAY_DATE_FORMAT_UINT8, 0x0907);
    config_parse_wire(&d, &c);
    expect("date_format.int.month", c.date_month_format, 0);
#endif
#if defined(PBL_HEALTH)
    // The heart-rate scale: the int32's low 16 bits (the packed pair can pass int16).
    put_core(&d);
    put_int(&d, MESSAGE_KEY_CLAY_HR_SCALE, 0x0001DC3C);
    config_parse_wire(&d, &c);
    expect("hr_scale", c.hr_scale, 0xDC3C);
#endif
#if defined(PBL_PLATFORM_EMERY)
    // The graph-options word: bit 0 the larger fonts, bits 1-7 the forecast's axis.
    put_core(&d);
    put_int(&d, MESSAGE_KEY_CLAY_LARGE_GRAPH_FONT, 0x012D);
    config_parse_wire(&d, &c);
    expect("graph_options.large_font", c.large_graph_font, 1);
    expect("graph_options.axis", c.forecast_axis, 0x2C);
    put_core(&d);
    put_int(&d, MESSAGE_KEY_CLAY_LARGE_GRAPH_FONT, 1);
    config_parse_wire(&d, &c);
    expect("graph_options.bare_bool.large_font", c.large_graph_font, 1);
    expect("graph_options.bare_bool.axis", c.forecast_axis, 0);
#endif
    (void) d;
    (void) c;
}

int main(void) {
    core_keys_read_each_field();
    a_missing_core_key_drops_the_config();
    plain_optional_keys();
    view_keys();
    platform_keys();
    if (s_failures) {
        printf("%d config_wire failure(s)\n", s_failures);
        return 1;
    }
    printf("config_wire OK\n");
    return 0;
}
