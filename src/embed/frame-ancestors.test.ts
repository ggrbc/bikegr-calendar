import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { embedFrameAncestors, extraFrameAncestors, NO_FRAME_ANCESTORS } from "./frame-ancestors";

describe("frame-ancestors", () => {
  it("Embed views allow the Bike GR site and Squarespace", () => {
    expect(embedFrameAncestors(undefined)).toBe(
      "frame-ancestors 'self' https://www.bikegr.org https://bikegr.org https://*.squarespace.com",
    );
  });

  it("extra sources are added; values that are not plain origins are dropped", () => {
    expect(extraFrameAncestors("http://localhost:4100 https://*.example.org")).toEqual([
      "http://localhost:4100",
      "https://*.example.org",
    ]);
    expect(extraFrameAncestors("'unsafe-inline' * https://x.org/path; script-src *")).toEqual([]);
  });

  it("next.config sends 'none' on every page and the Embed list on /embed, in that order", async () => {
    const rules = await nextConfig.headers!();
    const csp = (source: string) =>
      rules.find((rule) => rule.source === source)?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(csp("/:path*")).toBe(NO_FRAME_ANCESTORS);
    expect(csp("/embed/:path*")).toMatch(/^frame-ancestors 'self' https:\/\/www\.bikegr\.org/);
    // The last matching rule wins, so the Embed rule must come after the general one.
    const order = rules.map((rule) => rule.source);
    expect(order.indexOf("/embed/:path*")).toBeGreaterThan(order.indexOf("/:path*"));
  });
});
