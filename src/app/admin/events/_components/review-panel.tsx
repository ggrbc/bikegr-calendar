"use client";

import { useActionState, useId, useState } from "react";
import {
  approveSubmissionAction,
  deleteSubmissionAsSpamAction,
  rejectSubmissionAction,
  type SaveState,
} from "../actions";
import { buttonClass, h2Class, hintClass, inputClass, labelClass } from "../../_components/ui";
import { IDLE, SaveStatus } from "./save-status";

const REASON_MAX = 500;

export interface ReviewPanelProps {
  id: string;
  version: number;
  reviewStatus: "pending" | "rejected";
  /** True while the Event form has changes that are not saved: Approve waits for a Save. */
  dirty: boolean;
  /** True when the Event has no date today or later. */
  allPast: boolean;
  /** True when a Reject (or Delete as spam) removed the image, and it has no image now. */
  imageRemoved: boolean;
}

export const IMAGE_REMOVED_NOTE =
  "The image was removed when this Event was rejected. Add a new image before you approve it, if needed.";

/**
 * Approve, Reject, or Delete as spam, for a Submission that waits for review. A rejected Event
 * shows Approve only (undo a Reject).
 */
export function ReviewPanel({ id, version, reviewStatus, dirty, allPast, imageRemoved }: ReviewPanelProps) {
  const [approveState, approve, approving] = useActionState<SaveState, unknown>(approveSubmissionAction, IDLE);
  const [rejectState, reject, rejecting] = useActionState<SaveState, unknown>(rejectSubmissionAction, IDLE);
  const [spamState, spam, deleting] = useActionState<SaveState, unknown>(deleteSubmissionAsSpamAction, IDLE);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const busy = approving || rejecting || deleting;
  const pending = reviewStatus === "pending";
  const reasonError = rejectState.status === "invalid" ? rejectState.errors.reason : undefined;

  return (
    <section
      aria-labelledby={`${reasonId}-title`}
      className="flex flex-col gap-4 rounded-lg border border-brand-divider border-t-4 border-t-amber-500 bg-white p-4 sm:p-6"
    >
      <h2 id={`${reasonId}-title`} className={h2Class}>
        {pending ? "Review this Submission" : "This Submission was rejected"}
      </h2>
      <p>
        {pending
          ? "It is not public. Check it, change it if needed and save, then approve it. Reject it if it does not fit the Calendar. Delete it as spam if it is spam."
          : "It is not public. Approve it if the Reject was a mistake. The Submitter then gets the approve email."}
      </p>
      {allPast && <p className="font-semibold text-amber-900">All dates of this Event are in the past.</p>}
      {imageRemoved && <p className="font-semibold text-amber-900">{IMAGE_REMOVED_NOTE}</p>}
      <SaveStatus state={approveState} />
      <SaveStatus state={rejectState} />
      <SaveStatus state={spamState} />

      <form action={() => approve({ id, version })} className="flex flex-col gap-1">
        <div>
          <button
            type="submit"
            disabled={busy || dirty}
            className={buttonClass("approve")}
          >
            {approving ? "Approving…" : "Approve"}
          </button>
        </div>
        {dirty && <p className={hintClass}>Save your changes first. Then you can approve.</p>}
      </form>

      {pending && (
        <form
          action={() => {
            if (window.confirm("Reject this Submission? The Submitter gets an email.")) reject({ id, version, reason });
          }}
          className="flex flex-col gap-2 border-t border-brand-divider pt-4"
        >
          <label htmlFor={reasonId} className={labelClass}>
            Reason (optional; the Submitter sees it in the email)
          </label>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={REASON_MAX}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={reasonError ? true : undefined}
            className={inputClass}
          />
          {reasonError && <p className="text-sm font-semibold text-red-700">{reasonError}</p>}
          <div>
            <button
              type="submit"
              disabled={busy}
              className={buttonClass("danger")}
            >
              {rejecting ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </form>
      )}

      {pending && (
        <form
          action={() => {
            if (window.confirm("Delete this Submission as spam? No email is sent.")) spam({ id, version });
          }}
        >
          <button
            type="submit"
            disabled={busy}
            className={buttonClass("secondary")}
          >
            {deleting ? "Deleting…" : "Delete as spam"}
          </button>
        </form>
      )}
    </section>
  );
}
