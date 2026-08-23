# Status-glyph sizing and seating are hand-tuned rungs, not derived values

Status-slot PDC glyphs are sized by one knob (`icon_scale_pct`, in
`src/c/layers/status_row_icons.c`) and seated vertically by a second
(`s_status_icon_weight_pct`, in `src/c/layers/status_icon_weight.h`). Both are
**taste values a human picked by eye on real hardware**, not measurements and not
derivable from the artwork. This document is the design log that used to live —
in triplicate, and partly contradicting itself — inside those two files.

The code sites keep only the invariants a future editor must not break. Everything
here is the *reasoning*: the measurement tables, the rejected options, and the one
decision still open.

## Decision

- Glyph **size** is a percent trim of the tier's target height, except for the
  phone-battery pair, whose size is a whole-pixel **rung** chosen by
  `phone_icon_h()` because it depends on the tier, which `icon_scale_pct()` never
  sees.
- Glyph **seating** is a per-icon percent weight, stored in a **per-platform**
  table, applied as a lift about the digits' cap centre.
- Neither is auto-derived. In particular, weights are **not** derived from ink
  centroids (see §6).

## 1. What a weight means

A weight is where a glyph's optical centre sits inside its ink box, as an integer
percent of ink height measured from the **top**. Placement puts that point on
`cap_cy`, the digits' cap centre that `status_glyph_center_y()` reports and that the
sun arrow, the battery glyph and the threshold-highlight box all co-centre on:

```
ink-box top  +  weight% × ink height  ==  cap_cy
```

- `50` = the geometric centre of the ink box — exactly the box-centring this
  watchface did before weights existed. **50 is a provable no-op** (§5).
- `>50` claims the optical centre lies *below* the box centre, so the glyph is drawn
  **higher**.
- `<50` draws it **lower**.

The sign is easy to get backwards. Plainly: **a larger weight lifts, a smaller weight
drops.**

### Why a percent and not pixels

Glyph height follows the tier — ink heights of 9, 11, 13, 15 and 17 px all ship — and
a lopsided glyph's error scales with its height. One constant-pixel nudge is therefore
right at one tier and wrong at the other four. A fraction is the only tier-correct shape.

The lift rounds to whole pixels, so a weight within ~4 points of 50 is a no-op on the
small tiers (at ink height 9, weight 54 lifts by `round(0.36) = 0` px). **Tuning moves
in plateaus, not on a smooth slide.**

## 2. Measured ink heights per tier

Device-measured. Ink height is a function of the tier alone, identical on every
platform that renders that tier.

| icon | t9 | t10 | t12 | t13 | t16 |
|---|---|---|---|---|---|
| TEMP | 9 | 11 | 13 | 13 | 15 |
| UV | 9 | 11 | 13 | 13 | 17 |
| WIND | 9 | 11 | 13 | 13 | 17 |
| GUST | 9 | 11 | 13 | 13 | 17 |
| STEPS | 9 | 9 | 11 | 11 | 13 |
| SLEEP | 11 | 11 | 13 | 15 | 17 |
| HR | 11 | — | 13 | 15 | 17 |
| DISTANCE | 9 | 11 | 13 | 13 | 17 |
| AQI | 9 | 9 | 11 | 13 | 15 |
| POLLEN | 11 | 11 | 13 | 15 | 17 |
| COUNTDOWN | 11 | 11 | 13 | 15 | 17 |

Which tier is rendered where:

| tier | where |
|---|---|
| t9 | basalt/diorite/flint FULL rows |
| t10 | basalt/diorite/flint top strip |
| t12 | those platforms' COMPACT/NONE rows **and** emery's FULL rows |
| t13 | emery top strip |
| t16 | emery COMPACT/NONE rows |

`test/c/status_icon_weight_test.c`'s 66-cell (icon × tier) → pixel-lift matrix is
derived from this grid; its `ink` column converts with `ink - 1` (see §5). **This
table is the only in-repo copy those numbers can be checked against.**

The phone-battery pair is deliberately absent: its height is not a function of the
tier but a rung chosen by `phone_icon_h()` (§3).

## 3. The phone-battery pair: a rung ladder, not a percent

`STATUS_ICON_PHONE_BATTERY` and `_CHG` swap in place inside **one** slot the moment
the phone is plugged in, so they are sized as a pair.

The two are **different objects on purpose**: normal is a phone with the bolt drawn
*inside* it (`device-mobile-charging.svg`), charging is a mains plug (`plug.svg`). An
earlier pair drew a phone in both states and had to keep the shared phone body steady
across the swap — which was unsatisfiable: the bodies quantise on opposite parities, so
the best attainable case was a one-row mismatch, reported from the watch as "the
charging symbol is a little too long". Two distinct silhouettes retire that constraint
outright: there is no shared body left to match.

### Authored ink boxes

In the PDC's 1/8-px point units inside the 24 px viewbox:

| id | x | y | units | px |
|---|---|---|---|---|
| `STATUS_PHONE_BATTERY` | 43..149 | 16..176 | 106 × 160 | 13.250 × 20.000 |
| `STATUS_PHONE_BATTERY_CHG` | 16..176 | 16..176 | 160 × 160 | 20.000 × 20.000 |

The two **heights are exactly equal** — 160 units each, not merely close — so one `h`
renders both to the same height by construction, at every `h`, with no residual to
trade away. The plug is ~1.51× wider in source and renders 1.4–1.7× wider after
snapping. That is accepted: the slot text shifts right on plug-in, which was chosen
over a plug shrunk to phone width.

### The ladder

`h` is a **request**, not a result. `icon_load()` phases the minimum vertex onto 4
units (a pixel centre) and snaps every other vertex to a whole pixel about the glyph
centre, so the tight bounds land on rungs. Because every snapped coordinate is `4 + 8k`
— a pixel centre — a 1 px stroke paints exactly rows `0..bounds_h` inclusive:
**painted height == `bounds_h + 1`, by construction.**

Measured for **both** ids (the height columns are identical at every `h`):

| h (request) | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bounds_h | 8 | 10 | 10 | 12 | 12 | 14 | 14 | 16 | 16 | 18 | 18 | 20 | 20 |
| **painted h** | 9 | 11 | 11 | 13 | 13 | 15 | 15 | 17 | 17 | 19 | 19 | 21 | 21 |
| phone W | 7 | 7 | 7 | 9 | 9 | 9 | 11 | 11 | 11 | 13 | 13 | 13 | 15 |
| plug W | 9 | 11 | 11 | 13 | 13 | 15 | 15 | 17 | 17 | 19 | 19 | 21 | 21 |

**Painted height is always ODD** — `h+1` for even `h`, `h+2` for odd `h` — so the
achievable heights step by **two**. A literal "one pixel taller/shorter" is **not
expressible** for these glyphs. Every size decision here moves in 2 px jumps; say so
rather than pretending a number is a 1 px nudge. This is why `phone_icon_h()` subtracts
2 and never 1, and why the parity trim exists: an odd `h` buys a rung nobody asked for,
so it is rounded down.

Width is **not** locked to height. The plug is square, so its width tracks the same
2 px ladder; the phone is 1.51× narrower and its width steps on a 3-`h` period (rungs at
`h` = 11, 14, 17, 20). Width is the only lever left when two tiers land on the same
height rung.

### What ships

| platform / row | target | h phone | h plug | painted phone | painted plug |
|---|---|---|---|---|---|
| basalt/diorite/flint FULL | 9 | 9 | 9 | 7×11 | 11×11 |
| basalt/diorite/flint STRIP | 10 | 10 | 10 | 7×11 | 11×11 |
| basalt/diorite/flint COMPACT | 12 | 12 | 12 | 9×13 | 13×13 |
| **emery FULL rows** | 12 | **10** | **12** | **7×11** | **13×13** |
| emery TOP STRIP | 13 | 12 | 12 | 9×13 | 13×13 |
| emery COMPACT/NONE | 16 | 14 | 14 | 11×15 | 15×15 |

**Emery's FULL rows are the one tier where the pair is not height-matched**, and that is
deliberate. The watch reported the normal glyph as too tall "on the smallest font";
emery's three sizes are 12 (FULL rows), 13 (strip) and 16 (COMPACT/NONE), so the
smallest font *is* the FULL rows. The request named the **normal glyph only**. The ladder
has no 1 px step, so the only move down is one rung — `h` 12 → 10, painting 11 rows
instead of 13 — and the plug was left on its own rung because that is what was asked for.

**The cost, stated plainly:** at that tier, plugging the phone in jumps the glyph
11 → 13 painted rows and 7 → 13 painted columns at once. A 2-row height jump is the most
visible thing this pair can do, and this is the only tier that does it. If it reads wrong
on the watch, the fix is one line: delete the `icon_id == STATUS_ICON_PHONE_BATTERY` test
in `phone_icon_h()` and the plug follows the phone down to `h` 10 (7×11 / 11×11), pair
re-matched. Nothing on the weight side has to change.

Emery's COMPACT/NONE rows also leave their natural rung, by two, because two is the
smallest step there is: the tier's target 16 paints 17 rows and the next rung down is 15,
reached by spending two requested pixels (16 → 14). Compact asks for `h` 14 rather than 13
on purpose — 13 is odd, would parity-trim to 12, and would land compact on the top strip's
rung instead of one above it. **Both ids take that branch**; compact is not split.

The top strip is on its natural rung, painting 13 for both ids. An earlier revision let
emery's odd target 13 skip the parity trim so the strip painted 15 rows; the watch judged
that an overshoot, so the trim is back. The revert also retired a collision that shape had
introduced: with strip at 15 and compact also at 15, the plug was pixel-identical (15×15)
in both tiers, distinguishable only by the phone's width.

`PHONE_ICON_MIN_H` is 9: below that the plug's prongs merge into its outline and the
phone's inner bolt rasterises as a plain bar. The smallest `h` any shipping tier requests
is 10, so the floor only ever *holds* `h` — it never raises it past a tier's target, and so
can never push a glyph out of its row band.

## 4. Where the pair sits: weight 54 on emery, 50 on basalt

**Both ids carry the same weight, and must** — they swap in one slot, so weighting one
alone would make the icon hop on plug-in.

**Emery: 54 for both ids at every tier. There is no per-tier override.** The watch asked
for the COMPACT glyph to sit higher, and 54 is the smallest weight that bites at 15 painted
rows. It was known at the time that this also lifted the strip and the FULL rows by a pixel
nobody asked for, and that no single percent could avoid it: keeping the lift to compact
alone needs `off × 15 ≥ 50` and `off × 13 < 50` at once, i.e. `3.34 ≤ off < 3.85`, and no
integer lives there.

The FULL rows then came back reading a pixel high. **That was fixed by `phone_icon_h()`
shrinking the normal glyph there, not by a second weight**: at 11 painted rows, 54 stops
biting (`4 × 11 = 44 → 0 px`), so the glyph dropped its pixel the moment its size moved.

> **Historical correction.** Earlier revisions of `status_icon_weight.h` and
> `status_row_icons.c` described emery's FULL rows as taking weight **53** "from that
> file's per-tier override". **No such table ever shipped and no cell carries 53** — the
> 53s in the emery initialiser belong to UV, GUST and DISTANCE. Two other blocks in the
> same file said so correctly, which left the file contradicting itself in three places.
> The code is the authority: both phone ids are 54 on emery and 50 on basalt/diorite/flint.

Arithmetic, for reference — `status_icon_top_y()` lifts by
`div_round(off × painted_h, 100)` with `off = weight - 50`:

| off | ×11 | ×13 | ×15 |
|---|---|---|---|
| 3 (weight 53) | 33 → 0 px | 39 → 0 px | 45 → 0 px |
| 4 (weight 54) | 44 → 0 px | 52 → 1 px | 60 → 1 px |
| 10 (weight 60) | — | — | 150 → 2 px |

**Basalt/diorite/flint: 50 for both ids, by default rather than by judgement.** The watch
report that moved the pair up was made on emery, so only the emery table moved. The pair
paints 11 rows at t9 *and* t10 (`phone_icon_h()` floors t9's request back up to `h` 9) and
13 rows at t12, for both ids — this branch takes none of emery's rung splits, so the two
stay height-matched at every tier here.

**Still unjudged on the basalt branch:** where the pair sits against the digits. Emery's
base 54 would land differently here (`4 × 11 = 44 → 0` at FULL and strip, `4 × 13 = 52 → 1`
at COMPACT); a 1 px lift at all three would need 55. Do not copy emery's cell across
without looking — DEWPOINT is the standing example of the same shape wanting opposite
answers on the two branches (§6).

## 5. Why weight 50 is an exact no-op — and the rewrite that breaks it

At weight 50, `off` is 0, so the lift numerator is 0 and `lift` is 0 under **any** rounding
rule, leaving exactly `cap_cy - bounds_h / 2` — the expression this watchface drew glyphs at
before weights existed, bit for bit, for odd and even `bounds_h` alike.

**The obvious "cleaner" rewrite breaks this.** Scaling by `(bounds_h * weight) / 100` instead
of the `off`/`lift` form gives 7 where `bounds_h / 2` gives 6 at `bounds_h` 13 — a 1 px shift
on every odd-height glyph. This is the single most likely refactor an editor would attempt.
`test/c/status_icon_weight_test.c:23-43` pins it for `bounds_h` 0..40, odd and even.

The percentage is of the **painted** height (`bounds_h + 1`), not `bounds_h`. Drop that and
both the code and the test's `ink - 1` conversion become unexplainable, and someone "fixes"
the `+1` as an off-by-one.

## 6. Why the weight table is per platform

The lift is whole pixels of a fraction of ink height, so which tiers a weight actually bites
at depends on where the rounding plateaus fall — and the plateaus do not line up across
platforms, because the shipped tiers do not either (basalt 9/10/12, emery 12/13/16). Two
judgements make the split unavoidable:

- **GUST** wants a 1 px lift at basalt's t12 but **none** at emery's t13 — and its glyph is
  13 px of ink at *both*. Identical input, opposite answer: no single weight produces it.
- **WIND** wants no lift at basalt's t9 (ink 9, so `off ≤ 5`) and a 2 px lift at emery's t16
  (ink 17, so `off ≥ 9`). The two ranges do not meet.

**DEWPOINT** is the third: emery renders it at ink 13/15/17 where the drops' low mass is worth
a pixel (56), while 9/11/13 on basalt is too short for the same correction to help (50). It
was briefly given emery's 56 on basalt and sat a pixel high.

**Do not derive weights from ink centroids.** The centroid is a diagnostic, not a
prescription: the STEPS glyph reads correctly centred today even though its ink centroid sits
~1.2 px *below* the digits' centre, so auto-deriving would break the one glyph that is already
right.

## 7. Open: the TEMP cell on emery

TEMP on emery is the one cell a single weight cannot express, so it stays at the no-op 50
rather than being approximated.

The judgement was "no lift at t13, 1 px at t16". TEMP's ink is 13 px at t13 but only 15 px at
t16 (it is the shortest glyph at t16 apart from AQI). No lift at ink 13 needs `off ≤ 3`
(`3 × 13 = 39 → 0`); a lift at ink 15 needs `off ≥ 4` (`3 × 15 = 45 → 0`, `4 × 15 = 60 → 1`).
The two half-open ranges do not overlap.

Three ways out, none yet chosen:

1. **Accept 54.** Grants the judged 1 px at t16 but adds an unwanted 1 px at t13 *and* t12
   (both ink 13) — a two-cell regression for one cell.
2. **Per-tier storage** (three weights per icon instead of one). See §8 for the trap.
3. **A finer weight unit.** Half-percent would express it exactly at 53.5 with no extra
   bytes, but re-bases all 22 existing numbers and the comparison-sheet labels.

Until one is chosen, 50 keeps TEMP exactly where it renders today.

## 8. Rejected: a per-tier weight table

A previous revision added one, keyed on the row's target icon height, so the plug could be
dropped a pixel in emery's FULL rows while keeping its lift in the strip. **It was deleted
before it was ever wired**: the watch asked for only the *normal* glyph to drop there, and
that drop falls out of `phone_icon_h()` shrinking it, with no weight involved.

If a future request genuinely needs two tiers to differ for one icon **at the same painted
height**, per-tier storage is the answer and a percent is not — the plug paints 13 rows in
both the FULL rows and the top strip, so nothing keyed on size alone can separate them.

**Key such a table on the row's target height** (`row->glyph_h`, the value handed to
`status_row_icons_load`), **never on `bounds_h`**: the plug's bounds are 12 at both of those
tiers, and STEPS also carries 54 on emery with overlapping bounds, so a bounds-keyed rule
would silently move a different glyph.

## Consequences

- The taste values stay in code, where `test/c/status_icon_weight_test.c` pins each shipped
  weight exactly — editing one fails loudly.
- The reasoning lives here, once, instead of in three partly-contradicting copies.
- Prior citations pointed at `.superpowers/sdd/*.md`, which is gitignored (`.gitignore:1`,
  `.*`) and in one case never existed on disk. Any figure worth keeping is **copied into this
  document**, not cited out of the repo.
- The pair-equality invariant ("both phone ids carry the same weight") was prose only and
  untested; it is now asserted in `test/c/status_icon_weight_test.c`.
