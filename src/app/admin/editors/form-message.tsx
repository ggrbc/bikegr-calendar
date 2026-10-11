import type { EditorFormState } from "./actions";

/** The result line under an Editor form: an error alert, or a status. Nothing before a submit. */
export function FormMessage({ state }: { state: EditorFormState }) {
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
