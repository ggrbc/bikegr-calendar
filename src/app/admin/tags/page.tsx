import { Suspense } from "react";
import { requireEditor } from "@/auth/dal";

async function Placeholder() {
  await requireEditor();
  return <p>The Tag list of each Calendar. Coming in the Admin milestone.</p>;
}

export default function AdminTagsPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Tags</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Placeholder />
      </Suspense>
    </>
  );
}
