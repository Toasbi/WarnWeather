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
// plot widths the host suite sweeps: W = EMERY_W - graph_left, from B's collapsed edge at
// GOTHIC_14 hour labels (graph_left 8, W 190) to past any label strip the watch measures
// (graph_left 53, W 145). W_MAX_SWEPT runs the invariants a little wider still.
#define EMERY_W 198
#define W_MIN 145
#define W_MAX 190
#define W_MAX_SWEPT 196
// The tightest hour-label spacing emery ships: the health graph's pitch 7 x 3 slots.
#define LABEL_MIN_PX 21
#define TICK_MIN_PX 3

// The hours whose bar is wholly on screen in a plot `w` px wide: slot i's bar ends at
// i * pitch + tick 1 + pad + bar - 1.
static int whole_hours(ForecastSpan s, int w) {
    const int pitch = forecast_span_pitch(s);
    int whole = 0;
    for (int i = 0; i < s.slots; ++i) {
        if (i * pitch + s.bar_pad + s.bar_w <= w - 1) { ++whole; }
    }
    return whole;
}

// The long class's rule, written out on its own: the smallest pitch whose n columns reach the
// right edge, held to [3, 8], 1 px pads from pitch 6.
static int cover_pitch(int n, int w) {
    int p = (w + n - 1) / n;
    return p < 3 ? 3 : (p > 8 ? 8 : p);
}

static void test_classes(void) {
    for (int w = W_MIN; w <= W_MAX; ++w) {
        for (int n = 2; n <= FORECAST_MAX_ENTRIES; ++n) {
            const ForecastSpan s = forecast_span(n, w);
            const int pitch = forecast_span_pitch(s);
            if (n <= FORECAST_SPAN_HALF_SENT) {
                // 12 h: n slots (the phone sends 14), pitch W / 12 within [11, 15], 2 px pads.
                int want = w / 12;
                want = want < 11 ? 11 : (want > 15 ? 15 : want);
                CHECK(s.slots == n && s.bar_pad == 2 && pitch == want && s.bar_w == want - 5
                      && s.label_every == 2 && s.tick_every == 1,
                      "12 h n=%d w=%d: {%d %d %d %d %d}", n, w, s.slots, s.bar_pad, s.bar_w,
                      s.label_every, s.tick_every);
            } else if (n <= FORECAST_SPAN_DAY_SLOTS) {
                // 24 h is today's emery grid, whatever the width: pitch 8, bar 5, pad 1, a label
                // every 3rd slot and a small tick on every slot.
                CHECK(s.slots == 24 && s.bar_pad == 1 && s.bar_w == 5 && s.label_every == 3
                      && s.tick_every == 1, "24 h n=%d w=%d", n, w);
                const ChartDef d = forecast_grid_def_for(s);
                CHECK(memcmp(&d, &FORECAST_GRID_DEF, sizeof(d)) == 0,
                      "n=%d: the 24 h class is FORECAST_GRID_DEF", n);
            } else {
                // Long: one slot per hour received, the cover rule.
                const int p = cover_pitch(n, w);
                const int pad = p >= 6 ? 1 : 0;
                CHECK(s.slots == n && pitch == p && s.bar_pad == pad && s.bar_w == p - 1 - 2 * pad,
                      "long n=%d w=%d: pitch %d want %d", n, w, pitch, p);
                const int le = p == 3 ? 8 : (p <= 5 ? 6 : (p == 6 ? 4 : 3));
                CHECK(s.label_every == le && s.tick_every == (p <= 4 ? 2 : 1),
                      "long n=%d w=%d: cadence %d/%d", n, w, s.label_every, s.tick_every);
            }
            // The ChartDef the span builds: its slots, pad and bar, FORECAST_GRID_DEF's tick and
            // insets.
            const ChartDef d = forecast_grid_def_for(s);
            CHECK(d.num_slots == s.slots && d.bar_pad == s.bar_pad && d.bar_w == s.bar_w
                  && d.tick_w == 1 && d.inset_left == 1 && d.inset_bottom == 1
                  && chart_def_pitch(&d) == pitch, "n=%d: forecast_grid_def_for", n);
        }
    }
    // Spot rows at the default layout's plot (W 174: GOTHIC_24 two-digit labels and the health
    // graph's "0.x" claim, graph_left 24).
    ForecastSpan s = forecast_span(65, 174);
    CHECK(forecast_span_pitch(s) == 3 && s.bar_w == 2 && s.bar_pad == 0, "65 at 174");
    CHECK(forecast_span_pitch(forecast_span(58, 174)) == 3, "58 at 174");
    CHECK(forecast_span_pitch(forecast_span(57, 174)) == 4, "57 at 174");
    s = forecast_span(48, 174);
    CHECK(forecast_span_pitch(s) == 4 && s.bar_w == 3 && s.bar_pad == 0, "48 at 174");
    s = forecast_span(25, 174);
    CHECK(forecast_span_pitch(s) == 7 && s.bar_pad == 1 && s.bar_w == 4, "25 at 174");
    // At its widest a 25-hour feed is the 24 h look: pitch 8, pad 1, bar 5.
    s = forecast_span(25, 190);
    CHECK(forecast_span_pitch(s) == 8 && s.bar_pad == 1 && s.bar_w == 5, "25 at 190");
    // 12 h's two fit ends.
    CHECK(forecast_span_pitch(forecast_span(14, W_MAX)) == 15, "12 h at 190");
    CHECK(forecast_span_pitch(forecast_span(14, W_MIN)) == 12, "12 h at 145");
}

// The owner's rules, over every plot width a little past the real ones and every count sent.
static void test_invariants(void) {
    for (int w = W_MIN; w <= W_MAX_SWEPT; ++w) {
        for (int n = 2; n <= FORECAST_MAX_ENTRIES; ++n) {
            const ForecastSpan s = forecast_span(n, w);
            const int p = forecast_span_pitch(s);
            // The floors: never a pitch under 3 or a bar under 2 ("that's the min width").
            CHECK(p >= 3 && s.bar_w >= 2, "n=%d w=%d: pitch %d bar %d", n, w, p, s.bar_w);
            CHECK(s.label_every * p >= LABEL_MIN_PX && s.tick_every * p >= TICK_MIN_PX,
                  "n=%d w=%d: labels %d px, ticks %d px apart", n, w, s.label_every * p,
                  s.tick_every * p);
            CHECK(s.label_every % s.tick_every == 0, "n=%d: big ticks sit on the small lattice", n);
            CHECK(n <= s.slots, "n=%d: every entry has a slot", n);
            if (n > FORECAST_SPAN_DAY_SLOTS) {
                // A divisor of 24, so the labels keep the same clock hours every day.
                CHECK(24 % s.label_every == 0, "n=%d w=%d: label every %d", n, w, s.label_every);
                // No blank tail: the n columns reach the edge (the area fill and the bars do),
                // unless the pitch is at its max; and the smallest such pitch.
                CHECK(n * p >= w || p == FORECAST_SPAN_LONG_PITCH_MAX, "n=%d w=%d: tail", n, w);
                CHECK(n * (p - 1) < w || p == FORECAST_SPAN_LONG_PITCH_MIN,
                      "n=%d w=%d: pitch %d not the smallest", n, w, p);
            }
            if (n == FORECAST_MAX_ENTRIES && w <= 195) {
                CHECK(p == 3, "a full feed draws pitch 3 at w=%d", w);
            }
            if (n == FORECAST_SPAN_HALF_SENT && w <= W_MAX) {
                // 12 whole columns fit, and the 14th hour's vertex (13 * p) reaches the edge.
                CHECK(12 * p <= w && w <= 13 * p, "12 h w=%d: pitch %d", w, p);
            }
        }
    }
}

// What each option shows, by layout (plan A2's USER_FACING table): whole hours on the long
// span's full feed, and 24 h's whole / started columns (temp_axis_drawn_entries counts the
// started ones, the hours the scale and the labels cover).
static void test_visible(void) {
    static const int ws[] = { 190, 189, 181, 180, 179, 176, 174, 173, 170, 167, 165 };
    static const int long_whole[] = { 63, 63, 60, 60, 59, 58, 58, 57, 56, 55, 55 };
    static const int day_whole[] = { 23, 23, 22, 22, 22, 22, 21, 21, 21, 21, 20 };
    for (unsigned k = 0; k < sizeof(ws) / sizeof(ws[0]); ++k) {
        const int w = ws[k];
        const ForecastSpan l = forecast_span(65, w);
        CHECK(whole_hours(l, w) == long_whole[k], "65 at w=%d: %d whole, want %d", w,
              whole_hours(l, w), long_whole[k]);
        const int started = temp_axis_drawn_entries(65, w, forecast_span_pitch(l));
        CHECK(started == (w + 2) / 3 && started - whole_hours(l, w) <= 1,
              "65 at w=%d: %d started", w, started);
        const ForecastSpan d = forecast_span(24, w);
        CHECK(whole_hours(d, w) == day_whole[k], "24 at w=%d: %d whole, want %d", w,
              whole_hours(d, w), day_whole[k]);
    }
    // "58 h": the default layout's count (W 174, graph_left 24).
    CHECK(whole_hours(forecast_span(65, 174), 174) == 58, "the label's 58");
    // 12 h at W 180 (Beside, GOTHIC_18 two-digit labels): exactly 12 columns; at W 167, 13.
    CHECK(whole_hours(forecast_span(14, 180), 180) == 12
          && temp_axis_drawn_entries(14, 180, 15) == 12, "12 h at 180");
    CHECK(whole_hours(forecast_span(14, 167), 167) == 13, "12 h at 167");
    // A short feed: OWM's 48 hours at the default draw pitch 4, 43 whole.
    CHECK(whole_hours(forecast_span(48, 174), 174) == 43, "48 at 174");
}

static void test_label_end(void) {
    CHECK(forecast_span_label_end(3, 174) == 57, "(3, 174) -> %d", forecast_span_label_end(3, 174));
    CHECK(forecast_span_label_end(14, 174) == 13, "(14, 174) -> %d",
          forecast_span_label_end(14, 174));
    // The last labelled slot's ink (to the tick + FORECAST_SPAN_LABEL_INK_R) ends on screen; the
    // next one's would not.
    for (int w = W_MIN; w <= W_MAX_SWEPT; ++w) {
        for (int p = 3; p <= 15; ++p) {
            const int e = forecast_span_label_end(p, w);
            CHECK((e - 1) * p + FORECAST_SPAN_LABEL_INK_R <= w - 1
                  && w - 1 < e * p + FORECAST_SPAN_LABEL_INK_R, "w=%d p=%d: end %d", w, p, e);
        }
    }
}

static void test_cadence(void) {
    ChartAxisSlot slots[FORECAST_MAX_ENTRIES];
    const struct tm t = start_at(14);
    // The long span at (8, 2) from 14:00: labels 14, 22, 6, ... on every 8th slot; a small tick
    // on the even slots between, none on the odd ones. label_end 57 (W 174): slot 56 is the
    // last label, slot 64 keeps its big tick without one.
    forecast_grid_fill_axis_every(slots, 65, &t, 8, 2, 57);
    for (int i = 0; i < 65; ++i) {
        if (i % 8 == 0) {
            char want[4];
            snprintf(want, sizeof(want), "%d", (14 + i) % 24);
            CHECK(slots[i].tick == TICK_BIG, "long slot %d: big tick", i);
            CHECK(i < 57 ? strcmp(slots[i].label, want) == 0 : slots[i].label[0] == '\0',
                  "long slot %d: '%s' want '%s'", i, slots[i].label, i < 57 ? want : "");
        } else {
            CHECK(slots[i].label[0] == '\0', "long slot %d has no label", i);
            CHECK(slots[i].tick == (i % 2 == 0 ? TICK_SMALL : TICK_NONE), "long slot %d tick", i);
        }
    }
    CHECK(strcmp(slots[8].label, "22") == 0 && strcmp(slots[16].label, "6") == 0
          && strcmp(slots[56].label, "22") == 0 && slots[64].label[0] == '\0', "long labels");
    // 12 h at (2, 1): a label on every even slot before label_end 13, a small tick on every odd.
    forecast_grid_fill_axis_every(slots, 14, &t, 2, 1, 13);
    for (int i = 0; i < 14; ++i) {
        CHECK((i % 2 == 0 && i < 13) == (slots[i].label[0] != '\0'), "12 h slot %d label", i);
        CHECK(slots[i].tick == (i % 2 == 0 ? TICK_BIG : TICK_SMALL), "12 h slot %d tick", i);
    }
    // The wrapper the health graph calls is the (3, 1) cadence, emery's 24 h rule, every label.
    ChartAxisSlot every[24];
    forecast_grid_fill_axis_slots(slots, 24, 40, 8, 198, &t);
    forecast_grid_fill_axis_every(every, 24, &t, 3, 1, 24);
    for (int i = 0; i < 24; ++i) {
        CHECK(slots[i].tick == every[i].tick && strcmp(slots[i].label, every[i].label) == 0,
              "24 h wrapper slot %d", i);
        CHECK(slots[i].tick == (i % 3 == 0 ? TICK_BIG : TICK_SMALL), "24 h slot %d tick", i);
        CHECK((i % 3 == 0) == (slots[i].label[0] != '\0'), "24 h slot %d label", i);
    }
}

// The left axis's numbers on the graph or off (BETA, temp_axis_pad.h THE NUMBERS ON THE GRAPH):
// the strip goes to the plot, which starts temp_axis_collapsed_inset columns in, so the long
// span shows more hours there ("more room, more hours") and the 12 h span widens to its max.
static void test_collapsed(void) {
    // The hour labels' fonts: two GOTHIC_14 digits measure 12 px (Larger graph fonts off), two
    // GOTHIC_18 digits 14 px (on).
    static const int hour_ws[] = { 12, 14 }, insets[] = { 8, 9 }, ws[] = { 190, 189 };
    for (int k = 0; k < 2; ++k) {
        const int inset = temp_axis_collapsed_inset(hour_ws[k]);
        const int w = EMERY_W - inset;
        CHECK(inset == insets[k] && w == ws[k], "hour_w=%d: inset %d", hour_ws[k], inset);
        const ForecastSpan l = forecast_span(65, w);
        CHECK(forecast_span_pitch(l) == 3 && whole_hours(l, w) == 63, "65 at %d", w);
        CHECK(64 * 3 >= w, "hour 64's vertex (x 192) lies past the edge at %d", w);
        const ForecastSpan h = forecast_span(14, w);
        CHECK(forecast_span_pitch(h) == 15 && whole_hours(h, w) >= 12, "14 at %d", w);
    }
    for (int hour_w = 0; hour_w <= 22; ++hour_w) {
        const int w = EMERY_W - temp_axis_collapsed_inset(hour_w);
        for (int n = 2; n <= FORECAST_MAX_ENTRIES; ++n) {
            const ForecastSpan s = forecast_span(n, w);
            const int p = forecast_span_pitch(s);
            CHECK(p >= 3 && s.bar_w >= 2, "hour_w=%d n=%d: floors", hour_w, n);
            CHECK(n <= FORECAST_SPAN_DAY_SLOTS || p == cover_pitch(n, w),
                  "hour_w=%d n=%d: the cover rule", hour_w, n);
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
    CHECK(FORECAST_NIGHTS_MAX == 3, "FORECAST_NIGHTS_MAX %d", FORECAST_NIGHTS_MAX);
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
    CHECK(FORECAST_MAX_ENTRIES == 65 && FORECAST_MAX_ENTRIES == (190 + 2) / 3 + 1,
          "FORECAST_MAX_ENTRIES %d", FORECAST_MAX_ENTRIES);
    CHECK(FORECAST_NIGHTS_MAX == 4, "FORECAST_NIGHTS_MAX %d", FORECAST_NIGHTS_MAX);
    test_classes();
    test_invariants();
    test_visible();
    test_label_end();
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
