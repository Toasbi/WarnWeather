// Host dump for scripts/check-row-swap-lockstep.js: the watch's status row layout
// (status_row_layout.c status_row_layout) with the short forms the slots brought swapped in
// (status_row_swap_short_forms), over a sweep of three slots' measures and three row widths,
// so the settings page's copy (preview-watch.js swapShortForms) can be compared line by
// line. Built once by scripts/test-c.sh. Line format:
//   "<content_w> <slot> <slot> <slot> <swapped> <place> <place> <place>"
// a slot "<icon_w>,<text_w>,<suffix_w>,<alt_w>,<own>" (alt_w -1: it brought no short form;
// own 1: it gives way only where its own text is cut, as the date does) or "-" when empty;
// <swapped> the slots that swapped, bit i for slot i; a place "<x>,<text_w>" for a slot that
// shows, x its group's left edge, or "-" for one that doesn't.
#include <stdio.h>
#include "c/appendix/status_row_layout.h"

#define COUNT(a) ((int)(sizeof(a) / sizeof((a)[0])))

static const int16_t WIDTHS[] = { 64, 138, 196 };
static const int16_t ICONS[] = { 0, 10 };
static const int16_t TEXTS[] = { 0, 30, 90 };
static const int16_t SUFFIXES[] = { 0, 6 };
// The short form a slot brought: none, one, or one it takes only where its own text is cut.
static const int16_t ALTS[] = { -1, 20, 20 };
static const uint8_t OWNS[] = { 0, 0, 1 };
#define OPTIONS (1 + COUNT(ICONS) * COUNT(TEXTS) * COUNT(SUFFIXES) * COUNT(ALTS))

// Option `o` of a slot: 0 empty, else one of the measures above.
static void option(int o, StatusSlotMeasure *m, int16_t *alt, uint8_t *own) {
    *m = (StatusSlotMeasure) { false, 0, 0, 0 };
    *alt = -1;
    *own = 0;
    if (o == 0) { return; }
    o--;
    int a = o % COUNT(ALTS);
    o /= COUNT(ALTS);
    int s = o % COUNT(SUFFIXES);
    o /= COUNT(SUFFIXES);
    int t = o % COUNT(TEXTS);
    o /= COUNT(TEXTS);
    *m = (StatusSlotMeasure) { true, ICONS[o], TEXTS[t], SUFFIXES[s] };
    *alt = ALTS[a];
    *own = OWNS[a];
}

int main(void) {
    for (int w = 0; w < COUNT(WIDTHS); w++) {
        for (int o = 0; o < OPTIONS * OPTIONS * OPTIONS; o++) {
            StatusSlotMeasure m[3];
            int16_t alt[3];
            uint8_t own[3];
            option(o % OPTIONS, &m[0], &alt[0], &own[0]);
            option((o / OPTIONS) % OPTIONS, &m[1], &alt[1], &own[1]);
            option(o / (OPTIONS * OPTIONS), &m[2], &alt[2], &own[2]);
            printf("%d", WIDTHS[w]);
            for (int k = 0; k < 3; k++) {
                if (m[k].present) {
                    printf(" %d,%d,%d,%d,%u", m[k].icon_w, m[k].text_w, m[k].suffix_w, alt[k],
                           (unsigned)own[k]);
                } else {
                    printf(" -");
                }
            }
            // The plain layout first: the swap leaves it as it is when no slot brought a form.
            StatusSlotPlace p[3];
            status_row_layout(WIDTHS[w], m, p);
            const uint8_t owns = (uint8_t)(own[0] | (own[1] << 1) | (own[2] << 2));
            uint8_t swapped = status_row_swap_short_forms(WIDTHS[w], m, alt, owns, p);
            printf(" %u", (unsigned)swapped);
            for (int k = 0; k < 3; k++) {
                if (p[k].visible) {
                    printf(" %d,%d", p[k].icon_x, p[k].text_w);
                } else {
                    printf(" -");
                }
            }
            printf("\n");
        }
    }
    return 0;
}
