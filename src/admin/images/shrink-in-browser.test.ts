import { describe, expect, it } from "vitest";
import { targetSize } from "./shrink-in-browser";

describe("targetSize", () => {
  it("targetSize keeps the aspect ratio and never upscales", () => {
    expect(targetSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(targetSize(3001, 1000, 1600)).toEqual({ width: 1600, height: 533 });
    expect(targetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(targetSize(1600, 50, 1600)).toEqual({ width: 1600, height: 50 });
    expect(targetSize(10000, 1, 1600)).toEqual({ width: 1600, height: 1 });
  });
});
