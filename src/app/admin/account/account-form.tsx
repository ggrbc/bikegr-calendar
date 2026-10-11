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
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <NameField id="account-name" defaultValue={name} />
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
