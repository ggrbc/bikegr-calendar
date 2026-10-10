import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { BlobStore } from "@/import/images";
import { MAX_UPLOAD_BYTES } from "./limits";
import { toEventWebp } from "./process-image";
import { uploadEventImage } from "./upload-image";

const BLOB = "https://store.public.blob.vercel-storage.com";

function fakeStore(existing: string[] = []) {
  const paths = new Set(existing);
  const puts: { pathname: string; contentType: string; bytes: Uint8Array }[] = [];
  const heads: string[] = [];
  const store: BlobStore = {
    async head(pathname) {
      heads.push(pathname);
      return paths.has(pathname) ? { url: `${BLOB}/${pathname}` } : null;
    },
    async put(pathname, bytes, contentType) {
      puts.push({ pathname, contentType, bytes });
      paths.add(pathname);
      return { url: `${BLOB}/${pathname}` };
    },
  };
  return { store, puts, heads };
}

async function png(width = 50, height = 30) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#228833" } }).png().toBuffer(),
  );
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("uploadEventImage", () => {
  it("Stored path is events/<sha256 of the WebP>.webp with content type image/webp", async () => {
    const { store, puts } = fakeStore();
    const result = await uploadEventImage(await png(), { store });
    expect(puts).toHaveLength(1);
    const [put] = puts;
    expect(put.contentType).toBe("image/webp");
    expect(put.pathname).toBe(`events/${sha256(put.bytes)}.webp`);
    expect(result).toEqual({ ok: true, url: `${BLOB}/${put.pathname}`, width: 50, height: 30 });
  });

  it("Same image a second time: head finds it and nothing is put", async () => {
    const { store, puts, heads } = fakeStore();
    const bytes = await png();
    const first = await uploadEventImage(bytes, { store });
    const second = await uploadEventImage(bytes, { store });
    expect(puts).toHaveLength(1);
    expect(heads).toHaveLength(2);
    expect(second).toEqual(first);
  });

  it("File over 4 MB is refused before sharp runs", async () => {
    const { store, puts } = fakeStore();
    const process = vi.fn(toEventWebp);
    const result = await uploadEventImage(new Uint8Array(MAX_UPLOAD_BYTES + 1), { store, process });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("4 MB") });
    expect(process).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
  });

  it("Empty file is refused", async () => {
    const { store } = fakeStore();
    expect(await uploadEventImage(new Uint8Array(0), { store })).toEqual({
      ok: false,
      error: expect.stringContaining("empty"),
    });
  });

  it("Bytes that are not an image are refused with a message for the Editor", async () => {
    const { store, puts } = fakeStore();
    const result = await uploadEventImage(new TextEncoder().encode("<html>"), { store });
    expect(result).toMatchObject({ ok: false });
    expect(puts).toHaveLength(0);
  });

  it("No Blob credentials gives Image upload is not set up", async () => {
    expect(await uploadEventImage(await png(), { store: null })).toEqual({
      ok: false,
      error: "Image upload is not set up.",
    });
  });

  it("A Blob failure gives a retry message and no stack", async () => {
    const store: BlobStore = {
      head: async () => null,
      put: async () => {
        throw new Error("network down: token=secret");
      },
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await uploadEventImage(await png(), { store });
    expect(result).toEqual({ ok: false, error: "The image could not be stored. Try again." });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
    error.mockRestore();
  });
});
