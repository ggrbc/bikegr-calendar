/**
 * Loads the agenda days, and turns a database error into a fallback, so the page keeps its heading
 * and shows a short message instead of an error page. The log line has only the error name and
 * code: driver messages can contain the connection string or query values.
 */
import type { QueryWindow } from "@/engine";
import { redactSecrets } from "@/db/redact-secrets";
import { type AgendaDay, groupAgendaDays } from "./agenda-days";
import type { AgendaRow } from "./load-occurrences";

export type AgendaResult = { ok: true; days: AgendaDay[] } | { ok: false };

export async function loadAgenda(
  load: () => Promise<AgendaRow[]>,
  window: QueryWindow,
  log: (line: string) => void = console.error,
): Promise<AgendaResult> {
  let rows: AgendaRow[];
  try {
    rows = await load();
  } catch (error) {
    log(redactSecrets(`Agenda could not load: ${describe(error)}`));
    return { ok: false };
  }
  return { ok: true, days: groupAgendaDays(rows, window) };
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = codeOf(error) ?? codeOf(error.cause);
  return code ? `${error.name} (${code})` : error.name;
}

function codeOf(value: unknown): string | undefined {
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { code: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return String(code);
  }
  return undefined;
}
