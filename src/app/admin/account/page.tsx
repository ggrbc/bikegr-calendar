import { Suspense } from "react";
import { ROLE_LABELS } from "@/admin/editors/rules";
import { requireEditor } from "@/auth/dal";
import { Card, mutedClass, PageHeader } from "../_components/ui";
import { AccountForm } from "./account-form";

async function Account() {
  const me = await requireEditor();
  return (
    <div className="flex flex-col gap-6">
      <Card title="Details" titleId="account-heading">
        <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="font-semibold">Email</dt>
          <dd className="min-w-0">{me.email}</dd>
          <dt className="font-semibold">Role</dt>
          <dd>{ROLE_LABELS[me.role]}</dd>
        </dl>
      </Card>
      <Card title="Your name" titleId="name-heading">
        <AccountForm name={me.name ?? ""} />
      </Card>
    </div>
  );
}

/** Every signed-in person (any role) can open this page and change their own name. */
export default function AdminAccountPage() {
  return (
    <>
      <PageHeader title="Your account" />
      <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
        <Account />
      </Suspense>
    </>
  );
}
