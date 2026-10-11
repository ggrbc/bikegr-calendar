"use client";

import { useActionState } from "react";
import { buttonClass, hintClass, inputClass, labelClass, Notice } from "../../_components/ui";
import { addManagerAction, removeManagerAction, type ManagerFormState } from "../managers-actions";

const idle: ManagerFormState = { result: "idle" };

/** Email and name of a person. The name is needed only for a new person (the server checks it). */
export function AddManagerForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(addManagerAction, idle);
  // After a refusal React 19 resets the form; a new key takes the posted values as the defaults.
  const values = state.result === "error" ? state.values : undefined;
  const key = state.result === "idle" ? "idle" : state.stamp;
  return (
    <form action={action} key={key} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="eventId" value={eventId} />
      <label htmlFor="manager-email" className={labelClass}>
        Email
      </label>
      <input
        id="manager-email"
        name="email"
        type="email"
        required
        autoComplete="off"
        defaultValue={values?.email}
        className={inputClass}
      />
      <label htmlFor="manager-name" className={labelClass}>
        Name
      </label>
      <input
        id="manager-name"
        name="name"
        type="text"
        autoComplete="off"
        defaultValue={values?.name}
        aria-describedby="manager-name-hint"
        className={inputClass}
      />
      <p id="manager-name-hint" className={hintClass}>
        Needed for a new person. A person with an account gets this Event added and an email.
      </p>
      {state.result === "error" && (
        <Notice tone="error" role="alert">
          {state.message}
        </Notice>
      )}
      {state.result === "ok" && (
        <Notice tone="success" role="status">
          {state.message}
        </Notice>
      )}
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? "Adding…" : "Add manager"}
      </button>
    </form>
  );
}

export function RemoveManagerForm({ eventId, editorId, label }: { eventId: string; editorId: string; label: string }) {
  const [state, action, pending] = useActionState(removeManagerAction, idle);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Remove ${label} as a manager of this Event?`)) event.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="editorId" value={editorId} />
      {state.result === "error" && (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("secondary", "sm")}
        aria-label={`Remove ${label}`}
      >
        Remove
      </button>
    </form>
  );
}
