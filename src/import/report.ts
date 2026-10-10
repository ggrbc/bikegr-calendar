/**
 * Text report of one import run, and the filter that keeps secrets out of it. The CLI prints only
 * text that went through `redactSecrets`.
 */
import type { ImageReport } from "./images";
import type { ImportResult } from "./types";
import type { EventRef, WriteReport } from "./write";

const SECRET_PATTERNS: [RegExp, string][] = [
  [/postgres(?:ql)?:\/\/\S+/gi, "postgres://[hidden]"],
  [/npg_[A-Za-z0-9]+/g, "npg_[hidden]"],
  // Neon host (`ep-<name>-<id>.<region>.aws.neon.tech`), with or without the `@` before it.
  [/(?:@|\b)ep-[a-z0-9-]+(?:\.[a-z0-9-]+)*/gi, "[hidden]"],
  [/vercel_blob_rw_[A-Za-z0-9_]+/g, "vercel_blob_rw_[hidden]"],
  [/store_[A-Za-z0-9]+/g, "store_[hidden]"],
  // JWT-shaped text (the Vercel OIDC token): base64url header that starts with `{"`.
  [/eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2}/g, "[hidden]"],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

const ref = (e: EventRef) => `${e.title} (${e.sourceId})`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatImportReport({
  result,
  images,
  write,
}: {
  result: ImportResult;
  images: ImageReport;
  write: WriteReport;
}): string[] {
  const lines: string[] = [];
  lines.push(
    `Tockify import, import date ${result.importDate} (a Series is open-ended after ${result.openEndedAfter})`,
  );

  lines.push("", `Series (${result.series.length}):`);
  for (const s of result.series) {
    const rule =
      s.outcome === "flagged"
        ? "flagged, imported as one-time Events"
        : `${s.rrule}, ${s.until ? `until ${s.until}` : "open-ended"}`;
    lines.push(
      `  ${ref(s)}: ${s.occurrences} Occurrences, ${rule}, ${plural(s.exdates, "EXDATE")}, ${plural(s.overrides, "Override")}`,
    );
  }

  lines.push("", `Flags (${result.flags.length}):`);
  for (const f of result.flags) lines.push(`  ${f.reason}: ${ref(f)} — ${f.detail}`);
  if (result.flags.length === 0) lines.push("  none");

  lines.push("");
  if (images.status === "noCredentials") {
    lines.push("Images not copied (no Blob credentials)");
  } else {
    lines.push(
      `Images: ${images.copied.length} copied, ${images.alreadyInBlob.length} already in Blob, ${images.failed.length} failed`,
    );
    for (const f of images.failed) lines.push(`  Image not copied: ${f.url} — ${f.reason}`);
  }

  lines.push(
    "",
    `Database: ${write.inserted.length} inserted, ${write.updated.length} updated, ${write.unchanged.length} unchanged, ${write.failed.length} failed`,
  );
  for (const e of write.editorOverwrites) lines.push(`  Warning: overwrote Editor changes: ${ref(e)}`);
  for (const e of write.failed) lines.push(`  Failed: ${ref(e)} — ${e.message}`);
  for (const e of write.notInFeed) lines.push(`  Not in the feed: ${ref(e)}`);

  return lines.map(redactSecrets);
}
