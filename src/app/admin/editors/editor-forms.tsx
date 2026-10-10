"use client";

import { useActionState } from "react";
import type { EditorRole } from "@/db/schema";
import { buttonClass, smallInputClass } from "../_components/ui";
import { editorRowAction, type EditorFormState } from "./actions";

const idle: EditorFormState = { result: "idle" };
const button = buttonClass("secondary", "sm");

function Message({ state }: { state: EditorFormState }) {
  if (state.result === "error") {
    return (
      <p role="alert" className="text-sm font-semibold text-red-700">
        {state.message}
      </p>
    );
  }
  if (state.result === "ok") {
    return (
      <p role="status" className="text-sm font-semibold text-[#4d5822]">
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
  // One action for the row, so the row shows only the last message.
  const [state, action, pending] = useActionState(editorRowAction, idle);

  function confirmDeactivate(event: React.FormEvent<HTMLFormElement>) {
    const question = `Deactivate ${editor.label}? They are signed out at once and cannot sign in until an Admin reactivates them.`;
    if (!window.confirm(question)) event.preventDefault();
  }

  return (
    <div className="flex flex-col gap-2">
      {editor.deactivated ? (
        <form action={action}>
          <input type="hidden" name="editorId" value={editor.id} />
          <input type="hidden" name="intent" value="reactivate" />
          <button type="submit" disabled={pending} className={button}>
            Reactivate
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <form action={action} className="flex gap-2">
            <input type="hidden" name="editorId" value={editor.id} />
            <input type="hidden" name="intent" value="role" />
            <label className="sr-only" htmlFor={`role-${editor.id}`}>
              Role of {editor.label}
            </label>
            <select
              id={`role-${editor.id}`}
              name="role"
              defaultValue={editor.role}
              key={editor.role}
              className={smallInputClass}
            >
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit" disabled={pending} className={button}>
              Change role
            </button>
          </form>
          <form action={action} onSubmit={confirmDeactivate}>
            <input type="hidden" name="editorId" value={editor.id} />
            <input type="hidden" name="intent" value="deactivate" />
            <button type="submit" disabled={pending} className={buttonClass("danger", "sm")}>
              Deactivate
            </button>
          </form>
        </div>
      )}
      <Message state={state} />
    </div>
  );
}
