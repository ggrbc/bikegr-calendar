"use client";

import { useState } from "react";
import { EventForm, type EventFormProps } from "./event-form";
import { ReviewPanel } from "./review-panel";

/**
 * A Submission that waits for review: the Review panel and the full Event form (also for a Series:
 * the time and the rule change in place while the Event is pending). Approve waits until the form
 * has no unsaved changes, so an Editor never approves text that is not saved.
 */
export function PendingReview({
  allPast,
  ...form
}: Omit<EventFormProps, "mode" | "scope" | "onDirtyChange"> & { id: string; version: number; allPast: boolean }) {
  const [dirty, setDirty] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <ReviewPanel id={form.id} version={form.version} reviewStatus="pending" dirty={dirty} allPast={allPast} imageRemoved={false} />
      <EventForm {...form} mode="edit" scope="pending" onDirtyChange={setDirty} />
    </div>
  );
}
