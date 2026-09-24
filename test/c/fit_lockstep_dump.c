// Host dump for scripts/check-fit-lockstep.js: the block height the watch's ONE layout engine
// (layout.c compute_layout) gives every sized / graphless custom shape, so the phone's fit
// check (view-cycle.js stackNeed) can be compared with it line by line. Built once per screen
// family by scripts/test-c.sh. Line format: "<family> <wire> <ext> <need>".
// Only unclamped stacks are printed (block end above the floor): a clamped one has no
// measurable need, and the fit check's verdict for it is "does not fit" either way.
#include <stdio.h>
#include "c/windows/layout.h"

#ifdef PBL_PLATFORM_EMERY
#define FAMILY 1
#define BOUNDS GRect(0, 0, 200, 228)
#define START_STRIP 22
#define START_NOSTRIP 2
#define FLOOR 224
#else
#define FAMILY 0
#define BOUNDS GRect(0, 0, 144, 168)
#define START_STRIP 13
#define START_NOSTRIP 0
#define FLOOR 168
#endif

int main(void) {
    // tops: { wire tier, wire top, top_kind, sizes } — calendar 2/3, none, radar, graphs
    const struct { int tier, top, kind; } tops[] = {
        { 2, 1, 0 }, { 3, 1, 0 }, { 1, 0, 0 }, { 3, 2, 0 }, { 1, 3, 0 }, { 1, 3, 1 },
    };
    const int top_sizes[] = { 0, BAND_SIZE_2, BAND_SIZE_4 };
    const int bodies[] = { BODY_FORECAST, BODY_HEALTH_GRAPH, BODY_RADAR };
    const int body_sizes[] = { BAND_SIZE_2, BAND_SIZE_3, BAND_SIZE_4 };
    const int rows[][2] = { { 0, 0 }, { 1, 0 }, { 0, 2 }, { 1, 2 } };
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
        for (unsigned ts = 0; ts < (sized ? 3u : 1u); ts++) {
            for (int bi = -1; bi < 3; bi++) {
                for (unsigned bs = 0; bs < (bi < 0 ? 1u : 3u); bs++) {
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
                                ViewSpec s = view_spec_unpack(wire);
                                view_spec_apply_ext(&s, ext);
                                MainLayout L = layout_compute_spec(BOUNDS, &s, m);
                                int end = (body != BODY_NONE) ? L.bottom.origin.y + L.bottom.size.h
                                                              : L.bottom.origin.y;
                                if (end >= FLOOR) { continue; }
                                int start = (flags >> 1) ? START_NOSTRIP : START_STRIP;
                                printf("%d %u %u %d\n", FAMILY, wire, ext, end - start);
                            }
                        }
                    }
                }
            }
        }
    }
    return 0;
}
