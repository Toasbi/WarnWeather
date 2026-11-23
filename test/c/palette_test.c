// Host test for the two palette channels (appendix/palette.c), the bars' and the radar's:
// a channel holds what was set; a set of the same stops reports no change and is not saved
// again; a malformed blob changes nothing; before the first set a channel reads its stops
// from persist once, and falls back to the defaults when persist holds no valid blob.
// Built twice by scripts/test-c.sh, once per arm of theme.h the watches take: a colour
// build (basalt, emery) and a B&W one (diorite, flint). aplite takes palette_aplite.c.
#include <stdio.h>
#include <string.h>

#include "c/appendix/palette.h"
#include "c/appendix/persist.h"
#include "c/appendix/theme.h"

static int s_failures;

static void expect(const char *name, long got, long want) {
    if (got != want) {
        printf("FAIL %s: got %ld want %ld\n", name, got, want);
        s_failures++;
    }
}

// ── Fakes: the theme and one persisted blob per channel ─────────────────────────────

static bool s_light;
GColor theme_bg(void) { return s_light ? GColorWhite : GColorBlack; }
#if defined(PBL_COLOR)
static bool s_bw;
bool theme_is_bw(void) { return s_bw; }
GColor theme_pick(GColor color_arm, GColor bw_arm) { return s_bw ? bw_arm : color_arm; }
#endif

typedef struct {
    uint8_t blob[PALETTE_MAX_STOPS * 3];
    int len;        // <= 0: no blob stored
    int reads;
    int writes;
} FakeKey;

static FakeKey s_bar_key;
static FakeKey s_radar_key;

static int fake_read(FakeKey *k, uint8_t *buffer, size_t size) {
    k->reads++;
    if (k->len <= 0) { return -1; }   // E_DOES_NOT_EXIST, as the SDK reads a missing key
    const int n = k->len < (int) size ? k->len : (int) size;
    memcpy(buffer, k->blob, (size_t) n);
    return n;
}

static bool fake_write(FakeKey *k, const uint8_t *data, size_t size) {
    k->writes++;
    memcpy(k->blob, data, size);
    k->len = (int) size;
    return true;
}

int persist_get_bar_palette(uint8_t *buffer, const size_t buffer_size) {
    return fake_read(&s_bar_key, buffer, buffer_size);
}
bool persist_set_bar_palette(uint8_t *data, const size_t size) {
    return fake_write(&s_bar_key, data, size);
}
int persist_get_radar_palette(uint8_t *buffer, const size_t buffer_size) {
    return fake_read(&s_radar_key, buffer, buffer_size);
}
bool persist_set_radar_palette(uint8_t *data, const size_t size) {
    return fake_write(&s_radar_key, data, size);
}

// ── Checks ──────────────────────────────────────────────────────────────────────────

// Stops as the wire packs them: from (int16 LE), then the GColor8 byte.
static void expect_stops(const char *name, const ChartColorStop *stops, int n,
                         const int16_t *from, const uint8_t *argb, int want_n) {
    char label[96];
    snprintf(label, sizeof(label), "%s count", name);
    expect(label, n, want_n);
    for (int i = 0; i < n && i < want_n; i++) {
        snprintf(label, sizeof(label), "%s stop %d from", name, i);
        expect(label, stops[i].from, from[i]);
        snprintf(label, sizeof(label), "%s stop %d colour", name, i);
        expect(label, stops[i].color.argb, argb[i]);
    }
}

// A set, then the same stops again, then malformed blobs: the bars' channel, after its
// first read (test_first_read).
static void test_set(void) {
    const int reads = s_bar_key.reads;
    const uint8_t two[] = { 0x00, 0x00, 0xC3, 0x2C, 0x01, 0xF5 };        // 0: blue, 300: red
    const int16_t two_from[] = { 0, 300 };
    const uint8_t two_argb[] = { 0xC3, 0xF5 };
    expect("set: a new palette changes the channel", palette_set_bar(two, sizeof(two)), 1);
    expect("set: and is saved", s_bar_key.writes, 1);
    expect("set: saved as sent", memcmp(s_bar_key.blob, two, sizeof(two)), 0);

    int n = 0;
    const ChartColorStop *stops = palette_bar_stops(&n);
    expect_stops("set", stops, n, two_from, two_argb, 2);
    expect("set: a set channel never reads persist again", s_bar_key.reads, reads);

    expect("same: no change", palette_set_bar(two, sizeof(two)), 0);
    expect("same: not saved again", s_bar_key.writes, 1);

    const uint8_t three[] = { 0x00, 0x00, 0xC3, 0x2C, 0x01, 0xF5, 0x58, 0x02, 0xFC };
    expect("more stops: a change", palette_set_bar(three, sizeof(three)), 1);
    expect("more stops: saved", s_bar_key.writes, 2);
    expect("fewer stops: a change", palette_set_bar(two, sizeof(two)), 1);
    expect("fewer stops: saved", s_bar_key.writes, 3);

    const uint8_t recoloured[] = { 0x00, 0x00, 0xC3, 0x2C, 0x01, 0xFC };
    expect("a stop's colour: a change", palette_set_bar(recoloured, sizeof(recoloured)), 1);
    const uint8_t moved[] = { 0x00, 0x00, 0xC3, 0x2D, 0x01, 0xFC };
    expect("a stop's threshold: a change", palette_set_bar(moved, sizeof(moved)), 1);
    expect("each change saved", s_bar_key.writes, 5);

    const uint8_t six[18] = { 0 };
    expect("malformed: empty", palette_set_bar(two, 0), 0);
    expect("malformed: not a multiple of 3", palette_set_bar(two, 5), 0);
    expect("malformed: more stops than a palette holds", palette_set_bar(six, sizeof(six)), 0);
    expect("malformed: nothing saved", s_bar_key.writes, 5);
    stops = palette_bar_stops(&n);
    const int16_t moved_from[] = { 0, 301 };
    const uint8_t moved_argb[] = { 0xC3, 0xFC };
    expect_stops("malformed: the channel keeps its stops", stops, n, moved_from, moved_argb, 2);
}

#if defined(PBL_COLOR)
// Colour build: the bars' channel starts on the five rain-tier defaults when persist holds
// nothing, and the radar's on its persisted blob.
static void test_first_read(void) {
    int n = 0;
    const ChartColorStop *stops = palette_bar_stops(&n);
    const int16_t from[] = { 0, 140, 340, 560, 780 };
    const uint8_t argb[] = { GColorLightGray.argb, GColorElectricBlue.argb, GColorGreen.argb,
                             GColorYellow.argb, GColorSunsetOrange.argb };
    expect_stops("defaults", stops, n, from, argb, 5);
    expect("defaults: persist read once", s_bar_key.reads, 1);
    palette_bar_stops(&n);
    expect("defaults: not read again", s_bar_key.reads, 1);

    const uint8_t blob[] = { 0x00, 0x00, 0xC3, 0x64, 0x00, 0xCC };      // 0: blue, 100: green
    memcpy(s_radar_key.blob, blob, sizeof(blob));
    s_radar_key.len = sizeof(blob);
    stops = palette_radar_stops(&n);
    const int16_t radar_from[] = { 0, 100 };
    const uint8_t radar_argb[] = { 0xC3, 0xCC };
    expect_stops("persisted", stops, n, radar_from, radar_argb, 2);
    palette_radar_stops(&n);
    expect("persisted: read once", s_radar_key.reads, 1);
    expect("persisted: not written back", s_radar_key.writes, 0);

    // The radar's per-tier colour: tier 1..n its stop, past n the last, 0 white.
    expect("tier 0", palette_radar_color(0).argb, GColorWhite.argb);
    expect("tier 1", palette_radar_color(1).argb, 0xC3);
    expect("tier 2", palette_radar_color(2).argb, 0xCC);
    expect("tier past the last stop", palette_radar_color(4).argb, 0xCC);
    s_bw = true;
    expect("tier 0, Black & White theme", palette_radar_color(0).argb, GColorBlack.argb);
    s_bw = false;
}
#else
// B&W build: a malformed persisted blob leaves the bars' channel on its one default stop,
// the theme's background (light here); an absent one does the same for the radar's.
static void test_first_read(void) {
    const uint8_t blob[] = { 0x00, 0x00, 0xC3, 0x64 };                  // 4 B: malformed
    memcpy(s_bar_key.blob, blob, sizeof(blob));
    s_bar_key.len = sizeof(blob);
    s_light = true;
    int n = 0;
    const ChartColorStop *stops = palette_bar_stops(&n);
    const int16_t from[] = { 0 };
    const uint8_t white[] = { GColorWhite.argb };
    expect_stops("malformed persisted", stops, n, from, white, 1);
    expect("malformed persisted: read once", s_bar_key.reads, 1);
    expect("malformed persisted: not written back", s_bar_key.writes, 0);

    s_light = false;
    stops = palette_radar_stops(&n);
    const uint8_t black[] = { GColorBlack.argb };
    expect_stops("absent", stops, n, from, black, 1);
    expect("tier 0", palette_radar_color(0).argb, GColorBlack.argb);
    expect("tier past the one stop", palette_radar_color(3).argb, GColorBlack.argb);
}
#endif

#if defined(PBL_PLATFORM_EMERY)
// emery: a graph style's own palette parses as a channel's would, and stores nothing.
static void test_parse_stops(void) {
    ChartColorStop out[PALETTE_MAX_STOPS];
    const uint8_t blob[] = { 0x00, 0x00, 0xC3, 0x2C, 0x01, 0xF5 };
    expect("parse: count", palette_parse_stops(blob, sizeof(blob), out), 2);
    expect("parse: from", out[1].from, 300);
    expect("parse: colour", out[1].color.argb, 0xF5);
    expect("parse: malformed", palette_parse_stops(blob, 4, out), -1);
    expect("parse: nothing saved", s_bar_key.writes + s_radar_key.writes, 5);   // test_set's

}
#endif

int main(void) {
    test_first_read();
    test_set();
#if defined(PBL_PLATFORM_EMERY)
    test_parse_stops();
#endif
    if (s_failures) {
        printf("palette_test: %d failure(s)\n", s_failures);
        return 1;
    }
    printf("palette_test: ok\n");
    return 0;
}
