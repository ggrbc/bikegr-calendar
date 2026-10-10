"use client";

import { useActionState } from "react";
import { deleteEventAction, restoreEventAction, type SaveState } from "../actions";
import { buttonClass, hintClass, panelClass } from "../../_components/ui";
import { IDLE, SaveStatus } from "./save-status";

/** Delete (Editors) a whole Event; on a deleted Event, Restore (Admins). */
export function DeleteRestore({
  id,
  version,
  deleted,
  isAdmin,
}: {
  id: string;
  version: number;
  deleted: boolean;
  isAdmin: boolean;
}) {
  const [state, dispatch, pending] = useActionState<SaveState, unknown>(
    deleted ? restoreEventAction : deleteEventAction,
    IDLE,
  );
  if (deleted && !isAdmin) return <SaveStatus state={state} />;
  return (
    <div className={`${panelClass} flex flex-col gap-3`}>
      <SaveStatus state={state} />
      <form
        action={() => {
          if (deleted || window.confirm("Delete the whole Event? It is hidden everywhere. An Admin can restore it.")) {
            dispatch({ id, version });
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          className={deleted ? buttonClass("primary") : buttonClass("danger")}
        >
          {deleted ? "Restore this Event" : "Delete this Event"}
        </button>
      </form>
      {!deleted && (
        <p className={hintClass}>
          Delete only an Event that should not exist (a duplicate, a test, spam). To show that a date will
          not happen, cancel that date instead.
        </p>
      )}
    </div>
  );
}
