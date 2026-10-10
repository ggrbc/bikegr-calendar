"use client";

import type { SaveState } from "../actions";

/** The result of a save. A conflict keeps the input on screen and offers a reload. */
export function SaveStatus({ state }: { state: SaveState }) {
  switch (state.status) {
    case "idle":
      return null;
    case "saved":
      return (
        <p role="status" className="rounded border border-green-700 bg-green-50 p-3 text-green-900">
          {state.message}
        </p>
      );
    case "conflict":
      return (
        <div role="alert" className="rounded border border-red-700 bg-red-50 p-3 text-red-900">
          <p>{state.message}</p>
          <p className="mt-1 text-sm">
            Your input is still in the form. A reload shows their change and removes your input.{" "}
            {/* A full reload, so the page reads the Event again. */}
            <button type="button" className="font-medium underline" onClick={() => window.location.reload()}>
              Reload
            </button>
          </p>
        </div>
      );
    case "invalid":
    case "gone":
      return (
        <p role="alert" className="rounded border border-red-700 bg-red-50 p-3 text-red-900">
          {state.message}
        </p>
      );
  }
}

export const IDLE: SaveState = { status: "idle" };
export const errorsOf = (state: SaveState) => (state.status === "invalid" ? state.errors : {});
