#include "loading_layer.h"
#include "c/appendix/persist.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/theme.h"
#include "c/services/watch_services.h"

#define FORECAST_MAX_AGE_S (SECONDS_PER_HOUR * 12)  // older than this => show "No data :("
#if defined(WW_FETCH_NOTICE)
#define NOTICE_TEXT_MAX 48   // matches the phone-side ~32 B cap + NUL, with headroom
#endif

static Layer *s_loading_layer;
// What the overlay says (loading_layer_refresh): the notice, or "No data :(".
static const char *s_text;
#if defined(WW_FETCH_NOTICE)
static char s_notice_text[NOTICE_TEXT_MAX];
#endif

bool loading_layer_data_is_fresh() {
    const time_t forecast_start = persist_get_forecast_start();
    const time_t now = watch_services_now();

    return now - forecast_start <= FORECAST_MAX_AGE_S;
}

static void loading_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    int w = bounds.size.w;
    int h = bounds.size.h;

    // Black out (theme_bg()'s out) the weather components
    graphics_context_set_fill_color(ctx, theme_bg());
    graphics_fill_rect(ctx, GRect(0, 0, w, h), 0, GCornerNone);

    // The text, centred from a third of the way down, in the theme's ink at every draw.
    // Its box is the layer's current bounds: the window reframes this layer on every view
    // render (a settings apply, a flick, a quick-view peek).
    if (s_text && s_text[0] != '\0') {
        graphics_context_set_text_color(ctx, theme_fg());
        graphics_draw_text(ctx, s_text, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                           GRect(0, h / 3, w, h), GTextOverflowModeTrailingEllipsis,
                           GTextAlignmentCenter, NULL);
    }
}

void loading_layer_create(Layer* parent_layer, GRect frame) {
    s_loading_layer = layer_create(frame);
    layer_set_update_proc(s_loading_layer, loading_update_proc);
    layer_add_child(parent_layer, s_loading_layer);
    loading_layer_refresh();   // pick notice vs "No data :(" vs hidden from persist
    MEMORY_LOG_HEAP("after_loading_layer_create");
}

void loading_layer_refresh() {
    // Repaint: the text or the theme it is drawn in may have changed.
    layer_mark_dirty(s_loading_layer);

#if defined(WW_FETCH_NOTICE)
    int notice_len = persist_get_notice_text(s_notice_text, sizeof(s_notice_text));
    if (notice_len > 0) {
        // A pushed notice (e.g. "API key error") overrides the freshness fallback.
        s_text = s_notice_text;
        layer_set_hidden(s_loading_layer, false);
        return;
    }
#endif

    s_text = "No data :(";
    layer_set_hidden(s_loading_layer, loading_layer_data_is_fresh());
}

void loading_layer_destroy() {
    MEMORY_LOG_HEAP("loading_layer_destroy:before");
    layer_destroy(s_loading_layer);
    MEMORY_LOG_HEAP("loading_layer_destroy:after");
}

Layer *loading_layer_get_root(void) {
    return s_loading_layer;
}
