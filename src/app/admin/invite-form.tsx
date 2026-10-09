"use client";

import { useActionState } from "react";
import { inviteEditorAction, type InviteState } from "./actions";

const initial: InviteState = { status: "idle" };

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteEditorAction, initial);

  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <label htmlFor="invite-email" className="font-medium">
        Email
      </label>
      <input
        id="invite-email"
        name="email"
        type="email"
        required
        className="rounded border border-gray-400 px-3 py-2"
      />
      <label htmlFor="invite-name" className="font-medium">
        Name (optional)
      </label>
      <input id="invite-name" name="name" type="text" className="rounded border border-gray-400 px-3 py-2" />
      <label htmlFor="invite-role" className="font-medium">
        Role
      </label>
      <select
        id="invite-role"
        name="role"
        defaultValue="editor"
        className="rounded border border-gray-400 px-3 py-2"
      >
        <option value="editor">Editor</option>
        <option value="admin">Admin</option>
      </select>
      {state.status === "error" && (
        <p role="alert" className="text-red-700">
          {state.message}
        </p>
      )}
      {state.status === "sent" && (
        <p role="status" className="text-green-800">
          Invite sent to {state.email}.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send invite"}
      </button>
    </form>
  );
}
