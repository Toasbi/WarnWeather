// Host tests for the CLAY_NIGHT_LIGHT_UINT8 acceptance rule (persist.h's
// night_light_wire_ok) — the "Dim backlight" tint + window the phone packs in
// src/pkjs/night-light.js and app_message.c's handle_night_light persists.
//
// This is the only part of that unpack path that is pure integer arithmetic, and
// it is the part that decides whether a payload may OVERWRITE the last good
// persisted tuple, so it is the part worth pinning. app_message.c itself cannot be
// host-compiled (it needs the whole AppMessage + layer surface), which is exactly
// why the rule lives in a header instead of inside the handler.
//
// Built THREE times by scripts/test-c.sh: plain, with -DPBL_RGB_BACKLIGHT (the SDK's
// colour-backlight capability) and with -DPBL_PLATFORM_EMERY (the board that carries
// it today). The runtime assertions are identical on purpose — the WIRE is
// platform-independent, only the persist accessors behind it are gated — while the
// two gated builds prove persist.h's guarded declarations still parse, and the static
// check below pins the gate itself in all three.
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "c/appendix/persist.h"

// persist.h spells the gate once, as NIGHT_LIGHT_SUPPORTED, so the unpacker, the
// persist accessors and the apply cannot drift apart. Pin both of its terms: either
// one alone must light it up (an SDK too old for the capability macro must still
// build the feature on the board that has the hardware), and neither must not.
#if defined(PBL_RGB_BACKLIGHT) || defined(PBL_PLATFORM_EMERY)
#  if !defined(NIGHT_LIGHT_SUPPORTED)
#    error "NIGHT_LIGHT_SUPPORTED must follow PBL_RGB_BACKLIGHT / PBL_PLATFORM_EMERY"
#  endif
#elif defined(NIGHT_LIGHT_SUPPORTED)
#  error "NIGHT_LIGHT_SUPPORTED lit up on a build with no colour backlight"
#endif

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

// The tuple the phone actually sends for a red dim from 22:00 to 05:59.
static const uint8_t SAMPLE[NIGHT_LIGHT_BYTES] = { 96, 0, 0, 22, 6 };

static void wire_contract(void) {
    // Pinned against the phone side: test/inbox-size.test.js asserts the packed
    // tuple is 5 bytes, and night-light.js clamps both hour selects to 0..23.
    expect("bytes", NIGHT_LIGHT_BYTES, 5);
    expect("hour_max", NIGHT_LIGHT_HOUR_MAX, 23);
}

static void length_is_a_minimum(void) {
    expect("exact_len", night_light_wire_ok(SAMPLE, NIGHT_LIGHT_BYTES), 1);

    // Short = reject, at every length below the minimum. The caller keeps the last
    // good persisted tuple; a partially-applied window would be a made-up setting.
    uint8_t buf[16];
    memcpy(buf, SAMPLE, sizeof(SAMPLE));
    memset(buf + sizeof(SAMPLE), 0, sizeof(buf) - sizeof(SAMPLE));
    for (size_t len = 0; len < NIGHT_LIGHT_BYTES; len++) {
        expect("short_len", night_light_wire_ok(buf, len), 0);
    }

    // Longer = accept, per the growth contract (a newer phone appending a byte must
    // not have its whole tuple rejected by an older watch). Junk past byte [4] is
    // ignored, including junk that would be an illegal hour in an hour slot.
    buf[NIGHT_LIGHT_BYTES] = 200;
    buf[NIGHT_LIGHT_BYTES + 1] = 255;
    expect("long_len_6", night_light_wire_ok(buf, NIGHT_LIGHT_BYTES + 1), 1);
    expect("long_len_16", night_light_wire_ok(buf, sizeof(buf)), 1);

    expect("null_data", night_light_wire_ok(NULL, NIGHT_LIGHT_BYTES), 0);
    expect("null_zero_len", night_light_wire_ok(NULL, 0), 0);
}

static void the_off_tuple_is_valid(void) {
    // The switch turned off reaches the watch as five zero bytes — start == end is
    // this repo's "never" window (sleep-window.js), and it is the ONLY thing that
    // says "off". Reject it and the feature could never be turned off again.
    const uint8_t off[NIGHT_LIGHT_BYTES] = { 0, 0, 0, 0, 0 };
    expect("off_tuple", night_light_wire_ok(off, sizeof(off)), 1);

    // A user-configured zero-length window is the same shape with a real colour.
    const uint8_t never[NIGHT_LIGHT_BYTES] = { 96, 0, 0, 5, 5 };
    expect("zero_len_window", night_light_wire_ok(never, sizeof(never)), 1);
}

static void windows_may_wrap(void) {
    const uint8_t wrap[NIGHT_LIGHT_BYTES]     = { 10, 20, 30, 22, 6 };   // 22:00-05:59
    const uint8_t no_wrap[NIGHT_LIGHT_BYTES]  = { 10, 20, 30, 1, 5 };
    const uint8_t midnight[NIGHT_LIGHT_BYTES] = { 10, 20, 30, 23, 0 };   // 23:00-23:59
    const uint8_t all_day[NIGHT_LIGHT_BYTES]  = { 10, 20, 30, 0, 23 };
    expect("wrap", night_light_wire_ok(wrap, sizeof(wrap)), 1);
    expect("no_wrap", night_light_wire_ok(no_wrap, sizeof(no_wrap)), 1);
    expect("midnight_wrap", night_light_wire_ok(midnight, sizeof(midnight)), 1);
    expect("all_day", night_light_wire_ok(all_day, sizeof(all_day)), 1);
}

static void colour_bytes_never_gate_acceptance(void) {
    // Every 8-bit value is a legal channel: the LED driver takes 0..255 and scales
    // it by the user's brightness. Black is a pick (backlight effectively off), and
    // a 255 channel must not read as an out-of-range byte.
    const uint8_t black[NIGHT_LIGHT_BYTES] = { 0, 0, 0, 22, 6 };
    const uint8_t white[NIGHT_LIGHT_BYTES] = { 255, 255, 255, 22, 6 };
    expect("black_channels", night_light_wire_ok(black, sizeof(black)), 1);
    expect("max_channels", night_light_wire_ok(white, sizeof(white)), 1);

    uint8_t buf[NIGHT_LIGHT_BYTES] = { 0, 0, 0, 22, 6 };
    for (int ch = 0; ch < 3; ch++) {
        for (int v = 0; v <= 255; v++) {
            buf[ch] = (uint8_t) v;
            if (!night_light_wire_ok(buf, sizeof(buf))) {
                printf("FAIL channel %d value %d rejected\n", ch, v);
                s_failures++;
            }
        }
        buf[ch] = 0;
    }
}

static void hours_outside_the_clock_are_rejected(void) {
    // Rejected, NOT clamped: clamping 200 to 23 would invent a window nobody chose,
    // and for this feature the window is the on/off state.
    uint8_t buf[NIGHT_LIGHT_BYTES] = { 96, 0, 0, 0, 0 };
    int bad_start = 0, bad_end = 0, good = 0;
    for (int start = 0; start <= 255; start++) {
        for (int end = 0; end <= 255; end++) {
            buf[3] = (uint8_t) start;
            buf[4] = (uint8_t) end;
            const int ok = night_light_wire_ok(buf, sizeof(buf)) ? 1 : 0;
            const int want = (start <= NIGHT_LIGHT_HOUR_MAX
                              && end <= NIGHT_LIGHT_HOUR_MAX) ? 1 : 0;
            if (ok != want) {
                printf("FAIL hours %d..%d: got %d want %d\n", start, end, ok, want);
                s_failures++;
            }
            if (want) { good++; }
            else if (start > NIGHT_LIGHT_HOUR_MAX) { bad_start++; }
            else { bad_end++; }
        }
    }
    // Every legal clock pair is accepted, and a legal byte in one slot never
    // rescues an illegal one in the other.
    expect("legal_pairs", good, 24 * 24);
    expect("bad_start_pairs", bad_start, 232 * 256);
    expect("bad_end_pairs", bad_end, 24 * 232);
}

int main(void) {
    wire_contract();
    length_is_a_minimum();
    the_off_tuple_is_valid();
    windows_may_wrap();
    colour_bytes_never_gate_acceptance();
    hours_outside_the_clock_are_rejected();
    if (s_failures) { printf("%d failure(s)\n", s_failures); return 1; }
    printf("night_light_wire_test OK\n");
    return 0;
}
