#include "health_status_layer.h"
#include "c/appendix/memory_log.h"
#include "c/services/health.h"

// Mirror weather_status_layer.c font/offset constants exactly so this row
// occupies the same height as the weather status line (Task 7 places them
// in the same band).
#define FONT_18_OFFSET 7
#define FONT_14_OFFSET 3
#define MARGIN 2

// emery: use larger text to match weather_status_layer emery sizing
#ifdef PBL_PLATFORM_EMERY
#define STATUS_FONT_KEY FONT_KEY_GOTHIC_18
#define SLOT_Y_OFFSET FONT_18_OFFSET
#else
#define STATUS_FONT_KEY FONT_KEY_GOTHIC_14
#define SLOT_Y_OFFSET FONT_14_OFFSET
#endif

#define STATUS_TEXT_OVERFLOW GTextOverflowModeTrailingEllipsis

// Buffer sizing — values are clamped before snprintf to keep the compiler's
// format-truncation analysis from flagging theoretical int-max overflows:
//  s_steps_buf: clamped to 6 digits (999999 steps max display) + NUL = 7
//  s_sleep_buf: clamped to "99h59" (5 chars) + NUL = 6; padded to 8 for safety
//  s_hr_buf:    clamped to 3 digits (999 bpm) + "bpm" (3) + NUL = 7; padded to 8
//  (HR glyph: we append "bpm" suffix as an ASCII-safe indicator — a literal
//   heart character U+2665 may not render in Gothic-14/18; "bpm" is unambiguous
//   and fits the slot. Task 7 can tune this after visual confirmation.)
static char s_steps_buf[8];
static char s_sleep_buf[8];
static char s_hr_buf[8];

// Clamp helpers — avoids format-truncation warnings and limits display to sane ranges.
#define STEPS_MAX 999999
#define SLEEP_HOURS_MAX 99
#define HR_MAX 999

// Draw rects in the layer's local coordinate space, one per slot.
static GRect frame_steps;
static GRect frame_sleep;
static GRect frame_hr;

static Layer *s_health_status_layer;

static GFont status_font(void) { return fonts_get_system_font(STATUS_FONT_KEY); }

// ---------------------------------------------------------------------------
// Slot refresh helpers
// ---------------------------------------------------------------------------

static void steps_slot_refresh(void) {
    int steps = health_steps_today();
    if (steps > STEPS_MAX) { steps = STEPS_MAX; }
    if (steps < 0)         { steps = 0; }
    snprintf(s_steps_buf, sizeof(s_steps_buf), "%d", steps);
}

static void sleep_slot_refresh(void) {
    int secs = health_sleep_recent_seconds();
    if (secs <= 0) {
        snprintf(s_sleep_buf, sizeof(s_sleep_buf), "--");
    } else {
        int hours = secs / 3600;
        int mins  = (secs % 3600) / 60;
        if (hours > SLEEP_HOURS_MAX) { hours = SLEEP_HOURS_MAX; }
        snprintf(s_sleep_buf, sizeof(s_sleep_buf), "%dh%02d", hours, mins);
    }
}

static void hr_slot_refresh(void) {
    if (health_hr_available()) {
        int bpm = health_hr_current();
        if (bpm > 0) {
            if (bpm > HR_MAX) { bpm = HR_MAX; }
            snprintf(s_hr_buf, sizeof(s_hr_buf), "%dbpm", bpm);
        } else {
            snprintf(s_hr_buf, sizeof(s_hr_buf), "--bpm");
        }
    } else {
        snprintf(s_hr_buf, sizeof(s_hr_buf), "--bpm");
    }
}

// ---------------------------------------------------------------------------
// Layout — recomputed on every refresh so it tracks dynamic bounds
// ---------------------------------------------------------------------------

static void health_status_layout(void) {
    GRect bounds = layer_get_bounds(s_health_status_layer);
    int w = bounds.size.w;
    int y = -SLOT_Y_OFFSET;

    // Steps: flush left
    GSize steps_size = graphics_text_layout_get_content_size(
        s_steps_buf, status_font(), GRect(0, 0, w / 3, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    frame_steps = GRect(MARGIN, y, steps_size.w, steps_size.h);

    // HR: flush right — measure first so we know its width
    GSize hr_size = graphics_text_layout_get_content_size(
        s_hr_buf, status_font(), GRect(0, 0, w / 3, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    frame_hr = GRect(w - MARGIN - hr_size.w, y, hr_size.w, hr_size.h);

    // Sleep: centred in the remaining space between steps and HR
    int center_x     = frame_steps.origin.x + frame_steps.size.w + MARGIN * 2;
    int center_w     = frame_hr.origin.x - center_x - MARGIN * 2;
    if (center_w < 0) { center_w = 0; }
    GSize sleep_size = graphics_text_layout_get_content_size(
        s_sleep_buf, status_font(), GRect(0, 0, center_w, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentCenter);
    frame_sleep = GRect(center_x, y, center_w,
                        sleep_size.h + SLOT_Y_OFFSET);
}

// ---------------------------------------------------------------------------
// Update proc
// ---------------------------------------------------------------------------

static void health_status_update_proc(Layer *layer, GContext *ctx) {
    MEMORY_LOG_HEAP("health_status_update:enter");
    graphics_context_set_text_color(ctx, GColorWhite);

    graphics_draw_text(ctx, s_steps_buf, status_font(), frame_steps,
                       STATUS_TEXT_OVERFLOW, GTextAlignmentLeft, NULL);
    graphics_draw_text(ctx, s_sleep_buf, status_font(), frame_sleep,
                       STATUS_TEXT_OVERFLOW, GTextAlignmentCenter, NULL);
    graphics_draw_text(ctx, s_hr_buf, status_font(), frame_hr,
                       STATUS_TEXT_OVERFLOW, GTextAlignmentLeft, NULL);
    MEMORY_LOG_HEAP("health_status_update:exit");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void health_status_layer_create(Layer *parent_layer, GRect frame) {
    s_health_status_layer = layer_create(frame);

    steps_slot_refresh();
    sleep_slot_refresh();
    hr_slot_refresh();
    health_status_layout();

    layer_set_update_proc(s_health_status_layer, health_status_update_proc);
    layer_add_child(parent_layer, s_health_status_layer);
    MEMORY_LOG_HEAP("after_health_status_layer_create");
}

Layer *health_status_layer_get_root(void) {
    return s_health_status_layer;
}

void health_status_layer_refresh(void) {
    steps_slot_refresh();
    sleep_slot_refresh();
    hr_slot_refresh();
    health_status_layout();
    layer_mark_dirty(s_health_status_layer);
    MEMORY_LOG_HEAP("after_health_status_refresh");
}

void health_status_layer_destroy(void) {
    MEMORY_LOG_HEAP("health_status_layer_destroy:before");
    layer_destroy(s_health_status_layer);
    MEMORY_LOG_HEAP("health_status_layer_destroy:after");
}
