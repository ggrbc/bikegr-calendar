"use client";

import { useEffect } from "react";

/** Escape closes an open <details> menu and puts the focus back on its summary. */
export function EscapeCloses({ detailsId }: { detailsId: string }) {
  useEffect(() => {
    const details = document.getElementById(detailsId);
    if (!(details instanceof HTMLDetailsElement)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detailsId]);
  return null;
}
