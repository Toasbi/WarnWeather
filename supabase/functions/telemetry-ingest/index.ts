import { createClient } from "@supabase/supabase-js";
import { createIngestHandler } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const hashSecret = Deno.env.get("TELEMETRY_HASH_SECRET");

// A deploy missing any of these still boots: every valid request is answered 500
// internal_error and logged as 'not_configured', as it was 500 when the function read its
// environment per request (and threw). A 500 is retried by the phone, so nothing is lost while
// a secret is fixed. A blank value counts as missing (an empty HMAC key cannot be imported).
Deno.serve(createIngestHandler({
  backend: supabaseUrl && serviceRoleKey && hashSecret
    ? { client: createClient(supabaseUrl, serviceRoleKey), hashSecret }
    : null,
  now: () => new Date(),
}));
