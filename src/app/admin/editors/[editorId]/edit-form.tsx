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

/** Name, Role (when allowed), and one Save. The role select is left out, not disabled, on the Admin's own page. */
export function EditForm({ editorId, name, role, roleLabels }: EditFormProps) {
  const [state, action, pending] = useActionState(saveEditorAction, idle);
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="editorId" value={editorId} />
      <NameField id="editor-name" defaultValue={name} />
      {role && (
        <>
          <label htmlFor="editor-role" className={labelClass}>
            Role
          </label>
          <select id="editor-role" name="role" defaultValue={role} key={role} className={inputClass}>
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
