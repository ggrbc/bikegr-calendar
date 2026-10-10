import { NextResponse, type NextRequest } from "next/server";
import { detailGate, statusPageHtml } from "@/agenda/detail-gate";
import { findOccurrence } from "@/agenda/find-occurrence";
import { proxyDb } from "@/agenda/proxy-db";

/** Auth.js session cookie names (the `__Secure-` form is used on HTTPS). */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/events/")) return eventDetail(request);
  return admin(request);
}

/**
 * Optimistic check only: no session cookie means no login, so send the person to /login at once.
 * The real check (session row, active Editor, role) is in src/auth/dal.ts. No database here.
 */
function admin(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

/**
 * Event detail pages and their `.ics` files: a real 404 for an unknown Occurrence and 410 Gone for
 * a deleted Event (src/agenda/detail-gate.ts). A page cannot set these status codes itself.
 *
 * The body is a small static HTML page. Tried and refused: `NextResponse.rewrite(…, { status })` to
 * a styled page (Next.js 16.4 sends the prerendered page with 200, and an RSC request gets 307).
 */
async function eventDetail(request: NextRequest) {
  const decision = await detailGate(request.nextUrl.pathname, (eventId, segment) =>
    findOccurrence(proxyDb(), eventId, segment),
  );
  if (decision.kind === "next") return NextResponse.next();
  return new NextResponse(statusPageHtml(decision.status), {
    status: decision.status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/events/:path*"],
};
