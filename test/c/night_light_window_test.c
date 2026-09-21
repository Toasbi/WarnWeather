// Host tests for the night-light window predicate (night_light.h's
// night_light_hour_in_window) and its colour packer (night_light_rgb888) — the two
// decisions in the "Dim backlight" apply path that are pure integer arithmetic.
//
// appendix/night_light.c itself cannot be host-compiled: it drives the LED through
// applib (light_set_color_rgb888 / the app focus service) and reads flash through
// persist.h. That is exactly why the window rule lives in the header as a static
// inline — the date_format.h / status_icon_weight.h / night_light_wire_ok pattern —
// so the one part that can be executed before it reaches hardware is executed here.
//
// Built TWICE by scripts/test-c.sh: plain, and with -DWW_COLOR_BACKLIGHT (the emery
// build's flag). The assertions are identical on purpose — the window arithmetic is
// platform-independent — while the two builds prove both arms of the header parse
// and, in particular, that the gated declarations do not drag <pebble.h> or persist
// into a header the predicate has to stay host-compilable through.
#include <stdint.h>
#include <stdio.h>

#include "c/appendix/night_light.h"

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

static int in_window(int hour, int start, int end) {
    return night_light_hour_in_window(hour, start, end) ? 1 : 0;
}

// Every Nighttime feature owns a From/To pair the user picks freely, and an evening
// start like 22:00-05:59 is the ordinary way to say "night" — so the wrapping case is
// the common one, not the exotic one. (The dim window's own selects default to 0..7,
// which does not wrap; both shapes have to work.)
static void wraps_past_midnight(void) {
    // Inside, on both sides of the wrap.
    expect("wrap_22", in_window(22, 22, 6), 1);
    expect("wrap_23", in_window(23, 22, 6), 1);
    expect("wrap_00", in_window(0, 22, 6), 1);
    expect("wrap_03", in_window(3, 22, 6), 1);
    expect("wrap_05", in_window(5, 22, 6), 1);
    // Outside, across the whole daytime span.
    expect("wrap_06", in_window(6, 22, 6), 0);
    expect("wrap_12", in_window(12, 22, 6), 0);
    expect("wrap_21", in_window(21, 22, 6), 0);
}

static void does_not_wrap(void) {
    expect("plain_00", in_window(0, 1, 5), 0);
    expect("plain_01", in_window(1, 1, 5), 1);
    expect("plain_03", in_window(3, 1, 5), 1);
    expect("plain_04", in_window(4, 1, 5), 1);
    expect("plain_05", in_window(5, 1, 5), 0);
    expect("plain_23", in_window(23, 1, 5), 0);

    // A daytime window is a legal pick too — nothing in the rule says "night".
    expect("day_08", in_window(8, 9, 17), 0);
    expect("day_09", in_window(9, 9, 17), 1);
    expect("day_16", in_window(16, 9, 17), 1);
    expect("day_17", in_window(17, 9, 17), 0);
}

// The single most load-bearing asymmetry: start is INCLUSIVE, end is EXCLUSIVE.
// 22..6 must light 22:00 and must NOT light 06:00 — an off-by-one here is an hour of
// white light at exactly the wrong end, or an hour of red after waking.
static void boundaries_are_half_open(void) {
    expect("start_inclusive_plain", in_window(9, 9, 17), 1);
    expect("end_exclusive_plain", in_window(17, 9, 17), 0);
    expect("start_inclusive_wrap", in_window(22, 22, 6), 1);
    expect("end_exclusive_wrap", in_window(6, 22, 6), 0);

    // Every hour is some window's start and some other window's end; check both roles
    // right around the clock so no single boundary is special-cased by accident.
    for (int h = 0; h < 24; h++) {
        const int next = (h + 1) % 24;
        char name[48];
        // [h, h+1) covers exactly the one hour h.
        snprintf(name, sizeof(name), "one_hour_window_%d_covers", h);
        expect(name, in_window(h, h, next), 1);
        snprintf(name, sizeof(name), "one_hour_window_%d_excludes_end", h);
        expect(name, in_window(next, h, next), 0);
    }
}

// start == end is the "never" sentinel, and it is ALSO how the feature is switched
// off: the phone zeroes all five bytes when the "Dim backlight" toggle is off, so
// the watch reads the state out of the window and there is no enabled flag. If this
// ever returned true for some hour, the toggle would stop working.
static void equal_bounds_mean_never(void) {
    // The OFF tuple the phone actually sends: 0,0,0,0,0.
    for (int h = 0; h < 24; h++) {
        char name[48];
        snprintf(name, sizeof(name), "off_tuple_hour_%d", h);
        expect(name, in_window(h, 0, 0), 0);
    }
    // A user-configured zero-length window is the same rule, at any hour of the day.
    for (int bound = 0; bound < 24; bound++) {
        for (int h = 0; h < 24; h++) {
            if (in_window(h, bound, bound)) {
                printf("FAIL zero_length_%d covers hour %d\n", bound, h);
                s_failures++;
            }
        }
    }
}

// Midnight and 23:00 are where a naive start <= hour < end implementation breaks, so
// pin them in every role they can play.
static void midnight_and_last_hour(void) {
    expect("hour0_in_0_to_7", in_window(0, 0, 7), 1);     // the dim window's own default
    expect("hour6_in_0_to_7", in_window(6, 0, 7), 1);
    expect("hour7_in_0_to_7", in_window(7, 0, 7), 0);
    expect("hour23_in_0_to_7", in_window(23, 0, 7), 0);

    expect("hour23_in_23_to_0", in_window(23, 23, 0), 1); // a single hour, via the wrap
    expect("hour0_in_23_to_0", in_window(0, 23, 0), 0);
    expect("hour22_in_23_to_0", in_window(22, 23, 0), 0);

    expect("hour0_in_0_to_23", in_window(0, 0, 23), 1);   // all but the last hour
    expect("hour22_in_0_to_23", in_window(22, 0, 23), 1);
    expect("hour23_in_0_to_23", in_window(23, 0, 23), 0);

    expect("hour0_in_23_to_1", in_window(0, 23, 1), 1);   // wrap straddling midnight
    expect("hour1_in_23_to_1", in_window(1, 23, 1), 0);
}

// An independent model of the same rule, deliberately written the other way round:
// walk forward hour by hour from `start` for as many hours as the window spans,
// instead of comparing against the bounds. (end - start + 24) % 24 is 0 exactly when
// start == end, so "never" falls out rather than being special-cased.
static int ref_in_window(int hour, int start, int end) {
    const int span = (end - start + 24) % 24;
    for (int i = 0; i < span; i++) {
        if ((start + i) % 24 == hour) { return 1; }
    }
    return 0;
}

static void matches_reference_for_every_clock(void) {
    int covered = 0;
    for (int start = 0; start < 24; start++) {
        for (int end = 0; end < 24; end++) {
            for (int hour = 0; hour < 24; hour++) {
                const int got = in_window(hour, start, end);
                const int want = ref_in_window(hour, start, end);
                if (got != want) {
                    printf("FAIL sweep hour %d in [%d,%d): got %d want %d\n",
                           hour, start, end, got, want);
                    s_failures++;
                }
                covered += want;
            }
        }
    }
    // Every (start, end) pair spans (end - start + 24) % 24 hours, so each of the 24
    // starts contributes 0 + 1 + ... + 23 = 276 lit hours: 24 * 276. Pins the sweep
    // itself against a reference that silently answered "never" everywhere.
    expect("sweep_total_lit_hours", covered, 24 * 276);
}

// The colour bytes are RAW 0..255 channels and must reach the LED through the
// rgb888 variant with all 8 bits intact; light_set_color(GColor) would keep 2.
static void packs_raw_channels(void) {
    expect("pack_default_red", (int) night_light_rgb888(96, 0, 0), 0x600000);
    expect("pack_black", (int) night_light_rgb888(0, 0, 0), 0x000000);
    expect("pack_white", (int) night_light_rgb888(255, 255, 255), 0xFFFFFF);
    expect("pack_channel_order", (int) night_light_rgb888(0x12, 0x34, 0x56), 0x123456);
    // No channel bleeds into another, and the high byte stays clear.
    expect("pack_red_only", (int) night_light_rgb888(255, 0, 0), 0xFF0000);
    expect("pack_green_only", (int) night_light_rgb888(0, 255, 0), 0x00FF00);
    expect("pack_blue_only", (int) night_light_rgb888(0, 0, 255), 0x0000FF);
    for (int v = 0; v < 256; v++) {
        const uint32_t packed = night_light_rgb888((uint8_t) v, (uint8_t) v, (uint8_t) v);
        if ((packed >> 24) != 0) {
            printf("FAIL pack_high_byte_set for %d\n", v);
            s_failures++;
        }
        if ((int) ((packed >> 16) & 0xFF) != v || (int) ((packed >> 8) & 0xFF) != v
                || (int) (packed & 0xFF) != v) {
            printf("FAIL pack_roundtrip for %d\n", v);
            s_failures++;
        }
    }
}

int main(void) {
    wraps_past_midnight();
    does_not_wrap();
    boundaries_are_half_open();
    equal_bounds_mean_never();
    midnight_and_last_hour();
    matches_reference_for_every_clock();
    packs_raw_channels();
    if (s_failures) { printf("%d failure(s)\n", s_failures); return 1; }
    printf("night_light_window_test OK\n");
    return 0;
}
