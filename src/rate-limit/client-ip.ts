/**
 * The client's IP address, as a rate-limit key. No Next.js imports.
 *
 * On Vercel, `x-forwarded-for` and `x-real-ip` hold the client's address: Vercel overwrites
 * `x-forwarded-for`, so a client cannot spoof it there. Outside Vercel (local development only) a
 * client can set these headers.
 */
import { isIP } from "node:net";

/**
 * The first valid address from `x-forwarded-for` (its first entry), else from `x-real-ip`. Null
 * when neither holds a valid IP.
 *
 * An IPv6 address is returned as its /64 prefix (`2001:db8:1:2::/64`): one home or phone
 * connection usually gets a whole /64, so a per-address limit would be easy to get around. An
 * IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) is returned as the IPv4 address.
 */
export function clientIp(headers: Headers): string | null {
  const candidates = [headers.get("x-forwarded-for")?.split(",")[0], headers.get("x-real-ip")];
  for (const candidate of candidates) {
    const key = ipKey(candidate?.trim() ?? "");
    if (key) return key;
  }
  return null;
}

function ipKey(raw: string): string | null {
  // A zone ID (`fe80::1%eth0`) names a local interface; it is not part of the address.
  const value = raw.split("%")[0];
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;

  const groups = expandIpv6(value.toLowerCase());
  const isV4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isV4Mapped) return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** Eight 16-bit groups. The input is a valid IPv6 address (checked by `isIP`). */
function expandIpv6(address: string): number[] {
  const toGroups = (part: string): number[] =>
    part === ""
      ? []
      : part.split(":").flatMap((piece) => {
          // An embedded IPv4 tail (`64:ff9b::192.0.2.1`) is two groups.
          if (!piece.includes(".")) return [parseInt(piece, 16)];
          const [a, b, c, d] = piece.split(".").map(Number);
          return [(a << 8) | b, (c << 8) | d];
        });

  const [head, tail] = address.split("::");
  const front = toGroups(head);
  if (tail === undefined) return front;
  const back = toGroups(tail);
  return [...front, ...Array<number>(8 - front.length - back.length).fill(0), ...back];
}
