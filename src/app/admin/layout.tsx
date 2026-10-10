import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = { title: "Admin — Bike GR Calendar" };

/** Static shell. The parts that read the session are inside Suspense boundaries. */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-gray-300 px-4 py-4 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          <Link href="/admin" className="text-lg font-semibold">
            Bike GR Calendar — Admin
          </Link>
          <Suspense fallback={<div className="h-8" />}>
            <AdminNav />
          </Suspense>
        </div>
      </header>
      <main className="px-4 py-4 sm:px-8 sm:py-8">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
