#!/usr/bin/env bash
# Host-compiled C tests (no Pebble SDK): geometry goldens for src/c/windows/layout.c.
# layout.c is compiled twice so both platform variants of the #ifdefs are covered.
# PBL_HEALTH is defined so the dual-status carve compiles on the host.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/host
CFLAGS="-std=c11 -Wall -Wextra -Werror -DPBL_HEALTH -Itest/c/stub -Isrc"
cc $CFLAGS test/c/layout_test.c src/c/windows/layout.c -o build/host/layout_test
cc $CFLAGS -DPBL_PLATFORM_EMERY test/c/layout_test.c src/c/windows/layout.c -o build/host/layout_test_emery
build/host/layout_test "${1:-}"
build/host/layout_test_emery "${1:-}"
