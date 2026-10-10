import { Suspense } from "react";
import { requireAdmin } from "@/auth/dal";

async function Placeholder() {
  await requireAdmin();
  return <p>Invite, change roles, and deactivate Editors. Coming in the Admin milestone.</p>;
}

export default function AdminEditorsPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Editors</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Placeholder />
      </Suspense>
    </>
  );
}
