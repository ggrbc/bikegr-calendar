import { editors } from "./schema";
import type { Db } from "./types";

/** The first Admins (docs/design.md, "Editors"). They invite everyone else. */
export const FIRST_ADMINS = [
  { email: "jeremy@bikegr.org", name: "Jeremy" },
  { email: "bultentom@bikegr.org", name: "Tom" },
  { email: "nate@bikegr.org", name: "Nate" },
] as const;

/** Inserts the first Admins. Safe to run again: existing emails are left as they are. */
export async function seedAdmins(db: Db): Promise<number> {
  const inserted = await db
    .insert(editors)
    .values(FIRST_ADMINS.map((admin) => ({ ...admin, role: "admin" as const })))
    .onConflictDoNothing({ target: editors.email })
    .returning({ id: editors.id });
  return inserted.length;
}
