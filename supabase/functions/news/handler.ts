// The news function: the settings page's News popup (list / seen / vote).
// index.ts only wires the environment in; everything testable lives here.
//
// Privacy: the API gateway logs the full URL of every request the function makes to
// PostgREST, so nothing keyed by the caller's account-token hash ever rides a URL or a query
// filter. Every hash-keyed read or write, and every rate-limit count, is an RPC
// (supabase/schemas/news.sql: POST /rest/v1/rpc/<fn>, arguments in the body); the vote upsert
// carries the hash in its row body. Every query lives in supabase-store.ts, which the handler
// takes as a dependency; logs go through log.ts only.
//
// The external contract is unchanged, since old settings pages keep calling it: the same
// request shapes, status codes and success bodies (key order included), and the same
// {error} strings, except that the three list failures now share 'list_failed' (no client
// reads error strings). Messages ('reply') are no longer taken: an old settings page sending
// one gets 400 invalid_payload.
import { z } from "zod";
import { logEvent } from "./log.ts";

const MAX_BODY_BYTES = 4096;
const MAX_ACTIONS_PER_DAY = 10; // poll votes per account and day
const MAX_ITEMS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

// The config page runs from a data: URL (opaque origin), so unlike the
// PKJS-originated telemetry calls, browser CORS applies here.
export const CORS_HEADERS = {
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

// The regex keeps the version a plain version string. It fed a PostgREST .or() filter before
// the list became an RPC (where it is a body argument); the shape check stays, as part of the
// contract (a nonconforming version is still a 400).
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

export const voteSchema = z.object({
  op: z.literal("vote"),
  accountToken: accountTokenSchema,
  newsId: z.number().int().positive(),
  choiceIndex: z.number().int().nonnegative(),
}).strip();

export const payloadSchema = z.discriminatedUnion("op", [listSchema, seenSchema, voteSchema]);

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

/**
 * JSON.parse reviver dropping U+0000 from every string value. Postgres text and jsonb cannot
 * hold it: the insert fails (22P05) and Postgres logs a CONTEXT line quoting the request JSON
 * before the NUL (free text, or a token hash). Applied at the parse, so validation sees what
 * gets stored. Keys are left alone: the schemas strip unknown ones.
 * @param _key The property name (unused).
 * @param value The parsed value.
 * @returns The value, any string without its NULs.
 */
export function dropNul(_key: string, value: unknown): unknown {
  return typeof value === "string" && value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;
}

/**
 * Hex HMAC-SHA-256: the account-token hash every news table is keyed by (and telemetry's).
 * @param secret The hashing secret (TELEMETRY_HASH_SECRET); must not be empty.
 * @param message The account token.
 * @returns 64 hex characters.
 */
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

/** One item of the news_list RPC's answer (supabase/schemas/news.sql). */
export type ListRow = {
  id: number;
  created_at: string;
  title: string;
  body_md: string;
  choices: unknown;
  my_choice?: number | null;
};

/** The news_list RPC's answer: the items and the caller's seen watermark. */
export type ListAnswer = { items: ListRow[]; last_seen_id?: number | null };

/** One row of news_votes, as the vote upsert writes it. */
export type VoteRow = {
  news_id: number;
  account_token_hash: string;
  choice_index: number;
  choice_text: string;
  updated_at: string;
};

/**
 * Persistence seam: implemented over Postgres in supabase-store.ts. Each method logs its own
 * failure (by tag and code) and answers null or false for it.
 */
export interface NewsStore {
  /** The newest items for a version, each with the caller's vote; null on a failure. */
  list(version: string, hash: string | null, limit: number): Promise<ListAnswer | null>;
  /** Raise the caller's seen watermark (never lower it); false on a failure. */
  markSeen(hash: string, maxSeenId: number): Promise<boolean>;
  /** A poll's choices ({choices: null} for no such item); null on a failure. */
  getChoices(newsId: number): Promise<{ choices: unknown } | null>;
  /**
   * The caller's votes changed since `since` (by updated_at, so a re-vote refreshes its
   * window but never adds a second row); null on a failure.
   */
  countRecentActions(hash: string, since: string): Promise<number | null>;
  /** Record or change the caller's vote; false on a failure. */
  upsertVote(row: VoteRow): Promise<boolean>;
}

/** The store and the token-hashing secret. */
export type NewsBackend = { store: NewsStore; hashSecret: string };

export type NewsDeps = {
  /** null when the deploy lacks SUPABASE_URL, the service-role key or the hashing secret. */
  backend: NewsBackend | null;
  now: () => Date;
};

/**
 * op 'list': the newest items for the caller's version, each with the caller's vote, and the
 * caller's seen watermark, in one RPC. No or a nonconforming token -> lastSeenId null (unread
 * unknowable) and no votes; a token with no watermark yet -> 0 (all unread).
 * @param backend Store and hashing secret.
 * @param payload The validated request.
 * @returns 200 {items, lastSeenId}, each item {id, created_at, title, body_md, choices, myChoice}.
 */
async function list(backend: NewsBackend, payload: z.infer<typeof listSchema>): Promise<Response> {
  const token = conformingToken(payload.accountToken);
  const hash = token === "" ? null : await hmacSha256Hex(backend.hashSecret, token);
  const answer = await backend.store.list(payload.version, hash, MAX_ITEMS);
  if (!answer) {
    return json({ error: "list_failed" }, 500);
  }
  // Rebuilt in the key order the table read produced (the RPC's jsonb sorts its keys).
  const items = answer.items.map((it) => ({
    id: it.id,
    created_at: it.created_at,
    title: it.title,
    body_md: it.body_md,
    choices: it.choices,
    myChoice: it.my_choice ?? null,
  }));
  return json({ items, lastSeenId: answer.last_seen_id ?? null }, 200);
}

/**
 * op 'seen': raise the caller's watermark (never lower it), as one upsert RPC.
 * @param backend Store and hashing secret.
 * @param payload The validated request.
 * @returns 200 {ok: true}.
 */
async function seen(backend: NewsBackend, payload: z.infer<typeof seenSchema>): Promise<Response> {
  const hash = await hmacSha256Hex(backend.hashSecret, payload.accountToken);
  if (!await backend.store.markSeen(hash, payload.maxSeenId)) {
    return json({ error: "seen_failed" }, 500);
  }
  return json({ ok: true }, 200);
}

/**
 * op 'vote': record (or change) the caller's choice on a poll, within the shared daily budget.
 * @param backend Store and hashing secret.
 * @param payload The validated request.
 * @param now The current time.
 * @returns 200 {ok: true}; 400 unknown_choice; 429 when the budget is spent.
 */
async function vote(backend: NewsBackend, payload: z.infer<typeof voteSchema>, now: Date): Promise<Response> {
  const { store } = backend;
  const hash = await hmacSha256Hex(backend.hashSecret, payload.accountToken);
  const poll = await store.getChoices(payload.newsId);
  if (!poll) {
    return json({ error: "news_lookup_failed" }, 500);
  }
  const choices = poll.choices;
  if (!Array.isArray(choices) || payload.choiceIndex >= choices.length) {
    return json({ error: "unknown_choice" }, 400);
  }

  const actions = await store.countRecentActions(hash, new Date(now.getTime() - DAY_MS).toISOString());
  if (actions === null) {
    return json({ error: "rate_check_failed" }, 500);
  }
  if (actions >= MAX_ACTIONS_PER_DAY) {
    return json({ error: "rate_limit_exceeded", remaining: 0 }, 429);
  }

  const voted = await store.upsertVote({
    news_id: payload.newsId,
    account_token_hash: hash,
    choice_index: payload.choiceIndex,
    choice_text: String(choices[payload.choiceIndex]),
    updated_at: now.toISOString(),
  });
  if (!voted) {
    return json({ error: "vote_failed" }, 500);
  }
  return json({ ok: true }, 200);
}

/**
 * The news function's request handler. Nothing it throws reaches the Deno runtime (which would
 * log the error's message and stack): a throw is logged as 'unhandled' with no detail and
 * answered 500 internal_error, with CORS so the page can read it.
 * @param deps Backend (or null when unconfigured) and clock.
 * @returns The handler Deno.serve gets.
 */
export function createNewsHandler(deps: NewsDeps): (req: Request) => Promise<Response> {
  return async (req) => {
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
        parsed = JSON.parse(rawBody, dropNul);
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

      const backend = deps.backend;
      if (!backend) {
        logEvent("not_configured");
        return json({ error: "internal_error" }, 500);
      }

      if (payload.op === "list") return await list(backend, payload);
      if (payload.op === "seen") return await seen(backend, payload);
      return await vote(backend, payload, deps.now());
    } catch (_error) {
      // Its message may carry request data: the tag alone.
      logEvent("unhandled");
      return json({ error: "internal_error" }, 500);
    }
  };
}
