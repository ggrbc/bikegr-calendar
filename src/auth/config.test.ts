/**
 * Integration test of the Auth.js wiring: the real `Auth()` handler, the Drizzle adapter on PGlite
 * (real migrations), and a mock mailer.
 */
import { Auth } from "@auth/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authSessions, authVerificationTokens, editors } from "@/db/schema";
import { seedAdmins } from "@/db/seed-admins";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { buildAuthConfig } from "./config";
import type { Mailer, MagicLinkMessage } from "./mailer";

const ORIGIN = "http://localhost:3000";

describe("Auth.js wiring", () => {
  let db: Db;
  let close: () => Promise<void>;
  const sent: MagicLinkMessage[] = [];
  const mailer: Mailer = {
    transport: "console",
    sendMagicLink: vi.fn(async (message: MagicLinkMessage) => {
      sent.push(message);
    }),
  };

  function handle(request: Request) {
    return Auth(request, {
      ...buildAuthConfig({ db, mailer }),
      secret: "test-secret-for-auth-wiring-tests",
      trustHost: true,
      basePath: "/api/auth",
    });
  }

  /** Gets a CSRF token and its cookie, as the browser does before it posts the form. */
  async function csrf(): Promise<{ token: string; cookie: string }> {
    const res = await handle(new Request(`${ORIGIN}/api/auth/csrf`));
    const { csrfToken } = (await res.json()) as { csrfToken: string };
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { token: csrfToken, cookie };
  }

  /** Posts the email form to the Auth.js route, as `/api/auth/signin/resend` receives it. */
  async function requestLink(email: string): Promise<Response> {
    const { token, cookie } = await csrf();
    return handle(
      new Request(`${ORIGIN}/api/auth/signin/resend`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
        body: new URLSearchParams({ email, csrfToken: token, callbackUrl: `${ORIGIN}/admin` }),
      }),
    );
  }

  async function countRows(table: typeof authVerificationTokens | typeof authSessions) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    return row.n;
  }

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedAdmins(db);
  });
  afterAll(async () => close());
  beforeEach(async () => {
    sent.length = 0;
    vi.mocked(mailer.sendMagicLink).mockClear();
    await db.delete(authVerificationTokens);
    await db.delete(authSessions);
  });

  it("unknown email gets no token and no email", async () => {
    const res = await requestLink("stranger@example.org");
    expect(res.status).toBe(302);
    expect(await countRows(authVerificationTokens)).toBe(0);
    expect(mailer.sendMagicLink).not.toHaveBeenCalled();
  });

  it("seeded Admin gets one token and one email", async () => {
    const res = await requestLink("Jeremy@BikeGR.org");
    expect(res.status).toBe(302);
    expect(await countRows(authVerificationTokens)).toBe(1);
    expect(mailer.sendMagicLink).toHaveBeenCalledOnce();
    expect(sent[0]).toMatchObject({ to: "jeremy@bikegr.org", kind: "invite" });
  });

  it("refused and sent responses have the same Location", async () => {
    const refused = await requestLink("stranger@example.org");
    const accepted = await requestLink("nate@bikegr.org");
    expect(refused.headers.get("location")).toBe(accepted.headers.get("location"));
    expect(refused.headers.get("location")).not.toContain("error");
  });

  it("an active Editor's link makes a session", async () => {
    await requestLink("bultentom@bikegr.org");
    const res = await handle(new Request(sent[0].url));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin`);
    expect(await countRows(authSessions)).toBe(1);
  });

  it("a link used after deactivation is refused and makes no session", async () => {
    await requestLink("nate@bikegr.org");
    expect(sent).toHaveLength(1);
    await db.update(editors).set({ deactivatedAt: new Date() }).where(eq(editors.email, "nate@bikegr.org"));

    const res = await handle(new Request(sent[0].url));
    expect(res.headers.get("location")).toContain("error=AccessDenied");
    expect(await countRows(authSessions)).toBe(0);

    await db.update(editors).set({ deactivatedAt: null }).where(eq(editors.email, "nate@bikegr.org"));
  });
});
