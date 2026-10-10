import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageRejected, toEventWebp } from "./process-image";

/** A solid-color test image in one format. */
async function image(
  width: number,
  height: number,
  format: "png" | "jpeg" | "gif" | "webp" | "avif" | "tiff",
): Promise<Uint8Array> {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });
  return new Uint8Array(await base.toFormat(format).toBuffer());
}

describe("toEventWebp (real sharp)", () => {
  it("Large PNG is resized to 1600 px wide WebP, height in proportion", async () => {
    const out = await toEventWebp(await image(3200, 1000, "png"));
    expect(out).toMatchObject({ width: 1600, height: 500 });
    const meta = await sharp(out.bytes).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 1600, height: 500 });
  });

  it("Small image is not upscaled", async () => {
    const out = await toEventWebp(await image(120, 80, "png"));
    expect(out).toMatchObject({ width: 120, height: 80 });
  });

  it.each(["jpeg", "gif", "webp", "avif"] as const)("%s input becomes WebP", async (format) => {
    const out = await toEventWebp(await image(64, 32, format));
    expect((await sharp(out.bytes).metadata()).format).toBe("webp");
    expect(out).toMatchObject({ width: 64, height: 32 });
  });

  it("SVG bytes are refused although sharp can read SVG", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    expect((await sharp(svg).metadata()).format).toBe("svg");
    await expect(toEventWebp(svg)).rejects.toBeInstanceOf(ImageRejected);
  });

  it("TIFF is refused", async () => {
    await expect(toEventWebp(await image(10, 10, "tiff"))).rejects.toBeInstanceOf(ImageRejected);
  });

  it("Bytes that are not an image are refused", async () => {
    await expect(toEventWebp(new TextEncoder().encode("hello, not an image"))).rejects.toBeInstanceOf(ImageRejected);
  });

  it("Image over the pixel limit is refused before decode", async () => {
    const bytes = await image(200, 100, "png");
    await expect(toEventWebp(bytes, { maxInputPixels: 10_000 })).rejects.toThrow(/pixels/);
  });

  it("EXIF orientation is applied and metadata is removed", async () => {
    // Stored 40 x 20 with orientation 6 ("rotate 90° clockwise to view"): shows as 20 x 40.
    const rotated = new Uint8Array(
      await sharp({ create: { width: 40, height: 20, channels: 3, background: "#336699" } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    );
    expect((await sharp(rotated).metadata()).orientation).toBe(6);
    const out = await toEventWebp(rotated);
    expect(out).toMatchObject({ width: 20, height: 40 });
    const meta = await sharp(out.bytes).metadata();
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });
});
