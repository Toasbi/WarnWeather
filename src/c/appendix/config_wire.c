#include <stddef.h>   // offsetof: the key table
#include <string.h>

#include "config_wire.h"
// Last: the MESSAGE_KEY_* ids as constants (wscript generates it into build/include),
// shadowing the SDK's uint32_t globals so --gc-sections drops them.
#include "message_key_ids.auto.h"

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

// How a key's tuple fills its Config field.
enum {
    READ_FLAG,    // a bool: any non-zero int16
    READ_BYTE,    // a uint8_t: the int's low byte
    READ_INT16,   // a 16-bit field: the int's low half
    READ_COLOR,   // a GColor, sent as its 0xRRGGBB int
};
// The field size each read writes. A kind on a field of another size would write past it
// or leave part of it unset, so every row below is checked against these as it compiles.
#define SIZE_OF_READ_FLAG  sizeof(bool)
#define SIZE_OF_READ_BYTE  sizeof(uint8_t)
#define SIZE_OF_READ_INT16 sizeof(int16_t)
#define SIZE_OF_READ_COLOR sizeof(GColor)

// The core keys (config_wire.h): each with the field it fills and how. The parse stops at
// the first one missing, so a message without config (every weather message) costs one
// lookup here. New keys never join this list.
#define CORE_KEY_LIST(X) \
    X(MESSAGE_KEY_CLAY_CELSIUS,                celsius,                    READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_TIME_LEAD_ZERO,         time_lead_zero,             READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_AXIS_12H,               axis_12h,                   READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_START_MON,              start_mon,                  READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_PREV_WEEK,              prev_week,                  READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_VIBE,                   vibe,                       READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_SHOW_QT,                show_qt,                    READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_SHOW_BT,                show_bt,                    READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_SHOW_BT_DISCONNECT,     show_bt_disconnect,         READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_SHOW_AM_PM,             show_am_pm,                 READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_DAY_NIGHT_SHADING,      day_night_shading,          READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_HEALTH_MODE,            health_mode,                READ_BYTE)  \
    X(MESSAGE_KEY_CLAY_TOP_VIEW_MODE,          top_view_mode,              READ_BYTE)  \
    X(MESSAGE_KEY_CLAY_FETCH_INTERVAL_MIN,     fetch_interval_min,         READ_INT16) \
    X(MESSAGE_KEY_CLAY_RAIN_COUNTDOWN_HORIZON, rain_countdown_horizon_min, READ_INT16) \
    X(MESSAGE_KEY_CLAY_TIME_FONT,              time_font,                  READ_INT16) \
    X(MESSAGE_KEY_CLAY_COLOR_TODAY,            color_today,                READ_COLOR) \
    X(MESSAGE_KEY_CLAY_COLOR_SATURDAY,         color_saturday,             READ_COLOR) \
    X(MESSAGE_KEY_CLAY_COLOR_SUNDAY,           color_sunday,               READ_COLOR) \
    X(MESSAGE_KEY_CLAY_COLOR_US_FEDERAL,       color_us_federal,           READ_COLOR) \
    X(MESSAGE_KEY_CLAY_COLOR_TIME,             color_time,                 READ_COLOR)

// The optional keys that read as one plain int: an older phone omits them, and each field
// then keeps its zero from the parse's memset (theme 0 = dark, day-first dates). A new key
// with such a read joins this list; one with any other read is read by hand after the
// table, like the views off aplite below.
#if defined(PBL_PLATFORM_APLITE)
// The packed view slots (config.h view_spec2): the full low half, the tier bits 8-9
// included. Without them the phone re-sends the real cycle on connect. And the flick
// word's low byte, the auto-return minutes (config_wire.h): aplite has no Double flick.
#define APLITE_VIEW_KEY_LIST(X) \
    X(MESSAGE_KEY_CLAY_VIEW_0,                 view_spec2[0],              READ_INT16) \
    X(MESSAGE_KEY_CLAY_VIEW_1,                 view_spec2[1],              READ_INT16) \
    X(MESSAGE_KEY_CLAY_VIEW_2,                 view_spec2[2],              READ_INT16) \
    X(MESSAGE_KEY_CLAY_VIEW_RESET_MIN,         view_reset_min,             READ_BYTE)
#else
#define APLITE_VIEW_KEY_LIST(X)
#endif
#define OPTIONAL_KEY_LIST(X) \
    X(MESSAGE_KEY_CLAY_THEME,                  theme,                      READ_BYTE)  \
    X(MESSAGE_KEY_CLAY_BATTERY_LOW_ONLY,       battery_low_only,           READ_FLAG)  \
    X(MESSAGE_KEY_CLAY_DATE_MONTH_FIRST,       date_month_first,           READ_FLAG)  \
    APLITE_VIEW_KEY_LIST(X)

typedef struct {
    uint16_t key;
    uint8_t  offset;
    uint8_t  read;
} WireKey;
_Static_assert(sizeof(Config) <= 255, "a key's field offset is one byte");
// Every key id fits the table's 16 bits (message_key_ids.auto.h: small constants), and
// every field is the size its read writes.
#define WIRE_KEY_CHECK(id, field, read) \
    _Static_assert((id) <= 0xFFFFu, #id " does not fit a key's 16 bits"); \
    _Static_assert(sizeof(((Config *) 0)->field) == SIZE_OF_##read, \
                   "Config." #field " is not the size a " #read " read writes");
CORE_KEY_LIST(WIRE_KEY_CHECK)
OPTIONAL_KEY_LIST(WIRE_KEY_CHECK)
#define WIRE_KEY_ROW(id, field, read) { (uint16_t) (id), offsetof(Config, field), (read) },
#define WIRE_KEY_ONE(id, field, read) + 1
// The core rows first: the parse gives up at a missing one, and skips a missing optional.
static const WireKey WIRE_KEYS[] = { CORE_KEY_LIST(WIRE_KEY_ROW) OPTIONAL_KEY_LIST(WIRE_KEY_ROW) };
enum { CORE_KEY_COUNT = 0 CORE_KEY_LIST(WIRE_KEY_ONE) };

bool config_parse_wire(DictionaryIterator *iterator, Config *out) {
    // Zero the struct first so padding bytes compare deterministically in
    // persist_set_config's change detection.
    memset(out, 0, sizeof(*out));
    for (unsigned i = 0; i < sizeof(WIRE_KEYS) / sizeof(WIRE_KEYS[0]); ++i) {
        const Tuple *t = dict_find(iterator, WIRE_KEYS[i].key);
        if (!t) {
            if (i < CORE_KEY_COUNT) { return false; }
            continue;
        }
        uint8_t *const field = (uint8_t *) out + WIRE_KEYS[i].offset;
        const int16_t v = t->value->int16;
        switch (WIRE_KEYS[i].read) {
            case READ_FLAG:  *field = (v != 0); break;
            case READ_BYTE:  *field = (uint8_t) v; break;
            case READ_INT16: memcpy(field, &v, sizeof(v)); break;
            default:         *field = GColorFromHEX(t->value->int32).argb; break;
        }
    }

    // The optional keys the table cannot read, each looked up where it is read; like the
    // table's, each field keeps its zero when an older phone omits the key.
#if !defined(PBL_PLATFORM_APLITE)
    // The packed view slots (config.h view_spec2): the low half as aplite's rows read it,
    // and the high half the view's ext word (read_view_tuple).
    read_view_tuple(dict_find(iterator, MESSAGE_KEY_CLAY_VIEW_0), 0, &out->view_spec2[0], &out->view_ext[0]);
    read_view_tuple(dict_find(iterator, MESSAGE_KEY_CLAY_VIEW_1), 1, &out->view_spec2[1], &out->view_ext[1]);
    read_view_tuple(dict_find(iterator, MESSAGE_KEY_CLAY_VIEW_2), 2, &out->view_spec2[2], &out->view_ext[2]);
    const Tuple *clay_view_reset_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_VIEW_RESET_MIN);
    if (clay_view_reset_tuple) {
        // Low byte: the auto-return minutes; the cast drops the flag bits (config_wire.h).
        out->view_reset_min = (uint8_t) clay_view_reset_tuple->value->int16;
        // Bit 8: Double flick (an older phone never sets it).
        out->view_double_flick = (clay_view_reset_tuple->value->int16 & VIEW_RESET_DOUBLE_FLICK) != 0;
    }
#endif
#if defined(PBL_PLATFORM_EMERY)
    // emery-only, like the field (config.h): the tuple still RIDES to every platform,
    // but only emery pays the dict_find to look it up.
    const Tuple *clay_large_graph_font_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_LARGE_GRAPH_FONT);
    if (clay_large_graph_font_tuple) {
        // emery: the graph-options word (config.h GRAPH_OPT_*): bit 0 Larger graph fonts,
        // bits 1-7 the forecast's left axis, stored as sent. Read through the low half
        // like CLAY_VIEW_RESET_MIN: the bare boolean the phone sends while every axis option is
        // at its default (and sent before 2.2) reads as bit 0 alone.
        const uint16_t word = (uint16_t) clay_large_graph_font_tuple->value->int16;
        out->large_graph_font = (word & GRAPH_OPT_LARGE_FONT) != 0;
        out->forecast_axis = (uint8_t) (word & GRAPH_OPT_AXIS_MASK);
    }
#endif
#if !defined(PBL_PLATFORM_APLITE)
    // Not on aplite, like the fields (config.h): the phone omits the tuple for an
    // aplite watch too (clay-payload gates it with the threshold blob). Without it,
    // both date formats stay 0 = Auto.
    const Tuple *clay_date_format_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_DATE_FORMAT_UINT8);
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
    // Without it, hr_scale stays 0 = unset, and health_graph_layer falls back to its own
    // HEALTH_HR_LO/HEALTH_HR_HI.
    const Tuple *clay_hr_scale_tuple = dict_find(iterator, MESSAGE_KEY_CLAY_HR_SCALE);
    if (clay_hr_scale_tuple) {
        // Read as int32 (like the colour tuples): PKJS sends numbers as 32-bit,
        // and the packed value can exceed int16's range (hi 220 -> 56 3xx).
        out->hr_scale = (uint16_t) clay_hr_scale_tuple->value->int32;
    }
#endif
    return true;
}
