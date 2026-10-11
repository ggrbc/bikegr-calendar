"use client";

import { useActionState } from "react";
import type { EditorRole } from "@/db/schema";
import { buttonClass, inputClass, labelClass, mutedClass } from "../../_components/ui";
import { saveEditorAction, type EditorFormState } from "../actions";
import { FormMessage } from "../form-message";
import { NameField } from "../name-field";

const idle: EditorFormState = { result: "idle" };

export interface EditFormProps {
  editorId: string;
  name: string;
  /** Present only when the Admin may change the role (an active Editor other than the Admin). */
  role?: EditorRole;
  roleLabels: Record<EditorRole, string>;
}

/**
 * Name, Role (when allowed), and one Save. The role select is left out, not disabled, on the Admin's
 * own page. The hidden `nameWas` and `roleWas` are what this form loaded with: the server writes only
 * a field that changed, and refuses the save if the stored value is not the one this form showed.
 */
export function EditForm({ editorId, name, role, roleLabels }: EditFormProps) {
  const [state, action, pending] = useActionState(saveEditorAction, idle);
  // `key`: React 19 resets the form after the action; a new key takes the posted values as defaults.
  const key = state.result === "idle" ? "idle" : state.stamp;
  const shown = state.result === "idle" ? undefined : state.values;
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="editorId" value={editorId} />
      <input type="hidden" name="nameWas" value={name} />
      {role && <input type="hidden" name="roleWas" value={role} />}
      {/* The keys include the stored values: a refreshed `*Was` never pairs with an old field value. */}
      <NameField key={`name-${key}-${name}`}id="editor-name" defaultValue={shown?.name ?? name} />
      {role && (
        <>
          <label htmlFor="editor-role" className={labelClass}>
            Role
          </label>
          <select
            key={`role-${key}-${role}`}
            id="editor-role"
            name="role"
            defaultValue={shown?.role ?? role}
            className={inputClass}
          >
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </>
      )}
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

/** A line that says why the Role cannot change (a deactivated Editor). */
export function RoleNote({ children }: { children: React.ReactNode }) {
  return <p className={`${mutedClass} text-sm`}>{children}</p>;
}
