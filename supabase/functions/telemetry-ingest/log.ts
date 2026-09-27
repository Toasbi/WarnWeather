// The only place the telemetry-ingest function writes to its logs. Supabase keeps every
// function log line, so a line carries a fixed tag and at most a machine code (a Postgres
// SQLSTATE, a PostgREST code): never an error object, message, detail or hint, and never
// request data (account or watch tokens, their hashes, settings, error strings).

/** The events worth a log line. */
export type LogTag =
  | "rate_check_failed"
  | "insert_failed"
  | "not_configured"
  | "unhandled";

// Postgres SQLSTATEs ('23505', '42P01') and PostgREST codes ('PGRST202') fit; anything else
// (a sentence, a value) is dropped rather than logged.
const CODE = /^[A-Z0-9_]{1,16}$/;

/**
 * A code as it may appear in a log line.
 * @param code A machine code or HTTP status (anything else is dropped).
 * @returns The code as text, or "" when it is not a safe code.
 */
export function safeCode(code: unknown): string {
  if (typeof code === "number" && Number.isInteger(code)) return String(code);
  if (typeof code === "string" && CODE.test(code)) return code;
  return "";
}

/**
 * Log one event: 'telemetry-ingest <tag>[ <code>]'.
 * @param tag What happened.
 * @param code Optional machine code (filtered through safeCode).
 * @returns Nothing.
 */
export function logEvent(tag: LogTag, code?: unknown): void {
  const c = safeCode(code);
  console.error(c ? "telemetry-ingest " + tag + " " + c : "telemetry-ingest " + tag);
}
