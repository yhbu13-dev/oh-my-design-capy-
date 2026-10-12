import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(ROOT, "data", "products.json");

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { headers = {}, tries = 4 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", ...headers } });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${url}`), { fatal: true });
      return await r.text();
    } catch (e) {
      last = e;
      if (e.fatal) break;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}
export const fetchJson = async (url, opts) => JSON.parse(await fetchText(url, { ...opts, headers: { Accept: "application/json", ...(opts?.headers || {}) } }));

export const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** products.json 저장. --merge 면 기존 상품과 id(없으면 이름) 기준으로 합침 */
export async function saveProducts(products, source, { merge = process.argv.includes("--merge") } = {}) {
  let list = products;
  if (merge) {
    try {
      const prev = JSON.parse(await readFile(OUT, "utf8")).products || [];
      const keyOf = (p) => p.id || p.name;
      const map = new Map(prev.map((p) => [keyOf(p), p]));
      for (const p of products) map.set(keyOf(p), { ...map.get(keyOf(p)), ...p });
      list = [...map.values()];
    } catch { /* 첫 실행 */ }
  }
  list = list.map((p, i) => ({ ...p, rank: p.rank ?? i }));
  await writeFile(OUT, JSON.stringify({ source, importedAt: new Date().toISOString(), products: list }, null, 2) + "\n");
  console.log(`✓ ${list.length}개 상품 저장 → ${path.relative(process.cwd(), OUT)}`);
}
