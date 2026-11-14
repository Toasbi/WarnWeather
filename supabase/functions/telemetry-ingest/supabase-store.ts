import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestStore } from "./handler.ts";
import { logEvent } from "./log.ts";

/**
 * Store over the table and RPC declared in supabase/schemas/telemetry.sql. The gateway logs
 * the URL of every PostgREST request, so the account-token hash never rides one: the hourly
 * rate check is an RPC (arguments in the POST body), and the insert carries both hashes in
 * its row bodies. A failure is logged here by tag and code (log.ts) and answered as null or
 * false; the handler picks the status.
 * @param client A service-role client.
 * @returns The store.
 */
export function createIngestStore(client: SupabaseClient): IngestStore {
  return {
    async countRecentInserts(hash, since) {
      const { data, error } = await client.rpc("telemetry_recent_insert_count", {
        p_account_token_hash: hash,
        p_since: since,
      });
      if (error || !Number.isInteger(data)) {
        logEvent("rate_check_failed", error?.code);
        return null;
      }
      return data as number;
    },
    async insertFetches(rows) {
      // Both hashes ride the row bodies; the URL carries only the column names.
      const { error } = await client.from("telemetry_weather_fetch").insert(rows);
      if (error) {
        logEvent("insert_failed", error.code);
        return false;
      }
      return true;
    },
  };
}
