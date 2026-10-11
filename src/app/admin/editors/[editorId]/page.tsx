import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getEditorForAdmin } from "@/admin/editors/editors";
import { roleChoices } from "@/admin/editors/rules";
import { listGrantsOfEditor } from "@/admin/events/managers";
import { requireAdmin } from "@/auth/dal";
import { getDb } from "@/db";
import { Card, linkClass, mutedClass, PageHeader } from "../../_components/ui";
import { ActivationForm } from "./activation-form";
import { DetailsCard } from "./details-card";
import { EditForm, RoleNote } from "./edit-form";
import { ManagesList } from "./manages-list";

async function EditorDetail({ params }: { params: Promise<{ editorId: string }> }) {
  const admin = await requireAdmin();
  const { editorId } = await params;
  const editor = await getEditorForAdmin(getDb(), editorId);
  if (!editor) notFound();

  const label = editor.name ?? editor.email;
  const isMe = editor.id === admin.id;
  const deactivated = editor.deactivatedAt !== null;

  return (
    <>
      <PageHeader title={label} back={<BackLink />} />
      <div className="flex flex-col gap-6">
        <DetailsCard editor={editor} />

        <Card title={isMe ? "Your name" : "Name and role"} titleId="edit-heading">
          {/* An Admin cannot change their own role, and a deactivated Editor's role stays until reactivation. */}
          <EditForm
            editorId={editor.id}
            name={editor.name ?? ""}
            role={isMe || deactivated ? undefined : editor.role}
            roleLabels={roleChoices(editor.role)}
          />
          {deactivated && !isMe && <RoleNote>Reactivate this Editor to change the role.</RoleNote>}
        </Card>

        {editor.role === "event_manager" && <ManagesList grants={await listGrantsOfEditor(getDb(), editor.id)} />}

        {/* No Deactivate on the Admin's own page. */}
        {!isMe && (
          <Card title={deactivated ? "Reactivate" : "Deactivate"} titleId="activation-heading">
            <p className={`${mutedClass} mb-3`}>
              {deactivated
                ? "This Editor cannot sign in. Reactivate them so they can sign in again at /login."
                : "They are signed out at once and cannot sign in until an Admin reactivates them."}
            </p>
            <ActivationForm editorId={editor.id} label={label} deactivated={deactivated} />
          </Card>
        )}
      </div>
    </>
  );
}

function BackLink() {
  return (
    <Link href="/admin/editors" className={linkClass}>
      ← Editors
    </Link>
  );
}

export default function AdminEditorPage({ params }: PageProps<"/admin/editors/[editorId]">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Editor" back={<BackLink />} />
          <p className={mutedClass}>Loading…</p>
        </>
      }
    >
      <EditorDetail params={params} />
    </Suspense>
  );
}
