import { describe, expect, it } from "vitest";
import { LOCATION_MESSAGE, readEmbedMessage, RESIZE_MESSAGE } from "./protocol";

describe("readEmbedMessage", () => {
  it("accepts a resize message with a finite height in range", () => {
    expect(readEmbedMessage({ type: RESIZE_MESSAGE, height: 812.5 })).toEqual({ type: RESIZE_MESSAGE, height: 812.5 });
    expect(readEmbedMessage({ type: RESIZE_MESSAGE, height: 0 })).not.toBeNull();
  });

  it("refuses a wrong type, a missing height, a negative or huge height, or text", () => {
    for (const data of [
      { type: "other", height: 100 },
      { type: RESIZE_MESSAGE },
      { type: RESIZE_MESSAGE, height: -1 },
      { type: RESIZE_MESSAGE, height: 50_001 },
      { type: RESIZE_MESSAGE, height: Number.POSITIVE_INFINITY },
      { type: RESIZE_MESSAGE, height: Number.NaN },
      { type: RESIZE_MESSAGE, height: "100" },
      "bikegr-calendar:resize",
      null,
      undefined,
    ]) {
      expect(readEmbedMessage(data), JSON.stringify(data)).toBeNull();
    }
  });

  it("accepts a location message and refuses a long search string", () => {
    expect(readEmbedMessage({ type: LOCATION_MESSAGE, search: "day=tue" })).toEqual({
      type: LOCATION_MESSAGE,
      search: "day=tue",
    });
    expect(readEmbedMessage({ type: LOCATION_MESSAGE, search: "x".repeat(2001) })).toBeNull();
    expect(readEmbedMessage({ type: LOCATION_MESSAGE, search: 5 })).toBeNull();
  });
});
