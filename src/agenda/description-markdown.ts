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
  return value
    .split("\n")
    .flatMap((line, i): Inline[] => {
      const parts: Inline[] = inLink
        ? [{ kind: "text", text: line }]
        : lineParts(line).map((part) =>
            part.kind === "link"
              ? { kind: "link", href: part.href, children: [{ kind: "text", text: part.text }] }
              : { kind: "text", text: part.text },
          );
      return i > 0 ? [{ kind: "break" }, ...parts] : parts;
    })
    .filter((node) => node.kind !== "text" || node.text !== "");
}

function inlines(tokens: Token[] | undefined, inLink = false): Inline[] {
  const out: Inline[] = [];
  // Adjacent text is joined first: marked splits text at characters such as `_` and the h of http.
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
        if (!inLink && isLinkUrl(token.href)) {
          out.push({ kind: "link", href: token.href, children: inlines(token.tokens, true) });
        } else out.push(...inlines(token.tokens, inLink));
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
        out.push({
          kind: "list",
          ordered: token.ordered,
          ...start,
          items: token.items.map((item: { tokens: Token[] }) => blocks(item.tokens)),
        });
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
  return descriptionBlocks(markdown)
    .map(blockText)
    .filter((t) => t !== "")
    .join("\n\n");
}
