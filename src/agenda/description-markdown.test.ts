import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIcsEvents } from "@/import/ics";
import { toTockifyOccurrence } from "@/import/tockify-occurrence";
import { type Block, descriptionBlocks, descriptionParses, descriptionText, type Inline } from "./description-markdown";
import { descriptionParagraphs, type TextPart } from "./description-text";

const text = (t: string): Inline => ({ kind: "text", text: t });

describe("descriptionBlocks", () => {
  it("parses the allowed blocks and marks", () => {
    const md =
      "# Route\n\n## Stops\n\n**Lights** and *helmet*.\n\n- One\n- Two\n\n3. Three\n4. Four\n\n---\n\n[Map](https://example.org/map)";
    expect(descriptionBlocks(md)).toEqual<Block[]>([
      { kind: "heading", level: 1, children: [text("Route")] },
      { kind: "heading", level: 2, children: [text("Stops")] },
      {
        kind: "paragraph",
        children: [
          { kind: "strong", children: [text("Lights")] },
          text(" and "),
          { kind: "em", children: [text("helmet")] },
          text("."),
        ],
      },
      {
        kind: "list",
        ordered: false,
        items: [[{ kind: "paragraph", children: [text("One")] }], [{ kind: "paragraph", children: [text("Two")] }]],
      },
      {
        kind: "list",
        ordered: true,
        start: 3,
        items: [[{ kind: "paragraph", children: [text("Three")] }], [{ kind: "paragraph", children: [text("Four")] }]],
      },
      { kind: "rule" },
      { kind: "paragraph", children: [{ kind: "link", href: "https://example.org/map", children: [text("Map")] }] },
    ]);
  });

  it("keeps single line breaks as breaks", () => {
    expect(descriptionBlocks("One\nTwo")).toEqual([
      { kind: "paragraph", children: [text("One"), { kind: "break" }, text("Two")] },
    ]);
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

  it("reads the entities the editor writes for & < >, but not escaped ones", () => {
    expect(descriptionText("Bikes &amp; Beers &lt;3 &gt; &quot;x&quot; &#39;y&#x27;")).toBe(
      `Bikes & Beers <3 > "x" 'y'`,
    );
    expect(descriptionText("\\&amp; stays")).toBe("&amp; stays");
    expect(descriptionText("# Q&amp;A\n\n- R&amp;R\n\n[a&amp;b](https://example.org/?a=1&amp;b=2)")).toBe(
      "Q&A\n\n• R&R\n\na&b (https://example.org/?a=1&b=2)",
    );
  });

  it("falls back to plain paragraphs when the Markdown nests too deep to parse", () => {
    const deep = `${"- ".repeat(1875)}x\n\nAfter`;
    expect(() => descriptionBlocks(deep)).not.toThrow();
    expect(descriptionText(deep)).toContain("After");
    expect(descriptionParses(deep)).toBe(false);
    expect(descriptionParses(`${"> ".repeat(2400)}x`)).toBe(false);
    expect(descriptionParses("- a\n  - b\n    - c")).toBe(true);
  });

  it("does not link inside a link", () => {
    expect(descriptionBlocks("[see https://a.org](https://b.org)")).toEqual([
      { kind: "paragraph", children: [{ kind: "link", href: "https://b.org", children: [text("see https://a.org")] }] },
    ]);
  });
});

describe("descriptionText", () => {
  it("is plain text for excerpts and the Feed", () => {
    const md =
      "# Route\n\n**Bold** [Map](https://example.org/map) https://x.org\n\n- One\n- Two\n\n1. A\n2. B\n\n---\n\nEnd\nline";
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

  const showParts = (parts: TextPart[]) =>
    parts
      .map((p) => (p.kind === "link" ? `<${p.href}>` : p.text))
      .join("")
      .trim();
  const showInlines = (nodes: Inline[]): string =>
    nodes
      .map((n) =>
        n.kind === "text" ? n.text : n.kind === "link" ? `<${n.href}>` : n.kind === "break" ? "\n" : showInlines(n.children),
      )
      .join("");

  it("has the fixture's descriptions", () => {
    expect(descriptions.length).toBeGreaterThanOrEqual(20);
  });

  it.each(descriptions.filter((d) => d.trim() !== "" && !hasBulletLine(d)))(
    "renders %# with today's paragraphs, lines, and links",
    (d) => {
      const before = descriptionParagraphs(d).map((lines) => lines.map(showParts));
      const after = descriptionBlocks(d).map((block) => {
        expect(block.kind).toBe("paragraph");
        return block.kind === "paragraph"
          ? showInlines(block.children)
              .split("\n")
              .map((line) => line.trim())
          : [];
      });
      expect(after).toEqual(before);
    },
  );

  it("makes the one '* ' description into a real list", () => {
    const withList = descriptions.filter(hasBulletLine);
    expect(withList).toHaveLength(1);
    expect(descriptionBlocks(withList[0]).some((b) => b.kind === "list")).toBe(true);
  });
});
