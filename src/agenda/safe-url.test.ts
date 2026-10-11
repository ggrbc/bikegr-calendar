import { describe, expect, it } from "vitest";
import { isHttpUrl, isLinkUrl } from "./safe-url";

describe("isHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpUrl("https://example.org/register")).toBe(true);
    expect(isHttpUrl("http://example.org")).toBe(true);
    expect(isHttpUrl("HTTPS://EXAMPLE.ORG")).toBe(true);
  });

  it("refuses data, javascript, other schemes, relative URLs, and text", () => {
    for (const url of [
      "data:text/html,<script>alert(1)</script>",
      "javascript:alert(1)",
      " javascript:alert(1)",
      "mailto:a@b.org",
      "ftp://example.org",
      "/rides",
      "example.org",
      "",
    ]) {
      expect(isHttpUrl(url), url).toBe(false);
    }
  });
});

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
