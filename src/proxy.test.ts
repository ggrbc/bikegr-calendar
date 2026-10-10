import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const request = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));
const passesThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  it("/events alone goes through, not to /login", async () => {
    expect(passesThrough(await proxy(request("/events")))).toBe(true);
  });

  it("/admin without a session goes to /login", async () => {
    for (const path of ["/admin", "/admin/events"]) {
      const response = await proxy(request(path));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    }
  });

  it("a path that only starts with the letters admin is not the admin", async () => {
    expect(passesThrough(await proxy(request("/administrator")))).toBe(true);
  });

  it("a detail URL with a bad id gives 404 without a database", async () => {
    const response = await proxy(request("/events/spike/2026-10-14T1800"));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('<meta name="robots" content="noindex">');
  });

  it("router prefetches of detail pages skip the proxy (no database read)", () => {
    expect(config.matcher).toContainEqual({
      source: "/events/:path+",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    });
  });
});
