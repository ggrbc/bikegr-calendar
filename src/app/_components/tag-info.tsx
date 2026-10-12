import type { CSSProperties } from "react";

/**
 * An "i" button after a Tag name that opens the Tag's description. A native popover: no
 * JavaScript, opens on click or tap, and closes on Escape or a click outside. Placement is in
 * globals.css (`.tag-info`).
 */
export function TagInfo({ name, slug, description }: { name: string; slug: string; description: string }) {
  const id = `tag-info-${slug}`;
  return (
    <span className="inline-block align-middle" style={{ "--tip-anchor": `--${id}` } as CSSProperties}>
      <button
        type="button"
        popoverTarget={id}
        aria-label={`What is ${name}?`}
        className="tag-info-button ml-0.5 inline-flex size-6 cursor-pointer items-center justify-center rounded-full"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
          <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="4.75" r="1" fill="currentColor" />
          <path d="M8 7v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <span
        id={id}
        popover="auto"
        className="tag-info max-w-[min(20rem,calc(100vw-2rem))] rounded-[6px] border border-brand-divider bg-white px-4 py-3 font-sans text-[15px] font-light leading-[1.6] text-brand-gray shadow-lg"
      >
        <span className="font-chivo font-normal">{name}:</span> {description}
      </span>
    </span>
  );
}
