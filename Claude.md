## Dev Iteration Flow

After you've added a feature run `mise build` to verify it builds.

If you need runtime logs, `mise install-emulator --logs` runs it in an emulator and prints logs to the terminal. The process stays alive until the emulator is closed

## Debugging

- C: `APP_LOG(APP_LOG_LEVEL_DEBUG, "msg", args)`
- Heap probes: use `MEMORY_LOG_HEAP("tag")` for dev-only `MEM|...` logs around lifecycle and redraw checkpoints.
- JS: `console.log("msg")`

## Pebble Memory Tips

- Lazy-load bitmaps and destroy them when they are not needed to keep startup and steady-state heap usage low.
- Prefer drawing directly in an update proc over creating extra layer objects when a simple render path is enough.
- If a UI element only exists to paint pixels, keep it as light as possible instead of modeling it as a full layer.

## Key Technical Constraints

- No Floating Point — Uses sin_lookup()/cos_lookup() for trigonometry
- MINUTE_UNIT Updates — Always uses minute-based tick updates for battery efficiency
- Pre-allocated Memory — Creates GPaths in window_load
- Dynamic Bounds — Uses layer_get_bounds() instead of hardcoded screen sizes
- Resource Cleanup — Properly destroys all resources in unload handlers

## Code Conventions

- For new JavaScript functions, add brief JSDoc (`@param`/`@returns`) annotations since this project does not use TypeScript.
- Prefer `Boolean(value)` over `!!value` in new/edited code for readability.
- When branching on `#ifdef PBL_PLATFORM_EMERY`, add a brief `emery:` comment explaining the Emery-specific behavior.

## PKJS ES5-Only Runtime (aplite)

aplite (Pebble Classic/Steel) runs the PKJS phone-side JS on a pre-ES6 JavaScriptCore. The Pebble SDK bundles PKJS with webpack but does **no** babel transpilation, so ES6 in `src/pkjs/` ships as-is and breaks aplite — and the failure is invisible on other platforms and in the build:

- **ES6 syntax** (arrow functions, `const`/`let`, template literals, `class`, `for…of`, spread/destructuring) fails to parse → the whole bundle dies on aplite.
- **ES6 built-in methods/globals** (`Array.from`, `String.prototype.includes`/`startsWith`, `Object.values`/`entries`, `Promise`, `Map`, `Set`, …) are `undefined` → they throw "undefined is not a function" at **runtime**, only when that line executes (e.g. the v1.1.0 weather-fetch crash via `Object.assign`).

Write watch-runtime PKJS as ES5: `var` + `function`, no arrow/template-literal syntax, and avoid ES6 built-ins. Already polyfilled and safe to call: `Object.assign` and `Array.prototype.find`/`findIndex`/`includes` (see `src/pkjs/polyfills.js`, required first in `index.js`). Need another ES6 method? Add a guarded polyfill there instead of calling it directly. Exempt: `src/pkjs/clay/` is vendored and runs in the phone webview (modern JS), so its ES6 usage doesn't reach the watch.

## Generated package.json

`package.json` is generated — never edit it directly; `mise build` (via `scripts/prepare-package.sh`, mustache over `package.template.json` + `profiles/package.<profile>.json`, plus telemetry/release-notification injection) regenerates it and silently wipes manual edits. Add AppMessage keys (`messageKeys`), appinfo, capabilities, etc. to `package.template.json` (and profiles for per-profile values). A new key missing from the template surfaces as `MESSAGE_KEY_<NAME> undeclared` at C compile time even though the working-tree `package.json` looked correct before the build re-ran. Regenerate locally with `mise prepare-package` (or `scripts/prepare-package.sh dev`).

## Supabase migrations

Never write `migrations/` files manually. Edit declarative `schemas/` and generate migrations as-needed before commits with `supabase db diff -f <label>`
