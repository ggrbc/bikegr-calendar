import type { ReactNode } from "react";
import type { AdminEditorRow } from "@/admin/editors/editors";
import { ROLE_LABELS } from "@/admin/editors/rules";
import { Badge, Card } from "../../_components/ui";
import { EmailText } from "../email-text";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Detroit",
  year: "numeric",
  month: "short",
  day: "numeric",
});
const day = (date: Date | null) => (date ? dateFormat.format(date) : "—");
const dayBy = (date: Date | null, by: string | null) =>
  date ? `${day(date)}${by ? ` by ${by}` : ""}` : "—";

/** One label and value in the Details list. Other sections (for example "Manages") can add rows or cards. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-semibold">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** What the Admin knows about one Editor. Read only. */
export function DetailsCard({ editor }: { editor: AdminEditorRow }) {
  return (
    <Card title="Details" titleId="details-heading">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr] sm:gap-y-2">
        <DetailRow label="Email">
          <EmailText email={editor.email} />
        </DetailRow>
        <DetailRow label="Role">{ROLE_LABELS[editor.role]}</DetailRow>
        <DetailRow label="Status">
          {editor.deactivatedAt ? <Badge tone="deleted">Deactivated</Badge> : <Badge tone="approved">Active</Badge>}
        </DetailRow>
        <DetailRow label="Invited">
          {editor.invitedAt ? dayBy(editor.invitedAt, editor.invitedByName) : "Seeded"}
        </DetailRow>
        <DetailRow label="First sign-in">{day(editor.firstSignIn)}</DetailRow>
        <DetailRow label="Last active (about)">{day(editor.lastActive)}</DetailRow>
        {editor.deactivatedAt && (
          <DetailRow label="Deactivated">{dayBy(editor.deactivatedAt, editor.deactivatedByName)}</DetailRow>
        )}
      </dl>
    </Card>
  );
}
