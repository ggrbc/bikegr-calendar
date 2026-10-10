import { describe, expect, it } from "vitest";
import type { ImageReport } from "./images";
import { formatImportReport, redactSecrets } from "./report";
import type { ImportResult } from "./types";
import type { WriteReport } from "./write";

const result: ImportResult = {
  importDate: "2026-10-09",
  openEndedAfter: "2027-10-09",
  events: [],
  overrides: [],
  tags: [],
  flags: [
    { sourceId: "70", title: "Odd Ride", reason: "ruleNotInferred", detail: "no rule matches" },
  ],
  series: [
    {
      sourceId: "1",
      title: "Wednesday Evening Rides",
      occurrences: 109,
      outcome: "rule",
      rrule: "FREQ=WEEKLY;BYDAY=WE",
      until: null,
      exdates: 0,
      overrides: 1,
    },
    {
      sourceId: "52",
      title: "VBF Tuesday Night Road Ride",
      occurrences: 8,
      outcome: "rule",
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959",
      until: "2026-10-27",
      exdates: 0,
      overrides: 0,
    },
    {
      sourceId: "70",
      title: "Odd Ride",
      occurrences: 3,
      outcome: "flagged",
      rrule: null,
      until: null,
      exdates: 0,
      overrides: 0,
    },
  ],
};

const write: WriteReport = {
  inserted: [{ sourceId: "1", title: "Wednesday Evening Rides" }],
  updated: [{ sourceId: "52", title: "VBF Tuesday Night Road Ride" }],
  unchanged: [],
  failed: [{ sourceId: "9", title: "Bad", message: "check failed" }],
  editorOverwrites: [{ sourceId: "52", title: "VBF Tuesday Night Road Ride" }],
  notInFeed: [{ sourceId: "29", title: "Vital Streets Oversight Commission" }],
};

const images: ImageReport = {
  status: "done",
  copied: [{ from: "https://cdn/a.jpg", to: "https://abc.public.blob.vercel-storage.com/events/1.jpg" }],
  alreadyInBlob: [],
  failed: [{ url: "https://cdn/b.jpg", reason: "HTTP 403" }],
};

describe("import report", () => {
  const text = formatImportReport({ result, images, write }).join("\n");

  it("lists each Series with its rule and open-ended or its UNTIL", () => {
    expect(text).toMatch(/Wednesday Evening Rides \(1\): 109 Occurrences, FREQ=WEEKLY;BYDAY=WE, open-ended/);
    expect(text).toMatch(/VBF Tuesday Night Road Ride \(52\): 8 Occurrences, .*until 2026-10-27/);
    expect(text).toMatch(/Odd Ride \(70\): 3 Occurrences, flagged/);
    expect(text).toMatch(/open-ended after 2027-10-09/);
  });

  it("lists flags, image failures, warnings, and Not in the feed lines", () => {
    expect(text).toMatch(/ruleNotInferred: Odd Ride \(70\) — no rule matches/);
    expect(text).toMatch(/Images: 1 copied, 0 already in Blob, 1 failed/);
    expect(text).toMatch(/Image not copied: https:\/\/cdn\/b.jpg — HTTP 403/);
    expect(text).toMatch(/Database: 1 inserted, 1 updated, 0 unchanged, 1 failed/);
    expect(text).toMatch(/Warning: overwrote Editor changes: VBF Tuesday Night Road Ride \(52\)/);
    expect(text).toMatch(/Failed: Bad \(9\) — check failed/);
    expect(text).toMatch(/Not in the feed: Vital Streets Oversight Commission \(29\)/);
  });

  it("does not print Blob URLs (they contain the store)", () => {
    expect(text).not.toMatch(/blob\.vercel-storage\.com/);
  });

  it("says images not copied when there are no Blob credentials", () => {
    const lines = formatImportReport({
      result,
      images: { status: "noCredentials", copied: [], alreadyInBlob: [], failed: [] },
      write,
    });
    expect(lines).toContain("Images not copied (no Blob credentials)");
  });
});

describe("redactSecrets", () => {
  it("hides database URLs, Neon passwords and hosts, Blob tokens, store IDs, and JWTs", () => {
    const secret = [
      "postgres://user:pw@localhost:5432/db",
      "postgresql://neondb_owner:npg_AbC123@ep-cool-name-123.us-east-2.aws.neon.tech/neondb",
      "password npg_XyZ987 host @ep-cool-name-123.us-east-2.aws.neon.tech",
      "vercel_blob_rw_AbCdEf123_456XyZ",
      "store_AbC123xyz",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    ].join(" | ");
    const out = redactSecrets(secret);
    for (const leak of ["user:pw", "npg_AbC", "npg_XyZ", "ep-cool", "AbCdEf123", "AbC123xyz", "eyJhbGci"]) {
      expect(out).not.toContain(leak);
    }
    expect(out).toContain("[hidden]");
  });

  it("keeps ordinary text", () => {
    const plain = "Event 52 failed: check events_timing_shape; step-by-step";
    expect(redactSecrets(plain)).toBe(plain);
  });
});
