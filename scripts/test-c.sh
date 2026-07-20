#!/usr/bin/env bash
# Host-compiled C tests (no Pebble SDK): geometry goldens for src/c/windows/layout.c.
# layout.c is compiled twice so both platform variants of the #ifdefs are covered.
# PBL_HEALTH is defined so the dual-status carve compiles on the host.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/host
CFLAGS="-std=c11 -Wall -Wextra -Werror -DPBL_HEALTH -Itest/c/stub -Isrc"
# WW_QUICK_VIEW is defined for every non-aplite platform (wscript); the host layout test
# represents that evolving-platform build, so it exercises the peek view/layout.
cc $CFLAGS -DWW_QUICK_VIEW -DWW_VIEW_CYCLE test/c/layout_test.c src/c/windows/layout.c -o build/host/layout_test
cc $CFLAGS -DWW_QUICK_VIEW -DWW_VIEW_CYCLE -DPBL_PLATFORM_EMERY test/c/layout_test.c src/c/windows/layout.c -o build/host/layout_test_emery
build/host/layout_test "${1:-}"
build/host/layout_test_emery "${1:-}"
# Aplite lean twin: compiled exactly as the aplite platform build (no PBL_HEALTH,
# no WW_QUICK_VIEW, no WW_VIEW_CYCLE), goldens equal layout_test.c's forecast cases.
cc -std=c11 -Wall -Wextra -Werror -Itest/c/stub -Isrc -DPBL_PLATFORM_APLITE \
   test/c/layout_aplite_test.c src/c/windows/layout_aplite.c -o build/host/layout_aplite_test
build/host/layout_aplite_test
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
cc $CFLAGS test/c/status_row_layout_test.c src/c/layers/status_row_layout.c -o build/host/status_row_layout_test
build/host/status_row_layout_test
cc $CFLAGS test/c/status_row_alloc_test.c src/c/appendix/status_row_alloc.c -o build/host/status_row_alloc_test
build/host/status_row_alloc_test
cc $CFLAGS test/c/top_status_indicators_test.c -o build/host/top_status_indicators_test
build/host/top_status_indicators_test
cc $CFLAGS test/c/weather_status_layer_test.c src/c/layers/weather_status_layer.c -o build/host/weather_status_layer_test
build/host/weather_status_layer_test
cc $CFLAGS test/c/health_status_layer_test.c src/c/layers/health_status_layer.c -o build/host/health_status_layer_test
build/host/health_status_layer_test
