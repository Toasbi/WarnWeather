// Host dump for scripts/check-fit-lockstep.js: what the watch's ONE layout engine
// (layout.c compute_layout) does with every custom shape the editor can size — each laid
// out in all four data states (radar / health present or missing) through the watch's own
// view_spec_resolve — so the phone's fit check (view-cycle.js stackFits: resolveForFit +
// stackNeed) can be compared with it line by line. Built once per screen family by
// scripts/test-c.sh. Line format: "<family> <wire> <ext> <has_radar> <has_health> <kind> <v>":
//   N <need>  a stack with no fill band that ends above the floor: its exact block height;
//   F <0|1>   a stack with a fill band: whether the fill kept its floor (2 rows, 3 for the
//             forecast) — i.e. whether the view fits;
//   C <need>  a stack with no fill band that reaches the floor: the height it got (a lower
//             bound — it may have been cut).
// Legacy-order (preset-shaped) views are skipped: they always fit.
#include <stdio.h>
#include "c/windows/layout.h"

#ifdef PBL_PLATFORM_EMERY
#define FAMILY 1
#define BOUNDS GRect(0, 0, 200, 228)
#define START_STRIP 22
#define START_NOSTRIP 2
#define FLOOR 224
#define ROW 20
#else
#define FAMILY 0
#define BOUNDS GRect(0, 0, 144, 168)
#define START_STRIP 13
#define START_NOSTRIP 0
#define FLOOR 168
#define ROW 15
#endif

int main(void) {
    const struct { int tier, top, kind; } tops[] = {
        { 2, 1, 0 }, { 3, 1, 0 }, { 1, 0, 0 }, { 3, 2, 0 }, { 1, 3, 0 }, { 1, 3, 1 },
    };
    const int top_sizes[] = { 0, BAND_SIZE_2, BAND_SIZE_4, BAND_SIZE_FILL };
    const int bodies[] = { BODY_FORECAST, BODY_HEALTH_GRAPH, BODY_RADAR };
    const int body_sizes[] = { 0, BAND_SIZE_2, BAND_SIZE_3, BAND_SIZE_4 };   // 0 = fill
    const int rows[][2] = { { 0, 0 }, { 1, 0 }, { 0, 2 }, { 3, 2 } };
    LayoutMetrics m = {
        20,   // the DEVICE fc_band_h on both families (the fit table's statusFull)
#ifdef PBL_PLATFORM_EMERY
        { 2, 46 }
#else
        { 0, 35 }
#endif
    };
    for (unsigned t = 0; t < sizeof(tops) / sizeof(tops[0]); t++) {
        bool sized = tops[t].top >= 2;
        for (unsigned ts = 0; ts < (sized ? 4u : 1u); ts++) {
            for (int bi = -1; bi < 3; bi++) {
                for (unsigned bs = 0; bs < (bi < 0 ? 1u : 4u); bs++) {
                    for (unsigned r = 0; r < 4; r++) {
                        for (int order = 0; order < 12; order++) {
                            for (int flags = 0; flags < 4; flags++) {
                                int body = bi < 0 ? BODY_NONE : bodies[bi];
                                uint16_t wire = (uint16_t)((tops[t].tier << 8) | (tops[t].top << 6)
                                    | (body << 4) | (rows[r][0] << 2) | rows[r][1]
                                    | ((flags & 1) << 10) | ((flags >> 1) << 11) | (order << 12));
                                uint16_t ext = (uint16_t)((bi < 0 ? 0 : body_sizes[bs])
                                    | ((sized ? top_sizes[ts] : 0) << 3)
                                    | (tops[t].kind << 6) | (ALIGN_TOP << 7));
                                ViewSpec c = view_spec_unpack(wire);
                                view_spec_apply_ext(&c, ext);
                                if (!c.stacked) { continue; }   // legacy order: always fits
                                // Print the ext word as the watch normalised it (a fill
                                // drops the alignment) — what the phone compiler sends.
                                ext = (uint16_t)(c.body_size | (c.top_size << 3)
                                                 | (c.top_kind << 6) | (c.align << 7));
                                for (int state = 0; state < 4; state++) {
                                    int hr = state & 1, hh = state >> 1;
                                    ViewSpec s = view_spec_resolve(c, hr, hh);
                                    // Measure the block where it starts: alignment moves a
                                    // stack nothing fills without changing its height.
                                    s.align = ALIGN_TOP;
                                    MainLayout L = layout_compute_spec(BOUNDS, &s, m);
                                    int start = (flags >> 1) ? START_NOSTRIP : START_STRIP;
                                    bool top_fill = (s.top == TOP_BAND_RADAR || s.top == TOP_BAND_GRAPH)
                                                    && s.top_size == BAND_SIZE_FILL;
                                    bool body_fill = s.body != BODY_NONE && s.body_size == BAND_SIZE_DEFAULT;
                                    printf("%d %u %u %d %d ", FAMILY, wire, ext, hr, hh);
                                    if (top_fill || body_fill) {
                                        bool fc = top_fill ? (s.top == TOP_BAND_GRAPH
                                                              && s.top_kind == TOP_GRAPH_FORECAST)
                                                           : (s.body == BODY_FORECAST);
                                        int fill_h = top_fill ? L.top.size.h : L.bottom.size.h;
                                        printf("F %d\n", fill_h >= (fc ? 3 : 2) * ROW);
                                    } else {
                                        int end = (s.body != BODY_NONE)
                                            ? L.bottom.origin.y + L.bottom.size.h : L.bottom.origin.y;
                                        printf("%c %d\n", end >= FLOOR ? 'C' : 'N', end - start);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return 0;
}
