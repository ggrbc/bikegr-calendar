import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin — Bike GR Calendar" };

/** Static shell. The parts that read the session are inside Suspense boundaries in the pages. */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-gray-300 px-8 py-4">
        <p className="text-lg font-semibold">Bike GR Calendar — Admin</p>
      </header>
      <main className="mx-auto w-full max-w-3xl p-8">{children}</main>
    </div>
  );
}
