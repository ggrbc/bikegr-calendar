import Link from "next/link";
import { Suspense } from "react";
import { requireEditor } from "@/auth/dal";

async function AdminHome() {
  const editor = await requireEditor();
  const isAdmin = editor.role === "admin";

  return (
    <>
      <ul className="mb-8 list-disc pl-6">
        <li>
          <Link href="/admin/events" className="underline">
            Events
          </Link>{" "}
          — create and edit Events in both Calendars.
        </li>
        <li>
          <Link href="/admin/tags" className="underline">
            Tags
          </Link>{" "}
          — the Tag list of each Calendar.
        </li>
        {isAdmin && (
          <li>
            <Link href="/admin/editors" className="underline">
              Editors
            </Link>{" "}
            — invite, change roles, deactivate.
          </li>
        )}
      </ul>
    </>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <AdminHome />
    </Suspense>
  );
}
