"use client";

import { useActionState } from "react";
import { deleteEventAction, restoreEventAction, type SaveState } from "../actions";
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
    <div className="flex flex-col gap-2">
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
          className={
            deleted
              ? "rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
              : "rounded border border-red-700 px-4 py-2 font-medium text-red-800 disabled:opacity-60"
          }
        >
          {deleted ? "Restore this Event" : "Delete this Event"}
        </button>
      </form>
      {!deleted && (
        <p className="text-sm text-gray-700">
          Delete only an Event that should not exist (a duplicate, a test, spam). To show that a date will
          not happen, cancel that date instead.
        </p>
      )}
    </div>
  );
}
