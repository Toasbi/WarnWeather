#include "loading_layer.h"
#include "c/appendix/persist.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/theme.h"
#include "c/services/watch_services.h"

#define FORECAST_MAX_AGE_S (SECONDS_PER_HOUR * 12)  // older than this => show "No data :("
#define NOTICE_TEXT_MAX 48   // matches the phone-side ~32 B cap + NUL, with headroom

static Layer *s_loading_layer;
static TextLayer *s_loading_text_layer;
static char s_notice_text[NOTICE_TEXT_MAX];

bool loading_layer_data_is_fresh() {
    const time_t forecast_start = persist_get_forecast_start();
    const time_t now = watch_services_now();

    return now - forecast_start <= FORECAST_MAX_AGE_S;
}

static void loading_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    int w = bounds.size.w;
    int h = bounds.size.h;

    // Re-track the child text layer against our current bounds: main_window_relayout()
    // reframes this layer's root via layer_set_frame() alone (children aren't resized
    // automatically), so recompute here on every redraw to stay correct after a live
    // compact-top-view toggle.
    layer_set_frame(text_layer_get_layer(s_loading_text_layer), GRect(0, h / 3, w, h));

    // Black out (theme_bg()'s out) the weather components
    graphics_context_set_fill_color(ctx, theme_bg());
    graphics_fill_rect(ctx, GRect(0, 0, w, h), 0, GCornerNone);
}

void loading_layer_create(Layer* parent_layer, GRect frame) {
    s_loading_layer = layer_create(frame);

    GRect bounds = layer_get_bounds(s_loading_layer);
    int w = bounds.size.w; int h = bounds.size.h;
    s_loading_text_layer = text_layer_create(GRect(0, h / 3, w, h));
    text_layer_set_background_color(s_loading_text_layer, GColorClear);
    text_layer_set_text_color(s_loading_text_layer, theme_fg());
    text_layer_set_font(s_loading_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
    text_layer_set_text_alignment(s_loading_text_layer, GTextAlignmentCenter);
    layer_set_update_proc(s_loading_layer, loading_update_proc);
    layer_add_child(s_loading_layer, text_layer_get_layer(s_loading_text_layer));
    layer_add_child(parent_layer, s_loading_layer);
    loading_layer_refresh();   // pick notice vs "No data :(" vs hidden from persist
    MEMORY_LOG_HEAP("after_loading_layer_create");
}

void loading_layer_refresh() {
    text_layer_set_text_color(s_loading_text_layer, theme_fg());  // re-apply after a live theme flip

    int notice_len = persist_get_notice_text(s_notice_text, sizeof(s_notice_text));
    if (notice_len > 0) {
        // A pushed notice (e.g. "API key error") overrides the freshness fallback.
        text_layer_set_text(s_loading_text_layer, s_notice_text);
        layer_set_hidden(s_loading_layer, false);
        return;
    }

    text_layer_set_text(s_loading_text_layer, "No data :(");
    layer_set_hidden(s_loading_layer, loading_layer_data_is_fresh());
}

void loading_layer_destroy() {
    MEMORY_LOG_HEAP("loading_layer_destroy:before");
    text_layer_destroy(s_loading_text_layer);
    layer_destroy(s_loading_layer);
    MEMORY_LOG_HEAP("loading_layer_destroy:after");
}

Layer *loading_layer_get_root(void) {
    return s_loading_layer;
}
