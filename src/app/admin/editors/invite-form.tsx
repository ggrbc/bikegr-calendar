"use client";

import { useActionState } from "react";
import type { EditorRole } from "@/db/schema";
import { buttonClass, inputClass, labelClass, Notice } from "../_components/ui";
import { inviteEditorAction, type InviteState } from "./actions";
import { NameField } from "./name-field";

const initial: InviteState = { result: "idle" };

export function InviteForm({ roleLabels }: { roleLabels: Record<EditorRole, string> }) {
  const [state, action, pending] = useActionState(inviteEditorAction, initial);
  // After a refusal React 19 resets the form; a new key takes the posted values as the defaults.
  const values = state.result === "error" ? state.values : undefined;
  const key = state.result === "error" ? state.stamp : "initial";

  return (
    <form action={action} key={key} className="flex max-w-md flex-col gap-3">
      <label htmlFor="invite-email" className={labelClass}>
        Email
      </label>
      <input
        id="invite-email"
        name="email"
        type="email"
        required
        defaultValue={values?.email}
        className={inputClass}
      />
      <NameField id="invite-name" defaultValue={values?.name} />
      <label htmlFor="invite-role" className={labelClass}>
        Role
      </label>
      <select
        id="invite-role"
        name="role"
        defaultValue={values?.role ?? "editor"}
        className={inputClass}
      >
        {Object.entries(roleLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {state.result === "error" && (
        <Notice tone="error" role="alert">
          {state.message}
        </Notice>
      )}
      {state.result === "sent" && (
        <Notice tone="success" role="status">
          Invite sent to {state.email}.
        </Notice>
      )}
      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass("primary")} self-start`}
      >
        {pending ? "Sending…" : "Send invite"}
      </button>
    </form>
  );
}
