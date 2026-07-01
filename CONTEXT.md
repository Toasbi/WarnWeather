# ForecasWetter

A Pebble weather watchface: a C watchface (`src/c/`) driven by phone-side
PebbleKit JS (`src/pkjs/`), with a Clay config UI and a Supabase telemetry
backend. This file is the project's glossary — the canonical vocabulary. Keep it
free of implementation detail.

## Platform divergence

The strategy for keeping aplite within its fixed 24 KB budget while other
platforms grow (see [ADR 0001](./docs/adr/0001-aplite-frozen-lean-fork.md)).

**Lean twin**:
An aplite-only `foo_aplite.c` reimplementing the same declared interface as the
shared `foo.c`, cheaply and without color code. Used only when aplite callers
must still invoke the interface — a *substitution*.
_Avoid_: aplite variant, aplite fork (say "lean twin").

**Exclusion**:
An aplite-absent feature: it lives in its own leaf file whose entry points are
guarded so nothing on aplite references it and `--gc-sections` reaps it whole. No
twin, no duplicate.
_Avoid_: aplite-disabled, stubbed-out.

**Shared contract file**:
A file whose wire format, on-flash format, or config schema must stay identical
across platforms (`app_message.c`, `persist.c`, `config.c`). Never forked.

**Frozen (of a lean twin)**:
Feature-frozen, not code-frozen — a twin never gains new features but still
receives hand-ported bugfixes and interface updates.
