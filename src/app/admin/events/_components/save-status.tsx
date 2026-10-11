"use client";

import { buttonClass, noticeClass } from "../../_components/ui";
import type { SaveState } from "../actions";

/** The result of a save. A conflict keeps the input on screen and offers a reload. */
export function SaveStatus({ state, pending = false }: { state: SaveState; pending?: boolean }) {
  // Hidden while a save runs, so the next result is a new element and a screen reader announces it.
  if (pending) return null;
  switch (state.status) {
    case "idle":
      return null;
    case "saved":
      return (
        <p role="status" className={noticeClass("success")}>
          {state.message}
        </p>
      );
    case "conflict":
      return (
        <div role="alert" className={noticeClass("error")}>
          <p>{state.message}</p>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            Your input is still in the form. A reload shows their change and removes your input.{" "}
            {/* A full reload, so the page reads the Event again. */}
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => window.location.reload()}>
              Reload
            </button>
          </p>
        </div>
      );
    case "invalid":
    case "gone":
      return (
        <p role="alert" className={noticeClass("error")}>
          {state.message}
        </p>
      );
  }
}

export const IDLE: SaveState = { status: "idle" };
export const errorsOf = (state: SaveState) => (state.status === "invalid" ? state.errors : {});
