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
A named built-in view spec, keyed by the `layoutPreset` setting: `fullCal`,
`compactCal`, `compactDense` (stays dense — health/radar status paired — even
without a body), or `noCal`. Presets are compiled to view specs; they are not
a separate code path.

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

**Fetch cycle**:
The module that runs *one* weather fetch from trigger to record
(`src/pkjs/fetch-cycle.js`): the refresh gates (marker, slot, sleep pause,
failure backoff), the single-flight rule and its queued force, the watchdog and
late-completion guard, the attempt counter, the sleep commit and the
success/failure records. The scheduler asks it two things — `shouldFetchNow`
and `start(force)` — and everything it depends on (clock, timer, provider,
settings, outbox) is injected.
_Avoid_: fetch orchestrator, refresh loop.

## Weather

**Fetch options**:
The one per-fetch value of knobs every adapter and auxiliary fetch reads
(`provider.options`, built by `weather/fetch-options.js` from the settings):
which optional series are wanted (UV, AQI, pollen, feels), the feels formula,
the day-max codes, the wind unit, the AQI scale/source/token. Every default
lives there; nothing downstream carries its own fallback.
_Avoid_: provider flags, per-fetch knobs.

**Mapped forecast**:
The plain object an adapter's `withProviderData` produces from its API
response(s) — the series, scalars and feels inputs named by
`WeatherProvider.MAPPED_KEYS` — and hands to `adoptMapped`, which applies the
fetch options' gates and the one missing-value convention per field and writes
the instance. An adapter maps; only adopt decides.
_Avoid_: normalized provider fields, provider instance shape.

## Radar

**Radar source**:
The user-selected origin of the short-term rain nowcast — DWD (best radar in
Germany, exact spot + nearby area), Met.no (best radar in the Nordics, exact
spot), Rainbow (global satellite + radar nowcast, exact spot, worldwide), or
Tomorrow.io (ML nowcast on the user's own key, exact spot, worldwide) — chosen
independently of the weather provider. Every source answers the same interface;
"off" is itself a source whose tuples clear the radar. Rainbow is two sources,
and the Radar tab's picker offers both: "Rainbow (limited)", shared Rainbow
(id `rainbow`), goes through the project's proxy
on the project's key and its monthly allowance, so it refreshes at most every
30 minutes (one request per UTC-aligned half-hour slot, wherever the watch is:
a move within the slot keeps the slot's answer until the next slot); "Rainbow
(own key)" (id `rainbowkey`) fetches the same nowcast directly on the user's
own key at every update, on a key whose first 5,000 calls a month are free
(Rainbow asks for a credit card and bills calls past that). `rainbowkey` is
never a stored `radarProvider`: the settings store the own key as `rainbow`
plus `rainbowOwnKey` true (as since 1.23.1, when it was a switch), the page
folds that pair into the picker while it is open and writes it back on Save,
and `radar-source-id.js` resolves it everywhere else. Picked without a key, the
own-key source clears the radar. Wherever the own key can't be set, it is the
limited one.
_Avoid_: radar provider in prose (the wire key `radarProvider` keeps its name).

**Radar tuples**:
The wire triplet every radar source produces: exact-spot trend, nearby-area
trend, and the slot-0 start epoch. Empty trends with a zero start mean "clear
the radar on the watch".

**Radar limit notice**:
The third radar answer, beside a window and the clear: the source is up but
refuses us because a request limit is reached (HTTP 429 from the shared
Rainbow proxy, Rainbow on the user's own key or Tomorrow.io). It rides alone as
`RAIN_RADAR_LIMITED`, the phone's line ("Radar limit reached"), never with the
radar tuples; the watch keeps its window and, where that window shows no rain,
says that line instead of the no-rain line. With no window yet (a fresh
install, or right after a clear) the radar view still shows, carrying just the
notice. The next radar tuples (a window or the clear) end it.
_Avoid_: calling it transient — a transient failure sends no radar keys at all.

**Out of coverage (radar)**:
A place outside a regional radar source's area: DWD's composite around Germany,
Met.no's Nordic nowcast (weather/radar-coverage.js; Rainbow and Tomorrow.io
are worldwide). No request goes out; the answer is the clear carrying the
source's line in `RAIN_RADAR_LIMITED` ("DWD radar: Germany only"), so the
watch's radar says why it is empty, and the settings show an amber note under
the Radar provider row naming a source that covers the place.
_Avoid_: shipping flat zeros for it — that draws a made-up "no rain".

**Slot (radar)**:
One five-minute bucket of the two-hour nowcast window; slot 0 is pinned to the
most recent wall-clock five-minute boundary. Slot alignment is what lets the
dedupe treat a time-shifted but otherwise identical radar as unchanged.
