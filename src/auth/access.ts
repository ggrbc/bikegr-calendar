/** Pure access rules by role. No database, no Next.js, so they are easy to test. */
import type { EditorRole } from "@/db/schema";

export const MY_EVENTS_PATH = "/admin/my-events";

/**
 * What a page or action needs:
 * - `editor`: an Editor or an Admin (an Event manager is refused);
 * - `admin`: an Admin;
 * - `event-manager`: an Event manager (the My Events pages);
 * - `signed-in`: any active account (the account page and the admin shell).
 */
export type Need = "editor" | "admin" | "event-manager" | "signed-in";

/** Where to send a person with `role` who does not meet `need`, or null when the role is enough. */
export function accessRedirect(role: EditorRole, need: Need): string | null {
  switch (need) {
    case "signed-in":
      return null;
    case "editor":
      return role === "event_manager" ? MY_EVENTS_PATH : null;
    case "admin":
      if (role === "admin") return null;
      return role === "event_manager" ? MY_EVENTS_PATH : "/admin";
    case "event-manager":
      return role === "event_manager" ? null : "/admin";
  }
}
