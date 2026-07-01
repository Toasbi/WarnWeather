# Aplite is a frozen, lean source-fork; other platforms evolve

Aplite (Pebble Classic/Steel) has a fixed 24 KB image+heap budget that a growing
feature set can no longer fit, so aplite becomes a **frozen, lean variant**: for
files that diverge, aplite gets its own self-contained `foo_aplite.c` (no color
code, no inapplicable features), selected by a build-level source filter in
`wscript`, while every other platform keeps the full-featured shared `foo.c`. We
chose whole-file forks over interleaved `#ifdef PBL_PLATFORM_APLITE` because the
shared files are already hard to read and the freeze means there is no parallel
*feature* evolution to keep in sync.

## Considered options

- **Interleaved `#ifdef`** — rejected: piles more conditionals into files that
  are already hard to read, for savings `--gc-sections` only partly realizes.
- **Color/B&W split** — rejected: diorite is also B&W but has ample RAM, so it
  stays on the shared file and renders B&W via `PBL_IF_COLOR_ELSE`. The real axis
  is *memory-constrained-and-frozen* (aplite) vs *evolving* (everyone else), not
  color.
- **Whole-file source-fork (chosen)** — a dedicated lean file makes dead
  color/feature code obvious to cut, and `--gc-sections` reaps whatever the lean
  file stops referencing (including shared contract helpers), so contract files
  (`app_message.c`, `persist.c`, `config.c`) stay unified.

## Consequences

- "Frozen" means **feature-frozen, not code-frozen**: twins still receive
  hand-ported bugfixes and link-error-forced interface updates — they only never
  gain new features.
- The build's link check catches *interface* skew (a missing symbol) but not
  *behavioral* drift (a shared bugfix the twin silently misses), so a
  provenance-SHA header plus a "twins move together" CI check guard the gap.
- Twins are reserved for true **substitution** (aplite must still answer the
  interface, e.g. palette). Features merely *absent* on aplite use **exclusion**
  (own leaf file, guarded entry points, no duplicate) instead.
