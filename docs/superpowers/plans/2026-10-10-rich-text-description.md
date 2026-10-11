# Rich-text Event description and Custom Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editors and Submitters format the Event description in a Tockify-style toolbar editor, the
detail page shows the formatting, and an optional Custom Preview replaces the cut-off description on
the agenda card and in page metadata.

**Architecture:** The description stays a text column, now read as Markdown. A pure module parses it
with `marked` (the parser `@tiptap/markdown` uses) into a tree of only the allowed kinds, which a
server component renders as React elements and a text function flattens for excerpts, JSON-LD, and
the Feed. A Tiptap editor (client) loads and saves Markdown. `preview` is a new nullable column that
flows through the existing content paths (`parseContent`, `contentColumns`, the snapshot).

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript, Drizzle + Postgres (PGlite in
tests), Vitest (node), Playwright, Tailwind 4, Tiptap 3.31 (`@tiptap/react`, `@tiptap/pm`,
`@tiptap/starter-kit`, `@tiptap/markdown`), `marked` 17.

**Spec:** `docs/superpowers/specs/2026-10-10-rich-text-description-design.md`

## Global Constraints

- Never `dangerouslySetInnerHTML` for a description or preview. Rendering is React elements only.
- Allowed description formatting: paragraph, Heading 1, Heading 2, bulleted list, numbered list,
  horizontal line, bold, italic, link, line break. Everything else renders as literal text.
- Link schemes: `http:`, `https:`, `mailto:` only. Links render with
  `rel="nofollow noopener noreferrer"`.
- Bare web addresses link by today's `lineParts` rules (http and https only, trailing punctuation
  dropped). No `www.` or email autolinks.
- `marked` options everywhere (server and editor): `gfm: true`, `breaks: true`. The server's
  `marked` major version must equal the one `@tiptap/markdown` depends on (17 at plan time).
- Custom Preview: plain text, 300 characters at most (`char_length`), empty or whitespace-only is
  `null`. Error text: "Use 300 characters or fewer."
- Submission description limit stays 5,000 characters, counted on the stored Markdown.
- Toolbar order: Undo, Redo | Heading 1, Heading 2 | Bold, Italic | Bulleted list, Numbered list |
  Link | Horizontal line.
- Submission form hint: "Use the toolbar for headings, bold, lists, and links."
- Custom Preview hint: "Shown on the calendar list instead of the start of the description."
- Occurrence details keep `ParagraphText` and plain-text rules; no change.
- Submissions are rows of the `events` table, so the one `events.preview` column serves both forms.
- Run `pnpm` (not npm). Commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e`.
- Read `node_modules/next/dist/docs/` before using any Next.js API not already used in the touched
  file (AGENTS.md).

## Review Focus

1. Saving an Event whose description the Editor did not touch must store the description byte for
   byte, and the Review page's "unsaved change blocks Approve" check must not fire on page load (the
   editor must not emit a change on mount). Test: Task 7, "untouched description".
2. An old plain-text description with single line breaks keeps its line breaks after it is edited
   in the editor and saved. Test: Task 7, "line breaks survive an edit".
3. Characters typed literally in the editor (`5*3 and 2*4`, `#1`) display literally on the detail
   page, not as italic or a heading. Test: Task 7, "literal characters".
4. Pasting rich HTML (a span with color, an image, a table, a `<script>`) keeps only allowed
   formatting, and the detail page has no `img`, `table`, or `script`. Test: Task 7, "paste".
5. A `javascript:` address in the Link box is refused with a message, and never becomes a link.
   Test: Task 5 (`isLinkUrl` unit test) and Task 7, "link box refuses javascript:".

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/agenda/safe-url.ts` (modify) | add `isLinkUrl` (http, https, mailto) |
| `src/agenda/description-markdown.ts` (create) | `descriptionBlocks`, `descriptionText`, types `Block`, `Inline` |
| `src/agenda/description-markdown.test.ts` (create) | parser and text tests, Tockify fixture regression |
| `src/app/_components/rich-text.tsx` (create) | `RichText` server component |
| `src/app/_components/rich-text.test.ts` (create) | static-markup tests of `RichText` |
| `src/app/events/[eventId]/[start]/page.tsx` (modify) | body uses `RichText`; metadata uses `listingText` |
| `src/db/schema.ts` (modify), `drizzle/0004_custom-preview.sql` (generated) | `events.preview` + check |
| `src/db/preview-schema.test.ts` (create) | the 300 check |
| `src/admin/events/event-input.ts` (modify) | `preview` in values/drafts, `PREVIEW_MAX`, parse |
| `src/admin/events/create-event.ts` (modify) | `contentColumns` writes `preview` |
| `src/admin/events/form-values.ts` (modify) | `preview` in form rows/values |
| `src/submissions/submission-input.ts`, `form-data.ts` (modify) | `preview` field |
| `src/agenda/snapshot.ts`, `occurrence-rows.ts`, `test-fixtures.ts` (modify) | `preview` on snapshot and rows |
| `src/agenda/listing-text.ts` (create) + test | `listingText(row, length)` |
| `src/app/_components/occurrence-card.tsx`, `src/agenda/json-ld.ts`, `src/feeds/vevent.ts` (modify) | plain-text outputs |
| `src/app/_components/markdown-editor.tsx` (create) | Tiptap editor + toolbar + link box |
| `src/app/admin/events/_components/fields.tsx` (modify) | editor + `PreviewField` in `ContentFields` |
| `src/app/submit/submission-form.tsx` (modify) | editor + preview field |
| `e2e/turnstile.ts` (create), `e2e/submissions.spec.ts` (modify) | shared Turnstile stub |
| `e2e/rich-text.spec.ts` (create) | end-to-end tests |
| `docs/design.md`, `CONTEXT.md`, `docs/adr/0003-markdown-description.md` | docs |

---

### Task 1: Markdown description parser

**Files:**
- Modify: `src/agenda/safe-url.ts`
- Create: `src/agenda/description-markdown.ts`
- Test: `src/agenda/description-markdown.test.ts`, `src/agenda/safe-url.test.ts` (create if missing)
- Modify: `package.json` (add `marked`)

**Interfaces:**
- Consumes: `lineParts(line: string): TextPart[]` from `src/agenda/description-text.ts`.
- Produces:
  ```ts
  export function isLinkUrl(value: string): boolean; // safe-url.ts
  export type Inline =
    | { kind: "text"; text: string }
    | { kind: "strong" | "em"; children: Inline[] }
    | { kind: "link"; href: string; children: Inline[] }
    | { kind: "break" };
  export type Block =
    | { kind: "paragraph"; children: Inline[] }
    | { kind: "heading"; level: 1 | 2; children: Inline[] }
    | { kind: "list"; ordered: boolean; start?: number; items: Block[][] }
    | { kind: "rule" };
  export function descriptionBlocks(markdown: string): Block[];
  export function descriptionText(markdown: string): string;
  ```

- [ ] **Step 1: Add `marked` at the major `@tiptap/markdown` uses**

Run: `npm view @tiptap/markdown@3.31.4 dependencies` → expect `{ marked: '^17.x' }`. Then
`pnpm add marked@^17` (use the major shown). Commit nothing yet.

- [ ] **Step 2: Write the failing tests**

`src/agenda/safe-url.test.ts` (add to the file if it exists):

```ts
import { describe, expect, it } from "vitest";
import { isLinkUrl } from "./safe-url";

describe("isLinkUrl", () => {
  it("allows http, https, and mailto only", () => {
    expect(isLinkUrl("https://example.org/a")).toBe(true);
    expect(isLinkUrl("http://example.org")).toBe(true);
    expect(isLinkUrl("mailto:ride@example.org")).toBe(true);
    expect(isLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isLinkUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isLinkUrl("data:text/html,x")).toBe(false);
    expect(isLinkUrl("/relative")).toBe(false);
    expect(isLinkUrl("")).toBe(false);
  });
});
```

`src/agenda/description-markdown.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIcsEvents } from "@/import/ics";
import { toTockifyOccurrence } from "@/import/tockify-occurrence";
import { type Block, descriptionBlocks, descriptionText, type Inline } from "./description-markdown";
import { descriptionParagraphs, type TextPart } from "./description-text";

const text = (t: string): Inline => ({ kind: "text", text: t });

describe("descriptionBlocks", () => {
  it("parses the allowed blocks and marks", () => {
    const md = "# Route\n\n## Stops\n\n**Lights** and *helmet*.\n\n- One\n- Two\n\n3. Three\n4. Four\n\n---\n\n[Map](https://example.org/map)";
    expect(descriptionBlocks(md)).toEqual<Block[]>([
      { kind: "heading", level: 1, children: [text("Route")] },
      { kind: "heading", level: 2, children: [text("Stops")] },
      {
        kind: "paragraph",
        children: [{ kind: "strong", children: [text("Lights")] }, text(" and "), { kind: "em", children: [text("helmet")] }, text(".")],
      },
      { kind: "list", ordered: false, items: [[{ kind: "paragraph", children: [text("One")] }], [{ kind: "paragraph", children: [text("Two")] }]] },
      { kind: "list", ordered: true, start: 3, items: [[{ kind: "paragraph", children: [text("Three")] }], [{ kind: "paragraph", children: [text("Four")] }]] },
      { kind: "rule" },
      { kind: "paragraph", children: [{ kind: "link", href: "https://example.org/map", children: [text("Map")] }] },
    ]);
  });

  it("keeps single line breaks as breaks", () => {
    expect(descriptionBlocks("One\nTwo")).toEqual([{ kind: "paragraph", children: [text("One"), { kind: "break" }, text("Two")] }]);
  });

  it("links bare web addresses by today's rules", () => {
    expect(descriptionBlocks("See https://example.org/a_b_c. Or www.example.org")).toEqual([
      {
        kind: "paragraph",
        children: [
          text("See "),
          { kind: "link", href: "https://example.org/a_b_c", children: [text("https://example.org/a_b_c")] },
          text(". Or www.example.org"),
        ],
      },
    ]);
  });

  it("keeps HTML, images, code, quotes, tables, deep headings, and strikethrough as literal text", () => {
    const all = (md: string) => descriptionText(md);
    expect(all("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
    expect(all('Hi <img src=x onerror="alert(1)"> there')).toBe('Hi <img src=x onerror="alert(1)"> there');
    expect(all("![pic](https://example.org/a.png)")).toBe("![pic](https://example.org/a.png)");
    expect(all("Use `code` here")).toBe("Use `code` here");
    expect(all("> quoted")).toBe("> quoted");
    expect(all("### Small")).toBe("### Small");
    expect(all("~~gone~~")).toBe("~~gone~~");
    expect(all("A & B < C")).toBe("A & B < C");
    expect(JSON.stringify(descriptionBlocks("<b>x</b> ![a](b) `c`"))).not.toMatch(/"kind":"(?!text|paragraph|break)/);
  });

  it("makes links with other schemes into their text", () => {
    const md = "[click](javascript:alert(1)) [d](data:text/html,x)";
    expect(descriptionText(md)).toBe("click d");
    expect(JSON.stringify(descriptionBlocks(md))).not.toContain('"kind":"link"');
  });

  it("does not link inside a link", () => {
    expect(descriptionBlocks("[see https://a.org](https://b.org)")).toEqual([
      { kind: "paragraph", children: [{ kind: "link", href: "https://b.org", children: [text("see https://a.org")] }] },
    ]);
  });
});

describe("descriptionText", () => {
  it("is plain text for excerpts and the Feed", () => {
    const md = "# Route\n\n**Bold** [Map](https://example.org/map) https://x.org\n\n- One\n- Two\n\n1. A\n2. B\n\n---\n\nEnd\nline";
    expect(descriptionText(md)).toBe(
      "Route\n\nBold Map (https://example.org/map) https://x.org\n\n• One\n• Two\n\n1. A\n2. B\n\nEnd\nline",
    );
    expect(descriptionText("[ride@example.org](mailto:ride@example.org)")).toBe("ride@example.org");
    expect(descriptionText("")).toBe("");
  });
});

describe("existing Tockify descriptions", () => {
  const ics = readFileSync(new URL("../import/__fixtures__/tockify-bikegr-2026-10-09.ics", import.meta.url));
  const descriptions = [...new Set(parseIcsEvents(ics).map((event) => toTockifyOccurrence(event).description))];
  const hasBulletLine = (d: string) => /^\s*[-+*]\s/m.test(d);

  const showParts = (parts: TextPart[]) => parts.map((p) => (p.kind === "link" ? `<${p.href}>` : p.text)).join("").trim();
  const showInlines = (nodes: Inline[]): string =>
    nodes
      .map((n) => (n.kind === "text" ? n.text : n.kind === "link" ? `<${n.href}>` : n.kind === "break" ? "\n" : showInlines(n.children)))
      .join("");

  it("has the fixture's descriptions", () => {
    expect(descriptions.length).toBeGreaterThanOrEqual(20);
  });

  it.each(descriptions.filter((d) => d.trim() !== "" && !hasBulletLine(d)))("renders %# with today's paragraphs, lines, and links", (d) => {
    const before = descriptionParagraphs(d).map((lines) => lines.map(showParts));
    const after = descriptionBlocks(d).map((block) => {
      expect(block.kind).toBe("paragraph");
      return block.kind === "paragraph" ? showInlines(block.children).split("\n").map((line) => line.trim()) : [];
    });
    expect(after).toEqual(before);
  });

  it("makes the one '* ' description into a real list", () => {
    const withList = descriptions.filter(hasBulletLine);
    expect(withList).toHaveLength(1);
    expect(descriptionBlocks(withList[0]).some((b) => b.kind === "list")).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm vitest run src/agenda/description-markdown.test.ts src/agenda/safe-url.test.ts`
Expected: FAIL, "Failed to resolve import ./description-markdown" and `isLinkUrl` is not exported.

- [ ] **Step 4: Implement `isLinkUrl`**

Append to `src/agenda/safe-url.ts`:

```ts
/** True only for an absolute `http:`, `https:`, or `mailto:` URL: the links a description may have. */
export function isLinkUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Implement `description-markdown.ts`**

```ts
/**
 * The Event description is Markdown with a small allowed set: paragraphs, headings 1 and 2,
 * bulleted and numbered lists, horizontal lines, bold, italic, links, and line breaks. It is parsed
 * with `marked`, the parser of the editor's Markdown extension, with the same options, then mapped
 * to a tree of only those kinds. Anything else (HTML, images, code, quotes, tables) stays literal
 * text. Pure, so the page renders React elements and nothing is ever read as HTML.
 */
import { Lexer, type Token, Tokenizer } from "marked";
import { lineParts } from "./description-text";
import { isLinkUrl } from "./safe-url";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong" | "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "break" };

export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "heading"; level: 1 | 2; children: Inline[] }
  | { kind: "list"; ordered: boolean; start?: number; items: Block[][] }
  | { kind: "rule" };

/** Bare web addresses link by `lineParts` (today's rules), so marked leaves them as text. */
class NoBareUrls extends Tokenizer {
  override url(): undefined {
    return undefined;
  }
}

function lex(markdown: string): Token[] {
  return new Lexer({ gfm: true, breaks: true, tokenizer: new NoBareUrls() }).lex(markdown.replace(/\r\n?/g, "\n"));
}

/** Plain text with `\n` as breaks and web addresses as links. */
function plainInlines(value: string, inLink: boolean): Inline[] {
  return value.split("\n").flatMap((line, i): Inline[] => {
    const parts: Inline[] = inLink
      ? [{ kind: "text", text: line }]
      : lineParts(line).map((part) =>
          part.kind === "link"
            ? { kind: "link", href: part.href, children: [{ kind: "text", text: part.text }] }
            : { kind: "text", text: part.text },
        );
    return i > 0 ? [{ kind: "break" }, ...parts] : parts;
  }).filter((node) => node.kind !== "text" || node.text !== "");
}

function inlines(tokens: Token[] | undefined, inLink = false): Inline[] {
  const out: Inline[] = [];
  // Adjacent text is joined first: marked splits text at characters such as `_` and `h` of http.
  let pending = "";
  const flush = () => {
    if (pending !== "") out.push(...plainInlines(pending, inLink));
    pending = "";
  };
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text":
        if (token.tokens?.length) {
          flush();
          out.push(...inlines(token.tokens, inLink));
        } else pending += token.text;
        break;
      case "escape":
        pending += token.text;
        break;
      case "br":
        flush();
        out.push({ kind: "break" });
        break;
      case "strong":
      case "em":
        flush();
        out.push({ kind: token.type, children: inlines(token.tokens, inLink) });
        break;
      case "link":
        flush();
        if (!inLink && isLinkUrl(token.href)) out.push({ kind: "link", href: token.href, children: inlines(token.tokens, true) });
        else out.push(...inlines(token.tokens, inLink));
        break;
      default:
        pending += token.raw;
    }
  }
  flush();
  return out;
}

function literal(raw: string): Block {
  return { kind: "paragraph", children: plainInlines(raw.trim(), false) };
}

function blocks(tokens: Token[]): Block[] {
  const out: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "paragraph":
        out.push({ kind: "paragraph", children: inlines(token.tokens) });
        break;
      case "text":
        out.push({ kind: "paragraph", children: token.tokens ? inlines(token.tokens) : plainInlines(token.text, false) });
        break;
      case "heading":
        if (token.depth === 1 || token.depth === 2) {
          out.push({ kind: "heading", level: token.depth, children: inlines(token.tokens) });
        } else out.push(literal(token.raw));
        break;
      case "list": {
        const start = token.ordered && typeof token.start === "number" && token.start !== 1 ? { start: token.start } : {};
        out.push({ kind: "list", ordered: token.ordered, ...start, items: token.items.map((item: Token & { tokens: Token[] }) => blocks(item.tokens)) });
        break;
      }
      case "hr":
        out.push({ kind: "rule" });
        break;
      default:
        out.push(literal(token.raw));
    }
  }
  return out.filter((block) => block.kind !== "paragraph" || block.children.length > 0);
}

export function descriptionBlocks(markdown: string): Block[] {
  return blocks(lex(markdown));
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return node.text;
        case "break":
          return "\n";
        case "strong":
        case "em":
          return inlineText(node.children);
        case "link": {
          const shown = node.href.replace(/^mailto:/i, "");
          const label = inlineText(node.children);
          return label === node.href || label === shown ? label : `${label} (${shown})`;
        }
      }
    })
    .join("");
}

function blockText(block: Block): string {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return inlineText(block.children).trim();
    case "list":
      return block.items
        .map((item, i) => `${block.ordered ? `${(block.start ?? 1) + i}.` : "•"} ${item.map(blockText).filter(Boolean).join("\n")}`)
        .join("\n");
    case "rule":
      return "";
  }
}

/** The description as plain text: blocks at blank lines, `• ` and `1. ` items, links as "text (url)". */
export function descriptionText(markdown: string): string {
  return descriptionBlocks(markdown).map(blockText).filter((t) => t !== "").join("\n\n");
}
```

If `marked`'s TypeScript types differ from the casts above (`token.items`, `token.start`), adjust
the narrowing to the installed `node_modules/marked/lib/marked.d.ts` types without changing behavior.
If inline `text` tokens arrive HTML-escaped (the `A & B < C` test fails with `&amp;`), use
`token.raw` instead of `token.text` for inline text.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/agenda/description-markdown.test.ts src/agenda/safe-url.test.ts`
Expected: PASS. If a Tockify fixture case fails, do not change the test: the failure is an existing
description that would change on the page. Fix the parser (for example, an indented line that
`marked` reads as code) and report what you changed.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/agenda/safe-url.ts src/agenda/safe-url.test.ts src/agenda/description-markdown.ts src/agenda/description-markdown.test.ts
git commit -m "Rich-text description: the Markdown parser and plain text"
```

---

### Task 2: `RichText` on the detail page

**Files:**
- Create: `src/app/_components/rich-text.tsx`
- Test: `src/app/_components/rich-text.test.ts`
- Modify: `src/app/events/[eventId]/[start]/page.tsx:150-153`

**Interfaces:**
- Consumes: `descriptionBlocks`, `Block`, `Inline` (Task 1).
- Produces: `export function RichText({ markdown, className }: { markdown: string; className?: string }): ReactNode`.

- [ ] **Step 1: Write the failing test**

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichText } from "./rich-text";

const html = (markdown: string) => renderToStaticMarkup(createElement(RichText, { markdown }));

describe("RichText", () => {
  it("renders headings one level below the page title, lists, rules, and marks", () => {
    const out = html("# Route\n\n## Stops\n\n**Bold** *it*\n\n- A\n\n2. B\n\n---");
    expect(out).toContain("<h2");
    expect(out).toContain(">Route</h2>");
    expect(out).toContain(">Stops</h3>");
    expect(out).toMatch(/<strong[^>]*>Bold<\/strong>/);
    expect(out).toContain("<em>it</em>");
    expect(out).toMatch(/<ul[^>]*><li><p>A<\/p><\/li><\/ul>/);
    expect(out).toMatch(/<ol start="2"[^>]*>/);
    expect(out).toContain("<hr");
  });

  it("renders links with the safe rel and line breaks as <br>", () => {
    const out = html("[Map](https://example.org/map)\nhttps://x.org");
    expect(out).toContain('href="https://example.org/map"');
    expect(out).toContain('rel="nofollow noopener noreferrer"');
    expect(out).toContain("<br/>");
    expect(out).toContain('href="https://x.org"');
  });

  it("never renders HTML from the description", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror="a()"> [x](javascript:alert(1))');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("&lt;script&gt;");
  });

  it("renders nothing for an empty description", () => {
    expect(html("  \n ")).toBe("");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/app/_components/rich-text.test.ts`
Expected: FAIL, cannot resolve `./rich-text`.

- [ ] **Step 3: Implement**

```tsx
import type { ReactNode } from "react";
import { type Block, descriptionBlocks, type Inline } from "@/agenda/description-markdown";

/**
 * The Event description (Markdown, the allowed set in description-markdown.ts) as React elements,
 * so it is never read as HTML. Description headings are one and two levels below the page title.
 */
const linkClass = "break-all font-normal text-brand-orange-text underline underline-offset-4";

function renderInlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "break":
        return <br key={i} />;
      case "strong":
        return <strong key={i} className="font-semibold">{renderInlines(node.children)}</strong>;
      case "em":
        return <em key={i}>{renderInlines(node.children)}</em>;
      case "link":
        return (
          <a key={i} href={node.href} className={linkClass} rel="nofollow noopener noreferrer">
            {renderInlines(node.children)}
          </a>
        );
    }
  });
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return <p key={key}>{renderInlines(block.children)}</p>;
    case "heading":
      return block.level === 1 ? (
        <h2 key={key} className="font-chivo text-[22px] font-normal leading-snug">{renderInlines(block.children)}</h2>
      ) : (
        <h3 key={key} className="font-chivo text-[19px] font-normal leading-snug">{renderInlines(block.children)}</h3>
      );
    case "list": {
      const items = block.items.map((item, i) => <li key={i}>{item.map(renderBlock)}</li>);
      return block.ordered ? (
        <ol key={key} start={block.start} className="list-decimal space-y-1 pl-6">{items}</ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-6">{items}</ul>
      );
    }
    case "rule":
      return <hr key={key} className="border-brand-divider" />;
  }
}

export function RichText({ markdown, className }: { markdown: string; className?: string }) {
  const blocks = descriptionBlocks(markdown);
  if (blocks.length === 0) return null;
  return <div className={className}>{blocks.map(renderBlock)}</div>;
}
```

- [ ] **Step 4: Use it on the detail page**

In `src/app/events/[eventId]/[start]/page.tsx`, add
`import { RichText } from "../../../_components/rich-text";` and replace the description
`ParagraphText` (the one with `text={row.description}`, not the Occurrence details one) with:

```tsx
<RichText
  markdown={row.description}
  className="mt-8 space-y-4 text-[15.84px] font-light leading-[1.92] [overflow-wrap:anywhere]"
/>
```

`ParagraphText` stays imported for the Occurrence details box.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm vitest run src/app/_components/rich-text.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/_components/rich-text.tsx src/app/_components/rich-text.test.ts "src/app/events/[eventId]/[start]/page.tsx"
git commit -m "Rich-text description: RichText on the detail page"
```

---

### Task 3: Custom Preview data

**Files:**
- Modify: `src/db/schema.ts` (events table)
- Create (generated): `drizzle/0004_custom-preview.sql`, `drizzle/meta/0004_snapshot.json`, journal entry
- Create: `src/db/preview-schema.test.ts`
- Modify: `src/admin/events/event-input.ts`, `src/admin/events/create-event.ts`,
  `src/admin/events/form-values.ts`, `src/admin/events/test-helpers.ts`
- Modify: `src/submissions/submission-input.ts`, `src/submissions/form-data.ts`
- Modify: `src/agenda/snapshot.ts`, `src/agenda/occurrence-rows.ts`, `src/agenda/test-fixtures.ts`
- Test: `src/admin/events/event-input.test.ts`, `src/admin/events/create-event.test.ts`,
  `src/submissions/submission-input.test.ts`, `src/submissions/submit-event.test.ts`,
  `src/agenda/snapshot.test.ts`

**Interfaces:**
- Produces:
  - `events.preview: string | null` (column `preview`, check `events_preview_length`).
  - `export const PREVIEW_MAX = 300;` in `event-input.ts`.
  - `ContentValues.preview: string`; `ContentDraft.preview: string | null`.
  - `SubmissionValues.preview: string`; `FIELDS.preview = "preview"`.
  - `SnapshotEvent.preview: string | null`; `AgendaRow.preview: string | null`.

- [ ] **Step 1: Write the failing tests**

`src/db/preview-schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { events } from "./schema";
import { createTestDb } from "./test-db";
import type { Db } from "./types";

describe("Custom Preview column", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());

  const event = {
    calendar: "rides" as const,
    title: "Ride",
    allDay: false,
    startLocal: "2026-11-04T18:00",
    endLocal: "2026-11-04T20:00",
  };

  it("is null by default and refuses more than 300 characters", async () => {
    const [plain] = await db.insert(events).values(event).returning();
    expect(plain.preview).toBeNull();
    await db.insert(events).values({ ...event, preview: "é".repeat(300) });
    let error: unknown;
    try {
      await db.insert(events).values({ ...event, preview: "x".repeat(301) });
    } catch (e) {
      error = e;
    }
    const err = error as { message?: string; cause?: { message?: string } } | undefined;
    expect(`${err?.message} ${err?.cause?.message ?? ""}`).toContain("events_preview_length");
  });
});
```

In `src/admin/events/event-input.test.ts`, add `preview: ""` to `values()` and add:

```ts
describe("Custom Preview input", () => {
  it("is trimmed, empty is null, and more than 300 characters is an error", () => {
    const ok = parseSeriesContentInput({ ...values({ preview: "  Social pace, lights.  " }) }, editor);
    expect(ok.ok && ok.value.preview).toBe("Social pace, lights.");
    const empty = parseSeriesContentInput(values({ preview: "   " }), editor);
    expect(empty.ok && empty.value.preview).toBeNull();
    expect(errorsOf(parseSeriesContentInput(values({ preview: "x".repeat(301) }), editor))).toEqual({
      preview: "Use 300 characters or fewer.",
    });
    expect(parseSeriesContentInput(values({ preview: "é".repeat(300) }), editor).ok).toBe(true);
  });
});
```

In `src/submissions/submission-input.test.ts`, add `preview: ""` to `values()` and add:

```ts
describe("Submission Custom Preview", () => {
  it("goes to the Event draft and has the 300 limit", () => {
    const result = parse({ preview: " Easy pace. " });
    expect(result.ok && result.value.event.preview).toBe("Easy pace.");
    expect(errorsOf({ preview: "x".repeat(301) }).preview).toBe("Use 300 characters or fewer.");
  });
});
```

In `src/submissions/submit-event.test.ts`, add `preview: ""` to its `values()` helper.

In `src/admin/events/create-event.test.ts`, add:

```ts
it("stores the Custom Preview", async () => {
  const result = await createEvent(db, editor, draft({ preview: "Social pace." }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect((await eventRow(db, result.id)).preview).toBe("Social pace.");
});
```

In `src/agenda/snapshot.test.ts` `beforeAll`, add `preview: "Short."` to the `addEvent` call for
"Wednesday Evening Rides" (`addEvent` takes event columns), add `preview: "Short.",` to the
`toMatchObject` of the first test, and add to the end of that test:

```ts
    const all = await loadSnapshot(db, null);
    expect(all.events.find((e) => e.title === "Mobile GR Commission")?.preview).toBeNull();
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/db/preview-schema.test.ts src/admin/events src/submissions src/agenda/snapshot.test.ts`
Expected: FAIL (type errors on `preview`, missing column).

- [ ] **Step 3: Schema and migration**

In `src/db/schema.ts` events columns, after `description`:

```ts
    /** Custom Preview: plain text for the agenda card and page metadata instead of the description start. */
    preview: text("preview"),
```

In the events checks, after `events_occurrence_details_length`:

```ts
    check("events_preview_length", sql`char_length(${t.preview}) <= 300`),
```

Run: `pnpm db:generate --name custom-preview`
Expected: `drizzle/0004_custom-preview.sql` containing exactly:

```sql
ALTER TABLE "events" ADD COLUMN "preview" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_preview_length" CHECK (char_length("events"."preview") <= 300);
```

- [ ] **Step 4: Input, drafts, and writes**

`src/admin/events/event-input.ts`:
- `ContentValues`: add `preview: string;` after `description`.
- `ContentDraft`: add `preview: string | null;` after `description`.
- After `OCCURRENCE_DETAILS_MAX`: `export const PREVIEW_MAX = 300;`
- In `parseContent`, before `const location`:

```ts
  const preview = text(raw, "preview").replace(/\r\n?/g, "\n");
  if ([...preview].length > PREVIEW_MAX) errors.preview = "Use 300 characters or fewer.";
```

  and in the returned object after `description`: `preview: preview === "" ? null : preview,`

`src/admin/events/create-event.ts` `contentColumns`: add `preview: draft.preview,` after
`description`.

`src/admin/events/form-values.ts`: add `| "preview"` to `FormRow`; `preview: ""` in
`emptyEventValues`; `preview: row.preview ?? ""` in `contentValues`.

`src/admin/events/test-helpers.ts` `draft()`: add `preview: null,` after `description`.

`src/submissions/form-data.ts`: `FIELDS.preview: "preview"` after `description`, and
`preview: text(data, FIELDS.preview),` in `values`.

`src/submissions/submission-input.ts`: `SubmissionValues.preview: string;` after `description`,
and in the `parseEventInput` call: `preview: text(raw, "preview"),` after `description`.

- [ ] **Step 5: Snapshot and rows**

`src/agenda/snapshot.ts`: `SnapshotEvent.preview: string | null;` after `description`, and
`preview: event.preview,` in `snapshotEvents`.

`src/agenda/occurrence-rows.ts`: `AgendaRow` gets, after `description`:

```ts
  /** Custom Preview: replaces the description excerpt on the card and in metadata. */
  preview: string | null;
```

and `preview: event.preview,` in `expandEvent`.

`src/agenda/test-fixtures.ts`: `preview: null,` in both `snapshotEvent()` and `row()` defaults.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Fix every other place `tsc` reports a missing `preview` (object literals of
`ContentValues`, `SubmissionValues`, `AgendaRow`) by adding the empty value (`""` or `null`).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts drizzle src/db/preview-schema.test.ts src/admin/events src/submissions src/agenda
git commit -m "Custom Preview: column, input, writes, and snapshot"
```

---

### Task 4: Listing text and the plain-text outputs

**Files:**
- Create: `src/agenda/listing-text.ts`, `src/agenda/listing-text.test.ts`
- Modify: `src/app/_components/occurrence-card.tsx:35`, `src/agenda/json-ld.ts:30-48`,
  `src/feeds/vevent.ts:61`, `src/app/events/[eventId]/[start]/page.tsx:47`
- Test: `src/agenda/json-ld.test.ts`, `src/feeds/occurrence-details-feed.test.ts`

**Interfaces:**
- Consumes: `descriptionText` (Task 1); `AgendaRow.preview` (Task 3); `excerpt` from
  `description-text.ts`.
- Produces: `export function listingText(row: Pick<AgendaRow, "preview" | "description">, length: number): string`.

- [ ] **Step 1: Write the failing tests**

`src/agenda/listing-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listingText } from "./listing-text";

describe("listingText", () => {
  it("is the Custom Preview when set", () => {
    expect(listingText({ preview: "Easy pace.", description: "# Long\n\nText" }, 300)).toBe("Easy pace.");
  });

  it("else the description as plain text, cut to the length", () => {
    expect(listingText({ preview: null, description: "# Route\n\n**Bold** [Map](https://m.org)" }, 300)).toBe(
      "Route Bold Map (https://m.org)",
    );
    expect(listingText({ preview: null, description: "x".repeat(400) }, 160)).toHaveLength(160);
  });

  it("flattens a preview's line breaks and cuts it to a shorter length", () => {
    expect(listingText({ preview: "One\nTwo", description: "" }, 300)).toBe("One Two");
    expect(listingText({ preview: "y".repeat(300), description: "" }, 160)).toHaveLength(160);
  });
});
```

In `src/agenda/json-ld.test.ts` add:

```ts
it("uses the Custom Preview, else the description without Markdown", () => {
  expect(eventJsonLd(row({ description: "**Bring** lights", preview: "Easy pace." }), URL).description).toBe("Easy pace.");
  expect(eventJsonLd(row({ description: "**Bring** lights" }), URL).description).toBe("Bring lights");
});
```

In `src/feeds/occurrence-details-feed.test.ts` add:

```ts
it("the Event description is plain text, and the Custom Preview is not in the Feed", () => {
  expect(description({ description: "# Route\n\n**Bold** [Map](https://m.org)", preview: "Short." })).toBe(
    ["Route\n\nBold Map (https://m.org)", `https://calendar.bikegr.org/events/${ID}/2026-10-14T1800`].join("\n\n"),
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/agenda/listing-text.test.ts src/agenda/json-ld.test.ts src/feeds`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/agenda/listing-text.ts`:

```ts
/**
 * The short text of an Occurrence for the agenda card and page metadata: the Custom Preview when
 * the Event has one, else the start of the description as plain text. One line.
 */
import { descriptionText } from "./description-markdown";
import { excerpt } from "./description-text";
import type { AgendaRow } from "./occurrence-rows";

export function listingText(row: Pick<AgendaRow, "preview" | "description">, length: number): string {
  return excerpt(row.preview ?? descriptionText(row.description), length);
}
```

`occurrence-card.tsx`: replace the `excerpt` import with
`import { listingText } from "@/agenda/listing-text";` and line 35 with
`const description = moved ? "" : listingText(row, 300);`

`json-ld.ts`: `import { listingText } from "./listing-text";`, replace the first line of
`eventJsonLd` with `const description = listingText(row, DESCRIPTION_LENGTH);` and the
`if (description)` block with `if (description) json.description = description;`

`vevent.ts` `occurrenceDetails`: `import { descriptionText } from "@/agenda/description-markdown";`
and replace `row.description.trim(),` with `descriptionText(row.description),`.

Detail page `generateMetadata`: replace the `excerpt` import with `listingText` and line 47 with
`const description = listingText(row, 160) || \`${row.title} on ${date}\`;`

- [ ] **Step 4: Run the tests**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. Existing JSON-LD tests that expect a multi-line description now get one line
(`excerpt` flattens whitespace): update their expected text, and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/agenda src/feeds src/app/_components/occurrence-card.tsx "src/app/events/[eventId]/[start]/page.tsx"
git commit -m "Rich-text description: listing text, JSON-LD, and Feed as plain text"
```

---

### Task 5: The editor and the Event editor fields

**Files:**
- Modify: `package.json` (Tiptap packages)
- Create: `src/app/_components/markdown-editor.tsx`
- Modify: `src/app/admin/events/_components/fields.tsx` (description field and new `PreviewField`)

**Interfaces:**
- Consumes: `isLinkUrl` (Task 1); `ContentValues.preview`, `PREVIEW_MAX` (Task 3).
- Produces:
  ```ts
  export function MarkdownEditor(props: {
    label: string;              // accessible name of the editing area
    value?: string;             // controlled Markdown (admin); external changes reload the editor
    onChange?: (markdown: string) => void;
    name?: string;              // renders <input type="hidden" name={name} value={markdown}>
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    boxClassName?: string;      // border/background of the whole box, per site look
  }): ReactNode;
  ```

There are no component unit tests (Vitest runs `src/**/*.test.ts` in node); Task 7 tests the editor
in the browser.

- [ ] **Step 1: Install and read the Tiptap Markdown API**

Run: `pnpm add @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/markdown`
Then read `node_modules/@tiptap/markdown/README.md` (or `dist/index.d.ts`) and confirm, before
writing code: the extension export name (`Markdown`), the option that passes `marked` options
(expected `markedOptions`), the editor option `contentType: "markdown"`, `editor.getMarkdown()`, and
`setContent(value, { contentType: "markdown", emitUpdate: false })`. Read
`node_modules/@tiptap/starter-kit/dist/index.d.ts` for the v3 option names (`undoRedo`, `link`,
`underline`, `strike`, `code`, `codeBlock`, `blockquote`). If a name differs, use the installed one.
Run `pnpm ls marked` and confirm one major version (17).

- [ ] **Step 2: Write the editor**

`src/app/_components/markdown-editor.tsx`:

```tsx
"use client";

/**
 * The Event description editor: a toolbar like Tockify's, over Tiptap, reading and writing Markdown
 * with the allowed set of src/agenda/description-markdown.ts. Only the allowed nodes and marks are
 * loaded, so pasted rich text cannot bring others. It does not report a change until the person
 * edits, so an untouched description is saved byte for byte.
 */
import { Markdown } from "@tiptap/markdown";
import { type ChainedCommands, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { isLinkUrl } from "@/agenda/safe-url";

const LINK_ERROR = "Use a web address that starts with http://, https://, or mailto:.";

const contentClass =
  "min-h-40 px-4 py-3 outline-none [&_a]:text-brand-orange-text [&_a]:underline [&_h1]:font-chivo [&_h1]:text-[22px] [&_h2]:font-chivo [&_h2]:text-[19px] [&_hr]:my-4 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-6";
const buttonClass =
  "min-w-9 rounded px-2 py-1 text-sm hover:bg-black/5 disabled:opacity-40 aria-pressed:bg-black/10 aria-pressed:font-semibold";

export function MarkdownEditor({
  label,
  value,
  onChange,
  name,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  boxClassName = "rounded-[6px] border border-[#858486] bg-white",
}: {
  label: string;
  value?: string;
  onChange?: (markdown: string) => void;
  name?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  boxClassName?: string;
}) {
  const [markdown, setMarkdown] = useState(value ?? "");
  const lastEmitted = useRef(value ?? "");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const attributes = {
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": label,
    class: contentClass,
    ...(id ? { id } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(invalid ? { "aria-invalid": "true" } : {}),
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, protocols: ["mailto"], isAllowedUri: (url) => isLinkUrl(url) },
      }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    ],
    content: value ?? "",
    contentType: "markdown",
    editorProps: { attributes },
    onUpdate: ({ editor }) => {
      const next = editor.getMarkdown();
      lastEmitted.current = next;
      setMarkdown(next);
      onChange?.(next);
    },
  });

  // A new value from outside (a form reset after Save) reloads the editor, without a change event.
  useEffect(() => {
    if (!editor || value === undefined || value === lastEmitted.current) return;
    lastEmitted.current = value;
    setMarkdown(value);
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, id, describedBy, invalid, label]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e?.isActive("heading", { level: 1 }) ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      link: e?.isActive("link") ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  });

  function openLink() {
    setLinkHref(editor?.getAttributes("link").href ?? "");
    setLinkError(null);
    setLinkOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const href = linkHref.trim();
    if (!isLinkUrl(href)) {
      setLinkError(LINK_ERROR);
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else chain.setLink({ href }).run();
    setLinkOpen(false);
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  }

  function onLinkKey(event: KeyboardEvent<HTMLInputElement>) {
    // The editor can sit inside a <form>: Enter applies the link, it does not send the form.
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    } else if (event.key === "Escape") setLinkOpen(false);
  }

  const run = (command: (chain: ChainedCommands) => ChainedCommands) => () => {
    if (editor) command(editor.chain().focus()).run();
  };

  const tool = (labelText: string, glyph: string, onClick: () => void, pressed?: boolean, disabled?: boolean) => (
    <button
      type="button"
      className={buttonClass}
      aria-label={labelText}
      title={labelText}
      aria-pressed={pressed}
      disabled={!editor || disabled}
      onClick={onClick}
    >
      {glyph}
    </button>
  );
  const divider = <span aria-hidden="true" className="mx-1 h-5 w-px bg-black/15" />;

  return (
    <div className={boxClassName}>
      <div role="toolbar" aria-label={`${label} formatting`} className="flex flex-wrap items-center gap-1 border-b border-black/10 px-2 py-1">
        {tool("Undo", "↶", run((c) => c.undo()), undefined, !state?.canUndo)}
        {tool("Redo", "↷", run((c) => c.redo()), undefined, !state?.canRedo)}
        {divider}
        {tool("Heading 1", "H1", run((c) => c.toggleHeading({ level: 1 })), state?.h1)}
        {tool("Heading 2", "H2", run((c) => c.toggleHeading({ level: 2 })), state?.h2)}
        {divider}
        {tool("Bold", "B", run((c) => c.toggleBold()), state?.bold)}
        {tool("Italic", "I", run((c) => c.toggleItalic()), state?.italic)}
        {divider}
        {tool("Bulleted list", "•", run((c) => c.toggleBulletList()), state?.bullet)}
        {tool("Numbered list", "1.", run((c) => c.toggleOrderedList()), state?.ordered)}
        {divider}
        {tool("Link", "Link", openLink, state?.link)}
        {divider}
        {tool("Horizontal line", "—", run((c) => c.setHorizontalRule()))}
      </div>
      {linkOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-black/10 px-2 py-2">
          <input
            type="url"
            aria-label="Link address"
            className="min-w-0 flex-1 rounded border border-[#858486] px-2 py-1 text-sm"
            placeholder="https://"
            value={linkHref}
            autoFocus
            onChange={(e) => setLinkHref(e.target.value)}
            onKeyDown={onLinkKey}
          />
          <button type="button" className={buttonClass} onClick={applyLink}>Apply</button>
          {state?.link && <button type="button" className={buttonClass} onClick={removeLink}>Remove link</button>}
          <button type="button" className={buttonClass} onClick={() => setLinkOpen(false)}>Cancel</button>
          {linkError && <p role="alert" className="w-full text-sm text-brand-orange-text">{linkError}</p>}
        </div>
      )}
      {editor ? <EditorContent editor={editor} /> : <div className="min-h-40" aria-hidden="true" />}
      {name && <input type="hidden" name={name} value={markdown} />}
    </div>
  );
}
```

Use plain glyphs, not an icon library (none is installed). If `react-hooks/exhaustive-deps` is
not enabled in this ESLint config, remove the disable comment.

- [ ] **Step 3: Use it in `ContentFields`, and add `PreviewField`**

In `src/app/admin/events/_components/fields.tsx`:
- Imports: `useState` from `react`; `PREVIEW_MAX` from `@/admin/events/event-input`;
  `MarkdownEditor` from `../../../_components/markdown-editor`; `linkClass` from `../../_components/ui`.
- Replace the description `<textarea>` child of `<Field id="description" …>` with:

```tsx
        <MarkdownEditor
          label="Description"
          value={values.description}
          onChange={(description) => set({ description })}
          boxClassName="rounded border border-brand-divider bg-white"
        />
```

  Then right after that `Field`:

```tsx
      <PreviewField value={values.preview} onChange={(preview) => set({ preview })} error={errors.preview} />
```

- Add the component above `ContentFields`:

```tsx
/** "+ Custom Preview": plain text for the agenda card instead of the description start. */
function PreviewField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  const [open, setOpen] = useState(value !== "");
  if (!open && value === "" && !error) {
    return (
      <button type="button" className={`${linkClass} self-start`} onClick={() => setOpen(true)}>
        + Custom Preview
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Field id="preview" label="Custom Preview" error={error} hint="Shown on the calendar list instead of the start of the description.">
        <textarea rows={3} className={inputClass} value={value} autoFocus={value === ""} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <p className={hintClass}>
        {[...value].length} / {PREVIEW_MAX}
      </p>
    </div>
  );
}
```

The admin `Field` passes `id`, `aria-describedby`, and `aria-invalid` to its child with
`cloneElement`; `MarkdownEditor` accepts them, so error text is announced. The visible `<label>`
cannot name a contenteditable, which is why the editor also takes `label`.

- [ ] **Step 4: Typecheck, lint, and look at it**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. Then `pnpm dev`, open `/admin/events/new`, and check: the toolbar shows in order,
each button toggles, Link refuses `javascript:alert(1)` with the message, "+ Custom Preview" opens
the field with the count. Take a screenshot for the PR.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/app/_components/markdown-editor.tsx src/app/admin/events/_components/fields.tsx
git commit -m "Rich-text description: the editor and Custom Preview in the Event editor"
```

---

### Task 6: The Submission form

**Files:**
- Modify: `src/app/submit/submission-form.tsx` (description field ~line 195, new preview field)

**Interfaces:**
- Consumes: `MarkdownEditor` (Task 5); `FIELDS.preview` (Task 3); `PREVIEW_MAX` (Task 3).

- [ ] **Step 1: Replace the description field**

```tsx
        <Field name="description" label="Description" error={errors.description} hint="Use the toolbar for headings, bold, lists, and links.">
          {(props) => <MarkdownEditor {...props} label="Description" name={FIELDS.description} />}
        </Field>
        <SubmissionPreviewField error={errors.preview} />
```

Import `MarkdownEditor` from `../_components/markdown-editor` and `PREVIEW_MAX` from
`@/admin/events/event-input`. The form posts FormData, so the editor's hidden input carries the
Markdown. A refused send keeps the editor (same component instance); a successful send redirects to
the thank-you page, so there is nothing to clear.

- [ ] **Step 2: Add the preview field**

Below `Field` in the same file:

```tsx
/** "+ Custom Preview" on the public form: uncontrolled, so it posts with the FormData. */
function SubmissionPreviewField({ error }: { error?: string }) {
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState(0);
  if (!open && !error) {
    return (
      <button type="button" className="self-start font-normal text-brand-orange-text underline underline-offset-4" onClick={() => setOpen(true)}>
        + Custom Preview
      </button>
    );
  }
  return (
    <Field name="preview" label="Custom Preview" error={error} hint="Shown on the calendar list instead of the start of the description.">
      {(props) => (
        <>
          <textarea
            {...props}
            name={FIELDS.preview}
            rows={3}
            maxLength={PREVIEW_MAX}
            autoFocus
            onChange={(e) => setLength([...e.target.value].length)}
            className={input}
          />
          <p className="text-[14px]">{length} / {PREVIEW_MAX}</p>
        </>
      )}
    </Field>
  );
}
```

- [ ] **Step 3: Typecheck, lint, and run the existing Submission e2e**

Run: `pnpm typecheck && pnpm lint && pnpm test:e2e e2e/submissions.spec.ts`
Expected: PASS. `getByLabel("Description").fill(...)` in that spec now fills the editor (the
contenteditable has `aria-label="Description"`). If it matches more than one element, fix the
labels, not the test.

- [ ] **Step 4: Commit**

```bash
git add src/app/submit/submission-form.tsx
git commit -m "Rich-text description: the editor and Custom Preview on the Submission form"
```

---

### Task 7: End-to-end tests

**Files:**
- Create: `e2e/turnstile.ts` (move `turnstileStub` and `stubTurnstile` out of `e2e/submissions.spec.ts`)
- Modify: `e2e/submissions.spec.ts` (import them)
- Create: `e2e/rich-text.spec.ts`

**Interfaces:**
- Produces: `export async function stubTurnstile(page: Page, ip: string, token?: string): Promise<void>` in `e2e/turnstile.ts`.

- [ ] **Step 1: Move the Turnstile stub**

Move `turnstileStub` and `stubTurnstile` from `e2e/submissions.spec.ts` to `e2e/turnstile.ts`
unchanged (export `stubTurnstile`), and import it in `submissions.spec.ts`.

- [ ] **Step 2: Write `e2e/rich-text.spec.ts`**

```ts
/**
 * The rich-text description and the Custom Preview, end to end: the Event editor toolbar, the detail
 * page and agenda card, old plain-text descriptions, paste, the Link box, and a Submission.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { todayInDetroit } from "@/agenda/dates";
import { ruleInputToColumns } from "@/db/mappers";
import * as schema from "@/db/schema";
import { addDays } from "@/engine";
import { E2E_DATABASE_URL, E2E_EDITOR, nextWeekday, segment } from "./fixture";
import { stubTurnstile } from "./turnstile";

const OLD_ID = "10000000-0000-4000-8000-0000000000c1";
const OLD_DESCRIPTION = "Line one\nLine two\n\nSee https://example.org/x.";
const today = todayInDetroit(new Date());
const thursday = nextWeekday(addDays(today, 1), 4);

async function withDb<T>(run: (db: PostgresJsDatabase<typeof schema>) => Promise<T>): Promise<T> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    return await run(drizzle({ client: sql, schema }));
  } finally {
    await sql.end();
  }
}

const storedDescription = (id: string) =>
  withDb(async (db) => (await db.select().from(schema.events).where(eq(schema.events.id, id)))[0].description);

async function logIn(context: BrowserContext) {
  await context.addCookies([
    { name: "authjs.session-token", value: E2E_EDITOR.sessionToken, domain: "localhost", path: "/", httpOnly: true },
  ]);
}

const editorBox = (page: Page) => page.getByRole("textbox", { name: "Description" }).locator("visible=true");
const tool = (page: Page, name: string) => page.getByRole("toolbar", { name: "Description formatting" }).locator("visible=true").getByRole("button", { name, exact: true });

test.beforeAll(async () => {
  await withDb(async (db) => {
    await db.delete(schema.eventHistory).where(eq(schema.eventHistory.eventId, OLD_ID));
    await db.delete(schema.events).where(eq(schema.events.id, OLD_ID));
    await db.insert(schema.events).values({
      id: OLD_ID,
      calendar: "rides",
      title: "E2E Old Plain Ride",
      description: OLD_DESCRIPTION,
      reviewStatus: "approved",
      reviewedAt: new Date(),
      ...ruleInputToColumns({
        eventId: "",
        timing: { kind: "timed", start: `${thursday}T18:00`, end: `${thursday}T20:00` },
        rrule: "FREQ=WEEKLY;BYDAY=TH",
        exdates: [],
        scheduleStatus: "scheduled",
        scheduleNote: null,
      }),
    });
  });
});

test.afterAll(async () => {
  await withDb(async (db) => {
    await db.delete(schema.eventHistory).where(eq(schema.eventHistory.eventId, OLD_ID));
    await db.delete(schema.events).where(eq(schema.events.id, OLD_ID));
  });
});

test("toolbar formatting and a Custom Preview show on the detail page, card, and metadata", async ({ page, context }) => {
  await logIn(context);
  await page.goto("/admin/events/new");
  await page.getByLabel("Title", { exact: true }).locator("visible=true").fill("E2E Rich Ride");
  await editorBox(page).click();
  await tool(page, "Heading 1").click();
  await page.keyboard.type("Route");
  await page.keyboard.press("Enter");
  await tool(page, "Bold").click();
  await page.keyboard.type("Lights required");
  await tool(page, "Bold").click();
  await page.keyboard.press("Enter");
  await tool(page, "Bulleted list").click();
  await page.keyboard.type("Helmet");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Water");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Map: ");
  await tool(page, "Link").click();
  await page.getByLabel("Link address").fill("https://example.org/map");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "+ Custom Preview" }).click();
  await page.getByLabel("Custom Preview").fill("Social pace, lights required.");
  await page.getByRole("button", { name: "Create Event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\?saved=created/);
  const adminUrl = page.url().split("?")[0];
  const id = adminUrl.split("/").at(-1)!;

  // The editor reloads the saved Markdown with its formatting.
  await expect(editorBox(page).locator("strong")).toHaveText("Lights required");

  await expect(async () => {
    await page.goto(`/events/${id}/${segment(today)}`);
    await expect(page.getByRole("heading", { level: 2, name: "Route" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.locator("main strong", { hasText: "Lights required" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Helmet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://example.org/map" })).toHaveAttribute("rel", "nofollow noopener noreferrer");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Social pace, lights required.");
  await expect(page.getByText("Social pace, lights required.")).toHaveCount(0);

  await page.goto("/rides");
  const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "E2E Rich Ride" }) }).first();
  await expect(card).toContainText("Social pace, lights required.");
  await expect(card).not.toContainText("**");

  await page.goto(adminUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^Delete/ }).click();
  await expect(page.getByText("This Event was deleted")).toBeVisible();
});

test("an untouched description is saved byte for byte, and line breaks survive an edit", async ({ page, context }) => {
  await logIn(context);
  await page.goto(`/admin/events/${OLD_ID}`);
  const title = page.getByLabel("Title", { exact: true }).locator("visible=true");
  await title.fill("E2E Old Plain Ride (renamed)");
  await page.getByRole("button", { name: "Save for all dates" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible();
  expect(await storedDescription(OLD_ID)).toBe(OLD_DESCRIPTION);

  await editorBox(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Bring lights.");
  await page.getByRole("button", { name: "Save for all dates" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible();

  await expect(async () => {
    await page.goto(`/events/${OLD_ID}/${segment(thursday)}`);
    await expect(page.getByText("Bring lights.")).toBeVisible({ timeout: 1000 });
  }).toPass();
  const first = page.locator("main p").filter({ hasText: "Line one" });
  await expect(first.locator("br")).toHaveCount(1);
  await expect(first).toContainText("Line two");
  await expect(page.getByRole("link", { name: "https://example.org/x" })).toBeVisible();
});

test("literal characters, paste, and the Link box stay safe", async ({ page, context }) => {
  await logIn(context);
  await page.goto("/admin/events/new");
  await page.getByLabel("Title", { exact: true }).locator("visible=true").fill("E2E Literal Ride");
  await editorBox(page).click();
  // `5*3 and 2*4` is italic in Markdown unless the editor escapes it; it does not trigger the
  // editor's own `*text*` input rule (that needs a space before the first `*`).
  await page.keyboard.type("Price 5*3 and 2*4, #1 pick");
  await page.keyboard.press("Enter");
  await editorBox(page).evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/html", '<p><span style="color:red">Red</span> <img src="https://example.org/a.png"> <script>alert(1)</script></p><table><tr><td>Cell</td></tr></table>');
    data.setData("text/plain", "Red Cell");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await tool(page, "Link").click();
  await page.getByLabel("Link address").fill("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Use a web address that starts with http://, https://, or mailto:." })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Create Event" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\?saved=created/);
  const adminUrl = page.url().split("?")[0];
  const id = adminUrl.split("/").at(-1)!;

  await expect(async () => {
    await page.goto(`/events/${id}/${segment(today)}`);
    await expect(page.getByText("Price 5*3 and 2*4, #1 pick")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.locator("main em")).toHaveCount(0);
  await expect(page.locator("main img, main table, main script")).toHaveCount(0);
  await expect(page.locator("main").getByText("Red").first()).toBeVisible();
  await expect(page.locator('main a[href^="javascript:"]')).toHaveCount(0);

  await page.goto(adminUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^Delete/ }).click();
  await expect(page.getByText("This Event was deleted")).toBeVisible();
});

test("a Submission keeps its formatting and Custom Preview after approval; the toolbar works by keyboard", async ({ page, context }) => {
  await stubTurnstile(page, "198.51.100.61");
  await page.goto("/submit?calendar=rides");
  await page.getByLabel("Title (required)").fill("E2E Rich Submission");
  const bold = tool(page, "Bold");
  await editorBox(page).click();
  await bold.focus();
  await page.keyboard.press("Enter");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("Bring lights");
  await page.getByRole("button", { name: "+ Custom Preview" }).click();
  await page.getByLabel("Custom Preview").fill("Evening social ride.");
  await page.getByLabel("Starts (required)").fill(`${thursday}T18:00`);
  await page.getByLabel("Your name (required)").fill("Sam Rider");
  await page.getByLabel("Your email (required)").fill("sam@example.org");
  const send = page.getByRole("button", { name: "Send the event" });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page).toHaveURL(/\/submit\/thanks/);

  await logIn(context);
  await page.goto("/admin/review");
  await page.getByRole("row", { name: /E2E Rich Submission/ }).getByRole("link", { name: "E2E Rich Submission" }).click();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  // Loading the editor is not an unsaved change.
  await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved. The Event is public.")).toBeVisible();

  await expect(async () => {
    await page.goto(`/events/${id}/${segment(thursday)}`);
    await expect(page.locator("main strong", { hasText: "Bring lights" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.goto("/rides");
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "E2E Rich Submission" }) }).first()).toContainText(
    "Evening social ride.",
  );

  await page.goto(`/admin/events/${id}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^Delete/ }).click();
  await expect(page.getByText("This Event was deleted")).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: all specs PASS, including `submissions.spec.ts` and `editor-forms.spec.ts`. If a Review
Focus test fails (untouched description changed, line breaks lost, literal `*` became italic, paste
kept an image, `javascript:` became a link), fix the editor configuration in
`markdown-editor.tsx` (for example, the Markdown extension's `markedOptions`, or a missing
extension exclusion), not the test.

- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "Rich-text description: e2e for the editor, Custom Preview, and Submissions"
```

---

### Task 8: Docs

**Files:**
- Modify: `docs/design.md`, `CONTEXT.md`
- Create: `docs/adr/0003-markdown-description.md`

- [ ] **Step 1: `docs/design.md`**

Where the Event fields and the detail page are described, say: the description is Markdown with
the allowed set (paragraphs, headings 1 and 2, bulleted and numbered lists, horizontal lines, bold,
italic, links, line breaks), edited in a toolbar editor on the Event editor and the Submission
form; rendered as React elements, never HTML; plain text (formatting removed, links as
"text (url)") in the agenda card excerpt, metadata, JSON-LD, and the Feed. Add the **Custom
Preview**: optional plain text, 300 characters at most (a database check), set on the Event editor
and the Submission form; shown on the agenda card, the Embed, the meta description, Open Graph, and
JSON-LD instead of the description start; never on the detail page body or in the Feed. Keep the
Occurrence details paragraph unchanged.

- [ ] **Step 2: `CONTEXT.md`**

Add a row to the glossary table in the same style as **Occurrence details**:

```markdown
| **Custom Preview** | Optional short plain text on an Event (300 characters at most). Shown on the agenda card and in search and social previews instead of the start of the description. Not on the detail page body or in the Feed. |
```

- [ ] **Step 3: `docs/adr/0003-markdown-description.md`**

```markdown
# The Event description is Markdown, edited in a toolbar editor

Tockify had a toolbar editor for the description, and Editors and Submitters expect one. We store
the description as Markdown in the same text column and edit it with Tiptap and its Markdown
extension. The page parses it with `marked`, the parser the extension uses, with the same options
(`gfm`, `breaks`), maps it to a small tree of allowed kinds, and renders React elements. Anything
outside the allowed set stays literal text, so the page never reads a description as HTML.
Existing plain-text descriptions read as Markdown look the same (checked against the Tockify
export), so there is no migration.

## Considered options

- **Sanitized HTML.** Closest to Tockify, and would allow underline and alignment. It needs a
  sanitizer on every write and render, a data migration, and HTML-to-text for the Feed and
  metadata. We did not want underline or alignment, so the cost bought nothing.
- **A Markdown textarea with a toolbar.** Lightest, but people see `**` and `#`; a step back from
  Tockify.
```

- [ ] **Step 4: Commit**

```bash
git add docs/design.md CONTEXT.md docs/adr/0003-markdown-description.md
git commit -m "Rich-text description and Custom Preview: docs and ADR 0003"
```

---

## Final verification

- [ ] Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e` — all PASS.
- [ ] `git status` is clean apart from the AGENTS.md block that `next dev` re-adds (commit it if it
      appears, per AGENTS.md).
