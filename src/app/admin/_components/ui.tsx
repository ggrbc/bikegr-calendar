/**
 * Shared admin UI: class helpers and small components for the admin look (docs/design.md "Brand and
 * colors", admin look). No "use client" and no server-only imports, so server pages and client forms
 * use the same parts.
 *
 * WCAG AA (measured, WCAG formula): body text #424142 on white 10.16:1, on the page gray 9.08:1;
 * muted text #5F5E5F 6.46:1 / 5.77:1; white on brand-orange-text 5.10:1; white on brand-green-text
 * 5.05:1; red-700 on white 6.47:1. Badges: see BADGE_TONES. Input and secondary button borders
 * #8A898A on white 3.48:1 (non-text contrast needs 3:1).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { ReviewStatus } from "@/admin/events/queries";
import { statusLabel } from "@/admin/events/format";
import type { ScheduleStatus } from "@/engine";

export type ButtonVariant = "primary" | "approve" | "secondary" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[300px] font-chivo font-normal tracking-[0.01em] " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-orange-text text-white hover:bg-brand-gray disabled:hover:bg-brand-orange-text",
  approve: "bg-brand-green-text text-white hover:bg-brand-gray disabled:hover:bg-brand-green-text",
  secondary: "border border-[#8a898a] bg-white text-brand-gray hover:border-brand-gray",
  danger: "border border-red-700 bg-white text-red-700 hover:bg-red-50",
};

const BUTTON_SIZES = {
  md: "min-h-11 px-5 py-2 text-[14px] sm:min-h-10",
  sm: "min-h-9 px-4 py-1.5 text-[13px]",
};

/** A pill button (or a link that looks like one). */
export function buttonClass(variant: ButtonVariant = "secondary", size: keyof typeof BUTTON_SIZES = "md"): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`;
}

/** A text link in the admin: the AA orange, underlined. */
export const linkClass =
  "text-brand-orange-text underline decoration-1 underline-offset-2 hover:text-brand-gray";

export const inputClass =
  "w-full rounded-md border border-[#8a898a] bg-white px-3 py-2 text-brand-gray placeholder:text-[#6b6a6b] " +
  "disabled:bg-brand-page";

/** A short inline input (rename a Tag, the role select, an end date). */
export const smallInputClass =
  "rounded-md border border-[#8a898a] bg-white px-2.5 py-1.5 text-brand-gray disabled:bg-brand-page";

export const labelClass = "font-semibold text-brand-gray";
export const hintClass = "text-sm text-[#5f5e5f]";
export const mutedClass = "text-[#5f5e5f]";
export const h2Class = "font-chivo text-xl font-normal text-brand-gray";
export const h3Class = "font-chivo text-lg font-normal text-brand-gray";

/** A white box with an optional heading. */
export function Card({
  title,
  titleId,
  level = 2,
  actions,
  className = "",
  children,
}: {
  title?: ReactNode;
  titleId?: string;
  level?: 2 | 3;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className={`rounded-lg border border-brand-divider bg-white p-4 sm:p-6 ${className}`}
    >
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && (
            <Heading id={titleId} className={level === 2 ? h2Class : h3Class}>
              {title}
            </Heading>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** The top of an admin page: an optional back link, the h1, optional actions and a meta line. */
export function PageHeader({
  title,
  back,
  actions,
  children,
}: {
  title: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      {back && <p className="text-sm">{back}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-chivo text-[28px] font-normal leading-tight text-brand-gray">{title}</h1>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export type BadgeTone = "pending" | "approved" | "rejected" | "deleted" | "schedule" | "neutral";

/** Each pair is at least 4.5:1 (measured). */
const BADGE_TONES: Record<BadgeTone, string> = {
  pending: "bg-[#fef3c7] text-[#78350f]", // 8.15:1
  approved: "bg-[#e9eed3] text-[#4d5822]", // 6.45:1
  rejected: "bg-[#fee2e2] text-[#991b1b]", // 6.80:1
  deleted: "bg-brand-divider text-brand-gray", // 8.07:1
  schedule: "bg-amber-100 text-amber-900", // the public Schedule status badge
  neutral: "bg-brand-page text-brand-gray", // 9.08:1
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[300px] px-2.5 py-0.5 align-middle text-xs font-semibold ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return <Badge tone={status}>{REVIEW_LABELS[status]}</Badge>;
}

/** The Schedule status badge; `scheduled` has none. */
export function ScheduleBadge({ status }: { status: ScheduleStatus }) {
  const label = statusLabel(status);
  return label ? <Badge tone="schedule">{label}</Badge> : null;
}

export type NoticeTone = "success" | "error" | "info" | "warning";

const NOTICE_TONES: Record<NoticeTone, string> = {
  success: "border-brand-green-text bg-[#f4f6ea] text-[#3f481c]",
  error: "border-red-700 bg-red-50 text-red-900",
  info: "border-[#c9c8c9] bg-brand-page text-brand-gray",
  warning: "border-amber-600 bg-amber-50 text-amber-950",
};

/** The class of a notice box, for elements that need their own tag or role. */
export function noticeClass(tone: NoticeTone): string {
  return `rounded-md border-l-4 border-y border-r px-4 py-3 ${NOTICE_TONES[tone]}`;
}

/** A notice box. `role` is "status" for results and "alert" for errors; omit it for static text. */
export function Notice({
  tone,
  role,
  children,
}: {
  tone: NoticeTone;
  role?: "status" | "alert";
  children: ReactNode;
}) {
  return (
    <div role={role} className={noticeClass(tone)}>
      {children}
    </div>
  );
}

/** "Nothing here" text in a list or a card. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-[#c9c8c9] px-4 py-6 text-center text-[#5f5e5f]">{children}</p>;
}

// Tables: one look. `stackClass` variants make each row a block on a phone (one markup); the table
// keeps explicit ARIA roles there, because Safari drops table semantics when the display changes.
export const tableClass = "w-full border-collapse text-left";
export const theadRowClass = "border-b-2 border-brand-divider";
export const thClass = "px-3 py-2 text-sm font-semibold text-brand-gray first:pl-0 last:pr-0";
export const rowClass = "border-b border-brand-divider align-top last:border-b-0";
export const tdClass = "px-3 py-3 first:pl-0 last:pr-0";

/** A table that becomes stacked blocks below `sm`. Put `data-label` on each cell. */
export const stackTableClass = `${tableClass} max-sm:block`;
export const stackTheadClass = "max-sm:sr-only";
export const stackTbodyClass = "max-sm:block";
export const stackRowClass = `${rowClass} max-sm:flex max-sm:flex-col max-sm:gap-1 max-sm:py-3`;
export const stackTdClass =
  `${tdClass} max-sm:block max-sm:p-0 max-sm:before:mr-2 max-sm:before:text-sm max-sm:before:font-semibold ` +
  "max-sm:before:text-[#5f5e5f] max-sm:before:content-[attr(data-label)]";

/** Calendar tabs (All, Rides & Events, Advocacy) as links; the current one has `aria-current`. */
export function CalendarTabs({ tabs }: { tabs: { href: string; label: string; current: boolean }[] }) {
  return (
    <nav aria-label="Calendars" className="mb-4 flex flex-wrap gap-x-6 gap-y-1 border-b border-brand-divider">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.current ? "page" : undefined}
          className={`-mb-px border-b-[3px] pb-2 pt-1 ${
            tab.current
              ? "border-brand-orange-text font-semibold text-brand-gray"
              : "border-transparent text-[#5f5e5f] hover:text-brand-gray"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
