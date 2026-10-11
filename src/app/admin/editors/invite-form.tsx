"use client";

import { useActionState } from "react";
import { buttonClass, inputClass, labelClass, Notice } from "../_components/ui";
import { inviteEditorAction, type InviteState } from "./actions";
import { NameField } from "./name-field";

const initial: InviteState = { result: "idle" };

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteEditorAction, initial);

  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <label htmlFor="invite-email" className={labelClass}>
        Email
      </label>
      <input
        id="invite-email"
        name="email"
        type="email"
        required
        className={inputClass}
      />
      <NameField id="invite-name" />
      <label htmlFor="invite-role" className={labelClass}>
        Role
      </label>
      <select
        id="invite-role"
        name="role"
        defaultValue="editor"
        className={inputClass}
      >
        <option value="editor">Editor</option>
        <option value="admin">Admin</option>
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
