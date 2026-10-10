import { describe, expect, it } from "vitest";
import { isHttpUrl } from "./safe-url";

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
