import { describe, expect, it } from "vitest";
import { isEventImageUrl } from "./image-url";

describe("isEventImageUrl", () => {
  it("isEventImageUrl accepts our Blob host with events/ and refuses other hosts and paths", () => {
    expect(isEventImageUrl("https://abc123.public.blob.vercel-storage.com/events/0f1e.webp")).toBe(true);
    expect(isEventImageUrl("https://abc123.public.blob.vercel-storage.com/events/0f1e.jpg")).toBe(true);
    expect(isEventImageUrl("https://abc123.public.blob.vercel-storage.com/other/0f1e.webp")).toBe(false);
    expect(isEventImageUrl("http://abc123.public.blob.vercel-storage.com/events/0f1e.webp")).toBe(false);
    expect(isEventImageUrl("https://evil.example.org/events/0f1e.webp")).toBe(false);
    expect(isEventImageUrl("https://public.blob.vercel-storage.com.evil.org/events/a.webp")).toBe(false);
    expect(isEventImageUrl("https://d3fd4e4oyqldw5.cloudfront.net/a.jpg")).toBe(false);
    expect(isEventImageUrl("not a url")).toBe(false);
    expect(isEventImageUrl("")).toBe(false);
    expect(isEventImageUrl(null)).toBe(false);
  });
});
