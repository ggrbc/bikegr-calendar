import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { accessRedirect, MY_EVENTS_PATH } from "./access";

// ---------------------------------------------------------------------------------------------
// Mocks for the behavioral test below. The session is an active Event manager. The database throws
// on any use, so an action or page that gets past the guard and reads or writes fails the test.

const mocks = vi.hoisted(() => ({
  dbCalls: [] as string[],
  tracked: false,
}));

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new Error("notFound before the guard");
  },
}));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, io: async () => {}, updateTag: () => {} }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@vercel/blob", () => ({ del: async () => {}, put: async () => ({}) }));
vi.mock("@/agenda/cache", () => ({ invalidatePublicEvents: () => {} }));
vi.mock("@/auth", () => ({
  LOGIN_PATH: "/login",
  auth: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }),
  signIn: async () => {},
  signOut: async () => {},
}));
vi.mock("@/auth/editors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editors")>()),
  findEditorById: async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    email: "manager@example.org",
    name: "Manager",
    role: "event_manager",
    deactivatedAt: null,
  }),
}));
vi.mock("@/db", () => ({
  getDb: () => {
    mocks.dbCalls.push("getDb");
    return new Proxy({}, {
      get: () => {
        throw new Error("database used before the guard refused an Event manager");
      },
    });
  },
}));

describe("accessRedirect", () => {
  it("sends an Event manager away from every Editor and Admin page", () => {
    expect(accessRedirect("event_manager", "editor")).toBe(MY_EVENTS_PATH);
    expect(accessRedirect("event_manager", "admin")).toBe(MY_EVENTS_PATH);
  });

  it("lets Editors and Admins keep their rights", () => {
    expect(accessRedirect("editor", "editor")).toBeNull();
    expect(accessRedirect("admin", "editor")).toBeNull();
    expect(accessRedirect("admin", "admin")).toBeNull();
    expect(accessRedirect("editor", "admin")).toBe("/admin");
  });

  it("lets only an Event manager use the manager pages", () => {
    expect(accessRedirect("event_manager", "event-manager")).toBeNull();
    expect(accessRedirect("editor", "event-manager")).toBe("/admin");
    expect(accessRedirect("admin", "event-manager")).toBe("/admin");
  });

  it("lets every role open the signed-in pages", () => {
    for (const role of ["admin", "editor", "event_manager"] as const) {
      expect(accessRedirect(role, "signed-in")).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Every Editor page, server action, and route handler refuses an Event manager. The files come from
// the file system, so a new one is tested without a change here. Only sign out, the account page,
// and the My Events files are open to a manager.

const MANAGER_OPEN = [/\/app\/admin\/actions\.ts$/, /\/app\/admin\/account\//, /\/app\/admin\/my-events\//];
const isOpen = (path: string) => MANAGER_OPEN.some((re) => re.test(path));

const sources = import.meta.glob(
  ["/src/app/admin/**/*.{ts,tsx}", "/src/admin/images/actions.ts", "!/**/*.test.*"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;
const loaders = import.meta.glob(
  ["/src/app/admin/**/*.{ts,tsx}", "/src/admin/images/actions.ts", "!/**/*.test.*"],
) as Record<string, () => Promise<Record<string, unknown>>>;

const isAction = (path: string) => /^\s*["']use server["']/m.test(sources[path]);
const isPage = (path: string) => /\/page\.tsx$/.test(path);
const isRoute = (path: string) => /\/route\.ts$/.test(path);

const PARAMS = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  editorId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  eventId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  start: "2026-10-14T1800",
};

/** The redirect of a call, or null when it did not redirect. Any other error fails the test. */
async function redirectOf(run: () => unknown): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
}

/**
 * Runs a page like the server does, in a small way: server components that are `async` are called
 * (the guard is inside one), and everything else is only walked. Returns the first redirect.
 */
async function renderUntilRedirect(node: ReactNode): Promise<string | null> {
  if (Array.isArray(node)) {
    for (const child of node) {
      const url = await renderUntilRedirect(child);
      if (url) return url;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const { type, props } = node as { type: unknown; props: Record<string, unknown> };
  let next: ReactNode = props.children as ReactNode;
  if (typeof type === "function") {
    if (type.constructor.name === "AsyncFunction") {
      const url = await redirectOf(async () => {
        next = (await (type as (p: unknown) => Promise<ReactNode>)(props)) as ReactNode;
      });
      if (url) return url;
    } else {
      // A sync component (a layout piece or a client component): do not call it, look at its slots.
      next = Object.values(props).filter((v) => isValidElement(v) || Array.isArray(v)) as ReactNode;
    }
  }
  return renderUntilRedirect(next);
}

describe("every Editor route and action refuses an Event manager", () => {
  const paths = Object.keys(sources).sort();
  const guarded = paths.filter((p) => !isOpen(p));

  it("finds the files", () => {
    expect(paths.filter(isAction).length).toBeGreaterThan(5);
    expect(paths.filter(isPage).length).toBeGreaterThan(5);
  });

  for (const path of guarded.filter(isAction)) {
    it(`each action in ${path} redirects an Event manager to My Events`, async () => {
      const loaded = await loaders[path]();
      const actions = Object.entries(loaded).filter(([, value]) => typeof value === "function");
      expect(actions.length).toBeGreaterThan(0);
      for (const [name, action] of actions) {
        // (previous state, form data or input): every action takes one of these shapes.
        const url = await redirectOf(() => (action as (...a: unknown[]) => unknown)({ result: "idle" }, new FormData()));
        expect(url, `${path} ${name}`).toBe(MY_EVENTS_PATH);
      }
    });
  }

  for (const path of guarded.filter(isPage)) {
    it(`${path} redirects an Event manager to My Events`, async () => {
      const page = (await loaders[path]()).default as (props: unknown) => ReactNode;
      const url = await renderUntilRedirect(
        page({ params: Promise.resolve(PARAMS), searchParams: Promise.resolve({}) }),
      );
      expect(url).toBe(MY_EVENTS_PATH);
    });
  }

  for (const path of guarded.filter(isRoute)) {
    it(`each handler in ${path} refuses an Event manager`, async () => {
      const loaded = await loaders[path]();
      for (const [name, handler] of Object.entries(loaded)) {
        if (typeof handler !== "function") continue;
        const url = await redirectOf(() =>
          (handler as (r: Request) => unknown)(new Request("http://localhost/admin/x", { method: name })),
        );
        expect(url, `${path} ${name}`).toBe(MY_EVENTS_PATH);
      }
    });
  }

  it("the files that are open to a manager use the looser guards", () => {
    for (const path of paths.filter(isOpen).filter((p) => isAction(p) || isPage(p))) {
      if (/\/app\/admin\/actions\.ts$/.test(path)) continue; // sign out: no guard, only ends the session
      expect(sources[path], path).toMatch(/require(EventManager|SignedIn)\(\)/);
    }
  });
});
