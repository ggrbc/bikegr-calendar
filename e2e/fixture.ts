/**
 * Known data for the Playwright smoke tests. Dates are relative to "today" in Detroit, so the data
 * is always in the agenda window. Fixed ids, so the tests can build detail URLs.
 */
import { addDays, dayOfWeek, type LocalDate } from "@/engine";

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://bikegr:bikegr@localhost:55432/bikegr";
// Other ports for a run next to another checkout: E2E_APP_PORT and E2E_HOST_PORT (defaults 3100, 4100).
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
export const HOST_PORT = Number(process.env.E2E_HOST_PORT ?? 4100);
export const APP = `http://localhost:${APP_PORT}`;
export const HOST = `http://localhost:${HOST_PORT}`;

export const IDS = {
  tuesday: "10000000-0000-4000-8000-000000000001",
  thursday: "10000000-0000-4000-8000-000000000002",
  meeting: "10000000-0000-4000-8000-000000000003",
  deleted: "10000000-0000-4000-8000-000000000004",
  pending: "10000000-0000-4000-8000-000000000005",
};

/**
 * The e2e Editor. Auth.js uses database sessions, so global setup writes a session row and the
 * Review queue tests set its cookie: no magic link. Test-only values, never a real secret.
 */
export const E2E_EDITOR = {
  id: "20000000-0000-4000-8000-000000000001",
  email: "e2e.editor@example.org",
  name: "E2E Editor",
  sessionToken: "e2e-session-token-not-a-secret",
};

/** An Admin, for the pages only Admins see (Editors). Test-only values, like E2E_EDITOR. */
export const E2E_ADMIN = {
  id: "20000000-0000-4000-8000-000000000002",
  email: "e2e.admin@example.org",
  name: "E2E Admin",
  sessionToken: "e2e-admin-session-token-not-a-secret",
};

/** An Editor that only the Editors spec changes (rename, role, deactivate), so other specs keep their names. */
export const E2E_TARGET = {
  id: "20000000-0000-4000-8000-000000000003",
  email: "e2e.target@example.org",
  name: "E2E Rename Target",
};

/** An Editor with a 64-character address part and a 100-character name, both with no spaces. */
export const E2E_LONG = {
  id: "20000000-0000-4000-8000-000000000005",
  email: `${"a".repeat(64)}@example.org`,
  name: "N".repeat(100),
};

/** An Editor who renames themselves on /admin/account. Test-only values. */
export const E2E_SELF = {
  id: "20000000-0000-4000-8000-000000000004",
  email: "e2e.self@example.org",
  name: "E2E Self Rename",
  sessionToken: "e2e-self-session-token-not-a-secret",
};

/** A fixed test-only `AUTH_SECRET` for the e2e web server (it also keys the rate-limit hashes). */
export const E2E_AUTH_SECRET = "e2e-only-auth-secret-not-used-anywhere-else";

/** The first date on or after `from` with the weekday `day` (0 = Sunday). */
export function nextWeekday(from: LocalDate, day: number): LocalDate {
  return addDays(from, (day - dayOfWeek(from) + 7) % 7);
}

export function fixtureDates(today: LocalDate) {
  return {
    firstTuesday: nextWeekday(today, 2),
    firstThursday: nextWeekday(today, 4),
    meeting: addDays(today, 3),
    deleted: addDays(today, 2),
  };
}

/** `2026-10-14T1800`, the detail URL form. */
export const segment = (date: LocalDate, time = "1800") => `${date}T${time}`;
