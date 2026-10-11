"use client";

import { useActionState } from "react";
import { buttonClass } from "../_components/ui";
import type { EditorFormState } from "../editors/actions";
import { FormMessage } from "../editors/form-message";
import { NameField } from "../editors/name-field";
import { saveOwnNameAction } from "./actions";

const idle: EditorFormState = { result: "idle" };

export function AccountForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(saveOwnNameAction, idle);
  // `key`: React 19 resets the form after the action; a new key takes the posted text as the default.
  const key = state.result === "idle" ? "idle" : state.stamp;
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <NameField key={key} id="account-name" defaultValue={state.result === "idle" ? name : (state.values?.name ?? name)} />
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
