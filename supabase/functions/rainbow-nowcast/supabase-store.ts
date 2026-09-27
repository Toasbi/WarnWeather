import type { SupabaseClient } from "@supabase/supabase-js";
import type { Store } from "./handler.ts";
import { logEvent, StoreError } from "./log.ts";

/**
 * Store over the tables/RPCs declared in supabase/schemas/rainbow.sql. The gateway logs the
 * URL of every PostgREST request, so no key (cache key or IP bucket) ever rides one: the
 * cache read and both increments are RPCs (arguments in the POST body), and the cache write
 * is an upsert (row in the body). Only the month ('2026-07') appears in a query filter.
 * Errors are thrown as StoreErrors carrying the PostgREST/Postgres code, never the message.
 * @param supabase A service-role client.
 * @returns The store.
 */
export function createSupabaseStore(supabase: SupabaseClient): Store {
  return {
    async getCache(key) {
      const { data, error } = await supabase.rpc("get_rainbow_nowcast_cache", { p_cache_key: key });
      if (error) {
        // A failed read is a miss, as it always was: the guards and upstream still run.
        logEvent("cache_read_failed", error.code);
        return null;
      }
      if (!data || typeof data !== "object") {
        return null;
      }
      const row = data as { payload: unknown; expires_at: string };
      return { payload: row.payload, expiresAt: row.expires_at };
    },
    async setCache(key, payload, expiresAt) {
      const { error } = await supabase
        .from("rainbow_nowcast_cache")
        .upsert({ cache_key: key, payload, expires_at: expiresAt });
      if (error) {
        throw new StoreError("cache_write_failed", error.code);
      }
    },
    async getMonthlyUsage(period) {
      const { data, error } = await supabase
        .from("rainbow_upstream_usage")
        .select("upstream_calls")
        .eq("period", period)
        .maybeSingle();
      if (error) {
        throw new StoreError("budget_read_failed", error.code);
      }
      return data ? data.upstream_calls : 0;
    },
    async incrementMonthlyUsage(period) {
      const { data, error } = await supabase.rpc("increment_rainbow_usage", { p_period: period });
      if (error) {
        throw new StoreError("budget_bump_failed", error.code);
      }
      return data as number;
    },
    async incrementIpUsage(ipHour) {
      const { data, error } = await supabase.rpc("increment_rainbow_ip_usage", { p_ip_hour: ipHour });
      if (error) {
        throw new StoreError("ip_usage_failed", error.code);
      }
      return data as number;
    },
  };
}
