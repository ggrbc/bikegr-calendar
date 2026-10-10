/**
 * Integration test of the Auth.js wiring: the real `Auth()` handler, the Drizzle adapter on PGlite
 * (real migrations), and a mock mailer.
 */
import { Auth } from "@auth/core";
import { AdapterError } from "@auth/core/errors";
import { DrizzleQueryError, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authSessions, authVerificationTokens, editors, rateLimits } from "@/db/schema";
import { seedAdmins } from "@/db/seed-admins";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { clientIp } from "@/rate-limit";
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

  /** As src/auth/index.ts does for the route handler: the IP comes from the request headers. */
  function handle(request: Request, database: Db = db) {
    return Auth(request, {
      ...buildAuthConfig({
        db: database,
        mailer,
        getClientIp: async () => clientIp(request.headers),
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
    await db.delete(rateLimits);
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
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-10T12:20:00Z") });
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
});
