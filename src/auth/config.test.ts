/**
 * Integration test of the Auth.js wiring: the real `Auth()` handler, the Drizzle adapter on PGlite
 * (real migrations), and a mock mailer.
 */
import { Auth } from "@auth/core";
import { AdapterError } from "@auth/core/errors";
import { DrizzleQueryError, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authAccounts, authSessions, authVerificationTokens, editors, rateLimits } from "@/db/schema";
import { seedAdmins } from "@/db/seed-admins";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { clientIp } from "@/rate-limit";
import { buildAuthConfig } from "./config";
import { createFakeGoogle, type FakeGoogle, type FakeGoogleClaims } from "./fake-google";
import type { GoogleCredentials } from "./google";
import type { Mailer, MagicLinkMessage } from "./mailer";

const ORIGIN = "http://localhost:3000";
const GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";

describe("Auth.js wiring", () => {
  let db: Db;
  let close: () => Promise<void>;
  let fakeGoogle: FakeGoogle;
  let google: GoogleCredentials | null;
  const sent: MagicLinkMessage[] = [];
  const mailer: Mailer = {
    transport: "console",
    sendMagicLink: vi.fn(async (message: MagicLinkMessage) => {
      sent.push(message);
    }),
  };

  /** As src/auth/index.ts does for the route handler: the IP comes from the request headers. */
  function handle(request: Request, database: Db = db) {
    return Auth(request, {
      ...buildAuthConfig({
        db: database,
        mailer,
        getClientIp: async () => clientIp(request.headers),
        google,
      }),
      secret: "test-secret-for-auth-wiring-tests",
      trustHost: true,
      basePath: "/api/auth",
    });
  }

  /** Gets a CSRF token and its cookie, as the browser does before it posts the form. */
  async function csrf(database: Db = db): Promise<{ token: string; cookie: string }> {
    const res = await handle(new Request(`${ORIGIN}/api/auth/csrf`), database);
    const { csrfToken } = (await res.json()) as { csrfToken: string };
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { token: csrfToken, cookie };
  }

  /** Posts the email form to the Auth.js route, as `/api/auth/signin/resend` receives it. */
  async function requestLink(
    email: string,
    { ip, database = db }: { ip?: string; database?: Db } = {},
  ): Promise<Response> {
    const { token, cookie } = await csrf(database);
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", cookie };
    if (ip) headers["x-forwarded-for"] = ip;
    return handle(
      new Request(`${ORIGIN}/api/auth/signin/resend`, {
        method: "POST",
        headers,
        body: new URLSearchParams({ email, csrfToken: token, callbackUrl: `${ORIGIN}/admin` }),
      }),
      database,
    );
  }

  async function countRows(table: typeof authVerificationTokens | typeof authSessions) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    return row.n;
  }

  async function findByEmail(email: string) {
    const [row] = await db.select().from(editors).where(eq(editors.email, email));
    return row;
  }

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedAdmins(db);
    fakeGoogle = await createFakeGoogle(GOOGLE_CLIENT_ID);
  });
  afterAll(async () => close());
  beforeEach(async () => {
    sent.length = 0;
    vi.mocked(mailer.sendMagicLink).mockClear();
    await db.delete(authVerificationTokens);
    await db.delete(authSessions);
    await db.delete(rateLimits);
    await db.delete(authAccounts);
    google = { clientId: GOOGLE_CLIENT_ID, clientSecret: "test-google-secret", fetch: fakeGoogle.fetch };
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

  describe("bad input and error logs", () => {
    let lines: string[];

    beforeEach(() => {
      lines = [];
      for (const level of ["log", "info", "warn", "error"] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map((a) => (a instanceof Error ? `${a.stack} ${JSON.stringify(a.cause)}` : String(a))).join(" "));
        });
      }
    });
    afterEach(() => vi.restoreAllMocks());

    it("an email with a NUL byte (jeremy%00%40bikegr.org) gets the invalid-email answer, runs no query, and logs no email", async () => {
      const invalid = await requestLink('jeremy"@bikegr.org'); // the answer for any invalid email
      const select = vi.spyOn(db, "select");
      const insert = vi.spyOn(db, "insert");
      lines.length = 0;

      const res = await requestLink("jeremy\0@bikegr.org", { ip: "203.0.113.7" });
      expect(res.status).toBe(invalid.status);
      expect(res.headers.get("location")).toBe(invalid.headers.get("location"));
      expect(select).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(mailer.sendMagicLink).not.toHaveBeenCalled();
      expect(lines).toEqual(["[auth] Refused link request: not a valid email address."]);
    });

    it("an invalid email logs one warn line with no stack", async () => {
      const errors = vi.mocked(console.error);
      lines.length = 0;
      await requestLink("a(b)@example.org");
      expect(lines).toEqual(["[auth] Refused link request: not a valid email address."]);
      expect(errors).not.toHaveBeenCalled();
    });

    it("an AdapterError logs its classes and code only: no SQL, no params, no message text", () => {
      const driverError = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), {
        code: "22021",
      });
      const queryError = new DrizzleQueryError(
        'select "id" from "editors" where "email" = $1',
        ["jeremy@bikegr.org"],
        driverError,
      );
      const config = buildAuthConfig({ db, mailer, getClientIp: async () => null });
      // As Auth.js does it (`lib/init.js`: `new AdapterError(e)`). The public type allows only a string.
      config.logger!.error!(new AdapterError(queryError as unknown as string));

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(
        /^\[auth\] Auth\.js error: AdapterError cause DrizzleQueryError cause DatabaseError code=22021\n/,
      );
      for (const secret of ["jeremy", "select", "params", "invalid byte", "Failed query"]) {
        expect(lines[0]).not.toContain(secret);
      }
    });
  });

  describe("magic-link rate limit", () => {
    const IP = "203.0.113.7";
    let lines: string[];

    async function buckets() {
      const rows = await db.select({ bucket: rateLimits.bucket, hits: rateLimits.hits }).from(rateLimits);
      return Object.fromEntries(rows.map((r) => [r.bucket, r.hits]));
    }

    beforeEach(() => {
      // Mid-hour, so the requests of one test never cross a window boundary.
      // In the past: the rate limit compares with the database clock, which is not faked.
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2025-01-01T12:20:00Z") });
      lines = [];
      for (const level of ["log", "info", "warn", "error"] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(" "));
        });
      }
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("the 6th request for one Editor in an hour sends no email and writes no token", async () => {
      for (let i = 0; i < 5; i++) await requestLink("jeremy@bikegr.org");
      expect(mailer.sendMagicLink).toHaveBeenCalledTimes(5);
      expect(await countRows(authVerificationTokens)).toBe(5);

      await requestLink("Jeremy@BikeGR.org");
      expect(mailer.sendMagicLink).toHaveBeenCalledTimes(5);
      expect(await countRows(authVerificationTokens)).toBe(5);
    });

    it("a limited request has the same status and Location as a sent one", async () => {
      const sentResponse = await requestLink("nate@bikegr.org");
      for (let i = 0; i < 4; i++) await requestLink("nate@bikegr.org");
      const limited = await requestLink("nate@bikegr.org");
      expect(mailer.sendMagicLink).toHaveBeenCalledTimes(5);
      expect(limited.status).toBe(sentResponse.status);
      expect(limited.headers.get("location")).toBe(sentResponse.headers.get("location"));
    });

    it("the 21st request from one IP is refused, also for a non-Editor", async () => {
      for (let i = 0; i < 20; i++) await requestLink(`stranger${i}@example.org`, { ip: IP });
      await requestLink("jeremy@bikegr.org", { ip: IP });
      expect(mailer.sendMagicLink).not.toHaveBeenCalled();
      expect(await countRows(authVerificationTokens)).toBe(0);

      await requestLink("jeremy@bikegr.org", { ip: "198.51.100.2" });
      expect(mailer.sendMagicLink).toHaveBeenCalledOnce();
    });

    it("a non-Editor email writes no magic-link:email row", async () => {
      await requestLink("stranger@example.org", { ip: IP });
      expect(await buckets()).toEqual({ "magic-link:ip": 1 });
    });

    it("a request with no IP header uses only the email limit", async () => {
      await requestLink("jeremy@bikegr.org");
      expect(await buckets()).toEqual({ "magic-link:email": 1 });
      expect(mailer.sendMagicLink).toHaveBeenCalledOnce();
    });

    it("a link click is not counted", async () => {
      await requestLink("bultentom@bikegr.org", { ip: IP });
      const before = await buckets();
      await handle(new Request(sent[0].url, { headers: { "x-forwarded-for": IP } }));
      expect(await countRows(authSessions)).toBe(1);
      expect(await buckets()).toEqual(before);
    });

    it("a limited request logs exactly one line, and no log line has the email or the IP", async () => {
      for (let i = 0; i < 5; i++) await requestLink("jeremy@bikegr.org", { ip: IP });
      lines.length = 0;
      await requestLink("jeremy@bikegr.org", { ip: IP });
      expect(lines).toEqual(["[auth] Magic link not sent: rate limit (email)."]);

      for (let i = 0; i < 14; i++) await requestLink(`stranger${i}@example.org`, { ip: IP });
      lines.length = 0;
      await requestLink("stranger-last@example.org", { ip: IP });
      expect(lines).toEqual(["[auth] Magic link not sent: rate limit (ip)."]);
    });

    it("with no rate_limits table, an Editor still gets the link, and the log line has no email and no IP", async () => {
      const fresh = await createTestDb();
      try {
        await seedAdmins(fresh.db);
        await fresh.db.execute(sql`DROP TABLE rate_limits`);
        lines.length = 0;
        const res = await requestLink("jeremy@bikegr.org", { ip: IP, database: fresh.db });
        expect(res.status).toBe(302);
        expect(mailer.sendMagicLink).toHaveBeenCalledOnce();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^\[auth\] Magic-link rate limit failed; request allowed: \S/);
        expect(lines[0]).toContain("42P01"); // undefined_table
        for (const line of lines) {
          expect(line).not.toContain("jeremy");
          expect(line).not.toContain("203.0.113");
          expect(line).not.toContain("rate_limits"); // no driver message text
        }
      } finally {
        await fresh.close();
      }
    });
  });

  describe("Google sign-in", () => {
    let lines: string[];
    let nextSub = 1000;

    /** An Editor for one test, so the tests do not share state (emailVerified, links). */
    async function addEditor(email: string) {
      const [row] = await db.insert(editors).values({ email, role: "editor" }).returning();
      return row;
    }

    function sub(): string {
      return `google-sub-${++nextSub}`;
    }

    async function countFor(table: typeof authAccounts | typeof authSessions, userId: string) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.userId, userId));
      return row.n;
    }

    /** `POST /api/auth/signin/google` with CSRF, as the login page's form does. */
    async function startGoogle(headers: Record<string, string> = {}) {
      const { token, cookie } = await csrf();
      const start = await handle(
        new Request(`${ORIGIN}/api/auth/signin/google`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            ...headers,
            cookie: [cookie, headers.cookie].filter(Boolean).join("; "),
          },
          body: new URLSearchParams({ csrfToken: token, callbackUrl: `${ORIGIN}/admin` }),
        }),
      );
      // As a browser does it: a newer Set-Cookie replaces the cookie of the same name
      // (`authjs.callback-url` comes from both responses).
      const jar = new Map<string, string>();
      for (const pair of [...cookie.split("; "), ...start.headers.getSetCookie().map((c) => c.split(";")[0])]) {
        jar.set(pair.slice(0, pair.indexOf("=")), pair);
      }
      return { start, cookies: [...jar.values()] };
    }

    /**
     * The full flow, as a browser does it: CSRF, `POST /api/auth/signin/google` (302 to Google with
     * the PKCE challenge), then Google's redirect back to `/api/auth/callback/google?code=…` with the
     * cookies. `params` replaces the code (for example `error=access_denied` for a cancel).
     */
    async function googleSignIn(
      claims: FakeGoogleClaims,
      { sessionCookie, params }: { sessionCookie?: string; params?: Record<string, string> } = {},
    ) {
      const { start, cookies } = await startGoogle(sessionCookie ? { cookie: sessionCookie } : {});
      const authorize = new URL(start.headers.get("location") ?? "");
      const query = new URLSearchParams(params ?? { code: fakeGoogle.issueCode(claims) });
      const callback = await handle(
        new Request(`${ORIGIN}/api/auth/callback/google?${query}`, {
          headers: { cookie: [...cookies, sessionCookie].filter(Boolean).join("; ") },
        }),
      );
      return { start, authorize, callback, location: callback.headers.get("location") ?? "" };
    }

    beforeEach(() => {
      lines = [];
      for (const level of ["log", "info", "warn", "error"] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map((a) => (a instanceof Error ? `${a.stack} ${JSON.stringify(a.cause)}` : String(a))).join(" "));
        });
      }
    });
    afterEach(() => vi.restoreAllMocks());

    describe("google-provider", () => {
      it("the authorization request asks for openid email, prompt=select_account, PKCE S256, and no hd", async () => {
        const { start, authorize } = await googleSignIn({
          sub: sub(),
          email: "jeremy@bikegr.org",
          email_verified: true,
          hd: "bikegr.org",
        });
        expect(start.status).toBe(302);
        expect(`${authorize.origin}${authorize.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
        expect(authorize.searchParams.get("client_id")).toBe(GOOGLE_CLIENT_ID);
        expect(authorize.searchParams.get("scope")).toBe("openid email");
        expect(authorize.searchParams.get("prompt")).toBe("select_account");
        expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/google`);
        expect(authorize.searchParams.has("hd")).toBe(false);
        expect(fakeGoogle.tokenRequests.at(-1)?.get("code_verifier")).toMatch(/^\S{43,}$/);
      });

      it("with no Google credentials, the only provider is Resend, and /api/auth/signin/google makes no redirect to Google", async () => {
        google = null;
        const providers = (await (await handle(new Request(`${ORIGIN}/api/auth/providers`))).json()) as object;
        expect(Object.keys(providers)).toEqual(["resend"]);

        const { start } = await startGoogle();
        expect(start.headers.get("location") ?? "").not.toContain("accounts.google.com");
      });

      it("a cancel at Google redirects to /login?error=OAuthCallbackError and logs one warn line with no stack", async () => {
        const { location } = await googleSignIn(
          { sub: sub(), email: "jeremy@bikegr.org" },
          { params: { error: "access_denied" } },
        );
        expect(location).toBe(`${ORIGIN}/login?error=OAuthCallbackError`);
        expect(lines).toEqual(["[auth] OAuthCallbackError"]);
      });

      it("a callback with no PKCE cookie (InvalidCheck) logs one warn line with no stack", async () => {
        const editor = await addEditor("no.pkce.rider@gmail.com");
        await startGoogle();
        const code = fakeGoogle.issueCode({ sub: sub(), email: editor.email, email_verified: true });
        const res = await handle(new Request(`${ORIGIN}/api/auth/callback/google?code=${code}`));
        expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=Configuration`);
        expect(lines).toEqual(["[auth] InvalidCheck"]);
        expect(await countFor(authSessions, editor.id)).toBe(0);
      });

      it("a replayed code logs one warn line with no stack, with the OAuth error code", async () => {
        const editor = await addEditor("replay.rider@gmail.com");
        const { cookies } = await startGoogle();
        const code = fakeGoogle.issueCode({ sub: sub(), email: editor.email, email_verified: true });
        const callback = () =>
          handle(new Request(`${ORIGIN}/api/auth/callback/google?code=${code}`, { headers: { cookie: cookies.join("; ") } }));
        expect((await callback()).headers.get("location")).toBe(`${ORIGIN}/admin`);
        expect(lines).toEqual([]);

        const replay = await callback();
        expect(replay.headers.get("location")).toBe(`${ORIGIN}/login?error=Configuration`);
        expect(lines).toEqual(["[auth] CallbackRouteError: OAUTH_RESPONSE_BODY_ERROR (invalid_grant)"]);
        expect(await countFor(authSessions, editor.id)).toBe(1);
      });
    });

    describe("google-invite-only", () => {
      it("a Google email that is not an Editor is refused with AccessDenied, and writes no editors row, no auth_accounts row, and no session", async () => {
        const [before] = await db.select({ n: sql<number>`count(*)::int` }).from(editors);
        const { location } = await googleSignIn({ sub: sub(), email: "stranger@gmail.com", email_verified: true });
        expect(location).toBe(`${ORIGIN}/login?error=AccessDenied`);
        const [after] = await db.select({ n: sql<number>`count(*)::int` }).from(editors);
        expect(after.n).toBe(before.n);
        expect(await db.select().from(authAccounts)).toEqual([]);
        expect(await countRows(authSessions)).toBe(0);
      });

      it("email_verified false is refused, also for an Editor's email", async () => {
        const editor = await addEditor("unverified.rider@gmail.com");
        const { location } = await googleSignIn({ sub: sub(), email: editor.email, email_verified: false });
        expect(location).toBe(`${ORIGIN}/login?error=AccessDenied`);
        expect(await countFor(authAccounts, editor.id)).toBe(0);
        expect(await countRows(authSessions)).toBe(0);
      });

      it("a Google account that is not authoritative for its email is refused", async () => {
        const yahoo = await addEditor("rider@yahoo.example");
        const workspace = await addEditor("pat@bikegr.org");
        const results = [
          await googleSignIn({ sub: sub(), email: yahoo.email, email_verified: true }),
          await googleSignIn({ sub: sub(), email: workspace.email, email_verified: true, hd: "other.example" }),
          await googleSignIn({ sub: sub(), email: workspace.email, email_verified: true }),
        ];
        for (const { location } of results) expect(location).toBe(`${ORIGIN}/login?error=AccessDenied`);
        expect(await db.select().from(authAccounts)).toEqual([]);
        expect(await countRows(authSessions)).toBe(0);
      });

      it("a deactivated Editor's linked Google account is refused and makes no session", async () => {
        const editor = await addEditor("deactivated.rider@gmail.com");
        const claims = { sub: sub(), email: editor.email, email_verified: true };
        await googleSignIn(claims);
        expect(await countFor(authAccounts, editor.id)).toBe(1);
        await db.delete(authSessions);
        await db.update(editors).set({ deactivatedAt: new Date() }).where(eq(editors.id, editor.id));

        const { location } = await googleSignIn(claims);
        expect(location).toBe(`${ORIGIN}/login?error=AccessDenied`);
        expect(await countRows(authSessions)).toBe(0);
      });

      it("a refused Google sign-in logs no email", async () => {
        await googleSignIn({ sub: sub(), email: "stranger@gmail.com", email_verified: true });
        await googleSignIn({ sub: sub(), email: "jeremy@bikegr.org", email_verified: false, hd: "bikegr.org" });
        expect(lines).toContain("[auth] Refused sign-in: not an active Editor.");
        expect(lines).toContain("[auth] Refused Google sign-in: Google does not vouch for the email.");
        for (const line of lines) {
          expect(line).not.toContain("stranger");
          expect(line).not.toContain("jeremy");
        }
      });

      it("the adapter's createUser throws", async () => {
        const config = buildAuthConfig({ db, mailer, getClientIp: async () => null, google: null });
        await expect(
          config.adapter!.createUser!({ id: "x", email: "stranger@gmail.com", emailVerified: null }),
        ).rejects.toThrow("Auth.js must not create an Editor");
        expect(await findByEmail("stranger@gmail.com")).toBeUndefined();
      });

      it("a Google sign-in writes no rate_limits row", async () => {
        const editor = await addEditor("rate.rider@gmail.com");
        const ip = { "x-forwarded-for": "203.0.113.7" };
        const { cookies } = await startGoogle(ip);
        const code = fakeGoogle.issueCode({ sub: sub(), email: editor.email, email_verified: true });
        await handle(
          new Request(`${ORIGIN}/api/auth/callback/google?code=${code}`, {
            headers: { ...ip, cookie: cookies.join("; ") },
          }),
        );
        expect(await countFor(authSessions, editor.id)).toBe(1);
        expect(await db.select().from(rateLimits)).toEqual([]);
      });
    });

    describe("google-account-linking", () => {
      it("an active Editor's first Google sign-in links the account, makes a session, and redirects to /admin", async () => {
        const editor = await addEditor("first.rider@gmail.com");
        const googleSub = sub();
        const { location, callback } = await googleSignIn({ sub: googleSub, email: editor.email, email_verified: true });
        expect(location).toBe(`${ORIGIN}/admin`);
        expect(callback.headers.getSetCookie().some((c) => c.startsWith("authjs.session-token="))).toBe(true);
        expect(await countFor(authSessions, editor.id)).toBe(1);
        expect(await db.select().from(authAccounts)).toEqual([
          {
            userId: editor.id,
            type: "oidc",
            provider: "google",
            providerAccountId: googleSub,
            refresh_token: null,
            access_token: null,
            expires_at: null,
            token_type: null,
            scope: null,
            id_token: null,
            session_state: null,
          },
        ]);
      });

      it("the second Google sign-in uses the link and adds no row", async () => {
        const editor = await addEditor("second.rider@gmail.com");
        const claims = { sub: sub(), email: editor.email, email_verified: true };
        await googleSignIn(claims);
        const { location } = await googleSignIn(claims);
        expect(location).toBe(`${ORIGIN}/admin`);
        expect(await countFor(authAccounts, editor.id)).toBe(1);
        expect(await countFor(authSessions, editor.id)).toBe(2);
      });

      it("a linked account still signs in after its Google email changes (the link is by sub)", async () => {
        const editor = await addEditor("renamed.rider@gmail.com");
        const googleSub = sub();
        await googleSignIn({ sub: googleSub, email: editor.email, email_verified: true });
        const { location } = await googleSignIn({ sub: googleSub, email: "new.name@gmail.com", email_verified: true });
        expect(location).toBe(`${ORIGIN}/admin`);
        expect(await countFor(authSessions, editor.id)).toBe(2);
        expect(await findByEmail("new.name@gmail.com")).toBeUndefined();
      });

      it("an upper-case Google email matches the Editor", async () => {
        const editor = await addEditor("pat.upper@bikegr.org");
        const { location } = await googleSignIn({
          sub: sub(),
          email: "Pat.Upper@BikeGR.org",
          email_verified: true,
          hd: "bikegr.org",
        });
        expect(location).toBe(`${ORIGIN}/admin`);
        expect(await countFor(authAccounts, editor.id)).toBe(1);
      });

      it("the first Google sign-in sets emailVerified; the next magic link has the kind sign-in", async () => {
        const editor = await addEditor("invited.rider@gmail.com");
        expect(editor.emailVerified).toBeNull();
        await googleSignIn({ sub: sub(), email: editor.email, email_verified: true });
        expect((await findByEmail(editor.email))?.emailVerified).toBeInstanceOf(Date);

        await requestLink(editor.email);
        expect(sent.at(-1)).toMatchObject({ to: editor.email, kind: "sign-in" });
      });

      it("an Editor's invite email that differs from the Google email is refused", async () => {
        const editor = await addEditor("pat@company.example");
        const { location } = await googleSignIn({ sub: sub(), email: "pat.rides@gmail.com", email_verified: true });
        expect(location).toBe(`${ORIGIN}/login?error=AccessDenied`);
        expect(await countFor(authAccounts, editor.id)).toBe(0);
        expect(await countRows(authSessions)).toBe(0);
      });

      it("signed in as Editor A, a Google sign-in as Editor B gets OAuthAccountNotLinked; A's session is unchanged, and no Google link points to A", async () => {
        const a = await addEditor("editor.a@gmail.com");
        const b = await addEditor("editor.b@gmail.com");
        const sessionToken = "session-of-editor-a";
        const expires = new Date(Date.now() + 3600_000);
        await db.insert(authSessions).values({ sessionToken, userId: a.id, expires });

        const { location } = await googleSignIn(
          { sub: sub(), email: b.email, email_verified: true },
          { sessionCookie: `authjs.session-token=${sessionToken}` },
        );
        expect(location).toBe(`${ORIGIN}/login?error=OAuthAccountNotLinked`);
        expect(await countFor(authAccounts, a.id)).toBe(0);
        expect(await db.select().from(authSessions)).toEqual([{ sessionToken, userId: a.id, expires }]);
        expect(lines).toContain("[auth] OAuthAccountNotLinked");
      });
    });
  });
});
