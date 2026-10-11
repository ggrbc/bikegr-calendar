import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { accessRedirect, MY_EVENTS_PATH } from "./access";

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

/**
 * Every Editor page and server action must call `requireEditor` or `requireAdmin`, which refuse an
 * Event manager. The list is built from the file system, so a new action without a check fails.
 * Only sign out, the account page, and the My Events files may use the looser checks.
 */
const ROOT = join(__dirname, "..");
const MANAGER_SAFE = [/^app\/admin\/actions\.ts$/, /^app\/admin\/account\//, /^app\/admin\/my-events\//];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = [...walk(join(ROOT, "app/admin")), ...walk(join(ROOT, "admin/images"))]
  .map((path) => relative(ROOT, path))
  .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.test\./.test(path));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const isGuarded = (path: string) => !MANAGER_SAFE.some((re) => re.test(path));

describe("every Editor route and action refuses an Event manager", () => {
  const actionFiles = files.filter((p) => /^\s*["']use server["']/m.test(read(p)));
  const pageFiles = files.filter((p) => /\/page\.tsx$/.test(p));

  it("finds the files", () => {
    expect(actionFiles.length).toBeGreaterThan(5);
    expect(pageFiles.length).toBeGreaterThan(5);
  });

  for (const path of actionFiles.filter(isGuarded)) {
    it(`each action in ${path} calls requireEditor or requireAdmin`, () => {
      const source = read(path);
      const exported = source.match(/^export async function \w+/gm)?.length ?? 0;
      const guards = source.match(/await require(Editor|Admin)\(\)/g)?.length ?? 0;
      expect(guards).toBeGreaterThanOrEqual(exported);
      expect(source).not.toMatch(/requireSignedIn|requireEventManager|getCurrentEditor/);
    });
  }

  for (const path of pageFiles.filter(isGuarded)) {
    it(`${path} calls requireEditor or requireAdmin`, () => {
      const source = read(path);
      expect(source).toMatch(/require(Editor|Admin)\(\)/);
      expect(source).not.toMatch(/requireSignedIn|requireEventManager|getCurrentEditor/);
    });
  }

  it("a page that renders another file's guard is named here", () => {
    // None today: a page that guards in a child component would fail the page test above.
    expect(pageFiles.filter(isGuarded).every((p) => /require(Editor|Admin)\(\)/.test(read(p)))).toBe(true);
  });
});
