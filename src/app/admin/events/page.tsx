import { Suspense } from "react";
import { requireEditor } from "@/auth/dal";

async function Placeholder() {
  await requireEditor();
  return <p>Create and edit Events. Coming in the Admin milestone.</p>;
}

export default function AdminEventsPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Events</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Placeholder />
      </Suspense>
    </>
  );
}
