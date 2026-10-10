/**
 * Hides connection strings and tokens in text before it is printed or logged: database URLs, Neon
 * passwords and hosts, Vercel Blob tokens and store IDs, and JWT-shaped text (the Vercel OIDC token).
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/postgres(?:ql)?:\/\/\S+/gi, "postgres://[hidden]"],
  [/npg_[A-Za-z0-9]+/g, "npg_[hidden]"],
  // Neon host (`ep-<name>-<id>.<region>.aws.neon.tech`), with or without the `@` before it.
  [/(?:@|\b)ep-[a-z0-9-]+(?:\.[a-z0-9-]+)*/gi, "[hidden]"],
  [/vercel_blob_rw_[A-Za-z0-9_]+/g, "vercel_blob_rw_[hidden]"],
  [/store_[A-Za-z0-9]+/g, "store_[hidden]"],
  // JWT-shaped text: a base64url header that starts with `{"`.
  [/eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2}/g, "[hidden]"],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
