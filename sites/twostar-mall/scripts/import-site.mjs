#!/usr/bin/env node
// 일반 쇼핑몰(카페24·고도몰·아임웹·식스샵 등) 전 상품 가져오기 — twostar.net 용
//   node scripts/import-site.mjs https://twostar.net [--merge] [--limit=500]
//
// 1) sitemap.xml 에서 상품 페이지 주소를 모으고
// 2) 각 페이지의 JSON-LD(Product) / og 메타 태그에서 이름·가격·이미지를 읽습니다.
// sitemap 이 없으면 첫 페이지의 링크 중 상품 상세로 보이는 주소를 따라갑니다.

import { fetchText, saveProducts, sleep, num } from "./lib.mjs";

const site = (process.argv.slice(2).find((a) => !a.startsWith("--")) || "https://twostar.net").replace(/\/$/, "");
const limit = num(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || 2000;
const PRODUCT_URL = /\/product\/|\/goods\/goods_view|goodsNo=|product_no=|\/shop_view|\/products?\/\d|idx=\d/i;

const abs = (u) => { try { return new URL(u, site + "/").href; } catch { return null; } };
const decode = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

async function sitemapUrls(url, seen = new Set()) {
  if (seen.has(url)) return [];
  seen.add(url);
  let xml;
  try { xml = await fetchText(url, { tries: 2 }); } catch { return []; }
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decode(m[1]));
  if (/<sitemapindex/i.test(xml)) {
    const nested = await Promise.all(locs.map((l) => sitemapUrls(l, seen)));
    return nested.flat();
  }
  return locs;
}

async function crawlLinks() {
  const html = await fetchText(site);
  const links = [...html.matchAll(/href=["']([^"'#]+)["']/g)].map((m) => abs(decode(m[1]))).filter(Boolean);
  const cats = links.filter((l) => /cate|category|list/i.test(l) && l.startsWith(site)).slice(0, 60);
  const out = new Set(links.filter((l) => PRODUCT_URL.test(l)));
  for (const c of cats) {
    try {
      const h = await fetchText(c, { tries: 2 });
      [...h.matchAll(/href=["']([^"'#]+)["']/g)].map((m) => abs(decode(m[1]))).filter((l) => l && PRODUCT_URL.test(l)).forEach((l) => out.add(l));
    } catch { /* skip */ }
    await sleep(300);
  }
  return [...out];
}

function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re);
  return m ? decode(m[1] ?? m[2]) : "";
}

function parseProduct(html, url) {
  let ld;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      const arr = [j, ...(j["@graph"] || [])].flat();
      ld = arr.find((x) => [].concat(x?.["@type"]).includes("Product"));
      if (ld) break;
    } catch { /* invalid JSON-LD */ }
  }
  const offer = [].concat(ld?.offers || [])[0] || {};
  const name = decode(ld?.name || meta(html, "og:title") || (html.match(/<title>([^<]*)<\/title>/i) || [])[1]);
  const salePrice = num(offer.price || offer.lowPrice || meta(html, "product:price:amount") || meta(html, "og:price:amount"));
  const price = num(meta(html, "product:original_price:amount")) || salePrice;
  const image = abs([].concat(ld?.image || [])[0] || meta(html, "og:image"));
  if (!name || !salePrice) return null;
  const id = (url.match(/(?:product_no=|goodsNo=|\/product\/[^/]+\/|\/products?\/|idx=)(\d+)/) || [])[1] || url;
  return {
    id: String(id),
    name: name.replace(/\s*[-|:]\s*[^-|:]*$/, (s) => (s.length < 25 ? "" : s)).trim(),
    category: decode(ld?.category || meta(html, "product:category") || "기타").split(/[>/]/).pop().trim() || "기타",
    price: Math.max(price, salePrice),
    salePrice,
    image,
    soldOut: /OutOfStock|SoldOut/i.test(offer.availability || ""),
    reviewCount: num(ld?.aggregateRating?.reviewCount),
    rating: num(ld?.aggregateRating?.ratingValue),
    description: decode(ld?.description || meta(html, "og:description")),
    url,
  };
}

(async () => {
  console.log(`${site} 상품 주소 수집 중…`);
  let urls = (await sitemapUrls(`${site}/sitemap.xml`)).filter((u) => PRODUCT_URL.test(u));
  if (!urls.length) { console.log("  sitemap 에 상품이 없어 링크를 따라갑니다"); urls = await crawlLinks(); }
  urls = [...new Set(urls)].slice(0, limit);
  console.log(`  상품 페이지 ${urls.length}개`);
  const products = [];
  let i = 0;
  for (const u of urls) {
    try { const p = parseProduct(await fetchText(u, { tries: 2 }), u); if (p) products.push(p); }
    catch (e) { console.warn(`\n  실패 ${u}: ${e.message}`); }
    process.stdout.write(`\r  ${++i}/${urls.length} (성공 ${products.length})`);
    await sleep(400);
  }
  process.stdout.write("\n");
  if (!products.length) throw new Error("상품을 하나도 읽지 못했습니다. 관리자 엑셀 내보내기 → import-csv.mjs 를 쓰세요.");
  await saveProducts([...new Map(products.map((p) => [p.id, p])).values()], `site:${site}`);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
