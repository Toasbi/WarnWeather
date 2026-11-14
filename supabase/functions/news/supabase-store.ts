import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListAnswer, NewsStore } from "./handler.ts";
import { logEvent } from "./log.ts";

/**
 * Store over the tables and RPCs declared in supabase/schemas/news.sql. The gateway logs the
 * URL of every PostgREST request, so nothing keyed by the caller's account-token hash ever
 * rides one: every hash-keyed read or write and the rate-limit count is an RPC (arguments in
 * the POST body), and the vote upsert carries the hash in its row body. Only the news id
 * (no personal data) appears in a query filter. A failure is logged here by tag and code
 * (log.ts) and answered as null or false; the handler picks the status.
 * @param client A service-role client.
 * @returns The store.
 */
export function createNewsStore(client: SupabaseClient): NewsStore {
  return {
    async list(version, hash, limit) {
      const { data, error } = await client.rpc("news_list", {
        p_version: version,
        p_account_token_hash: hash,
        p_limit: limit,
      });
      const answer = data as { items?: unknown; last_seen_id?: number | null } | null;
      if (error || !answer || !Array.isArray(answer.items)) {
        logEvent("list_failed", error?.code);
        return null;
      }
      return answer as ListAnswer;
    },
    async markSeen(hash, maxSeenId) {
      const { error } = await client.rpc("news_mark_seen", {
        p_account_token_hash: hash,
        p_max_seen_id: maxSeenId,
      });
      if (error) {
        logEvent("seen_failed", error.code);
        return false;
      }
      return true;
    },
    async getChoices(newsId) {
      // Keyed by the news id only (no personal data), so a plain table read.
      const { data, error } = await client
        .from("news")
        .select("choices")
        .eq("id", newsId)
        .maybeSingle();
      if (error) {
        logEvent("news_lookup_failed", error.code);
        return null;
      }
      return { choices: data ? data.choices : null };
    },
    async countRecentActions(hash, since) {
      const { data, error } = await client.rpc("news_recent_action_count", {
        p_account_token_hash: hash,
        p_since: since,
      });
      if (error || !Number.isInteger(data)) {
        logEvent("rate_check_failed", error?.code);
        return null;
      }
      return data as number;
    },
    async upsertVote(row) {
      // The hash rides the row body; the URL carries only the conflict columns' names.
      const { error } = await client.from("news_votes").upsert(row, {
        onConflict: "news_id,account_token_hash",
      });
      if (error) {
        logEvent("vote_failed", error.code);
        return false;
      }
      return true;
    },
  };
}
