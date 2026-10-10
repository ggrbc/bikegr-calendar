/**
 * A safe log text for a database error: only the error name and code. Driver messages can contain
 * the connection string or query values, so they are never logged.
 */
import { redactSecrets } from "@/db/redact-secrets";

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = codeOf(error) ?? codeOf(error.cause);
  return redactSecrets(code ? `${error.name} (${code})` : error.name);
}

function codeOf(value: unknown): string | undefined {
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { code: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return String(code);
  }
  return undefined;
}
