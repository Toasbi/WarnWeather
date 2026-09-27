import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";
import { createKeyCheckHandler } from "./key-check.ts";
import { createKeys, resolvePepper } from "./keys.ts";
import { routeRequest } from "./router.ts";
import { createSupabaseStore } from "./supabase-store.ts";

const env = (name: string) => Deno.env.get(name);
const supabaseUrl = env("SUPABASE_URL");
const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is not set");
}
if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
}

// The root -> the nowcast proxy (handler.ts: POST {lat, lon, start}, legacy GET ?lat&lon&start);
// '/key-check' -> the settings page's Rainbow key Test (key-check.ts: one upstream call on the
// user's key, no DB). The hashing pepper for the stored keys (keys.ts) is resolved once here;
// it is never empty, since the service-role key it falls back to is checked above.
Deno.serve(routeRequest(
  createHandler({
    store: createSupabaseStore(createClient(supabaseUrl, serviceRoleKey)),
    keys: createKeys(resolvePepper(env)),
    fetchFn: fetch,
    env,
    now: () => new Date(),
  }),
  createKeyCheckHandler({ fetchFn: fetch }),
));
