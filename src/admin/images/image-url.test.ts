import { describe, expect, it } from "vitest";
import { blobPublicHost, isEventImageUrl, isEventImageUrlForHost } from "./image-url";

const HOST = "abc123store.public.blob.vercel-storage.com";
const HASH = "0123456789abcdef".repeat(4);
const url = (rest: string) => `https://${HOST}${rest}`;

describe("isEventImageUrlForHost", () => {
  it("accepts an Event image of our store for each stored extension", () => {
    for (const ext of ["webp", "jpg", "png", "gif", "avif"]) {
      expect(isEventImageUrlForHost(url(`/events/${HASH}.${ext}`), HOST)).toBe(true);
    }
  });

  it("refuses another Blob store", () => {
    expect(isEventImageUrlForHost(`https://attackerstore.public.blob.vercel-storage.com/events/${HASH}.webp`, HOST)).toBe(false);
  });

  it("refuses user info, a port, a query, a hash, and http", () => {
    expect(isEventImageUrlForHost(`https://user:pw@${HOST}/events/${HASH}.webp`, HOST)).toBe(false);
    expect(isEventImageUrlForHost(`https://user@${HOST}/events/${HASH}.webp`, HOST)).toBe(false);
    expect(isEventImageUrlForHost(`https://${HOST}:8443/events/${HASH}.webp`, HOST)).toBe(false);
    expect(isEventImageUrlForHost(url(`/events/${HASH}.webp?x=1`), HOST)).toBe(false);
    expect(isEventImageUrlForHost(url(`/events/${HASH}.webp#x`), HOST)).toBe(false);
    expect(isEventImageUrlForHost(`http://${HOST}/events/${HASH}.webp`, HOST)).toBe(false);
  });

  it("refuses a path that is not events/<sha256>.<stored extension>", () => {
    expect(isEventImageUrlForHost(url("/events/"), HOST)).toBe(false);
    expect(isEventImageUrlForHost(url("/events/x.webp"), HOST)).toBe(false);
    expect(isEventImageUrlForHost(url(`/events/${HASH.toUpperCase()}.webp`), HOST)).toBe(false);
    expect(isEventImageUrlForHost(url(`/events/${HASH}.svg`), HOST)).toBe(false);
    expect(isEventImageUrlForHost(url(`/other/${HASH}.webp`), HOST)).toBe(false);
    expect(isEventImageUrlForHost(url(`/events/a/${HASH}.webp`), HOST)).toBe(false);
  });

  it("refuses everything when the host is not known, and refuses non-URLs", () => {
    expect(isEventImageUrlForHost(url(`/events/${HASH}.webp`), null)).toBe(false);
    expect(isEventImageUrlForHost("not a url", HOST)).toBe(false);
    expect(isEventImageUrlForHost("", HOST)).toBe(false);
    expect(isEventImageUrlForHost(null, HOST)).toBe(false);
  });

  it("matches the host case-insensitively, as DNS does", () => {
    expect(isEventImageUrlForHost(`https://ABC123STORE.public.blob.vercel-storage.com/events/${HASH}.webp`, HOST)).toBe(true);
    expect(isEventImageUrlForHost(url(`/events/${HASH}.webp`), HOST.toUpperCase())).toBe(true);
  });
});

describe("blobPublicHost", () => {
  it("comes from BLOB_STORE_ID first, as @vercel/blob builds its URLs", () => {
    expect(blobPublicHost({ VERCEL_OIDC_TOKEN: "t", BLOB_STORE_ID: "store_AbC123" })).toBe(
      "abc123.public.blob.vercel-storage.com",
    );
    expect(blobPublicHost({ BLOB_STORE_ID: "AbC123" })).toBe("abc123.public.blob.vercel-storage.com");
  });

  it("comes from the read-write token when there is no store ID", () => {
    expect(blobPublicHost({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_XyZ789_secretpart" })).toBe(
      "xyz789.public.blob.vercel-storage.com",
    );
  });

  it("is null with no Blob settings or an unusable value", () => {
    expect(blobPublicHost({})).toBeNull();
    expect(blobPublicHost({ BLOB_STORE_ID: "  " })).toBeNull();
    expect(blobPublicHost({ BLOB_STORE_ID: "store_bad.host" })).toBeNull();
    expect(blobPublicHost({ BLOB_READ_WRITE_TOKEN: "nonsense" })).toBeNull();
  });
});

describe("isEventImageUrl", () => {
  it("reads our store host from the environment", () => {
    const env = { BLOB_STORE_ID: "store_abc123store" };
    expect(isEventImageUrl(url(`/events/${HASH}.webp`), env)).toBe(true);
    expect(isEventImageUrl(`https://other.public.blob.vercel-storage.com/events/${HASH}.webp`, env)).toBe(false);
    expect(isEventImageUrl(url(`/events/${HASH}.webp`), {})).toBe(false);
  });
});
