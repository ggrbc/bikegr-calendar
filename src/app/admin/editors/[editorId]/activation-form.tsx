"use client";

import { useActionState } from "react";
import { buttonClass } from "../../_components/ui";
import { editorRowAction, type EditorFormState } from "../actions";
import { FormMessage } from "../form-message";

const idle: EditorFormState = { result: "idle" };

/** Deactivate (with the confirm dialog) or Reactivate. Never shown on the Admin's own page. */
export function ActivationForm({
  editorId,
  label,
  deactivated,
}: {
  editorId: string;
  label: string;
  deactivated: boolean;
}) {
  const [state, action, pending] = useActionState(editorRowAction, idle);

  function confirmDeactivate(event: React.FormEvent<HTMLFormElement>) {
    const question = `Deactivate ${label}? They are signed out at once and cannot sign in until an Admin reactivates them.`;
    if (!window.confirm(question)) event.preventDefault();
  }

  return (
    <form action={action} onSubmit={deactivated ? undefined : confirmDeactivate} className="flex flex-col gap-3">
      <input type="hidden" name="editorId" value={editorId} />
      <input type="hidden" name="intent" value={deactivated ? "reactivate" : "deactivate"} />
      <FormMessage state={state} />
      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass(deactivated ? "secondary" : "danger")} self-start`}
      >
        {deactivated ? "Reactivate" : "Deactivate"}
      </button>
    </form>
  );
}
