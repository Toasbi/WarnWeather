import type { SupabaseClient } from "@supabase/supabase-js";
import type { Store } from "./handler.ts";

/** Store over the tables/RPCs declared in supabase/schemas/rainbow.sql. */
export function createSupabaseStore(supabase: SupabaseClient): Store {
  return {
    async getCache(key) {
      const { data, error } = await supabase
        .from("rainbow_nowcast_cache")
        .select("payload, expires_at")
        .eq("cache_key", key)
        .maybeSingle();
      if (error || !data) {
        return null;
      }
      return { payload: data.payload, expiresAt: data.expires_at };
    },
    async setCache(key, payload, expiresAt) {
      const { error } = await supabase
        .from("rainbow_nowcast_cache")
        .upsert({ cache_key: key, payload, expires_at: expiresAt });
      if (error) {
        throw new Error("rainbow_nowcast_cache upsert failed: " + error.message);
      }
    },
    async getMonthlyUsage(period) {
      const { data, error } = await supabase
        .from("rainbow_upstream_usage")
        .select("upstream_calls")
        .eq("period", period)
        .maybeSingle();
      if (error) {
        throw new Error("rainbow_upstream_usage read failed: " + error.message);
      }
      return data ? data.upstream_calls : 0;
    },
    async incrementMonthlyUsage(period) {
      const { data, error } = await supabase.rpc("increment_rainbow_usage", { p_period: period });
      if (error) {
        throw new Error("increment_rainbow_usage failed: " + error.message);
      }
      return data as number;
    },
    async incrementIpUsage(ipHour) {
      const { data, error } = await supabase.rpc("increment_rainbow_ip_usage", { p_ip_hour: ipHour });
      if (error) {
        throw new Error("increment_rainbow_ip_usage failed: " + error.message);
      }
      return data as number;
    },
  };
}
