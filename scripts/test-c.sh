#!/usr/bin/env bash
# Host-compiled C tests (no Pebble SDK): geometry goldens for src/c/windows/layout.c.
# layout.c is compiled twice so both platform variants of the #ifdefs are covered.
# PBL_HEALTH is defined so the dual-status carve compiles on the host.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/host
CFLAGS="-std=c11 -Wall -Wextra -Werror -DPBL_HEALTH -Itest/c/stub -Isrc"
# WW_QUICK_VIEW / WW_CLOCK_INK are defined for every non-aplite platform (wscript); the host
# layout test represents that evolving-platform build, so it exercises the peek view/layout and
# the clock ink centring. The aplite twin build below deliberately defines neither.
cc $CFLAGS -DWW_QUICK_VIEW -DWW_VIEW_CYCLE -DWW_CLOCK_INK test/c/layout_test.c src/c/windows/layout.c -o build/host/layout_test
cc $CFLAGS -DWW_QUICK_VIEW -DWW_VIEW_CYCLE -DWW_CLOCK_INK -DPBL_PLATFORM_EMERY test/c/layout_test.c src/c/windows/layout.c -o build/host/layout_test_emery
build/host/layout_test "${1:-}"
build/host/layout_test_emery "${1:-}"
# The phone's fit check (view-cycle.js stackNeed) must measure every custom shape exactly as
# the watch's layout engine lays it out: dump the engine's block heights per screen family
# and compare them line by line (scripts/check-fit-lockstep.js).
cc $CFLAGS -DWW_QUICK_VIEW -DWW_VIEW_CYCLE -DWW_CLOCK_INK test/c/fit_lockstep_dump.c src/c/windows/layout.c -o build/host/fit_lockstep_dump
cc $CFLAGS -DWW_QUICK_VIEW -DWW_VIEW_CYCLE -DWW_CLOCK_INK -DPBL_PLATFORM_EMERY test/c/fit_lockstep_dump.c src/c/windows/layout.c -o build/host/fit_lockstep_dump_emery
{ build/host/fit_lockstep_dump; build/host/fit_lockstep_dump_emery; } > build/host/fit_lockstep.txt
node scripts/check-fit-lockstep.js build/host/fit_lockstep.txt
# Aplite lean twin: compiled exactly as the aplite platform build (no PBL_HEALTH,
# no WW_QUICK_VIEW, no WW_VIEW_CYCLE), goldens equal layout_test.c's forecast cases.
cc -std=c11 -Wall -Wextra -Werror -Itest/c/stub -Isrc -DPBL_PLATFORM_APLITE \
   test/c/layout_aplite_test.c src/c/windows/layout_aplite.c -o build/host/layout_aplite_test
build/host/layout_aplite_test
# sizeof(Config) <= 64 (persist.c's change-compare buffer) for each platform arm of
# config.h: the evolving build, emery (large_graph_font), and aplite (no PBL_HEALTH, no
# !APLITE tail). A compile-time _Static_assert — the run just prints the size.
cc $CFLAGS test/c/config_size_test.c -o build/host/config_size_test
build/host/config_size_test
cc $CFLAGS -DPBL_PLATFORM_EMERY test/c/config_size_test.c -o build/host/config_size_test_emery
build/host/config_size_test_emery
cc -std=c11 -Wall -Wextra -Werror -Itest/c/stub -Isrc -DPBL_PLATFORM_APLITE \
   test/c/config_size_test.c -o build/host/config_size_test_aplite
build/host/config_size_test_aplite
cc $CFLAGS test/c/health_build_test.c src/c/services/health_build.c -o build/host/health_build_test
build/host/health_build_test
cc $CFLAGS test/c/health_test.c src/c/services/health.c -o build/host/health_test
build/host/health_test
cc $CFLAGS test/c/health_summary_test.c src/c/services/health_summary.c -o build/host/health_summary_test
build/host/health_summary_test
# WW_HOST_FAKE_TIME reroutes time(NULL) inside health_cache.c to the test's
# controllable clock (see test/c/stub/pebble.h).
cc $CFLAGS -DWW_HOST_FAKE_TIME test/c/health_cache_test.c src/c/services/health_cache.c src/c/services/health_build.c -o build/host/health_cache_test
build/host/health_cache_test
cc $CFLAGS test/c/radar_axis_test.c src/c/appendix/radar_axis.c -o build/host/radar_axis_test
build/host/radar_axis_test
cc $CFLAGS test/c/status_line_test.c src/c/appendix/status_line.c -o build/host/status_line_test
build/host/status_line_test
cc $CFLAGS test/c/status_threshold_test.c src/c/appendix/status_threshold.c -o build/host/status_threshold_test
build/host/status_threshold_test
cc $CFLAGS test/c/hr_scale_test.c src/c/appendix/hr_scale.c -o build/host/hr_scale_test
build/host/hr_scale_test
# Compiled twice like layout_test: status_highlight_extent's strip floor depends on the
# per-platform STATUS_STRIP_CAL_GAP.
cc $CFLAGS test/c/status_row_layout_test.c src/c/layers/status_row_layout.c -o build/host/status_row_layout_test
build/host/status_row_layout_test
cc $CFLAGS -DPBL_PLATFORM_EMERY test/c/status_row_layout_test.c src/c/layers/status_row_layout.c -o build/host/status_row_layout_test_emery
build/host/status_row_layout_test_emery
# status_icon_weight.h is header-only (a table + pure integer arithmetic), so the
# test needs no companion .c — that is also why the weight math lives in a header
# rather than inside the SDK-bound status_row.c. Built twice: the weight table is
# selected by #ifdef PBL_PLATFORM_EMERY (the tiers, and so the rounding plateaus,
# differ), so both initialisers need a run to be pinned.
cc $CFLAGS test/c/status_icon_weight_test.c -o build/host/status_icon_weight_test
build/host/status_icon_weight_test
cc $CFLAGS -DPBL_PLATFORM_EMERY test/c/status_icon_weight_test.c -o build/host/status_icon_weight_test_emery
build/host/status_icon_weight_test_emery
cc $CFLAGS test/c/status_row_alloc_test.c src/c/appendix/status_row_alloc.c -o build/host/status_row_alloc_test
build/host/status_row_alloc_test
# Header-only pure date-slot formatters (static inline in date_format.h, no .c file —
# the status_icon_weight pattern). Built once: no platform #ifdefs inside; aplite
# never compiles the caller (its status_row twin keeps the hardcoded formats).
cc $CFLAGS test/c/date_format_test.c -o build/host/date_format_test
build/host/date_format_test
cc $CFLAGS test/c/top_status_indicators_test.c -o build/host/top_status_indicators_test
build/host/top_status_indicators_test
# Header-only pure curve (static inline in hatch.h, no .c file — same pattern as
# top_status_indicators_test above). Compiled twice so both arms of
# HATCH_BASE_PLOT_H's emery #ifdef are covered.
cc $CFLAGS test/c/hatch_stride_test.c -o build/host/hatch_stride_test
build/host/hatch_stride_test
cc $CFLAGS -DPBL_PLATFORM_EMERY test/c/hatch_stride_test.c -o build/host/hatch_stride_test_emery
build/host/hatch_stride_test_emery
# The band status rows (forecast / radar / health) share ONE owner, so one test
# covers all three — including the radar row, which had no test of its own before
# and was the one carrying the missing-live-health bug. Built TWICE: the evolving
# build (all three bars) and an aplite-flavoured one with neither WW_RAIN_RADAR nor
# PBL_HEALTH, which is the only place STATUS_BAR_COUNT == 1 and a stray unguarded
# STATUS_BAR_RADAR / STATUS_BAR_HEALTH becomes a compile error — the shared CFLAGS
# force -DPBL_HEALTH everywhere else.
cc $CFLAGS -DWW_RAIN_RADAR -DWW_VIEW_CYCLE test/c/status_bar_test.c src/c/layers/status_bar.c -o build/host/status_bar_test
build/host/status_bar_test
cc -std=c11 -Wall -Wextra -Werror -Itest/c/stub -Isrc -DPBL_PLATFORM_APLITE \
   test/c/status_bar_test.c src/c/layers/status_bar.c -o build/host/status_bar_test_aplite
build/host/status_bar_test_aplite

# Header-only pure predicate (static inline in persist.h, no .c file — the
# date_format_test pattern): the acceptance rule for the inbound
# CLAY_NIGHT_LIGHT_UINT8 "Dim backlight" tuple, which is the one decision in
# app_message.c's unpack path that is not an SDK call (app_message.c itself needs
# the whole AppMessage + layer surface, so it cannot be host-compiled). Built THREE
# times: the wire itself is platform-independent, but persist.h's night-light
# accessors sit behind NIGHT_LIGHT_SUPPORTED, and both of that gate's terms
# (PBL_RGB_BACKLIGHT, the SDK capability, and PBL_PLATFORM_EMERY, the board that has
# it today) have to declare them — the test's own #error pins that, and each gated
# build proves the declarations parse.
cc $CFLAGS test/c/night_light_wire_test.c -o build/host/night_light_wire_test
build/host/night_light_wire_test
cc $CFLAGS -DPBL_RGB_BACKLIGHT test/c/night_light_wire_test.c -o build/host/night_light_wire_test_rgb
build/host/night_light_wire_test_rgb
cc $CFLAGS -DPBL_PLATFORM_EMERY test/c/night_light_wire_test.c -o build/host/night_light_wire_test_emery
build/host/night_light_wire_test_emery

# The other end of the same feature: the window predicate that decides, from the
# clock, whether the "Dim backlight" tint should be burning right now, plus its
# colour packer. Both are static inlines in appendix/night_light.h — the module's .c
# drives the LED through applib and reads flash through persist.h, so it cannot be
# host-compiled, and this is the only executable check the apply path gets. Built
# TWICE: without the gate (every platform but emery, where the header must still
# compile down to just these two helpers) and with -DWW_COLOR_BACKLIGHT, the flag
# wscript sets for emery, which additionally declares night_light_init/refresh/deinit.
# The runtime assertions are identical — the window arithmetic is not platform-bound.
cc $CFLAGS test/c/night_light_window_test.c -o build/host/night_light_window_test
build/host/night_light_window_test
cc $CFLAGS -DWW_COLOR_BACKLIGHT test/c/night_light_window_test.c -o build/host/night_light_window_test_color
build/host/night_light_window_test_color

# The third side of the same feature: the NIGHT_LIGHT persist accessors, run for
# real. appendix/persist.c needs nothing from the SDK but the persistent-storage
# syscalls, so the test fakes those over a RAM map and EXECUTES
# persist_set/get_night_light — which is what pins the change gating (a re-save of
# identical bytes must not reach flash) and the getter's short-read guard, neither
# of which any header-only test can reach. Built TWICE, once per term of persist.h's
# NIGHT_LIGHT_SUPPORTED gate, so both spellings are proven to DEFINE the accessors
# rather than merely declare them.
cc $CFLAGS -DPBL_RGB_BACKLIGHT test/c/night_light_persist_test.c src/c/appendix/persist.c \
   -o build/host/night_light_persist_test
build/host/night_light_persist_test
cc $CFLAGS -DPBL_PLATFORM_EMERY -DPBL_COLOR test/c/night_light_persist_test.c src/c/appendix/persist.c \
   -o build/host/night_light_persist_test_emery
build/host/night_light_persist_test_emery

# The LINE_STYLES byte decode (per-line marker styles, wire bytes [11..13] of
# CLAY_LINE_STYLE_UINT8): header-only static inlines in persist.h, mirrored
# against the JS packer's pins in test/line-style.test.js so the two wire ends
# cannot drift. Built with WW_LINE_STYLE — the only configuration that declares
# the helpers; aplite compiles them out together with their callers.
cc $CFLAGS -DWW_LINE_STYLE test/c/line_style_decode_test.c \
   -o build/host/line_style_decode_test
build/host/line_style_decode_test
# The solid line's gap/run kernel (chart_runs.h, header-only): segmentation of
# a polyline across absent samples, incl. the metric lines' zero_absent
# "wire byte 0 draws nothing" reading. Mirrored against the preview's UV
# segmentation pins in test/config-blocks.test.js.
cc $CFLAGS test/c/chart_absent_test.c -o build/host/chart_absent_test
build/host/chart_absent_test
# The stripe line style's arithmetic (chart_stripe.h, header-only): value ->
# level, the background->colour blend and the B&W dither. Mirrored against the
# preview's stripe pins in test/config-blocks.test.js.
cc $CFLAGS test/c/chart_stripe_test.c -o build/host/chart_stripe_test
build/host/chart_stripe_test
# The radar sky blob decode + bolt glyph (radar_sky.h, header-only), mirrored
# against radar-sky.js's packSky pin in test/radar-sky.test.js.
cc $CFLAGS test/c/radar_sky_test.c -o build/host/radar_sky_test
build/host/radar_sky_test
