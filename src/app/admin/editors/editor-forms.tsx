"use client";

import { useActionState } from "react";
import type { EditorRole } from "@/db/schema";
import { changeRoleAction, deactivateAction, type EditorFormState, reactivateAction } from "./actions";

const idle: EditorFormState = { result: "idle" };
const button = "rounded border border-gray-500 px-3 py-1 disabled:opacity-60";

function Message({ state }: { state: EditorFormState }) {
  if (state.result === "error") {
    return (
      <p role="alert" className="text-sm text-red-700">
        {state.message}
      </p>
    );
  }
  if (state.result === "ok") {
    return (
      <p role="status" className="text-sm text-green-800">
        {state.message}
      </p>
    );
  }
  return null;
}

export interface EditorActionsProps {
  editor: { id: string; label: string; role: EditorRole; deactivated: boolean };
}

/** Role change, deactivate, or reactivate for one Editor row (never the current Admin's own row). */
export function EditorActions({ editor }: EditorActionsProps) {
  const [roleState, roleAction, changingRole] = useActionState(changeRoleAction, idle);
  const [deactivateState, deactivateFormAction, deactivating] = useActionState(deactivateAction, idle);
  const [reactivateState, reactivateFormAction, reactivating] = useActionState(reactivateAction, idle);

  function confirmDeactivate(event: React.FormEvent<HTMLFormElement>) {
    const question = `Deactivate ${editor.label}? They are signed out at once and cannot sign in until an Admin reactivates them.`;
    if (!window.confirm(question)) event.preventDefault();
  }

  if (editor.deactivated) {
    return (
      <div className="flex flex-col gap-2">
        <form action={reactivateFormAction}>
          <input type="hidden" name="editorId" value={editor.id} />
          <button type="submit" disabled={reactivating} className={button}>
            Reactivate
          </button>
        </form>
        <Message state={reactivateState} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={roleAction} className="flex gap-2">
          <input type="hidden" name="editorId" value={editor.id} />
          <label className="sr-only" htmlFor={`role-${editor.id}`}>
            Role of {editor.label}
          </label>
          <select
            id={`role-${editor.id}`}
            name="role"
            defaultValue={editor.role}
            key={editor.role}
            className="rounded border border-gray-400 px-2 py-1"
          >
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" disabled={changingRole} className={button}>
            Change role
          </button>
        </form>
        <form action={deactivateFormAction} onSubmit={confirmDeactivate}>
          <input type="hidden" name="editorId" value={editor.id} />
          <button type="submit" disabled={deactivating} className={button}>
            Deactivate
          </button>
        </form>
      </div>
      <Message state={roleState} />
      <Message state={deactivateState} />
    </div>
  );
}
