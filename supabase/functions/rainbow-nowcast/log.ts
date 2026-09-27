// The only place the rainbow-nowcast function writes to its logs. Supabase keeps every
// function log line, so a line carries a fixed tag and at most a machine code (a Postgres
// SQLSTATE, a PostgREST code, an HTTP status): never an error message, detail or hint, and
// never request data (coordinates, IPs, keys).

/** The events worth a log line. */
export type LogTag =
  | "cache_read_failed"
  | "cache_write_failed"
  | "ip_usage_failed"
  | "budget_read_failed"
  | "budget_bump_failed"
  | "unhandled";

// Postgres SQLSTATEs ('23505', '42P01') and PostgREST codes ('PGRST116') fit; anything else
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
 * Log one event: 'rainbow-nowcast <tag>[ <code>]'.
 * @param tag What happened.
 * @param code Optional machine code (filtered through safeCode).
 * @returns Nothing.
 */
export function logEvent(tag: LogTag, code?: unknown): void {
  const c = safeCode(code);
  console.error(c ? "rainbow-nowcast " + tag + " " + c : "rainbow-nowcast " + tag);
}

/**
 * A failed database call. The message is fixed; what failed is the tag and the database's
 * code, so a thrown StoreError that reaches the runtime prints nothing about the request.
 */
export class StoreError extends Error {
  readonly tag: LogTag;
  readonly code: string;

  /**
   * @param tag What failed.
   * @param code The PostgREST/Postgres code (kept only when safeCode accepts it).
   */
  constructor(tag: LogTag, code?: unknown) {
    super("rainbow-nowcast store call failed");
    this.name = "StoreError";
    this.tag = tag;
    this.code = safeCode(code);
  }
}

/**
 * Log an exception caught at a boundary: a StoreError by its tag and code, anything else as
 * 'unhandled' with no detail at all (its message may carry request data).
 * @param error The caught value.
 * @returns Nothing.
 */
export function logCaught(error: unknown): void {
  if (error instanceof StoreError) logEvent(error.tag, error.code);
  else logEvent("unhandled");
}
