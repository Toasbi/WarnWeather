// Host-compiled test for src/c/appendix/forecast_span.h (header-only, SDK-free) and the pure
// half of src/c/appendix/forecast_grid.c: the forecast graph's span classes, the grid each
// draws and the hour axis's marks. forecast_layer.c is SDK-bound; what it reads of the span
// is pinned here. Built twice by scripts/test-c.sh: -DPBL_PLATFORM_BASALT (every platform but
// emery: FORECAST_MAX_ENTRIES stays 24 and the axis keeps today's rule) and
// -DPBL_PLATFORM_EMERY (the span classes).
//
// The unity pattern: forecast_grid.c is #included, so <stdio.h> must come first (the stub
// pebble.h has no snprintf), and config_axis_hour is defined here (config.c is SDK-bound).
// _POSIX_C_SOURCE for setenv/tzset: the axis reads each slot's local hour (localtime), and the
// daylight-saving cases below set their own zone.
#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "c/appendix/config.h"
int config_axis_hour(int hour) { return hour % 24; }
#include "c/appendix/forecast_grid.c"
#include "c/appendix/temp_axis_pad.h"   // temp_axis_drawn_entries: the columns on screen

static int s_failures = 0;
#define CHECK(cond, ...) do { if (!(cond)) { printf("FAIL %s:%d: ", __FILE__, __LINE__); \
    printf(__VA_ARGS__); printf("\n"); s_failures++; } } while (0)

static void set_zone(const char *tz) {
    setenv("TZ", tz, 1);
    tzset();
}

// `hour`:00 (the health graph's and the other platforms' start, a broken-down local time).
static struct tm start_at(int hour) {
    struct tm t;
    memset(&t, 0, sizeof(t));
    t.tm_hour = hour;
    return t;
}

#if defined(PBL_PLATFORM_EMERY)
// The forecast band (test/c/layout_test.c goldens: the emery bottom layer is 198 px, LAYOUT_PAD_X
// 2 in from the screen's left edge, so the screen is layer columns -2 .. 197) and the plot
// widths the host suite sweeps: W, from the plot's left edge to the screen's right edge. On
// axis W = EMERY_W - graph_left, down to past any label strip the watch measures (graph_left
// 53, W 145); with the numbers On graph or Off the plot starts at the screen's left edge, W =
// EMERY_SCREEN_W. W_MAX_SWEPT runs the invariants a little wider still.
#define EMERY_W 198
#define EMERY_SCREEN_W 200
#define SCREEN_L (-2)
#define SCREEN_R 197
#define W_MIN 145
#define W_MAX EMERY_SCREEN_W
#define W_MAX_SWEPT 204
// The tightest hour-label spacing emery ships: two labels 18 px apart (the long span's 6-hour
// marks at its 3 px floor; a two-digit GOTHIC_18 label's ink is 12 px wide).
#define LABEL_MIN_PX FORECAST_SPAN_LABEL_MIN_PX
#define TICK_MIN_PX 3

// The hours whose bar is wholly on screen in a plot `w` px wide: slot i's bar ends at
// x(i) + tick 1 + pad + bar - 1, x the one mapping (slot_x.h).
static int whole_hours(ForecastSpan s, int w) {
    int whole = 0;
    for (int i = 0; i < s.slots; ++i) {
        if (forecast_span_x(s, i) + s.bar_pad + s.bar_w <= w - 1) { ++whole; }
    }
    return whole;
}

// The long class's rule, written out on its own: the smallest pitch, in 1/256 px, that puts
// slot n - 1's tick on the plot's last column (floor((n - 1) * pq / 256) >= w - 1), held to
// [3, 8] px.
static int fill_pitch_q(int n, int w) {
    int pq = 3 * 256;
    while (pq < 8 * 256 && ((n - 1) * pq) / 256 < w - 1) { ++pq; }
    return pq;
}

// The edge rule unheld: the smallest pitch_q that puts slot `slots` - 1's tick on column w - 1.
static int fill_q(int slots, int w) {
    int pq = 256;
    while (((slots - 1) * pq) / 256 < w - 1) { ++pq; }
    return pq;
}

static void test_classes(void) {
    for (int w = W_MIN; w <= W_MAX; ++w) {
        for (int n = 2; n <= FORECAST_MAX_ENTRIES; ++n) {
            const ForecastSpan s = forecast_span(n, w);
            const int pitch = forecast_span_pitch(s);
            if (n <= FORECAST_SPAN_HALF_SENT) {
                // 12 h: n slots (the phone sends 14), pitch W / 12 within [11, 16], 2 px pads.
                int want = w / 12;
                want = want < 11 ? 11 : (want > 16 ? 16 : want);
                CHECK(s.slots == n && s.bar_pad == 2 && pitch == want && s.bar_w == want - 5
                      && s.label_every == 2 && s.tick_every == 1 && !s.by_clock,
                      "12 h n=%d w=%d: {%d %d %d %d %d}", n, w, s.slots, s.bar_pad, s.bar_w,
                      s.label_every, s.tick_every);
            } else if (n <= FORECAST_SPAN_DAY_SENT) {
                // 24 h is today's emery grid: pitch 8, bar 5, pad 1, a label every 3rd slot and
                // a small tick on every slot, from slot 0. 24 slots up to 24 hours
                // (FORECAST_GRID_DEF itself), one per hour past it. Only where its last slot's
                // tick would stop short of the plot's last column (no label strip, fewer than 26
                // hours) the edge rule stretches it there, bar and pad unchanged.
                const int slots = n > 24 ? n : 24;
                const bool short_of_edge = (slots - 1) * 8 < w - 1;
                CHECK(s.slots == slots && s.bar_pad == 1 && s.bar_w == 5
                      && s.label_every == 3 && s.tick_every == 1 && !s.by_clock,
                      "24 h n=%d w=%d", n, w);
                CHECK(forecast_span_pitch_q(s) == (short_of_edge ? fill_q(slots, w) : 8 * 256),
                      "24 h n=%d w=%d: pitch %d/256", n, w, forecast_span_pitch_q(s));
                if (n <= FORECAST_SPAN_DAY_SLOTS && !short_of_edge) {
                    const ChartDef d = forecast_grid_def_for(s);
                    CHECK(memcmp(&d, &FORECAST_GRID_DEF, sizeof(d)) == 0,
                          "n=%d: the 24 h class is FORECAST_GRID_DEF", n);
                }
                // A label strip is at least 17 px (BOTTOM_VIEW_LABEL_STRIP_MIN_W + its gap), so
                // On axis the plot is at most 183 px wide (a quick-view peek's 200 px frame):
                // 24 h On axis is never stretched.
                if (w <= 183) {
                    CHECK(!short_of_edge, "24 h n=%d w=%d: On axis keeps 8 px", n, w);
                }
            } else {
                // Long: one slot per hour received, the fill rule, the clock's marks: a tick
                // every 3 clock hours, a label every 6, or every 3 once 3 hours span 18 px.
                const int pq = fill_pitch_q(n, w);
                const int p = pq / 256;
                const int pad = p >= 6 ? 1 : 0;
                CHECK(s.slots == n && forecast_span_pitch_q(s) == pq && pitch == p
                      && s.bar_pad == pad && s.bar_w == p - 1 - 2 * pad,
                      "long n=%d w=%d: pitch %d/256 want %d", n, w, forecast_span_pitch_q(s), pq);
                CHECK(s.by_clock && s.tick_every == 3 && s.label_every == (3 * pq >= 18 * 256 ? 3 : 6),
                      "long n=%d w=%d: cadence %d/%d", n, w, s.label_every, s.tick_every);
            }
            const bool stretched = !s.by_clock && n > FORECAST_SPAN_HALF_SENT
                                   && (s.slots - 1) * 8 < w - 1;
            if (!s.by_clock && !stretched) {
                // 12 h and 24 h keep whole pitches (every On axis 24 h grid): x(i) is i * pitch,
                // today's pixels.
                CHECK(s.pitch_frac == 0, "n=%d w=%d: a whole pitch", n, w);
                for (int i = 0; i <= s.slots; ++i) {
                    CHECK(forecast_span_x(s, i) == i * pitch, "n=%d w=%d: x(%d)", n, w, i);
                }
            }
            // The ChartDef the span builds: its slots, pad and bar, FORECAST_GRID_DEF's tick and
            // insets.
            const ChartDef d = forecast_grid_def_for(s);
            CHECK(d.num_slots == s.slots && d.bar_pad == s.bar_pad && d.bar_w == s.bar_w
                  && d.tick_w == 1 && d.inset_left == 1 && d.inset_bottom == 1
                  && chart_def_pitch(&d) == pitch
                  && chart_def_pitch_q(&d) == forecast_span_pitch_q(s),
                  "n=%d: forecast_grid_def_for", n);
        }
    }
    // The class bounds: 2..14, 15..26, 27..68.
    CHECK(forecast_span(14, 174).label_every == 2 && forecast_span(15, 174).slots == 24
          && forecast_span(26, 174).slots == 26 && forecast_span(27, 174).by_clock,
          "the class bounds");
    // Spot rows at the default layout's plot (W 174: GOTHIC_24 two-digit labels and the health
    // graph's "0.x" claim, graph_left 24) and the screen-wide one (W 200).
    ForecastSpan s = forecast_span(68, 174);
    CHECK(forecast_span_pitch_q(s) == 768 && s.bar_w == 2 && s.bar_pad == 0
          && s.label_every == 6, "68 at 174: today's 3 px");
    s = forecast_span(68, EMERY_SCREEN_W);
    CHECK(forecast_span_pitch_q(s) == 768 && s.bar_w == 2 && s.label_every == 6, "68 at 200");
    // 58 at 174: 777/256 px, slot 57's tick on column 173; 59 there holds at the 3 px floor.
    CHECK(forecast_span_pitch_q(forecast_span(58, 174)) == 777, "58 at 174");
    CHECK(forecast_span_pitch_q(forecast_span(59, 174)) == 768, "59 at 174");
    // OWM / WU's 48 hours: 943/256 px (3.68) at the default, 2 px bars; 1084 (4.23) and 3 px
    // bars on the whole screen.
    s = forecast_span(48, 174);
    CHECK(forecast_span_pitch_q(s) == 943 && s.bar_w == 2 && s.bar_pad == 0 && s.label_every == 6,
          "48 at 174");
    s = forecast_span(48, EMERY_SCREEN_W);
    CHECK(forecast_span_pitch_q(s) == 1084 && s.bar_w == 3 && s.bar_pad == 0, "48 at 200");
    // 3 hours of 18 px or more (a pitch of 6): a label on every 3-hour mark. 30 hours at W 174
    // fall just short (1528/256 = 5.97: 6-hour labels, pad 0, 4 px bars), at W 176 not (1545).
    s = forecast_span(30, 174);
    CHECK(forecast_span_pitch_q(s) == 1528 && s.bar_pad == 0 && s.bar_w == 4
          && s.label_every == 6, "30 at 174");
    s = forecast_span(30, 176);
    CHECK(forecast_span_pitch_q(s) == 1545 && s.bar_pad == 1 && s.bar_w == 3
          && s.label_every == 3, "30 at 176");
    s = forecast_span(27, 174);
    CHECK(forecast_span_pitch_q(s) == 1704 && s.bar_pad == 1 && s.bar_w == 3, "27 at 174");
    s = forecast_span(27, EMERY_SCREEN_W);
    CHECK(forecast_span_pitch_q(s) == 1960 && s.bar_pad == 1 && s.bar_w == 4, "27 at 200");
    // 12 h's fit ends: 16 on the screen-wide plot, 12 behind the widest strip.
    CHECK(forecast_span_pitch(forecast_span(14, EMERY_SCREEN_W)) == 16, "12 h at 200");
    CHECK(forecast_span_pitch(forecast_span(14, 190)) == 15, "12 h at 190");
    CHECK(forecast_span_pitch(forecast_span(14, 174)) == 14, "12 h at 174");
    CHECK(forecast_span_pitch(forecast_span(14, W_MIN)) == 12, "12 h at 145");
}

// The owner's rules, over every plot width a little past the real ones and every count sent.
static void test_invariants(void) {
    for (int w = W_MIN; w <= W_MAX_SWEPT; ++w) {
        for (int n = 2; n <= FORECAST_MAX_ENTRIES; ++n) {
            const ForecastSpan s = forecast_span(n, w);
            const int p = forecast_span_pitch(s);
            const int pq = forecast_span_pitch_q(s);
            // The floors: never a pitch under 3 or a bar under 2 ("that's the min width").
            CHECK(p >= 3 && s.bar_w >= 2 && p == pq / 256, "n=%d w=%d: pitch %d bar %d", n, w,
                  p, s.bar_w);
            // label_every / tick_every count slots, or clock hours (one slot each) in the long
            // class: the px between two labels and two ticks, through the mapping.
            for (int i = 0; i + s.label_every <= s.slots; ++i) {
                CHECK(forecast_span_x(s, i + s.label_every) - forecast_span_x(s, i)
                      >= LABEL_MIN_PX, "n=%d w=%d: labels at %d too close", n, w, i);
            }
            CHECK(s.tick_every * p >= TICK_MIN_PX, "n=%d w=%d: ticks", n, w);
            // The columns tile: each is p or p + 1 px wide (p only at a whole pitch), and a bar
            // ends pad px or more before the next slot's tick: one bar width, the gap varies.
            for (int i = 0; i < s.slots; ++i) {
                const int cw = forecast_span_x(s, i + 1) - forecast_span_x(s, i);
                CHECK(cw == p || (cw == p + 1 && s.pitch_frac), "n=%d w=%d: column %d %d px",
                      n, w, i, cw);
                CHECK(forecast_span_x(s, i) + s.bar_pad + s.bar_w
                      <= forecast_span_x(s, i + 1) - 1 - s.bar_pad, "n=%d w=%d: bar %d", n, w, i);
            }
            // The hours on screen: the slots whose tick the mapping puts on the plot's columns.
            int on = 0;
            while (on < n && forecast_span_x(s, on) <= w - 1) { ++on; }
            CHECK(forecast_span_drawn(s, n, w) == on, "n=%d w=%d: %d on screen, want %d", n, w,
                  forecast_span_drawn(s, n, w), on);
            // The hours the layout reads: those whose bar starts on screen; the 24 h grid at its
            // whole 8 px keeps the started columns (today's count, today's pixels).
            int laid = 0;
            while (laid < n && forecast_span_x(s, laid) + 1 + s.bar_pad <= w - 1) { ++laid; }
            const bool day8 = !s.by_clock && pq == 8 * 256;
            CHECK(forecast_span_laid_out(s, n, w) == (day8 ? on : laid),
                  "n=%d w=%d: %d laid out, want %d", n, w, forecast_span_laid_out(s, n, w),
                  day8 ? on : laid);
            if (!s.by_clock && n > FORECAST_SPAN_HALF_SENT) {
                // No blank tail at 24 h either: its last slot's tick reaches the last column.
                CHECK(forecast_span_x(s, s.slots - 1) >= w - 1, "24 h n=%d w=%d: tail", n, w);
            }
            CHECK(s.label_every % s.tick_every == 0, "n=%d: big ticks sit on the small lattice", n);
            CHECK(n <= s.slots, "n=%d: every entry has a slot", n);
            if (s.by_clock) {
                // Divisors of 24, so the marks keep the same clock hours every day.
                CHECK(24 % s.label_every == 0 && 24 % s.tick_every == 0,
                      "n=%d w=%d: label every %d", n, w, s.label_every);
                // No blank tail: the last hour's vertex reaches the plot's last column (the
                // line, the fill and the bars run to the edge), unless the pitch is at its max;
                // and the smallest such pitch. Unheld, the vertex is ON that column, and every
                // hour but the last shows whole: a little overdraw, no more.
                const int xl = forecast_span_x(s, n - 1);
                CHECK(xl >= w - 1 || pq == SLOT_X_PITCH_Q(FORECAST_SPAN_LONG_PITCH_MAX),
                      "n=%d w=%d: tail", n, w);
                CHECK(slot_x(pq - 1, n - 1) < w - 1 || pq == SLOT_X_PITCH_Q(FORECAST_SPAN_LONG_PITCH_MIN),
                      "n=%d w=%d: pitch %d/256 not the smallest", n, w, pq);
                if (pq > SLOT_X_PITCH_Q(FORECAST_SPAN_LONG_PITCH_MIN)
                    && pq < SLOT_X_PITCH_Q(FORECAST_SPAN_LONG_PITCH_MAX)) {
                    CHECK(xl == w - 1 && whole_hours(s, w) == n - 1 && on == n,
                          "n=%d w=%d: vertex %d, %d whole", n, w, xl, whole_hours(s, w));
                }
            }
            if (n == FORECAST_MAX_ENTRIES) {
                // A full feed draws pitch 3 on every plot, and its last vertex (slot 67, at
                // 67 * 3 = 201) lies past the edge of the widest: the line runs off the screen.
                CHECK(p == 3 && (n - 1) * p >= (w < W_MAX ? w : W_MAX),
                      "a full feed at w=%d: pitch %d", w, p);
            }
            if (n == FORECAST_SPAN_HALF_SENT) {
                // 12 whole columns fit, and the 14th hour's vertex (13 * p) reaches the edge.
                CHECK(12 * p <= w && w <= 13 * p, "12 h w=%d: pitch %d", w, p);
            }
            if (n == FORECAST_SPAN_DAY_SENT && w <= W_MAX) {
                // 24 h, sent 26: the 26th hour's vertex (25 * 8 = 200) reaches the edge.
                CHECK((n - 1) * p >= w, "24 h sent 26 at w=%d", w);
            }
        }
    }
}

// What each option shows, by layout: whole hours on the long span's full feed, and 24 h's
// whole columns (temp_axis_drawn_entries counts the started ones, the hours the scale and the
// labels cover).
static void test_visible(void) {
    static const int ws[] = { 200, 190, 189, 181, 180, 179, 176, 174, 173, 170, 167, 165 };
    static const int long_whole[] = { 66, 63, 63, 60, 60, 59, 58, 58, 57, 56, 55, 55 };
    static const int day_whole[] = { 23, 23, 23, 22, 22, 22, 22, 21, 21, 21, 21, 20 };
    for (unsigned k = 0; k < sizeof(ws) / sizeof(ws[0]); ++k) {
        const int w = ws[k];
        const ForecastSpan l = forecast_span(68, w);
        CHECK(whole_hours(l, w) == long_whole[k], "68 at w=%d: %d whole, want %d", w,
              whole_hours(l, w), long_whole[k]);
        const int started = temp_axis_drawn_entries(68, w, forecast_span_pitch(l));
        CHECK(started == (w + 2) / 3 && started - whole_hours(l, w) <= 1,
              "68 at w=%d: %d started", w, started);
        const ForecastSpan d = forecast_span(24, w);
        CHECK(whole_hours(d, w) == day_whole[k], "24 at w=%d: %d whole, want %d", w,
              whole_hours(d, w), day_whole[k]);
    }
    // "58 h": the default layout's count (W 174, graph_left 24); 66 on the whole screen.
    CHECK(whole_hours(forecast_span(68, 174), 174) == 58, "the label's 58");
    CHECK(whole_hours(forecast_span(68, EMERY_SCREEN_W), EMERY_SCREEN_W) == 66, "66 at 200");
    // 24 h on the whole screen, sent 26: 25 whole columns, the 26th hour's vertex at the edge.
    const ForecastSpan d26 = forecast_span(26, EMERY_SCREEN_W);
    CHECK(whole_hours(d26, EMERY_SCREEN_W) == 25 && forecast_span_pitch_q(d26) == 8 * 256
          && temp_axis_drawn_entries(26, EMERY_SCREEN_W, 8) == 25, "26 at 200");
    // Sent 24 there (an unknown watch, or before the refetch that brings the 26): the whole
    // 8 px would end the line at x 184 and the bars at 192, a blank tail. The edge rule
    // stretches the 24 slots to 2215/256 px (8.65): the 24th hour's point on the last column,
    // 23 whole, the bars 5 px as ever. 25 hours: 2123/256 px.
    const ForecastSpan d24 = forecast_span(24, EMERY_SCREEN_W);
    CHECK(forecast_span_pitch_q(d24) == 2215 && d24.bar_w == 5 && d24.bar_pad == 1
          && d24.slots == 24 && forecast_span_x(d24, 23) == EMERY_SCREEN_W - 1
          && whole_hours(d24, EMERY_SCREEN_W) == 23
          && forecast_span_drawn(d24, 24, EMERY_SCREEN_W) == 24
          && forecast_span_laid_out(d24, 24, EMERY_SCREEN_W) == 23, "24 at 200");
    const ForecastSpan d25 = forecast_span(25, EMERY_SCREEN_W);
    CHECK(forecast_span_pitch_q(d25) == 2123 && forecast_span_x(d25, 24) == EMERY_SCREEN_W - 1,
          "25 at 200");
    // The layout's hours (forecast_span_laid_out): OWM's 48 at the default leave out the 48th,
    // whose bar starts past the edge (only its point is on screen); a full feed and 24 h On
    // axis count what they always did.
    CHECK(forecast_span_laid_out(forecast_span(48, 174), 48, 174) == 47
          && forecast_span_drawn(forecast_span(48, 174), 48, 174) == 48, "48 at 174: laid out");
    CHECK(forecast_span_laid_out(forecast_span(49, EMERY_SCREEN_W), 49, EMERY_SCREEN_W) == 48,
          "49 at 200: laid out");
    CHECK(forecast_span_laid_out(forecast_span(68, 174), 68, 174) == 58
          && forecast_span_laid_out(forecast_span(68, EMERY_SCREEN_W), 68, EMERY_SCREEN_W) == 67,
          "68: laid out");
    for (int w = W_MIN; w <= 183; ++w) {
        CHECK(forecast_span_laid_out(forecast_span(24, w), 24, w)
              == temp_axis_drawn_entries(24, w, 8), "24 On axis at w=%d: today's count", w);
    }
    // 12 h at W 180 (On axis, GOTHIC_18 two-digit labels): exactly 12 columns; at W 167, 13;
    // on the whole screen 12 whole and the 13th started.
    CHECK(whole_hours(forecast_span(14, 180), 180) == 12
          && temp_axis_drawn_entries(14, 180, 15) == 12, "12 h at 180");
    CHECK(whole_hours(forecast_span(14, 167), 167) == 13, "12 h at 167");
    CHECK(whole_hours(forecast_span(14, EMERY_SCREEN_W), EMERY_SCREEN_W) == 12
          && temp_axis_drawn_entries(14, EMERY_SCREEN_W, 16) == 13, "12 h at 200");
    // A short feed fills the plot: OWM's 48 hours show 47 whole on every layout (the 48th's
    // vertex on the last column), WU's 49 (the hour in progress and its 48) 48; at W 174 a
    // feed of 27..58 hours shows n - 1 (59 and more hold at the 3 px floor and run past).
    for (unsigned k = 0; k < sizeof(ws) / sizeof(ws[0]); ++k) {
        const int w = ws[k];
        CHECK(whole_hours(forecast_span(48, w), w) == 47
              && whole_hours(forecast_span(49, w), w) == 48, "48 / 49 at w=%d", w);
    }
    for (int n = 27; n <= 58; ++n) {
        CHECK(whole_hours(forecast_span(n, 174), 174) == n - 1, "%d at 174", n);
    }
}

// A label's ink, measured on emery's fonts: GOTHIC_14 one digit tick - 2 .. + 1, two digits
// tick - 5 .. + 4; GOTHIC_18 (Larger graph fonts) tick - 3 .. + 1 and tick - 6 .. + 5.
static void test_label_fits(void) {
    static const struct { bool large; int label, ink_l, ink_r; } inks[] = {
        { false, 7, -2, 1 }, { false, 17, -5, 4 }, { true, 7, -3, 1 }, { true, 17, -6, 5 },
    };
    for (unsigned k = 0; k < sizeof(inks) / sizeof(inks[0]); ++k) {
        const bool large = inks[k].large;
        const int label = inks[k].label;
        for (int x = -10; x <= 210; ++x) {
            const bool whole = x + inks[k].ink_l >= SCREEN_L && x + inks[k].ink_r <= SCREEN_R;
            CHECK(forecast_span_label_fits(x, label, large, SCREEN_L, SCREEN_R) == whole,
                  "label %d large %d at x=%d", label, large, x);
        }
    }
    // The edges exactly: a two-digit GOTHIC_14 label's first ink column on the screen's first.
    CHECK(forecast_span_label_fits(3, 12, false, SCREEN_L, SCREEN_R)
          && !forecast_span_label_fits(2, 12, false, SCREEN_L, SCREEN_R), "the left edge");
    CHECK(forecast_span_label_fits(193, 12, false, SCREEN_L, SCREEN_R)
          && !forecast_span_label_fits(194, 12, false, SCREEN_L, SCREEN_R), "the right edge");
    CHECK(forecast_span_label_fits(196, 9, false, SCREEN_L, SCREEN_R)
          && !forecast_span_label_fits(197, 9, false, SCREEN_L, SCREEN_R),
          "one digit at the right edge");
}

// The axis the helper must fill, written out: each slot's mark from its own local hour, and its
// hour's label unless the mark is not a label, the first slot is skipped or the label is cut.
static void expect_slots(const ChartAxisSlot *slots, ForecastSpan s, time_t start, int x0,
                         bool large, bool skip_first, const char *what) {
    int prev = -1;
    for (int i = 0; i < s.slots; ++i) {
        const time_t t = start + (time_t)i * 3600;
        const int hour = localtime(&t)->tm_hour;
        const int mark = forecast_span_mark(s, i, hour, prev);
        prev = hour;
        char want[4] = "";
        if (mark == FORECAST_MARK_LABEL && !(skip_first && i == 0)
            && forecast_span_label_fits(x0 + forecast_span_x(s, i), hour, large, SCREEN_L,
                                        SCREEN_R)) {
            snprintf(want, sizeof(want), "%d", hour);
        }
        CHECK((int)slots[i].tick == mark && strcmp(slots[i].label, want) == 0,
              "%s slot %d (hour %d): tick %d '%s', want %d '%s'", what, i, hour, slots[i].tick,
              slots[i].label, mark, want);
    }
}

static void test_marks(void) {
    ChartAxisSlot slots[FORECAST_MAX_ENTRIES];
    const time_t t14 = 14 * 3600;   // 14:00 UTC

    // 24 h at the default layout (plot from x 24, GOTHIC_14): today's axis, the health
    // graph's cadence (forecast_grid_fill_axis_slots), every label whole: identical.
    ForecastSpan s = forecast_span(24, 174);
    ChartAxisSlot health[24];
    const struct tm tm14 = start_at(14);
    forecast_grid_fill_axis_slots(health, 24, 24, 8, EMERY_W, &tm14);
    forecast_grid_fill_axis_span(slots, s, t14, 24, SCREEN_L, SCREEN_R, false, false);
    for (int i = 0; i < 24; ++i) {
        CHECK(slots[i].tick == health[i].tick && strcmp(slots[i].label, health[i].label) == 0,
              "24 h slot %d: '%s' / '%s'", i, slots[i].label, health[i].label);
        CHECK(slots[i].tick == (i % 3 == 0 ? TICK_BIG : TICK_SMALL), "24 h slot %d tick", i);
        CHECK((i % 3 == 0) == (slots[i].label[0] != '\0'), "24 h slot %d label", i);
    }
    CHECK(strcmp(slots[21].label, "11") == 0, "slot 21 (x 192) is whole");
    // A wider strip: slot 21's "11" at x 198 would run past the screen's last column. Dropped,
    // its big tick kept; with Larger graph fonts already from x 193.
    forecast_grid_fill_axis_span(slots, s, t14, 30, SCREEN_L, SCREEN_R, false, false);
    CHECK(slots[21].label[0] == '\0' && slots[21].tick == TICK_BIG
          && strcmp(slots[18].label, "8") == 0, "the cut last label");
    forecast_grid_fill_axis_span(slots, s, t14, 25, SCREEN_L, SCREEN_R, true, false);
    CHECK(slots[21].label[0] == '\0' && slots[21].tick == TICK_BIG, "GOTHIC_18 at x 193");
    forecast_grid_fill_axis_span(slots, s, t14, 24, SCREEN_L, SCREEN_R, true, false);
    CHECK(strcmp(slots[21].label, "11") == 0, "GOTHIC_18 at x 192 is whole");

    // 24 h on the whole screen, sent 26 (the numbers On graph or Off): the plot from the
    // screen's left edge (x -2), slot 0 never labelled (the current hour), its tick kept; a
    // label every 3rd slot from there, the 26th slot a small tick.
    s = forecast_span(26, EMERY_SCREEN_W);
    forecast_grid_fill_axis_span(slots, s, t14, SCREEN_L, SCREEN_L, SCREEN_R, false, true);
    expect_slots(slots, s, t14, SCREEN_L, false, true, "24 h / 26");
    CHECK(slots[0].label[0] == '\0' && slots[0].tick == TICK_BIG, "slot 0: the tick alone");
    CHECK(strcmp(slots[3].label, "17") == 0 && strcmp(slots[24].label, "14") == 0
          && slots[25].tick == TICK_SMALL && slots[25].label[0] == '\0', "24 h / 26 labels");
    // skip_first drops slot 0 even where it would be whole (a health graph's shared strip).
    forecast_grid_fill_axis_span(slots, s, t14, 24, SCREEN_L, SCREEN_R, false, true);
    CHECK(slots[0].label[0] == '\0' && slots[0].tick == TICK_BIG
          && strcmp(slots[3].label, "17") == 0, "skip_first");
    // Without skip_first, slot 0 at the screen's edge is cut: dropped all the same.
    forecast_grid_fill_axis_span(slots, s, t14, SCREEN_L, SCREEN_L, SCREEN_R, false, false);
    CHECK(slots[0].label[0] == '\0' && slots[0].tick == TICK_BIG, "slot 0 cut");

    // 12 h on the whole screen (pitch 16): a label every 2nd slot from slot 0, a tick on each.
    s = forecast_span(14, EMERY_SCREEN_W);
    forecast_grid_fill_axis_span(slots, s, t14, SCREEN_L, SCREEN_L, SCREEN_R, false, true);
    expect_slots(slots, s, t14, SCREEN_L, false, true, "12 h");
    for (int i = 0; i < 14; ++i) {
        CHECK(slots[i].tick == (i % 2 == 0 ? TICK_BIG : TICK_SMALL), "12 h slot %d tick", i);
    }
    // Slot 12 (x 190, "2") is whole; slot 0 skipped.
    CHECK(slots[0].label[0] == '\0' && strcmp(slots[2].label, "16") == 0
          && strcmp(slots[12].label, "2") == 0, "12 h labels");

    // The long span on the whole screen from 14:00: the clock's marks, not slot 0's. A label on
    // 18, 0, 6 and 12 (slots 4, 10, 16, ...), a small tick on 15, 21, 3 and 9, nothing else.
    s = forecast_span(68, EMERY_SCREEN_W);
    forecast_grid_fill_axis_span(slots, s, t14, SCREEN_L, SCREEN_L, SCREEN_R, false, true);
    expect_slots(slots, s, t14, SCREEN_L, false, true, "long");
    for (int i = 0; i < 68; ++i) {
        const int hour = (14 + i) % 24;
        const int want = hour % 6 == 0 ? TICK_BIG : (hour % 3 == 0 ? TICK_SMALL : TICK_NONE);
        CHECK((int)slots[i].tick == want, "long slot %d (hour %d): tick %d", i, hour,
              slots[i].tick);
        CHECK((hour % 6 == 0) == (slots[i].label[0] != '\0'), "long slot %d label", i);
    }
    CHECK(strcmp(slots[4].label, "18") == 0 && strcmp(slots[10].label, "0") == 0
          && strcmp(slots[64].label, "6") == 0 && slots[67].tick == TICK_SMALL, "long labels");
    // From 12:00 slot 0 is a 6-hour mark: its tick stays, its label goes (skipped On graph and
    // Off; cut at the screen's edge either way).
    const time_t t12 = 12 * 3600;
    forecast_grid_fill_axis_span(slots, s, t12, SCREEN_L, SCREEN_L, SCREEN_R, false, true);
    expect_slots(slots, s, t12, SCREEN_L, false, true, "long from 12");
    CHECK(slots[0].tick == TICK_BIG && slots[0].label[0] == '\0'
          && strcmp(slots[6].label, "18") == 0, "long from 12: slot 0");
    // On axis (x0 24, no skip): slot 0's "12" is whole, so it is drawn; at x0 2 it is cut.
    s = forecast_span(68, 174);
    forecast_grid_fill_axis_span(slots, s, t12, 24, SCREEN_L, SCREEN_R, false, false);
    expect_slots(slots, s, t12, 24, false, false, "long On axis");
    CHECK(strcmp(slots[0].label, "12") == 0, "long On axis: slot 0");
    // Slot 66 (x 222, hour 6) lies off the screen: its mark, no label.
    CHECK(slots[66].label[0] == '\0' && slots[66].tick == TICK_BIG, "long On axis: the end");
    forecast_grid_fill_axis_span(slots, s, t12, 2, SCREEN_L, SCREEN_R, false, false);
    CHECK(slots[0].label[0] == '\0' && slots[0].tick == TICK_BIG, "long: slot 0 cut at x 2");
    forecast_grid_fill_axis_span(slots, s, t12, 3, SCREEN_L, SCREEN_R, false, false);
    CHECK(strcmp(slots[0].label, "12") == 0, "long: slot 0 whole at x 3");

    // 3 hours of 18 px (30 hours at W 176, 1545/256 px): a label on every 3-hour mark, no
    // small ticks.
    s = forecast_span(30, 176);
    forecast_grid_fill_axis_span(slots, s, t14, 22, SCREEN_L, SCREEN_R, false, false);
    expect_slots(slots, s, t14, 22, false, false, "long pitch 6");
    for (int i = 0; i < 30; ++i) {
        const int hour = (14 + i) % 24;
        CHECK((hour % 3 == 0) == (slots[i].tick == TICK_BIG), "pitch 6 slot %d", i);
        CHECK(slots[i].tick != TICK_SMALL, "pitch 6 slot %d: no small tick", i);
    }
    CHECK(strcmp(slots[1].label, "15") == 0 && strcmp(slots[4].label, "18") == 0, "pitch 6");

    // OWM's 48 hours at the default (943/256 px) from 14:00: the 6-hour labels on the mapping's
    // ticks, slot 46 ("12", x 24 + 169 = 193) whole, slot 47's tick on the last column (197).
    s = forecast_span(48, 174);
    forecast_grid_fill_axis_span(slots, s, t14, 24, SCREEN_L, SCREEN_R, false, false);
    expect_slots(slots, s, t14, 24, false, false, "48 at 174");
    CHECK(24 + forecast_span_x(s, 47) == SCREEN_R && strcmp(slots[46].label, "12") == 0,
          "48 at 174: the end");
    // From 19:00 slot 47 is 18:00, a 6-hour label, on the last column (197): its "18" would run
    // 4 px past the screen, so it is dropped and its big tick stays. At a whole 3 px the fit
    // would have read x 24 + 141 = 165, where it fits: the fit and the tick share the mapping.
    const time_t t19 = 19 * 3600;
    forecast_grid_fill_axis_span(slots, s, t19, 24, SCREEN_L, SCREEN_R, false, false);
    expect_slots(slots, s, t19, 24, false, false, "48 at 174 from 19");
    CHECK(slots[47].tick == TICK_BIG && slots[47].label[0] == '\0'
          && strcmp(slots[41].label, "12") == 0, "48 at 174 from 19: the cut 18");
    // Every start hour, the 48- and 49-hour feeds On axis and on the whole screen.
    for (int start = 0; start < 24; ++start) {
        const time_t t = (time_t)start * 3600;
        static const int ns[] = { 48, 49 };
        for (unsigned k = 0; k < 2; ++k) {
            s = forecast_span(ns[k], 174);
            forecast_grid_fill_axis_span(slots, s, t, 24, SCREEN_L, SCREEN_R, false, false);
            expect_slots(slots, s, t, 24, false, false, "short feed On axis");
            s = forecast_span(ns[k], EMERY_SCREEN_W);
            forecast_grid_fill_axis_span(slots, s, t, SCREEN_L, SCREEN_L, SCREEN_R, false, true);
            expect_slots(slots, s, t, SCREEN_L, false, true, "short feed, no left axis");
        }
    }
    // 24 hours on the whole screen (the stretched 24 h grid, 2215/256 px): every 3rd slot from
    // slot 0, the labels on the mapping's ticks; slot 21 ("11", x -2 + 181) whole.
    s = forecast_span(24, EMERY_SCREEN_W);
    forecast_grid_fill_axis_span(slots, s, t14, SCREEN_L, SCREEN_L, SCREEN_R, false, true);
    expect_slots(slots, s, t14, SCREEN_L, false, true, "24 h / 24 stretched");
    CHECK(slots[0].label[0] == '\0' && strcmp(slots[21].label, "11") == 0
          && slots[23].tick == TICK_SMALL, "24 h / 24 stretched labels");
}

// The one mapping (slot_x.h): whole hours of the time mapping land on the slot ticks at every
// pitch, it never steps back, and at a whole pitch both are today's arithmetic (i * p, and the
// night bands' elapsed * (n * p) / (n * 3600)), so the 12 h / 24 h grids, the health graph and
// the radar keep their pixels.
static void test_mapping(void) {
    for (int pq = 256; pq <= 16 * 256; ++pq) {
        for (int i = 0; i <= FORECAST_MAX_ENTRIES; ++i) {
            CHECK(slot_time_x(pq, i * 3600) == slot_x(pq, i), "time pq=%d i=%d", pq, i);
        }
        int prev = 0;
        for (int32_t secs = 0; secs <= FORECAST_MAX_ENTRIES * 3600; secs += 61) {
            const int x = slot_time_x(pq, secs);
            CHECK(x >= prev, "monotonic pq=%d at %d s", pq, (int)secs);
            prev = x;
        }
    }
    for (int p = 3; p <= 16; ++p) {
        for (int n = 2; n <= FORECAST_MAX_ENTRIES; ++n) {
            for (int32_t e = 1; e < n * 3600; e += 97) {
                CHECK(slot_time_x(SLOT_X_PITCH_Q(p), e) == (int)((e * (n * p)) / (n * 3600)),
                      "night p=%d n=%d e=%d", p, n, (int)e);
            }
            for (int w = 100; w <= 240; ++w) {
                CHECK(slot_x_count(SLOT_X_PITCH_Q(p), n, w) == temp_axis_drawn_entries(n, w, p),
                      "count p=%d n=%d w=%d", p, n, w);
            }
        }
    }
    // The chart engine's mapping (chart.h): the def's pitch_q, whole px plus pitch_frac; 0 frac
    // (FORECAST_GRID_DEF, the health graph's re-padded copy, the radar) is the whole pitch.
    ChartDef d = FORECAST_GRID_DEF;
    CHECK(chart_def_pitch_q(&d) == 8 * 256, "FORECAST_GRID_DEF: 8 px");
    d.bar_pad = 0;
    d.bar_w = 6;
    CHECK(chart_def_pitch_q(&d) == 7 * 256 && chart_def_slot_x(&d, 5) == 35, "a re-padded copy");
    // The renderers' half (chart.h chart_slot_tick_x / chart_slot_bar_x: the bars, marks, line
    // and area vertices, ticks and stripe cells): the geometry's pitch_q through the mapping,
    // never i * slots.pitch, and each bar bar_dx right of its tick. The pitches: the 3 px
    // floor, OWM's 48 at 174 and 200, 30 at 174, the stretched 24 h grid, 8 px.
    static const int pqs[] = { 768, 943, 1084, 1528, 2215, 2048 };
    for (unsigned k = 0; k < sizeof(pqs) / sizeof(pqs[0]); ++k) {
        const int px = pqs[k] / 256;
        const int pad = px >= 6 ? 1 : 0;
        const ChartGeometry g = { .anchor_x = 24,
                                  .slots = slot_geometry(68, 1, pad, px - 1 - 2 * pad),
                                  .pitch_q = pqs[k] };
        for (int i = 0; i <= FORECAST_MAX_ENTRIES; ++i) {
            CHECK(chart_slot_tick_x(&g, i) == 24 + slot_x(pqs[k], i)
                  && chart_slot_bar_x(&g, i) == chart_slot_tick_x(&g, i) + 1 + pad,
                  "chart.h pq=%d slot %d: tick %d bar %d", pqs[k], i, chart_slot_tick_x(&g, i),
                  chart_slot_bar_x(&g, i));
        }
    }
    // A def's pitch_frac reaches the geometry's mapping: the long span's def at OWM's 48.
    const ChartDef owm = forecast_grid_def_for(forecast_span(48, 174));
    CHECK(chart_def_pitch_q(&owm) == 943 && chart_def_slot_x(&owm, 47) == 173, "OWM's def");
}

// Daylight saving: the axis reads each slot's own local hour. A zone whose clocks jump at
// 03:00 (forward to 04:00 in March, back from 04:00 to 03:00 in October), so the jumps touch a
// 3-hour mark.
static void test_daylight_saving(void) {
    set_zone("XST-1XDT,M3.5.0/3,M10.5.0/4");
    ChartAxisSlot slots[FORECAST_MAX_ENTRIES];
    // 2026-10-24 22:00 UTC = 2026-10-25 00:00 XDT. The clock reads 0, 1, 2, 3, 3 (the repeat:
    // XST from 02:00 UTC), 4, 5, 6, ... The long class marks the first 3 only, so no two
    // marks stack a pitch apart; the 6-hour label lands on 06:00 XST.
    const time_t fall = 1792879200;
    ForecastSpan s = forecast_span(68, EMERY_SCREEN_W);
    forecast_grid_fill_axis_span(slots, s, fall, SCREEN_L, SCREEN_L, SCREEN_R, false, true);
    expect_slots(slots, s, fall, SCREEN_L, false, true, "fall back");
    CHECK(slots[3].tick == TICK_SMALL && slots[4].tick == TICK_NONE, "the repeated 3: once");
    CHECK(slots[7].tick == TICK_BIG && strcmp(slots[7].label, "6") == 0, "06:00 on slot 7");
    for (int i = 1; i < 68; ++i) {
        CHECK(!(slots[i].tick != TICK_NONE && slots[i - 1].tick != TICK_NONE),
              "fall back: marks on slots %d and %d", i - 1, i);
    }
    // The 24 h grid keeps its cadence from slot 0 (every 3rd slot) and names each slot's own
    // hour: slot 3 reads 3, slot 6 reads 5 (the hour repeated), slot 9 reads 8.
    s = forecast_span(24, 174);
    forecast_grid_fill_axis_span(slots, s, fall, 24, SCREEN_L, SCREEN_R, false, false);
    CHECK(strcmp(slots[3].label, "3") == 0 && strcmp(slots[6].label, "5") == 0
          && strcmp(slots[9].label, "8") == 0, "24 h across the fall back: '%s' '%s' '%s'",
          slots[3].label, slots[6].label, slots[9].label);

    // 2026-03-28 23:00 UTC = 2026-03-29 00:00 XST. The clock reads 0, 1, 2, 4 (03:00 skipped:
    // XDT from 02:00 UTC), 5, 6, ... No mark on the skipped 3; the step from 0 to 6 is 5 slots.
    const time_t spring = 1774738800;
    s = forecast_span(68, EMERY_SCREEN_W);
    forecast_grid_fill_axis_span(slots, s, spring, SCREEN_L, SCREEN_L, SCREEN_R, false, true);
    expect_slots(slots, s, spring, SCREEN_L, false, true, "spring forward");
    CHECK(slots[0].tick == TICK_BIG && slots[1].tick == TICK_NONE && slots[2].tick == TICK_NONE
          && slots[3].tick == TICK_NONE && slots[5].tick == TICK_BIG
          && strcmp(slots[5].label, "6") == 0, "spring forward: 0, (no 3), 6");
    set_zone("UTC0");
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
    set_zone("UTC0");
#if defined(PBL_PLATFORM_EMERY)
    CHECK(FORECAST_MAX_ENTRIES == 68 && FORECAST_MAX_ENTRIES == (EMERY_SCREEN_W + 2) / 3 + 1,
          "FORECAST_MAX_ENTRIES %d", FORECAST_MAX_ENTRIES);
    CHECK(FORECAST_NIGHTS_MAX == 4, "FORECAST_NIGHTS_MAX %d", FORECAST_NIGHTS_MAX);
    test_classes();
    test_invariants();
    test_visible();
    test_label_fits();
    test_marks();
    test_mapping();
    test_daylight_saving();
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
