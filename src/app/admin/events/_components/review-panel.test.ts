/**
 * The Review panel's text. Rendered to static HTML on the server; the actions are mocked (the
 * panel only passes them to `useActionState`).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  approveSubmissionAction: vi.fn(),
  rejectSubmissionAction: vi.fn(),
  deleteSubmissionAsSpamAction: vi.fn(),
}));

import { IMAGE_REMOVED_NOTE, ReviewPanel, type ReviewPanelProps } from "./review-panel";

const base: ReviewPanelProps = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  version: 2,
  reviewStatus: "rejected",
  dirty: false,
  allPast: false,
  imageRemoved: false,
};

const render = (props: Partial<ReviewPanelProps>) => renderToStaticMarkup(createElement(ReviewPanel, { ...base, ...props }));

describe("Review panel", () => {
  it("a rejected Event whose image was removed says so before Approve", () => {
    expect(IMAGE_REMOVED_NOTE).toBe(
      "The image was removed when this Event was rejected. Add a new image before you approve it, if needed.",
    );
    const html = render({ imageRemoved: true });
    expect(html).toContain(IMAGE_REMOVED_NOTE);
    expect(html.indexOf(IMAGE_REMOVED_NOTE)).toBeLessThan(html.indexOf(">Approve<"));
  });

  it("a rejected Event that kept its image has no such line", () => {
    expect(render({ imageRemoved: false })).not.toContain(IMAGE_REMOVED_NOTE);
  });

  it("a pending Submission shows Approve, Reject, and Delete as spam", () => {
    const html = render({ reviewStatus: "pending" });
    expect(html).toContain("Review this Submission");
    expect(html).toContain(">Reject<");
    expect(html).toContain(">Delete as spam<");
  });
});
