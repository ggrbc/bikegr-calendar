import Link from "next/link";
import { requireEditor } from "@/auth/dal";
import { signOutAction } from "./actions";

/** Admin navigation. Reads the session, so the layout renders it inside a Suspense boundary. */
export async function AdminNav() {
  const editor = await requireEditor();
  const isAdmin = editor.role === "admin";

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <nav aria-label="Admin" className="flex flex-wrap gap-4">
        <Link href="/admin/events" className="underline">
          Events
        </Link>
        <Link href="/admin/tags" className="underline">
          Tags
        </Link>
        {isAdmin && (
          <Link href="/admin/editors" className="underline">
            Editors
          </Link>
        )}
      </nav>
      <div className="flex items-center gap-3 text-sm">
        <span>
          {editor.name ?? editor.email} {isAdmin ? "(Admin)" : "(Editor)"}
        </span>
        <form action={signOutAction}>
          <button type="submit" className="rounded border border-gray-400 px-3 py-1">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
