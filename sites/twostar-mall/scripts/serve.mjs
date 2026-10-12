#!/usr/bin/env node
// 미리보기용 로컬 서버: node scripts/serve.mjs [포트]  →  http://localhost:8080
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { ROOT } from "./lib.mjs";

const port = Number(process.argv[2]) || 8080;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html");
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" }).end(body);
  } catch { res.writeHead(404).end("Not found"); }
}).listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`미리보기: ${url}  (종료: Ctrl+C)`);
  const open = process.platform === "win32" ? `start "" ${url}` : process.platform === "darwin" ? `open ${url}` : `xdg-open ${url}`;
  exec(open, () => {});
});
