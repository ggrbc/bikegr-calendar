import Link from "next/link";
import { ROLE_LABELS } from "@/admin/editors/rules";
import { requireSignedIn } from "@/auth/dal";
import { getDb } from "@/db";
import { countPending } from "@/submissions/queue";
import { Badge, buttonClass, linkClass } from "./_components/ui";
import { signOutAction } from "./actions";
import { AdminNavLinks } from "./admin-nav-links";

/** Admin navigation. Reads the session, so the layout renders it inside a Suspense boundary. */
export async function AdminNav() {
  const editor = await requireSignedIn();
  // An Event manager has no Review queue, so skip the count.
  const waiting = editor.role === "event_manager" ? 0 : await countPending(getDb());
  return <AdminNavLinks role={editor.role} waiting={waiting} />;
}

/** The Editor's name and role, a link to the public calendar, and Sign out. */
export async function AdminUser() {
  const editor = await requireSignedIn();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {editor.role !== "event_manager" && (
        <Link href="/" className={linkClass}>
          Public calendar
        </Link>
      )}
      <span className="flex items-center gap-2">
        <Link href="/admin/account" className={linkClass}>
          {editor.name ?? editor.email}
        </Link>
        <Badge tone="neutral">{ROLE_LABELS[editor.role]}</Badge>
      </span>
      <form action={signOutAction}>
        <button type="submit" className={buttonClass("secondary", "sm")}>
          Sign out
        </button>
      </form>
    </div>
  );
}
