#pragma once

#include <pebble.h>
#include "../appendix/status_line.h"

typedef struct StatusRow StatusRow;

StatusRow *status_row_create(uint8_t line_id);
void status_row_destroy(StatusRow *row);
// tier is a LayoutTier value (windows/layout.h) — the font tier this row renders at.
void status_row_apply(StatusRow *row, GRect bounds, uint8_t tier, uint8_t line_id);
bool status_row_refresh(StatusRow *row);
// Per-instance: the active view has no calendar (none
// tier or quick-view peek) -> this row's SLOT_LIVE_DATE renders the full date
// ("Jul 4. 2026") instead of month-year ("Jul 2026"). Pushed window -> owner ->
// row (tier push); the resolver reads only row state.
void status_row_set_full_date(StatusRow *row, bool full_date);
bool status_row_uses_live_health(const StatusRow *row);
// When active, this row's right slot (index 2) draws the battery glyph in place
// of its packed content — the top strip's low-battery takeover. Independent of a
// slot whose packed kind is already SLOT_LIVE_BATTERY (that draws battery anyway).
void status_row_set_battery_override(StatusRow *row, bool active);
// When true, only the right slot renders (left + mid treated as absent, right
// stays right-aligned). The top strip sets this during a rain alert so the alert
// takeover keeps the right slot (battery) visible instead of hiding the row.
void status_row_set_suppress_edges(StatusRow *row, bool suppress);
// Pixel width the right slot occupies for the current blob + state (icon + gap +
// text), or 0 when empty. Lets the top strip reserve exactly the right slot's
// width when bounding a rain-alert takeover to its left.
int16_t status_row_right_slot_width(StatusRow *row);
void status_row_draw(StatusRow *row, GContext *ctx);
