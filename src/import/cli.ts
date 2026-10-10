/**
 * `pnpm import:tockify [--file path]` — imports the Tockify feed into the database at DATABASE_URL
 * (from the environment or `.env.local`). Safe to run again. Without `--file`, it downloads the
 * public feed. Images go to Vercel Blob when Blob credentials are set (OIDC first).
 *
 * Prints only redacted text: never the database URL, the OIDC token, the store ID, or a Blob token.
 */
import { readFileSync } from "node:fs";
import { todayInDetroit } from "@/agenda/dates";
import { openDb, requireDatabaseUrl } from "@/db/client";
import { loadLocalEnv } from "@/db/load-env";
import { blobCredentials, copyImages, vercelBlobStore } from "./images";
import { importTockify } from "./import-tockify";
import { formatImportReport, redactSecrets } from "./report";
import { writeImport } from "./write";

const FEED_URL = "https://tockify.com/api/feeds/ics/bikegr";

function argValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

async function readFeed(file: string | undefined): Promise<Uint8Array> {
  if (file) return new Uint8Array(readFileSync(file));
  const response = await fetch(FEED_URL);
  if (!response.ok) throw new Error(`Could not download the Tockify feed: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  loadLocalEnv();
  const file = argValue("--file");
  const bytes = await readFeed(file);
  // The CLI reads the clock; the pure import gets the date as an input.
  const importDate = todayInDetroit(new Date());
  const result = importTockify(bytes, { importDate });

  const credentials = blobCredentials(process.env);
  console.log(
    `Feed: ${file ?? FEED_URL}. Blob credentials: ${credentials === "oidc" ? "Vercel OIDC" : credentials === "readWrite" ? "read-write token" : "none"}.`,
  );
  const images = await copyImages(result, { store: credentials ? vercelBlobStore() : null });

  const { db, close } = openDb(requireDatabaseUrl(), { max: 1 });
  try {
    const write = await writeImport(db, images.result, { uncopiedImages: images.uncopiedImages });
    for (const line of formatImportReport({ result, images: images.report, write })) {
      console.log(line);
    }
    if (write.failed.length > 0) process.exitCode = 1;
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
