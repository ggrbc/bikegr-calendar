"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * The admin nav links. The link of the current section has `aria-current="page"` and an orange
 * underline; the Review queue shows its count as a badge (the accessible name stays "Review queue
 * (3)", from `aria-label`).
 *
 * After each client-side navigation to a new path, focus moves to `<main id="admin-main">`, as after
 * a full page load. Without this, the clicked header link keeps focus in the kept layout, and the
 * next key press (Shift, an arrow, Space) makes Chrome show the focus ring on it. A query change
 * (filters, `?calendar=`) keeps the path and does not move focus.
 */
export function AdminNavLinks({ isAdmin, waiting }: { isAdmin: boolean; waiting: number }) {
  const pathname = usePathname();
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    document.getElementById("admin-main")?.focus({ preventScroll: true });
  }, [pathname]);

  const links = [
    { href: "/admin/events", label: "Events" },
    { href: "/admin/review", label: "Review queue", count: waiting },
    { href: "/admin/tags", label: "Tags" },
    ...(isAdmin ? [{ href: "/admin/editors", label: "Editors" }] : []),
  ];

  return (
    <nav aria-label="Admin" className="-mb-px flex flex-wrap gap-x-6 gap-y-1">
      {links.map((link) => {
        const current = pathname === link.href || pathname.startsWith(`${link.href}/`);
        const badge = link.count !== undefined && link.count > 0;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            // A fixed name with the count: "Review queue (3)".
            aria-label={badge ? `${link.label} (${link.count})` : undefined}
            className={`flex min-h-11 items-center gap-2 border-b-[3px] pb-1 ${
              current
                ? "border-brand-orange-text font-semibold text-brand-gray"
                : "border-transparent text-[#5f5e5f] hover:border-brand-divider hover:text-brand-gray"
            }`}
          >
            {link.label}
            {badge && (
              <span className="rounded-[300px] bg-brand-orange-text px-2 py-0.5 text-xs font-semibold text-white">
                {link.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
