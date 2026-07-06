import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";
import { createSupabaseStore } from "./supabase-store.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is not set");
}
if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
}

Deno.serve(createHandler({
  store: createSupabaseStore(createClient(supabaseUrl, serviceRoleKey)),
  fetchFn: fetch,
  env: (name) => Deno.env.get(name),
  now: () => new Date(),
}));
