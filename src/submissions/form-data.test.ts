import { describe, expect, it } from "vitest";
import { submissionFromFormData } from "./form-data";

describe("submissionFromFormData", () => {
  it("reads every field, the lists, the checkboxes, the honeypot, the token, and the image", () => {
    const data = new FormData();
    data.set("calendar", "advocacy");
    data.set("title", "Meeting");
    data.append("tagIds", "a");
    data.append("tagIds", "b");
    data.set("allDay", "on");
    data.set("repeats", "on");
    data.append("repeatDays", "TU");
    data.append("repeatDays", "TH");
    data.set("repeatUntil", "2026-12-31");
    data.set("submitterEmail", "sam@example.org");
    data.set("website", "bot text");
    data.set("turnstileToken", "token");
    data.set("image", new File([new Uint8Array([1, 2])], "ride.jpg", { type: "image/jpeg" }));

    const form = submissionFromFormData(data);
    expect(form.values).toMatchObject({
      calendar: "advocacy",
      title: "Meeting",
      tagIds: ["a", "b"],
      allDay: true,
      repeats: true,
      repeatDays: ["TU", "TH"],
      repeatUntil: "2026-12-31",
      submitterEmail: "sam@example.org",
      description: "",
    });
    expect(form.honeypot).toBe("bot text");
    expect(form.turnstileToken).toBe("token");
    expect(form.image?.size).toBe(2);
  });

  it("no checkbox means false, and an empty file input means no image", () => {
    const data = new FormData();
    data.set("image", new File([], ""));
    const form = submissionFromFormData(data);
    expect(form.values.allDay).toBe(false);
    expect(form.values.repeats).toBe(false);
    expect(form.image).toBeNull();
  });
});
