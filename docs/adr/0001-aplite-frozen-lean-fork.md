# Aplite is a frozen, lean source-fork; other platforms evolve

Aplite (Pebble Classic/Steel) has a fixed 24 KB image+heap budget that a growing feature set
cannot fit, so aplite is a frozen, lean variant. For files that diverge, aplite gets its own
self-contained `foo_aplite.c` (no color code, no inapplicable features), selected by a
build-level source filter in `wscript`. Every other platform keeps the full-featured shared
`foo.c`. Whole-file forks were chosen over interleaved `#ifdef PBL_PLATFORM_APLITE` because the
shared files are already hard to read, and the freeze means there is no parallel feature
evolution to keep in sync.

## Considered options

- Interleaved `#ifdef`. Rejected: it piles more conditionals into files that are already hard
  to read, for savings `--gc-sections` only partly realizes.
- Color/B&W split. Rejected: diorite is also B&W but has ample RAM, so it stays on the shared
  file and renders B&W via `PBL_IF_COLOR_ELSE`. The axis that matters is memory-constrained and
  frozen (aplite) against evolving (everyone else).
- Whole-file source-fork (chosen). A dedicated lean file makes dead color and feature code
  obvious to cut, and `--gc-sections` reaps whatever the lean file stops referencing (shared
  contract helpers included), so the contract files (`app_message.c`, `persist.c`, `config.c`)
  stay unified.

## Consequences

- Frozen means feature-frozen. Twins still receive hand-ported bugfixes and interface updates
  forced by link errors; they never gain new features.
- The build's link check catches interface skew (a missing symbol) but misses behavioral drift
  (a shared bugfix the twin silently lacks). A provenance-SHA header and a CI check that twins
  move together cover that gap.
- Twins are for substitution only, where aplite must still answer the interface (the palette,
  for example). A feature that is absent on aplite uses exclusion instead: its own leaf file,
  guarded entry points, no duplicate.
