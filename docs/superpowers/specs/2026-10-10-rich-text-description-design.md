# Rich-text Event description and Custom Preview: design

Date: 2026-10-10. Status: approved in chat, spec under review.

## Goal

Admins, Editors, and Submitters write the Event description in a WYSIWYG editor with
a toolbar, as they did in Tockify. The detail page shows the formatting. An optional **Custom Preview**
replaces the cut-off description on the agenda card and in page metadata.

Existing descriptions (imported from Tockify as plain text) look the same as today.

## Decisions

| # | Decision |
|---|----------|
| D1 | The description is stored as Markdown in the existing `description` text column. No migration of the description, no backfill. |
| D2 | Editor: Tiptap with the official Markdown extension. The value in and out is a Markdown string. |
| D3 | Toolbar, in this order: Undo, Redo, Heading 1, Heading 2, Bold, Italic, Bulleted list, Numbered list, Link, Horizontal line. Nothing else (no underline, strikethrough, alignment, code, images, video). |
| D4 | The editor is on the Event editor (`ContentFields`, used by Editors and Admins) and the public Submission form. Occurrence details stay plain text with today's rules. |
| D5 | Server rendering uses the same Markdown parser as the editor (`marked`, GitHub-flavored, single line breaks kept), turned into an allowlisted tree and rendered as React elements. Never `dangerouslySetInnerHTML`. |
| D6 | Plain-text outputs (agenda card excerpt, meta description, Open Graph, JSON-LD, ICS `DESCRIPTION`) use the Markdown stripped to text. |
| D7 | Custom Preview: a new nullable `preview` column on the Event, plain text, 300 characters at most (a database check). Set on the Event editor and the Submission form. |
| D8 | When set, the Custom Preview replaces the excerpt on the agenda card (and the Embed), the meta description, Open Graph, and JSON-LD. The detail page body and the Feed always use the full description. |
| D9 | The Tockify importer keeps dropping `X-TKF-CUSTOM-PREVIEW`: all 26 previews in the 2026-10-09 export are cut-off copies of the description. |

## Existing content

Checked against the 26 distinct descriptions in `src/import/__fixtures__/tockify-bikegr-2026-10-09.ics`:
none has headings, emphasis markers, numbered lines, quotes, or HTML. One has a `* ` line, which becomes
a real bulleted list. With single line breaks kept and bare URLs auto-linked (D5), the other 25 render
with the same paragraphs, lines, and links as `descriptionParagraphs` today.

## The editor

`src/app/_components/markdown-editor.tsx`, a client component shared by both forms.

- Tiptap extensions: the StarterKit parts for paragraph, text, hard break, heading (levels 1 and 2
  only), bold, italic, bullet list, ordered list, list item, horizontal rule, and history; Link; the
  Markdown extension. Underline, strike, code, code block, blockquote, and image are not loaded, so
  pasted rich text cannot bring them in.
- Toolbar buttons are `<button type="button">` with an `aria-label` and `aria-pressed` for marks and
  blocks. Keyboard shortcuts (Cmd/Ctrl+B, I, Z, Shift+Z) work.
- Link: the button opens a small inline input for the address. Only `http:`, `https:`, and `mailto:`
  are accepted; the same input removes a link. Typed or pasted bare URLs become links (autolink).
- The editor runs only in the browser. Before it mounts, a placeholder box of the same height is shown,
  so the layout does not move.
- Props: `value` (Markdown), `onChange(markdown)`, `id`, `aria-describedby`, and an optional `name`.
  With `name`, it also renders a hidden `<input name={name}>` with the current Markdown.

### Event editor

`ContentFields` (`src/app/admin/events/_components/fields.tsx`) uses the editor as a controlled field
in place of the description textarea. No length limit, as today.

### Submission form

`src/app/submit/submission-form.tsx` posts FormData, so the editor gets `name={FIELDS.description}` and
writes Markdown to the hidden input. The editor is cleared with the rest of the form after a successful
send and keeps its content after a refused send. The 5,000-character limit
(`LIMITS.description`) counts the stored Markdown and is checked on the server, as today; the editor
has no `maxLength`. The hint becomes "Use the toolbar for headings, bold, lists, and links."

## Custom Preview

- **Column:** `events.preview text` (nullable), with a check `char_length(preview) <= 300`, in a new
  Drizzle migration.
- **Content field:** it is one of the "All dates" fields, with title and description. It goes through
  the same paths: create, edit, Series split (copied), the snapshot (`src/agenda/snapshot.ts`) and the
  review queue comparison, and Submission approval (Submission to Event).
- **Submissions:** the submission record gets the same nullable column and limit, and
  `FIELDS.preview` in the form data.
- **Validation (shared):** trim; empty or whitespace-only is `null`; more than 300 characters is the
  usual "too long" error. Used by `event-input.ts` and `submission-input.ts`.
- **Form UI (both forms):** under the description editor, a "+ Custom Preview" link opens a plain
  textarea with a live count "N / 300" and the hint "Shown on the calendar list instead of the start of
  the description." When a preview is already saved, the field is open.
- **One choice point:** `listingText(row, length)` in `src/agenda/` returns the preview when set, else
  `excerpt(descriptionText(row.description), length)`. The agenda card, the detail page metadata, and
  JSON-LD call it.

## Rendering

`src/agenda/description-markdown.ts` (pure) replaces the description use of
`src/agenda/description-text.ts`. `lineParts`, `descriptionParagraphs`, and `ParagraphText` stay for
Occurrence details.

- **`descriptionBlocks(md)`** parses with `marked` (`gfm: true`, `breaks: true`) and maps tokens to:

  ```ts
  type Inline =
    | { kind: "text"; text: string }
    | { kind: "strong" | "em"; children: Inline[] }
    | { kind: "link"; href: string; children: Inline[] }
    | { kind: "break" };
  type Block =
    | { kind: "paragraph"; children: Inline[] }
    | { kind: "heading"; level: 1 | 2; children: Inline[] }
    | { kind: "list"; ordered: boolean; start?: number; items: Block[][] }
    | { kind: "rule" };
  ```

  Any other token (raw HTML, image, code, code span, blockquote, table, deeper heading,
  strikethrough) becomes text with its source characters, never interpreted. A link with a scheme
  other than `http`, `https`, or `mailto` becomes its text. Bare URLs follow today's trailing
  punctuation and closing parenthesis rules.
- **`descriptionText(md)`** is the same tree as plain text: blocks separated by a blank line; list
  items as `• item` or `1. item`; a link as `text (url)`, or `url` when the text is the URL; a rule as
  a blank line; no emphasis markers.
- **`RichText`** (`src/app/_components/rich-text.tsx`) renders the blocks as React elements on the
  detail page. Heading 1 is an `<h2>` and Heading 2 an `<h3>`, styled as sub-headings below the Event
  title. Lists get visible bullets and numbers. Links keep today's class and
  `rel="nofollow noopener noreferrer"`.

### Plain-text outputs

| Output | Text |
|--------|------|
| Agenda card, Embed | `listingText(row, 300)` |
| Meta description, Open Graph | `listingText(row, 160)`, else today's "Title on Date" fallback |
| JSON-LD `description` | `listingText(row, DESCRIPTION_LENGTH)` |
| ICS `DESCRIPTION` | `descriptionText(row.description)` in today's position |
| Detail page body | `RichText` of the full description |

## Testing

**Vitest**

- `description-markdown`: each allowed block and mark; `<script>`, `<img onerror>`, images, code, and
  quotes come out as literal text; `javascript:` and `data:` links become text; bare URLs and the
  trailing punctuation cases from `description-text.test.ts`; single line breaks kept; all 26 fixture
  descriptions match today's paragraphs, lines, and links (the `* ` list case asserted on its own);
  `descriptionText` for headings, lists, links, and rules.
- Preview validation in `event-input` and `submission-input`: trim, empty to `null`, 300 limit.
- `listingText`; the card and metadata use it; ICS and JSON-LD outputs; snapshot, Series split, and
  Submission approval carry the preview.
- Migration: the 300-character check (PGlite).

**Playwright**

- Event editor: type text, apply Bold, a bulleted list, Heading 1, and a link with the toolbar; save.
  The detail page has `<strong>`, `<ul>`, `<h2>`, and the link; the agenda card has plain text.
- Custom Preview: the card shows it instead of the description start; the detail page shows the full
  description.
- Submission form: formatted description and a preview; after approval the Event has both.
- Keyboard: Tab reaches the toolbar buttons, Enter applies them, `aria-pressed` changes.

## Docs

- `docs/design.md`: the Event description is Markdown with the allowed set above, edited in a WYSIWYG
  editor; the Custom Preview field and where it shows.
- `CONTEXT.md`: add **Custom Preview**.
- `docs/adr/0003-markdown-description.md`: Markdown and not HTML; the editor and server share one
  parser.

## Out of scope

- Rich text in Occurrence details.
- Underline, strikethrough, alignment, code, inline images, and video.
- Restoring formatting that Tockify had (its export has plain text only).
