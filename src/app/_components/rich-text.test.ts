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
    expect(out).not.toContain('href="javascript:');
    expect(out).toContain("&lt;script&gt;");
  });

  it("renders nothing for an empty description", () => {
    expect(html("  \n ")).toBe("");
  });
});
