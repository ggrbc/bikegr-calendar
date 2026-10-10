/**
 * The description is plain text (no HTML). For the detail page: paragraphs at blank lines, lines in
 * a paragraph, and the parts of each line that are web addresses. Pure, so the page renders the
 * parts as text and links, and nothing is ever read as HTML.
 */

export type TextPart = { kind: "text"; text: string } | { kind: "link"; href: string; text: string };

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
/** Punctuation at the end of a URL in a sentence is not part of it ("see https://x.org."). */
const TRAILING = /[.,;:!?)\]'"]+$/;

export function lineParts(line: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    let href = match[0];
    const trailing = TRAILING.exec(href)?.[0] ?? "";
    // Keep a closing parenthesis when the URL has its own opening one.
    const keepParen = trailing.startsWith(")") && href.includes("(");
    if (trailing && !keepParen) href = href.slice(0, -trailing.length);
    const start = match.index;
    if (start > last) parts.push({ kind: "text", text: line.slice(last, start) });
    parts.push({ kind: "link", href, text: href });
    last = start + href.length;
  }
  if (last < line.length) parts.push({ kind: "text", text: line.slice(last) });
  return parts;
}

/** Paragraphs (split at blank lines), each a list of lines, each a list of parts. */
export function descriptionParagraphs(description: string): TextPart[][][] {
  return description
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => paragraph.split("\n").map(lineParts));
}

/** The first `length` characters of the description, on one line, for metadata. */
export function excerpt(description: string, length = 160): string {
  const flat = description.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
}
