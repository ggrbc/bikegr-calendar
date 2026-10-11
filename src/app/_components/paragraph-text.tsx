import { descriptionParagraphs } from "@/agenda/description-text";

/**
 * Plain text as paragraphs, with web addresses (http and https only) as links. Rendered as React
 * elements, so the text is never read as HTML. Used for the Event description and the Occurrence
 * details on the detail page.
 */
export function ParagraphText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {descriptionParagraphs(text).map((lines, p) => (
        <p key={p}>
          {lines.map((parts, l) => (
            <span key={l}>
              {l > 0 && <br />}
              {parts.map((part, i) =>
                part.kind === "link" ? (
                  <a
                    key={i}
                    href={part.href}
                    className="break-all font-normal text-brand-orange-text underline underline-offset-4"
                    rel="nofollow noopener noreferrer"
                  >
                    {part.text}
                  </a>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
