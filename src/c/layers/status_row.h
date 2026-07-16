#pragma once

#include <pebble.h>
#include "../appendix/status_line.h"

typedef struct StatusRow StatusRow;

StatusRow *status_row_create(uint8_t line_id);
void status_row_destroy(StatusRow *row);
void status_row_apply(StatusRow *row, GRect bounds, uint8_t tier, uint8_t line_id);
bool status_row_refresh(StatusRow *row);
void status_row_set_sleeping(StatusRow *row, bool sleeping);
// Per-instance, sibling of set_sleeping: the active view has no calendar (none
// tier or quick-view peek) -> this row's SLOT_LIVE_DATE renders the full date
// ("Jul 4. 2026") instead of month-year ("Jul 2026"). Pushed window -> owner ->
// row (tier push); the resolver reads only row state.
void status_row_set_full_date(StatusRow *row, bool full_date);
bool status_row_uses_live_health(const StatusRow *row);
void status_row_draw(StatusRow *row, GContext *ctx);
