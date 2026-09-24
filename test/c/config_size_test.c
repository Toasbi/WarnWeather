// Host guard: Config must fit persist.c's 64-byte change-compare buffer.
// write_data_if_changed (src/c/appendix/persist.c) reads the stored blob into a 64 B
// stack buffer and skips the flash write when nothing changed; a Config larger than
// that falls through to an UNCONDITIONAL write on every settings apply — silent flash
// churn, no failing test. Config only ever grows at its end (append-only persist
// offsets; custom layout v2 appended view_ext[3], +6 B), so pin the ceiling per
// platform arm of config.h. Built by scripts/test-c.sh once per platform define.
// (The host stub's GColor may be wider than the watch's 1-byte GColor8, so the host
// size is an upper bound — conservative in the direction that matters.)
#include <stdio.h>
#include "c/appendix/config.h"

_Static_assert(sizeof(Config) <= 64,
               "Config outgrew persist.c's 64 B change-compare buffer (write_data_if_changed)");

int main(void) {
    printf("config_size_test OK (%u B)\n", (unsigned) sizeof(Config));
    return 0;
}
