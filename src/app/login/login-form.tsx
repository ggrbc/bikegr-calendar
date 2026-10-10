"use client";

import { useActionState } from "react";
import { requestMagicLink, type LoginState } from "./actions";

const initial: LoginState = { result: "idle" };

export function LoginForm() {
  const [state, action, pending] = useActionState(requestMagicLink, initial);

  if (state.result === "sent") {
    return (
      <p role="status" className="rounded border border-green-700 bg-green-50 p-4 text-green-900">
        If <strong>{state.email}</strong> belongs to an Editor, we sent a sign-in link. No email?
        Ask an Admin.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="font-medium">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="rounded border border-gray-400 px-3 py-2"
      />
      {state.result === "error" && (
        <p role="alert" className="text-red-700">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send sign-in link"}
      </button>
    </form>
  );
}
