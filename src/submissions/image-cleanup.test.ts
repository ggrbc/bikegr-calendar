import { describe, expect, it, vi } from "vitest";
import { removeOrphanImage } from "./image-cleanup";

const env = { BLOB_STORE_ID: "store_abc123" };
const ours = `https://abc123.public.blob.vercel-storage.com/events/${"c".repeat(64)}.webp`;

describe("removeOrphanImage", () => {
  it("removes an image of our store", async () => {
    const del = vi.fn(async () => {});
    await removeOrphanImage(ours, { del, env });
    expect(del).toHaveBeenCalledWith(ours);
  });

  it("does nothing for no URL or a URL that is not ours", async () => {
    const del = vi.fn(async () => {});
    await removeOrphanImage(null, { del, env });
    await removeOrphanImage("https://example.org/events/x.webp", { del, env });
    await removeOrphanImage(ours, { del, env: {} });
    expect(del).not.toHaveBeenCalled();
  });

  it("a failed delete is logged with the error name only", async () => {
    const log = vi.fn();
    await removeOrphanImage(ours, { del: async () => Promise.reject(new TypeError("token vercel_blob_rw_x")), env, log });
    expect(log).toHaveBeenCalledWith("[images] Blob delete failed: TypeError");
  });
});
