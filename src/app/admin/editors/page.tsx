import Link from "next/link";
import { Suspense } from "react";
import { listEditorsForAdmin } from "@/admin/editors/editors";
import { ROLE_LABELS } from "@/admin/editors/rules";
import { requireAdmin } from "@/auth/dal";
import { getDb } from "@/db";
import {
  Badge,
  buttonClass,
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
import { InviteForm } from "./invite-form";

/** `name<wbr>@example.org`: the only break point of an address. */
function splitAtSign(email: string) {
  const at = email.indexOf("@");
  if (at < 1) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

async function EditorList() {
  await requireAdmin();
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
              <th role="columnheader" className={thClass}>Editor</th>
              <th role="columnheader" className={thClass}>Role</th>
              <th role="columnheader" className={thClass}>Status</th>
              <th role="columnheader" className={thClass}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" className={stackTbodyClass}>
            {list.map((editor) => {
              const label = editor.name ?? editor.email;
              return (
                <tr role="row" key={editor.id} className={stackRowClass}>
                  <td role="cell" className={`${stackTdClass} max-lg:before:content-none`}>
                    {editor.name && <div className="font-semibold">{editor.name}</div>}
                    {/* The email breaks only before the "@", never inside a word. */}
                    <div>{splitAtSign(editor.email)}</div>
                  </td>
                  <td role="cell" data-label="Role" className={stackTdClass}>
                    {ROLE_LABELS[editor.role]}
                  </td>
                  <td role="cell" data-label="Status" className={stackTdClass}>
                    {editor.deactivatedAt ? (
                      <Badge tone="deleted">Deactivated</Badge>
                    ) : (
                      <Badge tone="approved">Active</Badge>
                    )}
                  </td>
                  <td role="cell" className={`${stackTdClass} max-lg:pt-1 max-lg:before:content-none lg:text-right`}>
                    <Link href={`/admin/editors/${editor.id}`} className={buttonClass("secondary", "sm")}>
                      Edit<span className="sr-only"> {label}</span>
                    </Link>
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
