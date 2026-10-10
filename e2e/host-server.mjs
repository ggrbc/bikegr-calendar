// A tiny static server for the Embed test host pages, on a second origin (like a Squarespace site).
// Usage: node e2e/host-server.mjs <port>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 4100);
const root = fileURLToPath(new URL("./host/", import.meta.url));
const pages = { "/": "index.html", "/two.html": "two.html" };

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = pages[path];
  if (!file) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(await readFile(`${root}${file}`));
}).listen(port, () => console.log(`Embed test host on http://localhost:${port}`));
