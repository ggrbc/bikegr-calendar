/**
 * The log line for an unexpected Auth.js error: the error classes, the Postgres code, and the
 * stack frames. No message text: an `AdapterError` wraps a Drizzle error whose message holds the
 * SQL and its params (an email). The same rule as the admin error log.
 *
 * Auth.js puts the original error in `cause.err` (`new AdapterError(e)` gives
 * `cause = { err: e, ...e.cause }`), so the walk follows both `cause` and `cause.err`.
 */
const MAX_DEPTH = 4;
const MAX_FRAMES = 12;

export function authErrorLog(error: unknown): string {
  const parts = ["[auth] Auth.js error:"];
  const frames: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < MAX_DEPTH; depth++) {
    const code = codeOf(current);
    parts.push(`${depth === 0 ? "" : "cause "}${current.constructor.name}${code ? ` code=${code}` : ""}`);
    for (const line of (current.stack ?? "").split("\n")) {
      if (/^\s+at /.test(line) && frames.length < MAX_FRAMES) frames.push(line);
    }
    current = nextCause(current.cause);
  }
  if (!(error instanceof Error)) parts.push(typeof error);
  return [parts.join(" "), ...frames].join("\n");
}

function nextCause(cause: unknown): unknown {
  if (cause instanceof Error) return cause;
  if (cause && typeof cause === "object" && "err" in cause) return (cause as { err: unknown }).err;
  return undefined;
}

function codeOf(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
}
