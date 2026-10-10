import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const ip = (init: Record<string, string>) => clientIp(new Headers(init));

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry", () => {
    expect(ip({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).toBe("203.0.113.7");
  });

  it("uses x-real-ip when there is no x-forwarded-for", () => {
    expect(ip({ "x-real-ip": "198.51.100.2" })).toBe("198.51.100.2");
  });

  it("trims spaces", () => {
    expect(ip({ "x-forwarded-for": "  203.0.113.7  " })).toBe("203.0.113.7");
  });

  it("a value that is not an IP gives null", () => {
    expect(ip({ "x-forwarded-for": "not-an-ip" })).toBeNull();
    expect(ip({ "x-real-ip": "203.0.113.7; drop table" })).toBeNull();
  });

  it("an invalid x-forwarded-for falls back to a valid x-real-ip", () => {
    expect(ip({ "x-forwarded-for": "unknown", "x-real-ip": "198.51.100.2" })).toBe("198.51.100.2");
  });

  it("no header gives null", () => {
    expect(ip({})).toBeNull();
    expect(ip({ "x-forwarded-for": "" })).toBeNull();
  });

  it("an IPv6 address counts as its /64 prefix", () => {
    expect(ip({ "x-forwarded-for": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" })).toBe("2001:db8:1:2::/64");
    expect(ip({ "x-forwarded-for": "2001:db8:1:2::9" })).toBe("2001:db8:1:2::/64");
  });

  it("two addresses in the same /64 give the same key", () => {
    expect(ip({ "x-real-ip": "2001:0DB8:0001:0002::1" })).toBe(ip({ "x-real-ip": "2001:db8:1:2:ffff::" }));
  });

  it("a compressed IPv6 address expands before the prefix", () => {
    expect(ip({ "x-real-ip": "2001:db8::1" })).toBe("2001:db8:0:0::/64");
    expect(ip({ "x-real-ip": "::1" })).toBe("0:0:0:0::/64");
  });

  it("an IPv4-mapped IPv6 address counts as the IPv4 address", () => {
    expect(ip({ "x-forwarded-for": "::ffff:203.0.113.7" })).toBe("203.0.113.7");
  });

  it("an IPv6 zone ID is removed", () => {
    expect(ip({ "x-real-ip": "fe80::1%eth0" })).toBe("fe80:0:0:0::/64");
  });
});
