import { Suspense } from "react";
import { listEditorsForAdmin } from "@/admin/editors/editors";
import { requireAdmin } from "@/auth/dal";
import { getDb } from "@/db";
import { EditorActions } from "./editor-forms";
import { InviteForm } from "./invite-form";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Detroit",
  year: "numeric",
  month: "short",
  day: "numeric",
});
const day = (date: Date | null) => (date ? dateFormat.format(date) : "—");

async function EditorList() {
  const admin = await requireAdmin();
  const list = await listEditorsForAdmin(getDb());

  return (
    <>
      <section aria-labelledby="invite-heading" className="mb-10">
        <h2 id="invite-heading" className="mb-3 text-xl font-semibold">
          Invite an Editor
        </h2>
        <InviteForm />
      </section>

      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="mb-3 text-xl font-semibold">
          Editors
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-gray-400">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Invited</th>
                <th className="py-2 pr-4">First sign-in</th>
                <th className="py-2 pr-4">Last active (about)</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((editor) => {
                const isMe = editor.id === admin.id;
                return (
                  <tr key={editor.id} className="border-b border-gray-200 align-top">
                    <td className="py-2 pr-4">
                      {editor.name && <div className="font-medium">{editor.name}</div>}
                      <div>{editor.email}</div>
                    </td>
                    <td className="py-2 pr-4">{editor.role === "admin" ? "Admin" : "Editor"}</td>
                    <td className="py-2 pr-4">
                      {editor.deactivatedAt
                        ? `Deactivated ${day(editor.deactivatedAt)}${editor.deactivatedByName ? ` by ${editor.deactivatedByName}` : ""}`
                        : "Active"}
                    </td>
                    <td className="py-2 pr-4">
                      {editor.invitedAt
                        ? `${day(editor.invitedAt)}${editor.invitedByName ? ` by ${editor.invitedByName}` : ""}`
                        : "Seeded"}
                    </td>
                    <td className="py-2 pr-4">{day(editor.firstSignIn)}</td>
                    <td className="py-2 pr-4">{day(editor.lastActive)}</td>
                    <td className="py-2">
                      {isMe ? (
                        <span>You</span>
                      ) : (
                        <EditorActions
                          editor={{
                            id: editor.id,
                            label: editor.name ?? editor.email,
                            role: editor.role,
                            deactivated: editor.deactivatedAt !== null,
                          }}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function AdminEditorsPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Editors</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <EditorList />
      </Suspense>
    </>
  );
}
