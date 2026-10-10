"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * The admin nav links. The link of the current section has `aria-current="page"` and an orange
 * underline; the Review queue shows its count as a badge (the accessible name stays "Review queue
 * (3)", from `aria-label`).
 *
 * After each client-side navigation to a new path, focus moves to the new page's h1 (or to
 * `<main id="admin-main">` until the h1 shows). A screen reader reads the page title, and the next
 * Tab goes into the page. Without this, the clicked header link keeps focus in the kept layout, and
 * the next key press (Shift, an arrow, Space) makes Chrome show the focus ring on it. A query change
 * (filters, `?calendar=`) keeps the path and does not move focus.
 */
/**
 * Focus the visible h1 in `main` (the router can keep an earlier page hidden in the DOM). True if
 * there is one. The h1 gets `tabindex="-1"` if it has none; globals.css gives it no ring.
 */
function focusHeading(main: HTMLElement): boolean {
  const h1 = Array.from(main.querySelectorAll<HTMLElement>("h1")).find((el) => el.getClientRects().length > 0);
  if (!h1) return false;
  if (!h1.hasAttribute("tabindex")) h1.tabIndex = -1;
  h1.focus({ preventScroll: true });
  return true;
}

export function AdminNavLinks({ isAdmin, waiting }: { isAdmin: boolean; waiting: number }) {
  const pathname = usePathname();
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    const main = document.getElementById("admin-main");
    if (!main) return;
    if (focusHeading(main)) return;
    // The h1 can stream in later (inside Suspense). Focus <main> now, then the h1 when it shows,
    // but only while the focus is still on <main> (the user did not move it).
    main.focus({ preventScroll: true });
    const observer = new MutationObserver(() => {
      if (document.activeElement !== main || focusHeading(main)) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
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
