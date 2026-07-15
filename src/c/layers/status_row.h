#pragma once

#include <pebble.h>
#include "../appendix/status_line.h"

typedef struct StatusRow StatusRow;

StatusRow *status_row_create(uint8_t line_id);
void status_row_destroy(StatusRow *row);
void status_row_apply(StatusRow *row, GRect bounds, uint8_t tier, uint8_t line_id);
bool status_row_refresh(StatusRow *row);
void status_row_set_sleeping(StatusRow *row, bool sleeping);
bool status_row_uses_live_health(const StatusRow *row);
void status_row_draw(StatusRow *row, GContext *ctx);
