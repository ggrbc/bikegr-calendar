import { type FormEvent, startTransition } from "react";

/**
 * Submits a controlled form through `onSubmit`. React 19 resets a `<form action>` after its action
 * ends, which sets a controlled `<select>` back to its first option while the state keeps the old
 * value. With `onSubmit` there is no reset, and the form keeps what the person typed. The dispatch
 * of `useActionState` must run inside a transition.
 */
export function submitForm(event: FormEvent<HTMLFormElement>, submit: () => void): void {
  event.preventDefault();
  startTransition(submit);
}
