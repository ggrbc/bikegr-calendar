import { describe, expect, it } from "vitest";
import { parseInviteInput } from "@/auth/rules";
import type { EditorRole } from "@/db/schema";
import { checkRoleChange, ROLE_LABELS } from "./rules";

const person = (id: string, role: EditorRole) => ({ id, role, deactivatedAt: null });
const admin = person("admin-1", "admin");
const otherAdmin = person("admin-2", "admin");
const editor = person("editor-1", "editor");
const manager = person("manager-1", "event_manager");

describe("Event manager role rules", () => {
  it("has a role label", () => {
    expect(ROLE_LABELS.event_manager).toBe("Event manager");
  });

  it("an Admin can promote an Event manager", () => {
    expect(checkRoleChange({ actor: admin, target: manager, role: "editor", activeAdmins: 1 })).toBeNull();
    expect(checkRoleChange({ actor: admin, target: manager, role: "admin", activeAdmins: 1 })).toBeNull();
  });

  it("nobody becomes an Event manager by a role change", () => {
    expect(checkRoleChange({ actor: admin, target: editor, role: "event_manager", activeAdmins: 2 })).toMatchObject({
      reason: "not-allowed",
    });
    expect(
      checkRoleChange({ actor: admin, target: otherAdmin, role: "event_manager", activeAdmins: 2 }),
    ).toMatchObject({ reason: "not-allowed" });
  });

  it("the invite form refuses the role: managers come only from a grant", () => {
    expect(parseInviteInput({ email: "a@b.org", role: "event_manager", name: "Sam" })).toMatchObject({ ok: false });
  });
});
