// Rainbow's point-nowcast API, shared by both callers in this function: the nowcast proxy
// (handler.ts) and the settings page's key check (key-check.ts). Path order is /{lon}/{lat}.
// It lives here, not in handler.ts, so key-check.ts imports nothing from the nowcast handler.
export const RAINBOW_BASE = "https://api.rainbow.ai/nowcast/v1/precip-global";
