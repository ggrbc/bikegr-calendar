import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blobCredentials, type BlobStore, copyImages, imageExtension, isBlobUrl } from "./images";
import type { ImportResult, ImportedEvent } from "./types";

const BLOB = "https://store.public.blob.vercel-storage.com";

function fakeStore(existing: string[] = []) {
  const paths = new Set(existing);
  const puts: string[] = [];
  const store: BlobStore = {
    async head(pathname) {
      return paths.has(pathname) ? { url: `${BLOB}/${pathname}` } : null;
    },
    async put(pathname) {
      puts.push(pathname);
      paths.add(pathname);
      return { url: `${BLOB}/${pathname}` };
    },
  };
  return { store, puts };
}

type Reply = { status?: number; type?: string; body?: string } | Error;

function fakeFetch(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const reply = replies[url] ?? { status: 404 };
    if (reply instanceof Error) throw reply;
    return new Response(reply.body ?? "", {
      status: reply.status ?? 200,
      headers: reply.type ? { "content-type": reply.type } : {},
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function event(sourceId: string, imageUrl: string | null): ImportedEvent {
  return {
    sourceId,
    calendar: "rides",
    title: `Event ${sourceId}`,
    description: "",
    location: null,
    tagSlugs: [],
    imageUrl,
    cta: null,
    rule: {
      eventId: sourceId,
      timing: { kind: "timed", start: "2026-10-20T18:00", end: "2026-10-20T20:00" },
      rrule: null,
      exdates: [],
      scheduleStatus: "scheduled",
      scheduleNote: null,
    },
  };
}

function result(events: ImportedEvent[]): ImportResult {
  return {
    importDate: "2026-10-09",
    openEndedAfter: "2027-10-09",
    events,
    overrides: [],
    tags: [],
    flags: [],
    series: [],
  };
}

const A = "https://d3fd4e4oyqldw5.cloudfront.net/a.jpg";
const B = "https://d3fd4e4oyqldw5.cloudfront.net/b.png";

describe("image copy", () => {
  it("image is copied to events/<sha256>.<ext> and the Event gets the Blob URL", async () => {
    const { store, puts } = fakeStore();
    const { fetchImpl } = fakeFetch({ [A]: { type: "image/jpeg", body: "AAA" } });
    const out = await copyImages(result([event("1", A)]), { store, fetch: fetchImpl });
    expect(puts).toEqual([`events/${sha("AAA")}.jpg`]);
    expect(out.result.events[0].imageUrl).toBe(`${BLOB}/events/${sha("AAA")}.jpg`);
    expect(out.uncopiedImages).toEqual(new Set());
    expect(out.report.copied).toEqual([{ from: A, to: `${BLOB}/events/${sha("AAA")}.jpg` }]);
  });

  it("image already in the store is not uploaded again", async () => {
    const { store, puts } = fakeStore([`events/${sha("AAA")}.jpg`]);
    const { fetchImpl } = fakeFetch({ [A]: { type: "image/jpeg", body: "AAA" } });
    const out = await copyImages(result([event("1", A)]), { store, fetch: fetchImpl });
    expect(puts).toEqual([]);
    expect(out.result.events[0].imageUrl).toBe(`${BLOB}/events/${sha("AAA")}.jpg`);
    expect(out.report.alreadyInBlob).toHaveLength(1);
  });

  it("two Events with the same image URL download it once", async () => {
    const { store } = fakeStore();
    const { fetchImpl, calls } = fakeFetch({ [A]: { type: "image/jpeg", body: "AAA" } });
    const out = await copyImages(result([event("1", A), event("2", A)]), { store, fetch: fetchImpl });
    expect(calls).toEqual([A]);
    expect(new Set(out.result.events.map((e) => e.imageUrl)).size).toBe(1);
  });

  it("two URLs with the same bytes give one Blob path", async () => {
    const { store, puts } = fakeStore();
    const other = "https://d3fd4e4oyqldw5.cloudfront.net/copy-of-a.jpg";
    const { fetchImpl } = fakeFetch({
      [A]: { type: "image/jpeg", body: "AAA" },
      [other]: { type: "image/jpeg", body: "AAA" },
    });
    const out = await copyImages(result([event("1", A), event("2", other)]), {
      store,
      fetch: fetchImpl,
    });
    expect(puts).toEqual([`events/${sha("AAA")}.jpg`]);
    expect(out.result.events[0].imageUrl).toBe(out.result.events[1].imageUrl);
  });

  it("second run gives the same Blob URLs, so the writer sees no change", async () => {
    const { store, puts } = fakeStore();
    const { fetchImpl } = fakeFetch({ [A]: { type: "image/jpeg", body: "AAA" } });
    const first = await copyImages(result([event("1", A)]), { store, fetch: fetchImpl });
    const second = await copyImages(result([event("1", A)]), { store, fetch: fetchImpl });
    expect(second.result.events[0].imageUrl).toBe(first.result.events[0].imageUrl);
    expect(puts).toHaveLength(1);
  });

  it("failed download keeps the Tockify URL and is reported", async () => {
    const { store } = fakeStore();
    const { fetchImpl } = fakeFetch({ [A]: { status: 403 }, [B]: new Error("network down") });
    const out = await copyImages(result([event("1", A), event("2", B), event("3", null)]), {
      store,
      fetch: fetchImpl,
    });
    expect(out.result.events.map((e) => e.imageUrl)).toEqual([A, B, null]);
    expect(out.uncopiedImages).toEqual(new Set(["1", "2"]));
    expect(out.report.failed.map((f) => f.url)).toEqual([A, B]);
    expect(out.report.failed[0].reason).toMatch(/403/);
    expect(out.report.failed[1].reason).toMatch(/network down/);
  });

  it("response that is not an image keeps the Tockify URL and is reported", async () => {
    const { store, puts } = fakeStore();
    const { fetchImpl } = fakeFetch({ [A]: { type: "text/html", body: "<html>" } });
    const out = await copyImages(result([event("1", A)]), { store, fetch: fetchImpl });
    expect(puts).toEqual([]);
    expect(out.result.events[0].imageUrl).toBe(A);
    expect(out.report.failed[0].reason).toMatch(/text\/html/);
  });

  it("extension comes from the content type", () => {
    expect(imageExtension("image/png; charset=binary")).toBe("png");
    expect(imageExtension("image/jpeg")).toBe("jpg");
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("image/svg+xml")).toBeNull();
  });

  it("SVG and other image types that are not in the list are refused", async () => {
    const { store, puts } = fakeStore();
    const { fetchImpl } = fakeFetch({ [A]: { type: "image/svg+xml", body: "<svg/>" } });
    const out = await copyImages(result([event("1", A)]), { store, fetch: fetchImpl });
    expect(puts).toEqual([]);
    expect(out.result.events[0].imageUrl).toBe(A);
    expect(out.report.failed[0].reason).toMatch(/image\/svg\+xml/);
  });

  it("image over the size limit is refused and reported", async () => {
    const { store, puts } = fakeStore();
    const { fetchImpl } = fakeFetch({ [A]: { type: "image/jpeg", body: "x".repeat(11) } });
    const out = await copyImages(result([event("1", A)]), {
      store,
      fetch: fetchImpl,
      maxBytes: 10,
    });
    expect(puts).toEqual([]);
    expect(out.report.failed[0].reason).toMatch(/too large/);
  });

  it("each download has a time limit", async () => {
    const { store } = fakeStore();
    let signal: AbortSignal | null | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return new Response("AAA", { headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
    await copyImages(result([event("1", A)]), { store, fetch: fetchImpl });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("Blob URLs are told apart from Tockify URLs", () => {
    expect(isBlobUrl(`${BLOB}/events/abc.jpg`)).toBe(true);
    expect(isBlobUrl(A)).toBe(false);
    expect(isBlobUrl(null)).toBe(false);
    expect(isBlobUrl("not a url")).toBe(false);
  });

  it("no Blob credentials keeps every URL and reports images not copied", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const out = await copyImages(result([event("1", A), event("2", null)]), {
      store: null,
      fetch: fetchImpl,
    });
    expect(calls).toEqual([]);
    expect(out.result.events.map((e) => e.imageUrl)).toEqual([A, null]);
    expect(out.uncopiedImages).toEqual(new Set(["1"]));
    expect(out.report.status).toBe("noCredentials");
  });

  it("credentials: OIDC token with store ID wins; read-write token is the fallback; neither gives none", () => {
    expect(blobCredentials({ VERCEL_OIDC_TOKEN: "t", BLOB_STORE_ID: "store_1" })).toBe("oidc");
    expect(
      blobCredentials({ VERCEL_OIDC_TOKEN: "t", BLOB_STORE_ID: "s", BLOB_READ_WRITE_TOKEN: "rw" }),
    ).toBe("oidc");
    expect(blobCredentials({ VERCEL_OIDC_TOKEN: "t", BLOB_READ_WRITE_TOKEN: "rw" })).toBe("readWrite");
    expect(blobCredentials({ BLOB_READ_WRITE_TOKEN: "rw" })).toBe("readWrite");
    expect(blobCredentials({ VERCEL_OIDC_TOKEN: "t" })).toBeNull();
    expect(blobCredentials({ BLOB_STORE_ID: " " })).toBeNull();
  });

  it("credentials: a Vercel Function's request OIDC token counts as the OIDC token", () => {
    expect(blobCredentials({ BLOB_STORE_ID: "store_1" }, "t")).toBe("oidc");
    expect(blobCredentials({ BLOB_STORE_ID: "store_1" }, " ")).toBeNull();
    expect(blobCredentials({ BLOB_STORE_ID: "store_1" }, null)).toBeNull();
    expect(blobCredentials({}, "t")).toBeNull();
  });
});
