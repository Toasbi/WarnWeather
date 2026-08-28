# The graph's colours are derived built-ins with per-polarity overrides

Every colour the forecast graph paints — the two metric lines, the area fill, and the
five night colours — is resolved by `src/pkjs/line-style.js` from the settings blob
alone, packed into one ten-byte Clay tuple, and read back by
`src/c/layers/forecast_layer.c`. This document is the design log that used to live
inside that module, where it had grown to roughly 60% of the file and had started to
drift (a "9 bytes" note for a ten-byte tuple, a pointer to a function that no longer
existed).

The code keeps only the invariants an editor must not break. Everything here is the
*reasoning*: why the built-ins are derived rather than listed, why the night tint
cascades at resolve time, and which trade-offs were accepted rather than solved.

Shipped in 1.15.0; reworked in 1.15.1 (§3, §4).

## Decision

- A graph colour is stored per **(scope, role, polarity)** under a concrete key.
  There is no "auto" sentinel.
- The **built-in** for every key is *derived* from the three colour resolvers the
  renderer already uses — never transcribed into a second table.
- "Has the user moved this off its built-in?" is answered by **comparing against the
  derived built-in**, not by a magic stored value.
- The night fill tint **cascades from the metric's fill colour at resolve time**. The
  settings page never writes one key on behalf of another.

## 1. The key vocabulary

`gc` + metric slug + role + polarity — `gcPrecipLineDark`, `gcNightHatchLight`.
Built by `graphColorKey(scope, role, suffix)`.

- **scope**: a metric id from `GRAPH_METRICS`, or the pseudo-scope `'night'` for the
  full-height band.
- **role**: `Line` / `Fill` / `Night` for a metric; `Hatch` / `Boundary` for `'night'`.
  `Night` is the night **fill tint** — the base of the area triple.
- **polarity**: `Dark` / `Light`, read off the *folded* theme so an aplite install
  never looks up a Light colour it cannot paint.

Slugs exist because the ids are snake_case wire values and `gcPrecip_probLineDark`
reads badly.

36 keys: five metrics × three roles × two polarities, `feels`' Line pair, and the
night band's two pairs. `feels` is Line-only — it never fills (§6), so a Fill or tint
row would offer a colour nothing can paint.

Both polarities are stored independently and both are reset together. Leaving the
hidden one tuned would resurrect old picks on the next theme switch.

## 2. Why there is no sentinel

An earlier design used `''` to mean "auto". It was dropped because the settings page
has nowhere to *show* an absent value: `hydrate()` seeds every schema key and the save
flattens the whole blob, so "unset" does not survive a save anyway. A concrete stored
value with a derived comparison is the honest model for this config UI.

The cost is that a colour deliberately picked *equal to* its built-in reads as
untouched. That is accepted: the two paint identically, so nothing is visibly wrong,
and the only consumers of the distinction are the wire's opt-in bit (§4) and
telemetry's `default` vs `#RRGGBB` report.

## 3. Built-ins are derived, never transcribed

`graphColorDefault(scope, role, suffix, settings)` asks:

| role | source |
|---|---|
| `night` / `Hatch`, `Boundary` | `NIGHT_HATCH_DEFAULT`, `NIGHT_BOUNDARY_DEFAULT` |
| metric / `Night` | `nightAreaColorsFor(scope, null).base` |
| metric / `Fill` | `fillColorFor(scope, true, theme)` |
| anything else | `lineColorFor(scope, settings, true, theme)` |

1.15.0 shipped a 40-cell `GRAPH_COLOR_DEFAULTS` table beside these resolvers, with a
comment stating the two "MUST" stay equal and a test that compared each cell against
the resolver that produced it. That test had decayed into `assert.equal(f(x), f(x))`
— it could no longer fail — and the table was a second source of truth for values the
module could already compute. It was deleted in 1.15.1 after proving the derived form
identical over 1440 (scope × role × polarity × settings-blob) combinations.

**The appearance contract now lives in the test**, as 40 literal expected constants
(`test/line-style.test.js`). A literal table belongs there: its job is to fail when a
built-in moves. It does not belong in production, where its job would be to agree with
code sitting twenty lines away.

`suffix` alone names the theme because this is the colour arm — `renderContextFor`
reports `isColor` true only for `dark` and `light`, so `Dark ↔ 'dark'` exactly.

### Totality

`graphColorDefault` is total over scopes and roles: an unknown scope (today
`thirdLine`'s `'off'`, or a blob with no `secondaryLine`) falls through to
`lineColorFor`, which answers the theme foreground. No caller needs a `||` fallback —
which matters, because `GColorBlack` is `0x000000` and therefore falsy. That trap has
bitten this module before; prefer `hasOwnProperty` over truthiness when testing for a
light-theme override.

**Known hole, unreached:** the `LINE_COLORS` / `FILL_COLORS` / `NIGHT_AREA_COLORS`
lookups are bare object literals, so an `Object.prototype` name (`'toString'`,
`'constructor'`) answers truthy and resolves to `undefined`. Pre-existing and
unreachable — every scope comes from `GRAPH_METRICS`, `'night'`, or a metric picker.
Closing it means own-key guards in all three lookups.

## 4. The night tint cascades at resolve time

The watch paints the night band **opaquely** over the filled area (`chart.c`'s
`has_underlay` loop strokes from the curve down to the axis), so the tint *replaces*
the day fill for the night hours rather than shading it. A tint left on its built-in
while the fill moved would therefore paint over a colour the user chose with one they
never did.

1.15.0 solved that in the settings page: a `graphFillTint` onChange copied each new
fill colour into the sibling tint key, and `line-style.js` recognised the carry
afterwards by comparing the two stored values.

**That was the bug.** A page-side write makes a carried tint and a deliberately chosen
one the same bytes, so nothing downstream could tell them apart. A tint picked equal to
its fill read as untouched: on the light polarity the night re-shade was silently
skipped, and telemetry reported `default` for a colour the user had chosen.

1.15.1 moved the cascade into `graphNightTint(settings, metric, suffix)`:

```
claimed  — the tint key is off its built-in        -> that colour
carried  — the tint is built-in but the fill isn't -> the fill's colour
built-in — neither has moved                       -> null
```

`null` rather than the base is deliberate: `nightAreaColorsFor` answers `null` with the
hand-tuned triple verbatim, while a concrete base runs the derive recipe (§5).

A stored tint now means exactly one thing — someone picked it — so `graphColorIsPicked`
is `!graphColorIsDefault`, and the settings page is a pure editor again.

### The upgrade migration

Every 1.15.0 install that ever touched a fill picker has the carried bytes on flash.
Under the new reading those are a pick, which would have flipped the wire bit and
frozen the cascade on a stale colour. `clay-settings.js`'
`migrateCarriedGraphNightTints` (marker `v1.15.1_carried_graph_night_tint_migration`)
clears a stored tint that still equals its stored fill; the resolver then re-derives
the same triple with the flag clear — byte-for-byte what 1.15.0 sent.

Two accepted imprecisions:

- A tint set equal to its fill **by hand** is cleared too. Indistinguishable by
  construction, and 1.15.0 painted the two identically, so clearing preserves
  appearance.
- A fill picked to the metric's **own built-in fill colour** is not restored
  byte-for-byte: 1.15.0 stored it in the tint key, where it was not that metric's night
  built-in, so it derived a lightened triple. With the tint cleared, the hand-tuned
  triple stands. The flag stays 0 and the result is what a fresh install with those
  settings paints.

### Re-tuning a built-in needs a migration of its own

Concrete storage (§2) has a price that is easy to miss: **moving a built-in reaches
nobody who is already installed.** `seedDefaults` wrote a real colour into every key, so
after a re-tune the stored value is the OLD default, which no longer equals the new one
— `graphColorIsDefault` calls it a pick and the old colour keeps winning. Observed on a
watch after the light re-tune (§6): every light row had to be reset by hand.

`migrateLightGraphColorRetune` (marker `v1.16.0_light_graph_color_retune_migration`)
rewrites each cell still holding the value the page seeded, cell by cell, so a colour
that is neither the old default nor the new one — someone's actual choice — survives.
Its `SUPERSEDED_LIGHT_GRAPH_COLORS` is a **frozen historical record** and must never be
re-derived from `line-style.js`: the whole point is that the built-ins have moved away
from it. Any future re-tune needs its own frozen table and its own marker.

Two rules the code carries comments about, both of which were bugs first:

- It runs **after** `migrateCarriedGraphNightTints`. A carried tint holds the *fill's*
  colour, so the release detects it by `night === fill`; the re-tune rewrites the Fill
  cell but not the Night cell, breaking that equality. Run second, the release cannot
  see the carry and the stale colour survives as a fake pick.
- It **always** asks for the Clay resend and never marks itself done — the marker rides
  the ACK. "Nothing left to rewrite, so mark done" is indistinguishable from "saved, then
  NACKed", and taking that shortcut strands the install on the old colours until someone
  opens and saves the settings page.

## 5. The night area triple

For **dark** polarity: six hand-tuned `{base, hatch, boundary}` triples, keyed by
**metric** (`NIGHT_AREA_COLORS`). They moved here from `forecast_layer.c`, which keyed
on the *day fill colour* with `gcolor_equal` — which is exactly what made an unlisted
metric render precip-blue (pressure shipped that way; measured on emery). A
user-selectable fill would have sent every custom pick down that same fall-through.

For an **arbitrary** pick the triples cannot cover, `nightAreaColorsFor` derives one via
`deriveNightTriple`: one Pebble level brighter per layer (`lighten`). This is **not** the
recipe the six were built with — feed their bases back through it and only `feels`
matches. The other five were tuned per hue (precip and uv keep a saturated channel at
`0x00` instead of lifting it; wind, gust and pressure collapse boundary onto hatch a
level earlier). The six stay verbatim; the recipe exists only for picks, where a
plausible member of the same family beats a matching one.

For **light** polarity: a **base per metric**, not a triple (`NIGHT_AREA_LIGHT_BASE`),
whose hatch and boundary come from `deriveNightTriple`. The asymmetry is deliberate and
is about provenance, not about taste. The five light bases were tuned on hardware in the
light theme by picking them *in the settings sheet* — i.e. as stored tints, which is the
path that derives. Deriving is therefore what reproduces what was signed off; a
hand-written triple here would repaint it. A metric absent from the light table (only
`feels`, which never fills) keeps its dark triple in both polarities.

Both tables are read through the same `nightAreaColorsFor(metric, tint, theme)`, and the
"tint equals the built-in base" short-circuit compares against the base of *the polarity
in hand*. `NIGHT_AREA_COLORS` entries are handed back by reference, so they are kept as
pure triples — an extra key on one would ride out into a caller's result.

`colorPick` snaps every stored value onto the Pebble-64 grid at the parse boundary, so
`lighten`'s level arithmetic is exact. The snap changes no pixel — `rgbToGColor8`
reduces both forms to the same `>> 6` level — it is about the numbers this module
reasons over.

## 6. Per-metric colour choices

Line colours claim distinct hues so two lines never read as one: precip owns blue, uv
magenta, wind yellow, pressure orange, gust the greys.

- **uv on light polarity is Purple, not ImperialPurple.** ImperialPurple is one Pebble
  level per channel off black, and the light theme's solid rain bars paint
  `GColorDarkGray` (rain-tier.js) — a near-black line crossing dark grey bars is two
  dark values touching. Purple keeps the same hue at a level the bars cannot swallow.
  It also widens the gap from precip, which owns the neighbouring blue and is the other
  half of the default line pair.

- **gust** takes the achromatic slot so it never reads as a rain bar, which makes it
  the one built-in that depends on another live setting: it must dodge whichever grey
  the bars use, so `lineColorFor` reads `rainBarColor`. `graphColorIsDefault` therefore
  accepts **either** grey (White with multicolour bars, LightGray with solid white
  ones) as "still the built-in", so a solid-bar install seeded with White keeps
  resolving through `rainBarColor` instead of painting white on white. The cost: this
  one row cannot be deliberately pinned. 1.15.0 also carried a hard-coded override of
  this cell in `graphColorDefault`; deriving the default (§3) made it redundant, since
  `lineColorFor` was already applying the rule.
- **feels** shadows the 3px temp curve, so it stays achromatic and dimmer than any hue
  — LightGray on dark, **Black** on light (a grey at 1px on white reads as
  barely-there, and DarkGray is what the white-bar mode paints its bars in a light
  theme). It **never fills**: every other metric maps `0..max`, so the area under the
  line is the area above a real zero, while feels rides the temp∪feels band whose floor
  is just the coldest value on the plot. A fill there would flood the plot and swallow
  the temp curve it exists to be compared against. `resolveGraphColors` is the
  authoritative gate, so a blob written before the UI hid the toggle still cannot turn
  it on.
- **pressure**'s orange reads close to wind's yellow at 1px on dark. It is also the one
  metric with no light line variant — Orange holds on white as-is.
- **Light-theme variants.** Fills and night bases take a *brighter* tint of the hue (the
  dark shades read too heavy on white); lines take a *darker* step. Those are the shapes
  the values happen to have, **not a formula** — every light cell was tuned metric by
  metric on hardware in the light (alpha) theme, and they do not sit at a uniform
  distance from their dark counterparts. Do not "restore symmetry" with a dark
  neighbour or re-derive one from a recipe; the literal table in
  `test/line-style.test.js` (`EXPECTED_DEFAULTS`) is the contract, and it is meant to
  break when someone tries. Note `0x55FFFF` is `GColorElectricBlue`; the constant named
  `GColorCyan` is `0x00FFFF` and is precip's light night base.

## 7. The wire

Ten bytes on `CLAY_LINE_STYLE_UINT8`, on the **Clay settings message** — these are
settings-derived, never weather-derived, so per `AGENTS.md`'s message-boundary rule
they must not ride every weather send. (They replaced four scalar tuples that did: 44 B
per weather send, 17 B once here. The Clay message sits at 490 B of its 536 B inbox.)

```
[0] main line   [1] area fill   [2] second line   [3] line flags (bit 0 = fill on)
[4] night hatch [5] dusk/dawn   [6] area base     [7] area hatch  [8] area boundary
[9] night flags (bit 0 = tint is an explicit pick)
```

Bytes `[4..9]` are **byte-for-byte** the watch's `NIGHT_COLORS` persist blob
(`persist.h`, `NIGHT_COLOR_BYTES = 6`); `app_message.c` stores the tail straight
through with no repacking. That is the whole reason the night flag sits in its own byte
`[9]` rather than beside the fill flag in `[3]` — one bit, one name, one offset, both
ends, no translation step in the C. It cost one byte and is worth it.

**Growing the tuple:** `LINE_STYLE_BYTES` is a *minimum* length. Append a new block
with its own `length >= offset + size` check; widening the minimum would start
rejecting the shorter tuples older senders still emit.

`byte[9]` bit 0 says the night-area tint is an **explicit user pick**. It *was* the
light-polarity opt-in: `forecast_layer.c` skipped the night re-shade on colour + light
polarity, because the built-in triples were tuned for dark grounds, and this bit was
what made a deliberate Light tint paint there. Once `NIGHT_AREA_LIGHT_BASE` gave light
its own hardware-tuned arm (§5) that reason was gone, the skip was deleted, and **no
watch reads the bit any more**.

It is still sent, and still computed honestly rather than pinned true, for two reasons:
the blob would otherwise change length for the sake of one dead byte (bytes `[4..9]` are
`NIGHT_COLORS` verbatim), and it is the same "did the user pick this?" answer telemetry
reports — the wire and telemetry disagreeing about intent is the bug §8 exists to
prevent.

### No B&W arm in the night tail

Every one of these bytes reaches the render through `theme_pick(colour_arm, bw_arm)`,
and the underlay through `has_underlay = !theme_is_bw()`. A B&W watch or a bw/bw-light
theme discards all five and paints `theme_fg()` over a LightGray underlay from its own
constants. Sending a "B&W-honest" set was five bytes of ceremony no watch ever read.

Consequence, accepted: on a bw theme these bytes carry whatever the user picked for
that polarity. The wire is not lying — it is describing colours this render mode
ignores.

## 8. One render context, three consumers

`renderContext(settings, watchInfo)` is the single authority on *what this watch is
actually rendering*. The wire packer and the telemetry snapshot once derived it
separately and diverged — telemetry copied the theme fold but dropped the
colour-platform half, so a diorite install reported picks the wire had already resolved
away to white.

- `theme` is the **folded** theme. aplite has the light polarity compiled out
  (`theme.h` pins `theme_is_light()` false), so resolving off `settings.theme` would
  send black lines to a black background.
- `isColor` is the **effective** colour flag: colour hardware renders as colour only
  when the theme isn't Black & White.
- `suffix` is the polarity half of every key name, derived from the folded theme so the
  pick that is read is the pick that is painted.

The settings page has no watchInfo, so it enters through `renderContextFor` /
`resolveGraphColors` with capabilities passed in. `resolveLineStyle` is the thin
watchInfo adapter over the same body — the preview and the wire run one resolution, not
two copies.

This is also why `line-style.js` is dual-context: a CommonJS module on the phone and in
the tests, and a plain concatenated `<script>` in the settings-page webview, which has
no `require()`. `pebble-colors.js` and `resolve-ink.js` must precede it in the bundle.

## 9. Displaying a derived value

Because the tint cascades at resolve time, its stored key sits on the built-in while
the graph paints the fill's colour. The settings page must show what is *painted*, or
the picker contradicts the watch.

`engine.js`' `displayFrom` / `PConf.displayResolvers` exists for exactly this: an item
paints what its named resolver returns while storing under its own key. Writes are
untouched, so picking the shown colour pins it — which is the right meaning for that
gesture. The row badge dot uses the same helper.
