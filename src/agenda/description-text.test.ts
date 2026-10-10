import { describe, expect, it } from "vitest";
import { descriptionParagraphs, excerpt, lineParts } from "./description-text";

describe("description text", () => {
  it("splits paragraphs at blank lines and keeps the lines of a paragraph", () => {
    const paragraphs = descriptionParagraphs("One\nTwo\n\n\nThree\r\n\r\nFour");
    expect(paragraphs.map((p) => p.map((line) => line.map((part) => part.text).join("")))).toEqual([
      ["One", "Two"],
      ["Three"],
      ["Four"],
    ]);
  });

  it("makes web addresses into links, without the punctuation after them", () => {
    expect(lineParts("See https://example.org/a?b=1. Or http://x.org, then go.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", href: "https://example.org/a?b=1", text: "https://example.org/a?b=1" },
      { kind: "text", text: ". Or " },
      { kind: "link", href: "http://x.org", text: "http://x.org" },
      { kind: "text", text: ", then go." },
    ]);
    expect(lineParts("(https://en.wikipedia.org/wiki/Bike_(disambiguation))")[1]).toMatchObject({
      href: "https://en.wikipedia.org/wiki/Bike_(disambiguation))",
    });
  });

  it("HTML in a description stays text", () => {
    expect(lineParts("<script>alert(1)</script>")).toEqual([{ kind: "text", text: "<script>alert(1)</script>" }]);
    expect(lineParts("javascript:alert(1)")).toEqual([{ kind: "text", text: "javascript:alert(1)" }]);
  });

  it("excerpt is one line with at most 160 characters", () => {
    expect(excerpt("A\n\nB  c")).toBe("A B c");
    expect(excerpt("x".repeat(200))).toHaveLength(160);
  });
});
