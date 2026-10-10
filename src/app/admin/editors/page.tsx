import { Suspense } from "react";
import { listEditorsForAdmin } from "@/admin/editors/editors";
import { requireAdmin } from "@/auth/dal";
import { getDb } from "@/db";
import {
  Badge,
  Card,
  mutedClass,
  PageHeader,
  stackRowClass,
  stackTableClass,
  stackTbodyClass,
  stackTdClass,
  stackTheadClass,
  theadRowClass,
  thClass,
} from "../_components/ui";
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
      <Card title="Invite an Editor" titleId="invite-heading" className="mb-8">
        <InviteForm />
      </Card>

      <Card title="Editors" titleId="list-heading">
        {/* One markup: on a phone each row is a stacked block (ARIA roles keep the table semantics). */}
        <table role="table" className={`${stackTableClass} text-sm`}>
          <thead role="rowgroup" className={stackTheadClass}>
            <tr role="row" className={theadRowClass}>
              <th role="columnheader" className={thClass}>Name</th>
              <th role="columnheader" className={thClass}>Role</th>
              <th role="columnheader" className={thClass}>Account</th>
              <th role="columnheader" className={thClass}>Invited</th>
              <th role="columnheader" className={thClass}>First sign-in</th>
              <th role="columnheader" className={thClass}>Last active (about)</th>
              <th role="columnheader" className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody role="rowgroup" className={stackTbodyClass}>
            {list.map((editor) => {
              const isMe = editor.id === admin.id;
              return (
                <tr role="row" key={editor.id} className={stackRowClass}>
                  <td role="cell" className={`${stackTdClass} max-sm:before:content-none`}>
                    {editor.name && <div className="font-semibold">{editor.name}</div>}
                    <div className="break-all">{editor.email}</div>
                  </td>
                  <td role="cell" data-label="Role" className={stackTdClass}>
                    {editor.role === "admin" ? "Admin" : "Editor"}
                  </td>
                  <td role="cell" data-label="Account" className={stackTdClass}>
                    {editor.deactivatedAt ? (
                      <Badge tone="deleted">
                        Deactivated {day(editor.deactivatedAt)}
                        {editor.deactivatedByName ? ` by ${editor.deactivatedByName}` : ""}
                      </Badge>
                    ) : (
                      <Badge tone="approved">Active</Badge>
                    )}
                  </td>
                  <td role="cell" data-label="Invited" className={stackTdClass}>
                    {editor.invitedAt
                      ? `${day(editor.invitedAt)}${editor.invitedByName ? ` by ${editor.invitedByName}` : ""}`
                      : "Seeded"}
                  </td>
                  <td role="cell" data-label="First sign-in" className={stackTdClass}>
                    {day(editor.firstSignIn)}
                  </td>
                  <td role="cell" data-label="Last active (about)" className={stackTdClass}>
                    {day(editor.lastActive)}
                  </td>
                  <td role="cell" className={`${stackTdClass} max-sm:pt-1 max-sm:before:content-none`}>
                    {isMe ? (
                      <span className={mutedClass}>You</span>
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
      </Card>
    </>
  );
}

export default function AdminEditorsPage() {
  return (
    <>
      <PageHeader title="Editors" />
      <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
        <EditorList />
      </Suspense>
    </>
  );
}
