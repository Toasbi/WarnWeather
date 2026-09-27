#pragma once

#include <pebble.h>
#include "../appendix/status_line.h"

typedef struct StatusRow StatusRow;

StatusRow *status_row_create(uint8_t line_id);
void status_row_destroy(StatusRow *row);
// tier is a LayoutTier value (windows/layout.h) — the font tier this row renders at.
void status_row_apply(StatusRow *row, GRect bounds, uint8_t tier, uint8_t line_id);
bool status_row_refresh(StatusRow *row);
// Per-instance: no calendar is on screen (layout_full_date in windows/layout.h: a
// none-tier view, a radar or graph top, or a quick-view peek) -> this row's
// SLOT_LIVE_DATE renders the full date
// ("Jul 4. 2026") instead of month-year ("Jul 2026"). Pushed window -> owner ->
// row (tier push); the resolver reads only row state.
void status_row_set_full_date(StatusRow *row, bool full_date);
bool status_row_uses_live_health(const StatusRow *row);
// When active, this row's right slot (index 2) draws the battery glyph in place
// of its packed content — the top strip's low-battery takeover. Independent of a
// slot whose packed kind is already SLOT_LIVE_BATTERY (that draws battery anyway).
void status_row_set_battery_override(StatusRow *row, bool active);
#if defined(WW_ALERT_ROW)
// True when this row's packed line holds an Alerts slot (SLOT_ALERTS). Its rain
// entry is re-derived from the radar cache on every refresh, so the owner of a row
// that answers true refreshes it on the minute tick and after a radar rescan
// (status_bar_tick_alerts; the top strip's own tick). Declared only where the row
// exists: aplite has no Alerts row, so its lean twin need not answer it.
bool status_row_uses_alerts(const StatusRow *row);
#endif
void status_row_draw(StatusRow *row, GContext *ctx);
