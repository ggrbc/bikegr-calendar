"use client";

import { useActionState } from "react";
import { requestMagicLink, type LoginState } from "./actions";

const initial: LoginState = { result: "idle" };

const input =
  "w-full rounded-[6px] border border-[#858486] bg-white px-4 py-2 text-[15.84px] font-light text-brand-gray";
/** The bikegr.org pill. White text on `brand-orange-text` is 5.07:1 (the AA rule in design.md). */
const pillButton =
  "inline-flex w-full items-center justify-center rounded-[300px] bg-brand-orange-text px-[28px] py-[12px] font-chivo text-[14px] uppercase tracking-[0.02em] text-white hover:bg-brand-gray disabled:opacity-60";

export function LoginForm() {
  const [state, action, pending] = useActionState(requestMagicLink, initial);

  if (state.result === "sent") {
    return (
      <p role="status" className="border-l-4 border-brand-green bg-white px-4 py-3 font-normal">
        If <strong className="font-semibold">{state.email}</strong> belongs to an Editor, we sent a sign-in link.
        No email? Ask an Admin.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="font-normal">
        Email
      </label>
      <input id="email" name="email" type="email" autoComplete="email" required className={input} />
      {state.result === "error" && (
        <p role="alert" className="font-normal text-brand-orange-text">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className={`mt-2 ${pillButton}`}>
        {pending ? "Sending…" : "Send sign-in link"}
      </button>
    </form>
  );
}
