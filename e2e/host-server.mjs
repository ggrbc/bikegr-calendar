// A tiny static server for the Embed test host pages, on a second origin (like a Squarespace site).
// It also stands in for Cloudflare's Turnstile siteverify (POST /turnstile/siteverify), so the
// Submission e2e tests need no network: the app uses it through TURNSTILE_SITEVERIFY_URL (off Vercel
// only). Every token passes for the hostname "localhost", except "e2e-refused" (no success) and
// "e2e-other-host" (another hostname).
// Usage: node e2e/host-server.mjs <port> [app origin]. The pages name http://localhost:3100; another
// app origin replaces it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 4100);
const app = process.argv[3] ?? "http://localhost:3100";
const root = fileURLToPath(new URL("./host/", import.meta.url));
const pages = { "/": "index.html", "/two.html": "two.html" };

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "POST" && path === "/turnstile/siteverify") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const token = new URLSearchParams(body).get("response");
    // Like Cloudflare: the action of the widget and the hostname of the page where it was solved.
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        success: token !== "e2e-refused",
        action: "submit",
        hostname: token === "e2e-other-host" ? "other.example" : "localhost",
      }),
    );
    return;
  }
  const file = pages[path];
  if (!file) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end((await readFile(`${root}${file}`, "utf8")).replaceAll("http://localhost:3100", app));
}).listen(port, () => console.log(`Embed test host on http://localhost:${port}`));
