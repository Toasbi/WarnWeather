import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const MAX_BODY_BYTES = 4096;
const MAX_ACTIONS_PER_DAY = 10; // shared budget: free-text replies + poll votes
const MAX_TOTAL_REPLIES_PER_DAY = 500; // global reply flood cap across all tokens
const MAX_ITEMS = 50;

// The config page runs from a data: URL (opaque origin), so unlike the
// PKJS-originated telemetry calls, browser CORS applies here.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

// Version strings feed a PostgREST .or() filter; the regex keeps filter
// metacharacters (commas, parens) out of it.
export const versionSchema = z.string().trim().min(1).max(32).regex(/^[0-9A-Za-z.+-]+$/);

// Deliberately permissive: Pebble account tokens are 32-hex today, but the Core
// Devices mobile app's token format isn't guaranteed — this blocks arbitrary
// junk/flood strings without betting on one specific format.
export const accountTokenSchema = z.string().trim().regex(/^[0-9A-Za-z-]{8,64}$/);

// Read-side leniency: a present-but-non-conforming token (a future app with a
// different format) is treated as absent so list reads never break. Returns ""
// for anything that doesn't conform, else the trimmed token.
export function conformingToken(t: unknown): string {
  const s = typeof t === "string" ? t.trim() : "";
  return /^[0-9A-Za-z-]{8,64}$/.test(s) ? s : "";
}

export const listSchema = z.object({
  op: z.literal("list"),
  accountToken: z.string().optional(),
  version: versionSchema,
}).strip();

export const seenSchema = z.object({
  op: z.literal("seen"),
  accountToken: accountTokenSchema,
  maxSeenId: z.number().int().positive(),
}).strip();

export const replySchema = z.object({
  op: z.literal("reply"),
  accountToken: accountTokenSchema,
  version: versionSchema,
  newsId: z.number().int().positive(),
  message: z.string().trim().min(1).max(1000),
}).strip();

export const voteSchema = z.object({
  op: z.literal("vote"),
  accountToken: accountTokenSchema,
  newsId: z.number().int().positive(),
  choiceIndex: z.number().int().nonnegative(),
}).strip();

export const payloadSchema = z.discriminatedUnion("op", [listSchema, seenSchema, replySchema, voteSchema]);

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

export async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encodeUtf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encodeUtf8(message));
  const bytes = new Uint8Array(signature);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// Shared 10/day budget across replies and votes: reply rows count by
// created_at, vote rows by their last change (updated_at) — a re-vote
// refreshes its window but never adds a second row. Returns null on DB error.
// deno-lint-ignore no-explicit-any
async function countRecentActions(supabase: any, hash: string): Promise<number | null> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const replies = await supabase
    .from("news_replies")
    .select("id", { count: "exact", head: true })
    .eq("account_token_hash", hash)
    .gte("created_at", oneDayAgo);
  if (replies.error) {
    return null;
  }
  const votes = await supabase
    .from("news_votes")
    .select("news_id", { count: "exact", head: true })
    .eq("account_token_hash", hash)
    .gte("updated_at", oneDayAgo);
  if (votes.error) {
    return null;
  }
  return (replies.count || 0) + (votes.count || 0);
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }
    const rawBody = await req.text();
    if (encodeUtf8(rawBody).length > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (_error) {
      return json({ error: "invalid_json" }, 400);
    }

    const payloadResult = payloadSchema.safeParse(parsed);
    if (!payloadResult.success) {
      return json({
        error: "invalid_payload",
        detail: payloadResult.error.issues[0]?.message || "invalid_payload",
      }, 400);
    }
    const payload = payloadResult.data;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const hashSecret = Deno.env.get("TELEMETRY_HASH_SECRET");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is not set");
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    if (!hashSecret) throw new Error("TELEMETRY_HASH_SECRET is not set");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (payload.op === "list") {
      const itemsRes = await supabase
        .from("news")
        .select("id, created_at, title, body_md, choices")
        .or(`target_version.is.null,target_version.eq.${payload.version}`)
        .order("id", { ascending: false })
        .limit(MAX_ITEMS);
      if (itemsRes.error) {
        console.error("news: list list_failed", itemsRes.error);
        return json({ error: "list_failed" }, 500);
      }

      let lastSeenId: number | null = null;
      const votesByNews: Record<number, number> = {};
      const token = conformingToken(payload.accountToken);
      if (token !== "") {
        const hash = await hmacSha256Hex(hashSecret, token);
        const seenRes = await supabase
          .from("news_seen")
          .select("last_seen_news_id")
          .eq("account_token_hash", hash)
          .maybeSingle();
        if (seenRes.error) {
          console.error("news: list seen_lookup_failed", seenRes.error);
          return json({ error: "seen_lookup_failed" }, 500);
        }
        lastSeenId = seenRes.data ? seenRes.data.last_seen_news_id : 0;

        const ids = itemsRes.data.map((it: { id: number }) => it.id);
        if (ids.length > 0) {
          const votesRes = await supabase
            .from("news_votes")
            .select("news_id, choice_index")
            .eq("account_token_hash", hash)
            .in("news_id", ids);
          if (votesRes.error) {
            console.error("news: list votes_lookup_failed", votesRes.error);
            return json({ error: "votes_lookup_failed" }, 500);
          }
          for (const v of votesRes.data) {
            votesByNews[v.news_id] = v.choice_index;
          }
        }
      }
      const items = itemsRes.data.map((it: { id: number }) => ({
        ...it,
        myChoice: Object.prototype.hasOwnProperty.call(votesByNews, it.id)
          ? votesByNews[it.id]
          : null,
      }));
      return json({ items, lastSeenId }, 200);
    }

    if (payload.op === "seen") {
      const hash = await hmacSha256Hex(hashSecret, payload.accountToken);
      const ins = await supabase
        .from("news_seen")
        .insert({ account_token_hash: hash, last_seen_news_id: payload.maxSeenId });
      if (ins.error) {
        if (ins.error.code !== "23505") {
          console.error("news: seen seen_failed", ins.error);
          return json({ error: "seen_failed" }, 500);
        }
        // Row exists — raise the watermark, never lower it.
        const upd = await supabase
          .from("news_seen")
          .update({
            last_seen_news_id: payload.maxSeenId,
            updated_at: new Date().toISOString(),
          })
          .eq("account_token_hash", hash)
          .lt("last_seen_news_id", payload.maxSeenId);
        if (upd.error) {
          console.error("news: seen seen_failed", upd.error);
          return json({ error: "seen_failed" }, 500);
        }
      }
      return json({ ok: true }, 200);
    }

    if (payload.op === "vote") {
      const hash = await hmacSha256Hex(hashSecret, payload.accountToken);
      const newsRes = await supabase
        .from("news")
        .select("choices")
        .eq("id", payload.newsId)
        .maybeSingle();
      if (newsRes.error) {
        console.error("news: vote news_lookup_failed", newsRes.error);
        return json({ error: "news_lookup_failed" }, 500);
      }
      const choices = newsRes.data ? newsRes.data.choices : null;
      if (!Array.isArray(choices) || payload.choiceIndex >= choices.length) {
        return json({ error: "unknown_choice" }, 400);
      }

      const actions = await countRecentActions(supabase, hash);
      if (actions === null) {
        console.error("news: vote rate_check_failed");
        return json({ error: "rate_check_failed" }, 500);
      }
      if (actions >= MAX_ACTIONS_PER_DAY) {
        return json({ error: "rate_limit_exceeded", remaining: 0 }, 429);
      }

      const up = await supabase.from("news_votes").upsert({
        news_id: payload.newsId,
        account_token_hash: hash,
        choice_index: payload.choiceIndex,
        choice_text: String(choices[payload.choiceIndex]),
        updated_at: new Date().toISOString(),
      }, { onConflict: "news_id,account_token_hash" });
      if (up.error) {
        console.error("news: vote vote_failed", up.error);
        return json({ error: "vote_failed" }, 500);
      }
      return json({ ok: true }, 200);
    }

    // op === "reply"
    const hash = await hmacSha256Hex(hashSecret, payload.accountToken);

    // Global flood cap across ALL tokens (no account filter): bounds storage
    // abuse via fabricated-token rotation — free-text reply bodies are the
    // flagged blast radius, so this backstops the per-account budget.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const totalReplies = await supabase
      .from("news_replies")
      .select("id", { count: "exact", head: true })
      .gte("created_at", oneDayAgo);
    if (totalReplies.error) {
      console.error("news: reply rate_check_failed", totalReplies.error);
      return json({ error: "rate_check_failed" }, 500);
    }
    if ((totalReplies.count || 0) >= MAX_TOTAL_REPLIES_PER_DAY) {
      console.error("news: global reply cap reached");
      return json({ error: "rate_limit_exceeded", remaining: 0 }, 429);
    }

    const actions = await countRecentActions(supabase, hash);
    if (actions === null) {
      console.error("news: reply rate_check_failed");
      return json({ error: "rate_check_failed" }, 500);
    }
    if (actions >= MAX_ACTIONS_PER_DAY) {
      return json({ error: "rate_limit_exceeded", remaining: 0 }, 429);
    }

    const insertResult = await supabase.from("news_replies").insert({
      news_id: payload.newsId,
      account_token_hash: hash,
      app_version: payload.version,
      message: payload.message,
    });
    if (insertResult.error) {
      // 23503 = FK violation: the news item was deleted (or never existed).
      if (insertResult.error.code === "23503") {
        return json({ error: "unknown_news" }, 400);
      }
      console.error("news: reply insert_failed", insertResult.error);
      return json({ error: "insert_failed" }, 500);
    }
    return json({ ok: true }, 202);
  } catch (error) {
    console.error("news: unhandled error", error);
    return json({ error: "internal_error" }, 500);
  }
});
