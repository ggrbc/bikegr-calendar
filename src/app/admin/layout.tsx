import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { AdminNav, AdminUser } from "./admin-nav";

export const metadata: Metadata = { title: "Admin — Bike GR Calendar" };

/**
 * Static shell: a white header band (the GGRBC logo and "Calendar admin"), then the page gray with
 * white cards. The parts that read the session are inside Suspense boundaries.
 *
 * `<main>` is the focus target after a client-side navigation (see AdminNavLinks), and `min-w-0`
 * keeps a wide table inside the screen: a flex item has `min-width: auto` by default.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-page text-[15px] text-brand-gray">
      <header className="border-b border-brand-divider bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 pt-3 sm:px-8 sm:pt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Link href="/admin" className="flex items-center gap-3">
              <Image
                src="/brand/ggrbc-logo-primary.png"
                alt="Greater Grand Rapids Bicycle Coalition"
                width={184}
                height={40}
                priority
                className="hidden h-10 w-[184px] sm:block"
              />
              <Image
                src="/brand/ggrbc-logo-icon.png"
                alt="Greater Grand Rapids Bicycle Coalition"
                width={32}
                height={32}
                priority
                className="size-8 sm:hidden"
              />
              <span aria-hidden="true" className="hidden h-8 w-px bg-brand-divider sm:block" />
              <span className="font-chivo text-lg">Calendar admin</span>
            </Link>
            <Suspense fallback={<div className="h-10" />}>
              <AdminUser />
            </Suspense>
          </div>
          <Suspense fallback={<div className="h-11" />}>
            <AdminNav />
          </Suspense>
        </div>
      </header>
      <main id="admin-main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
