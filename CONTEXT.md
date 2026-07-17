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

## Layout

**View spec**:
The small struct describing what is on screen: top-band content, calendar
rows, body, status row(s), font tier, band size weights. Geometry and layer
visibility both derive from it. Producers make specs (today the preset
compiler + flick state; later the à-la-carte settings); the layout module
consumes them.

**Preset (layout)**:
A named built-in view spec — Full, Compact, None (± dual status). Presets are
compiled to view specs; they are not a separate code path.

**Stop (flick)**:
One position in the wrist-flick cycle: a view spec shown when the user flicks.
Today the stops are hardcoded transitions; the à-la-carte plan makes them user
data.

**Tier push**:
Per-view layout facts (calendar rows, the date slot's full-date mode, graph gap,
status tier and line id) flow one way: view spec → window → owning layer →
consumed state (a layer static or per-instance row field). Layers never read
tier facts from config; config's `top_view_mode` is wire/flash compat only.

## Settings pipeline

**Clay bundle**:
The settings AppMessage as it rides the wire: all watch-bound settings keys
(`CLAY_*` + packed holidays + palettes) sent atomically in one message —
`sendClay` never splits it. Distinct from the *weather* message, which is
split per category.

**Wire manifest**:
The single description of the Clay bundle's contract: every watch-bound key
with its wire kind (bool/int16/color/blob) and C config field. The manifest is
what the drift tests check the payload builder, `messageKeys`, and the C
parser against.

**Guarded key (of the Clay bundle)**:
A key in `config_parse_wire`'s all-or-nothing presence chain
(`src/c/appendix/config_wire.c`). The chain is
the *category detector* — it distinguishes "this message carries no config"
(normal for weather messages) from "carries config". Holidays and palettes are
deliberately unguarded: they have their own handlers and dirty flags, so a
parse problem there can't take the whole config down.

## Channel

**Half-duplex channel**:
The phone↔watch AppMessage link: one message in flight at a time — a second
send issued before the ACK collides and is dropped. Every send-ordering rule
on the phone side derives from this constraint.

**Channel scheduler**:
The module that decides *when* anything rides the channel (startup handshake,
config-close chaining, day-change resend, minute tick). The outbox decides
*what* rides it (dedupe, one-message bundling, ACK-gated cache commit).
_Avoid_: send queue.

## Radar

**Radar source**:
The user-selected origin of the short-term rain nowcast — DWD (exact spot +
nearby area, Germany-only) or Rainbow (exact spot only, worldwide) — chosen
independently of the weather provider. Every source answers the same
interface; "off" is itself a source whose tuples clear the radar.
_Avoid_: radar provider in prose (the wire key `radarProvider` keeps its name).

**Radar tuples**:
The wire triplet every radar source produces: exact-spot trend, nearby-area
trend, and the slot-0 start epoch. Empty trends with a zero start mean "clear
the radar on the watch".

**Slot (radar)**:
One five-minute bucket of the two-hour nowcast window; slot 0 is pinned to the
most recent wall-clock five-minute boundary. Slot alignment is what lets the
dedupe treat a time-shifted but otherwise identical radar as unchanged.
