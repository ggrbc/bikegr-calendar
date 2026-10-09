import { Suspense } from "react";
import { requireEditor } from "@/auth/dal";
import { signOutAction } from "./actions";
import { InviteForm } from "./invite-form";

async function AdminHome() {
  const editor = await requireEditor();
  const isAdmin = editor.role === "admin";

  return (
    <>
      <div className="mb-8 flex items-center justify-between gap-4">
        <p>
          Signed in as <strong>{editor.name ?? editor.email}</strong>
          {isAdmin ? " (Admin)" : " (Editor)"}
        </p>
        <form action={signOutAction}>
          <button type="submit" className="rounded border border-gray-400 px-3 py-1">
            Sign out
          </button>
        </form>
      </div>
      {isAdmin && (
        <section aria-labelledby="invite-heading">
          <h2 id="invite-heading" className="mb-3 text-xl font-semibold">
            Invite an Editor
          </h2>
          <InviteForm />
        </section>
      )}
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
