// Host-compiled test for src/c/appendix/forecast_span.h (header-only, SDK-free) and the pure
// half of src/c/appendix/forecast_grid.c: the forecast graph's span classes, the grid each
// draws and the hour axis's cadence. forecast_layer.c is SDK-bound; what it reads of the span
// is pinned here. Built twice by scripts/test-c.sh: -DPBL_PLATFORM_BASALT (every platform but
// emery: FORECAST_MAX_ENTRIES stays 24 and the axis keeps today's rule) and
// -DPBL_PLATFORM_EMERY (the span classes).
//
// The unity pattern: forecast_grid.c is #included, so <stdio.h> must come first (the stub
// pebble.h has no snprintf), and config_axis_hour is defined here (config.c is SDK-bound).
#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "c/appendix/config.h"
int config_axis_hour(int hour) { return hour % 24; }
#include "c/appendix/forecast_grid.c"
#include "c/appendix/temp_axis_pad.h"   // temp_axis_drawn_entries: the columns on screen

static int s_failures = 0;
#define CHECK(cond, ...) do { if (!(cond)) { printf("FAIL %s:%d: ", __FILE__, __LINE__); \
    printf(__VA_ARGS__); printf("\n"); s_failures++; } } while (0)

// 14:00, the start hour of every cadence vector below.
static struct tm start_at(int hour) {
    struct tm t;
    memset(&t, 0, sizeof(t));
    t.tm_hour = hour;
    return t;
}

#if defined(PBL_PLATFORM_EMERY)
// The forecast band (test/c/layout_test.c goldens: the emery bottom layer is 198 px) and the
// graph_left range: the narrowest label strip (BOTTOM_VIEW_LABEL_STRIP_MIN_W 15 + the 2 px
// gap) up to past any label the strip measures (a 3-character label like "-12" in GOTHIC_24).
#define EMERY_W 198
#define GRAPH_LEFT_MIN 17
#define GRAPH_LEFT_MAX 53
// The tightest hour-label spacing emery ships: the health graph's pitch 7 x 3 slots.
#define LABEL_MIN_PX 21
#define TICK_MIN_PX 3

static void test_classes(void) {
    for (int gl = GRAPH_LEFT_MIN; gl <= GRAPH_LEFT_MAX; ++gl) {
        const int visible = EMERY_W - gl;
        for (int n = 2; n <= FORECAST_MAX_ENTRIES; ++n) {
            const ForecastSpan s = forecast_span(n, visible);
            const int want = n <= 12 ? 12 : (n <= 24 ? 24 : n);
            CHECK(s.slots == want, "n=%d gl=%d slots %d want %d", n, gl, s.slots, want);
            CHECK(n <= s.slots, "n=%d: every entry has a slot", n);
            const int pitch = forecast_span_pitch(s);
            CHECK(s.label_every * pitch >= LABEL_MIN_PX, "n=%d gl=%d labels %d px apart", n, gl,
                  s.label_every * pitch);
            CHECK(s.tick_every * pitch >= TICK_MIN_PX, "n=%d gl=%d ticks %d px apart", n, gl,
                  s.tick_every * pitch);
            CHECK(s.label_every % s.tick_every == 0, "n=%d: big ticks sit on the small lattice", n);
            CHECK(s.bar_w >= 2, "n=%d: a bar is never a hairline", n);
            if (n > 24) {
                // 48 h: a 3 px pitch, 2 px bars and no pad, a label every 8th slot, a tick every
                // 2nd; every column and the frame's closing column fit right of the strip.
                CHECK(s.bar_pad == 0 && s.bar_w == 2 && pitch == 3, "n=%d: the 48 h grid", n);
                CHECK(s.label_every == 8 && s.tick_every == 2, "n=%d: the 48 h cadence", n);
                CHECK(n * pitch + 1 <= visible, "n=%d gl=%d: %d px past %d", n, gl,
                      n * pitch + 1, visible);
                CHECK(temp_axis_drawn_entries(n, visible, pitch) == n, "n=%d gl=%d drawn", n, gl);
            } else if (n > 12) {
                // 24 h is today's emery grid, whatever the width: pitch 8, bar 5, pad 1, a label
                // every 3rd slot and a small tick on every slot (temp_axis_pad_test.c).
                CHECK(s.bar_pad == 1 && s.bar_w == 5 && pitch == 8, "n=%d: the 24 h grid", n);
                CHECK(s.label_every == 3 && s.tick_every == 1, "n=%d: the 24 h cadence", n);
                const ChartDef d = forecast_grid_def_for(s);
                CHECK(memcmp(&d, &FORECAST_GRID_DEF, sizeof(d)) == 0,
                      "n=%d: the 24 h class is FORECAST_GRID_DEF", n);
            } else {
                // 12 h fills the width: its 12 columns and the closing column fit, and one more
                // px of pitch would not (or it sits at its max); 2 px pads, bars 6 px or more.
                CHECK(pitch >= FORECAST_SPAN_HALF_PITCH_MIN && pitch <= FORECAST_SPAN_HALF_PITCH_MAX,
                      "n=%d gl=%d pitch %d", n, gl, pitch);
                CHECK(12 * pitch + 1 <= visible, "n=%d gl=%d: 12 x %d + 1 past %d", n, gl, pitch,
                      visible);
                CHECK(pitch == FORECAST_SPAN_HALF_PITCH_MAX || 12 * (pitch + 1) + 1 > visible,
                      "n=%d gl=%d: pitch %d leaves room", n, gl, pitch);
                CHECK(s.bar_pad == FORECAST_SPAN_HALF_PAD && s.bar_w >= 6 && s.bar_w == pitch - 5,
                      "n=%d gl=%d: bar %d", n, gl, s.bar_w);
                CHECK(s.label_every == 2 && s.tick_every == 1, "n=%d: the 12 h cadence", n);
                CHECK(temp_axis_drawn_entries(12, visible, pitch) == 12, "n=%d gl=%d drawn", n, gl);
            }
            // The ChartDef the span builds: its slots, pad and bar, FORECAST_GRID_DEF's tick and
            // insets.
            const ChartDef d = forecast_grid_def_for(s);
            CHECK(d.num_slots == s.slots && d.bar_pad == s.bar_pad && d.bar_w == s.bar_w
                  && d.tick_w == 1 && d.inset_left == 1 && d.inset_bottom == 1
                  && chart_def_pitch(&d) == pitch, "n=%d: forecast_grid_def_for", n);
        }
    }
    // The widest label strip still fits all 48 columns, with the closing column flush right.
    CHECK(48 * 3 + 1 == EMERY_W - GRAPH_LEFT_MAX, "48 h at the widest strip");
    // The two fit ends of the 12 h class.
    CHECK(forecast_span_pitch(forecast_span(12, EMERY_W - GRAPH_LEFT_MIN)) == 15, "12 h at 17");
    CHECK(forecast_span_pitch(forecast_span(12, EMERY_W - GRAPH_LEFT_MAX)) == 12, "12 h at 53");
}

static void test_cadence(void) {
    ChartAxisSlot slots[FORECAST_MAX_ENTRIES];
    const struct tm t = start_at(14);
    // 48 h at (8, 2) from 14:00: labels 14, 22, 6, 14, 22, 6 on every 8th slot; a small tick on
    // the even slots between, none on the odd ones.
    forecast_grid_fill_axis_every(slots, 48, &t, 8, 2);
    for (int i = 0; i < 48; ++i) {
        if (i % 8 == 0) {
            char want[4];
            snprintf(want, sizeof(want), "%d", (14 + i) % 24);
            CHECK(slots[i].tick == TICK_BIG && strcmp(slots[i].label, want) == 0,
                  "48 h slot %d: '%s' want '%s'", i, slots[i].label, want);
        } else {
            CHECK(slots[i].label[0] == '\0', "48 h slot %d has no label", i);
            CHECK(slots[i].tick == (i % 2 == 0 ? TICK_SMALL : TICK_NONE), "48 h slot %d tick", i);
        }
    }
    CHECK(strcmp(slots[8].label, "22") == 0 && strcmp(slots[16].label, "6") == 0, "48 h labels");
    // 12 h at (2, 1): a label on every even slot, a small tick on every odd one.
    forecast_grid_fill_axis_every(slots, 12, &t, 2, 1);
    for (int i = 0; i < 12; ++i) {
        CHECK((i % 2 == 0) == (slots[i].label[0] != '\0'), "12 h slot %d label", i);
        CHECK(slots[i].tick == (i % 2 == 0 ? TICK_BIG : TICK_SMALL), "12 h slot %d tick", i);
    }
    // The wrapper the health graph calls is the (3, 1) cadence, emery's 24 h rule.
    ChartAxisSlot every[24];
    forecast_grid_fill_axis_slots(slots, 24, 40, 8, 198, &t);
    forecast_grid_fill_axis_every(every, 24, &t, 3, 1);
    for (int i = 0; i < 24; ++i) {
        CHECK(slots[i].tick == every[i].tick && strcmp(slots[i].label, every[i].label) == 0,
              "24 h wrapper slot %d", i);
        CHECK(slots[i].tick == (i % 3 == 0 ? TICK_BIG : TICK_SMALL), "24 h slot %d tick", i);
    }
}

// The left axis's numbers on the graph or off (BETA, temp_axis_pad.h THE NUMBERS ON THE GRAPH):
// the strip goes to the plot, which starts temp_axis_collapsed_inset columns in, a narrower
// edge than any strip. Every span class still puts every hour on screen there, and 12 h's
// fitted pitch only grows (to its max) with the extra width.
static void test_collapsed(void) {
    for (int hour_w = 0; hour_w <= 22; ++hour_w) {
        const int inset = temp_axis_collapsed_inset(hour_w);
        const int visible = EMERY_W - inset;
        CHECK(inset < GRAPH_LEFT_MIN, "hour_w=%d: inset %d", hour_w, inset);
        for (int n = 2; n <= FORECAST_MAX_ENTRIES; ++n) {
            const ForecastSpan s = forecast_span(n, visible);
            const int pitch = forecast_span_pitch(s);
            // 12 h and 48 h fit with the frame's closing column; 24 h is today's fixed grid,
            // whose last cell may run past the edge (its column starts on screen: drawn).
            CHECK((n > 12 && n <= 24) || s.slots * pitch + 1 <= visible,
                  "n=%d hour_w=%d: %d px past %d", n, hour_w, s.slots * pitch + 1, visible);
            CHECK(temp_axis_drawn_entries(n, visible, pitch) == n, "n=%d hour_w=%d drawn", n,
                  hour_w);
            if (n <= 12) {
                CHECK(pitch >= forecast_span_pitch(forecast_span(n, EMERY_W - GRAPH_LEFT_MIN)),
                      "n=%d hour_w=%d: 12 h pitch %d", n, hour_w, pitch);
            }
        }
    }
}
#else
// Every other platform: the forecast keeps today's 24 slots and today's axis rule (a label on
// every 3rd slot unless the screen edge would slice a two-digit one, a small tick on the
// midpoint after each).
static void test_basalt(void) {
    CHECK(FORECAST_MAX_ENTRIES == 24 && FORECAST_MAX_ENTRIES == MAX_BOTTOM_VIEW_ENTRIES,
          "FORECAST_MAX_ENTRIES %d", FORECAST_MAX_ENTRIES);
    ChartAxisSlot slots[FORECAST_MAX_ENTRIES];
    const struct tm t = start_at(14);
    // basalt's 144 px band from origin 20 at pitch 6: slot 21's label (hour 11) starts at
    // 20 + 126 - 3 = 143, sliced, so it is dropped.
    forecast_grid_fill_axis_slots(slots, 24, 20, 6, 144, &t);
    for (int i = 0; i < 24; ++i) {
        const int hour = (14 + i) % 24;
        const bool sliced = hour >= 10 && (20 + i * 6 - 3) + 8 > 144;
        CHECK((i % 3 == 0 && !sliced) == (slots[i].label[0] != '\0'), "slot %d label", i);
        CHECK(slots[i].tick == (i % 3 == 1 ? TICK_SMALL : TICK_NONE), "slot %d tick", i);
    }
    CHECK(slots[21].label[0] == '\0' && strcmp(slots[18].label, "8") == 0, "the edge drop");
}
#endif

int main(void) {
#if defined(PBL_PLATFORM_EMERY)
    CHECK(FORECAST_MAX_ENTRIES == 48, "FORECAST_MAX_ENTRIES %d", FORECAST_MAX_ENTRIES);
    test_classes();
    test_cadence();
    test_collapsed();
#else
    test_basalt();
#endif
    if (s_failures) {
        printf("forecast_span_test: %d failure(s)\n", s_failures);
        return 1;
    }
#if defined(PBL_PLATFORM_EMERY)
    printf("forecast_span_test (emery) OK\n");
#else
    printf("forecast_span_test OK\n");
#endif
    return 0;
}
