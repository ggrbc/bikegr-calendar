/**
 * Text report of one import run, and the filter that keeps secrets out of it. The CLI prints only
 * text that went through `redactSecrets`.
 */
import { redactSecrets } from "@/db/redact-secrets";
import type { ImageReport } from "./images";
import type { ImportResult } from "./types";
import type { EventRef, WriteReport } from "./write";

export { redactSecrets };

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
    `Database: ${write.inserted.length} inserted, ${write.updated.length} updated, ${write.unchanged.length} unchanged, ${write.failed.length} failed, ${write.changedInAdmin.length} changed in the admin`,
  );
  for (const e of write.editorOverwrites) lines.push(`  Warning: overwrote Editor changes: ${ref(e)}`);
  for (const e of write.failed) lines.push(`  Failed: ${ref(e)} — ${e.message}`);
  for (const e of write.notInFeed) lines.push(`  Not in the feed: ${ref(e)}`);
  for (const e of write.changedInAdmin) lines.push(`  Changed in the admin, not updated: ${ref(e)}`);

  return lines.map(redactSecrets);
}
