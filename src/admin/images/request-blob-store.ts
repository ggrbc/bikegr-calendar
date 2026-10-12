import { headers } from "next/headers";
import { type BlobStore, blobCredentials, vercelBlobStore } from "@/import/images";

/** The Blob store for this request, or null when it has no Blob credentials. */
export async function requestBlobStore(): Promise<BlobStore | null> {
  const oidcToken = (await headers()).get("x-vercel-oidc-token");
  return blobCredentials(process.env, oidcToken) ? vercelBlobStore() : null;
}
