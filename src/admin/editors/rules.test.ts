import { describe, expect, it } from "vitest";
import type { EditorRole } from "@/db/schema";
import { checkDeactivate, checkReactivate, checkRename, checkRoleChange, parseRole, ROLE_LABELS } from "./rules";

const person = (id: string, role: EditorRole, deactivated = false) => ({
  id,
  role,
  deactivatedAt: deactivated ? new Date() : null,
});

const admin = person("admin-1", "admin");
const otherAdmin = person("admin-2", "admin");
const editor = person("editor-1", "editor");

describe("Editor rules", () => {
  it("Role change by a non-Admin is refused", () => {
    expect(checkRoleChange({ actor: editor, target: otherAdmin, role: "editor", activeAdmins: 2 })).toMatchObject({
      reason: "not-admin",
    });
    expect(
      checkRoleChange({ actor: person("x", "admin", true), target: editor, role: "admin", activeAdmins: 2 }),
    ).toMatchObject({ reason: "not-admin" });
  });

  it("Admin cannot change their own role", () => {
    expect(checkRoleChange({ actor: admin, target: admin, role: "editor", activeAdmins: 3 })).toMatchObject({
      reason: "self",
    });
  });

  it("Admin cannot deactivate themself", () => {
    expect(checkDeactivate({ actor: admin, target: admin, activeAdmins: 3 })).toMatchObject({ reason: "self" });
  });

  it("Last active Admin cannot be demoted", () => {
    expect(checkRoleChange({ actor: admin, target: otherAdmin, role: "editor", activeAdmins: 1 })).toMatchObject({
      reason: "last-admin",
    });
  });

  it("Last active Admin cannot be deactivated", () => {
    expect(checkDeactivate({ actor: admin, target: otherAdmin, activeAdmins: 1 })).toMatchObject({
      reason: "last-admin",
    });
  });

  it("Role change of a deactivated Editor is refused", () => {
    expect(
      checkRoleChange({ actor: admin, target: person("gone", "editor", true), role: "admin", activeAdmins: 2 }),
    ).toMatchObject({ reason: "deactivated" });
  });

  it("Deactivate of a deactivated Editor is refused", () => {
    expect(checkDeactivate({ actor: admin, target: person("gone", "editor", true), activeAdmins: 2 })).toMatchObject({
      reason: "deactivated",
    });
  });

  it("Admin may promote an Editor, demote another Admin, and deactivate an Editor", () => {
    expect(checkRoleChange({ actor: admin, target: editor, role: "admin", activeAdmins: 1 })).toBeNull();
    expect(checkRoleChange({ actor: admin, target: otherAdmin, role: "editor", activeAdmins: 2 })).toBeNull();
    expect(checkDeactivate({ actor: admin, target: editor, activeAdmins: 1 })).toBeNull();
    expect(checkDeactivate({ actor: admin, target: otherAdmin, activeAdmins: 2 })).toBeNull();
  });

  it("Reactivate needs an Admin and a deactivated Editor", () => {
    expect(checkReactivate({ actor: admin, target: person("gone", "editor", true) })).toBeNull();
    expect(checkReactivate({ actor: admin, target: editor })).toMatchObject({ reason: "not-deactivated" });
    expect(checkReactivate({ actor: editor, target: person("gone", "editor", true) })).toMatchObject({
      reason: "not-admin",
    });
  });

  it("Role from a form must be admin or editor", () => {
    expect(parseRole("admin")).toBe("admin");
    expect(parseRole("editor")).toBe("editor");
    expect(parseRole("owner")).toBeNull();
    expect(parseRole(null)).toBeNull();
  });

  describe("rename", () => {
    it("an active Admin renames anyone, themselves included", () => {
      expect(checkRename({ actor: admin, target: editor })).toBeNull();
      expect(checkRename({ actor: admin, target: otherAdmin })).toBeNull();
      expect(checkRename({ actor: admin, target: admin })).toBeNull();
      expect(checkRename({ actor: admin, target: person("gone", "editor", true) })).toBeNull();
    });

    it("an Editor renames only themselves", () => {
      expect(checkRename({ actor: editor, target: editor })).toBeNull();
      expect(checkRename({ actor: editor, target: otherAdmin })).toMatchObject({ reason: "not-allowed" });
      expect(checkRename({ actor: editor, target: person("editor-2", "editor") })).toMatchObject({
        reason: "not-allowed",
      });
    });

    it("a deactivated actor is refused, even for their own name", () => {
      const gone = person("gone", "editor", true);
      expect(checkRename({ actor: gone, target: gone })).toMatchObject({ reason: "not-allowed" });
      expect(checkRename({ actor: person("gone-admin", "admin", true), target: editor })).toMatchObject({
        reason: "not-allowed",
      });
    });
  });

  it("every role has a label", () => {
    expect(ROLE_LABELS).toEqual({ admin: "Admin", editor: "Editor" });
  });
});
