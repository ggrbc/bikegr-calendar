import { NextResponse, type NextRequest } from "next/server";

/** Auth.js session cookie names (the `__Secure-` form is used on HTTPS). */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Optimistic check only: no session cookie means no login, so send the person to /login at once.
 * The real check (session row, active Editor, role) is in src/auth/dal.ts. No database here.
 */
export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
