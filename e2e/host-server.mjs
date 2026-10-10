// A tiny static server for the Embed test host pages, on a second origin (like a Squarespace site).
// It also stands in for Cloudflare's Turnstile siteverify (POST /turnstile/siteverify), so the
// Submission e2e tests need no network: the app uses it through TURNSTILE_SITEVERIFY_URL (off Vercel
// only). Every token passes, except "e2e-refused".
// Usage: node e2e/host-server.mjs <port>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 4100);
const root = fileURLToPath(new URL("./host/", import.meta.url));
const pages = { "/": "index.html", "/two.html": "two.html" };

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "POST" && path === "/turnstile/siteverify") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const token = new URLSearchParams(body).get("response");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: token !== "e2e-refused" }));
    return;
  }
  const file = pages[path];
  if (!file) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(await readFile(`${root}${file}`));
}).listen(port, () => console.log(`Embed test host on http://localhost:${port}`));
