import { createClient } from "@supabase/supabase-js";
import { createNewsHandler } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const hashSecret = Deno.env.get("TELEMETRY_HASH_SECRET");

// A deploy missing any of these still boots: every valid request is answered 500
// internal_error (with CORS, so the page can read it) and logged as 'not_configured', as it
// was when the function read its environment per request. A blank value counts as missing
// (an empty HMAC key cannot be imported).
Deno.serve(createNewsHandler({
  backend: supabaseUrl && serviceRoleKey && hashSecret
    ? { client: createClient(supabaseUrl, serviceRoleKey), hashSecret }
    : null,
  now: () => new Date(),
}));
