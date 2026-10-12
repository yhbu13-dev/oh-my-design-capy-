#!/usr/bin/env node
// 카페24 쇼핑몰(twostar.net) 전 상품 가져오기 — 목록 + 상세(옵션·이미지·배송비·상세이미지)
//   node scripts/import-cafe24.mjs [https://twostar.net] [--no-details] [--merge]

import { fetchText, saveProducts, sleep, num } from "./lib.mjs";

const site = (process.argv.slice(2).find((a) => !a.startsWith("--")) || "https://twostar.net").replace(/\/$/, "");
const withDetails = !process.argv.includes("--no-details");
const ALL = "43"; // 전체카테고리
const TAGS = { 242: "BEST", 162: "특가", 248: "선물세트" }; // 진열용 카테고리 → 배지

const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const absImg = (u) => (!u ? "" : u.startsWith("//") ? `https:${u}` : u.startsWith("/") ? site + u : u);

async function categories() {
  const html = await fetchText(site + "/");
  const seen = new Map();
  for (const m of html.matchAll(/<a[^>]+href="[^"]*cate_no=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const name = strip(m[2]);
    if (name && !name.startsWith("상품명") && !seen.has(m[1])) seen.set(m[1], name);
  }
  return seen;
}

function parseList(html) {
  const out = [];
  const parts = html.split(/<li id="anchorBoxId_/).slice(1);
  for (const part of parts) {
    const id = part.match(/^(\d+)/)?.[1];
    const li = part.split(/<li id="anchorBoxId_|<\/ul>\s*<\/div>/)[0];
    const nameBlock = li.match(/<div class="name">([\s\S]*?)<\/div>/)?.[1] || "";
    const name = strip(nameBlock.replace(/<span class="title[\s\S]*?<\/span>\s*:<\/span>/, "")).replace(/^상품명\s*:\s*/, "");
    const custom = num(li.match(/data-prod-custom="([^"]*)"/)?.[1]);
    const price = num(li.match(/data-prod-price="([^"]*)"/)?.[1]);
    const sale = num(li.match(/data-sale-price="([^"]*)"/)?.[1]);
    const img = li.match(/<img src="([^"]+)" id="eListPrdImage/)?.[1];
    const review = num(strip(li.match(/review_cnt[\s\S]*?<\/strong>([\s\S]*?)<\/li>/)?.[1] || "0"));
    const soldOut = /품절|soldout/i.test(li.match(/<div class="icon">([\s\S]*?)<\/div>/)?.[1] || "");
    const hasOptions = /selectOptionCommon/.test(li);
    if (id && name) out.push({ id, name, custom, price, sale, image: absImg(img), reviewCount: review, soldOut, hasOptions });
  }
  return out;
}

async function crawlCategory(cate) {
  const items = [];
  const ids = new Set();
  for (let page = 1; page < 100; page++) {
    const html = await fetchText(`${site}/product/list.html?cate_no=${cate}&page=${page}`);
    const got = parseList(html).filter((x) => !ids.has(x.id));
    if (!got.length) break;
    got.forEach((x) => { ids.add(x.id); items.push(x); });
    await sleep(250);
  }
  return items;
}

function parseDetail(html, p) {
  const big = html.match(/(\/\/ecimg[^"']+\/web\/product\/big\/[^"']+)/)?.[1];
  if (big) p.image = absImg(big);
  p.images = [p.image];
  // 판매가
  const basePrice = num(html.match(/var product_price = '([\d.]+)'/)?.[1]) || p.salePrice;
  // 옵션
  const raw = html.match(/option_stock_data = '((?:[^'\\]|\\.)*)'/)?.[1];
  if (raw) {
    try {
      const data = JSON.parse(JSON.parse(`"${raw}"`));
      const combos = Object.values(data).filter((o) => o.is_display === "T");
      const names = combos[0]?.option_name_original || [];
      const groups = names.map((name) => ({ name: String(name).replace(/^선택\s*\d*$/, "옵션").replace(/\s*\d+$/, ""), values: [] }));
      for (const c of combos) {
        const vals = c.option_value_orginal || [c.option_value];
        const out = c.is_selling !== "T" || (c.use_stock && c.use_soldout === "T" && num(c.stock_number) <= 0);
        vals.forEach((label, gi) => {
          const g = groups[gi];
          if (!g || g.values.find((v) => v.label === label)) return;
          const v = { label };
          if (groups.length === 1) {
            const extra = num(c.option_price) - basePrice;
            if (extra) v.extra = extra;
            if (out) v.soldOut = true;
          }
          g.values.push(v);
        });
      }
      p.options = groups.filter((g) => g.name && g.values.length);
    } catch { /* 옵션 파싱 실패 시 옵션 없이 */ }
  }
  // 배송비
  const dlv = strip(html.match(/delv_price_B">([\s\S]*?)<\/span>\s*<\/span>/)?.[1] || html.match(/배송비<\/span><\/th>\s*<td>([\s\S]*?)<\/td>/)?.[1] || "");
  if (/무료/.test(dlv)) p.shippingFee = 0;
  else if (num(dlv.match(/([\d,]+)\s*원/)?.[1])) p.shippingFee = num(dlv.match(/([\d,]+)\s*원/)[1]);
  const cond = dlv.match(/([\d,]+)\s*원\s*이상/);
  if (cond) p.freeShippingOver = num(cond[1]);
  // 상세 이미지
  const cont = html.slice(html.indexOf('id="prdDetail"'), html.indexOf('id="prdReview"') > 0 ? html.indexOf('id="prdReview"') : undefined);
  const dimgs = [...cont.matchAll(/(?:ec-data-src|src)="([^"]+\.(?:jpe?g|png|gif|webp))"/gi)].map((m) => absImg(m[1])).filter((u) => !/img_loading|echosting\.cafe24\.com\/(?:skin|design)/.test(u));
  p.description = [...new Set(dimgs)].map((u) => `<img src="${u}" alt="" loading="lazy">`).join("");
  if (/is_soldout_icon = 'T'/.test(html)) p.soldOut = true;
  return p;
}

(async () => {
  console.log(`${site} 카테고리 수집 중…`);
  const cats = await categories();
  console.log(`  카테고리 ${cats.size}개: ${[...cats.values()].join(", ")}`);

  const all = await crawlCategory(ALL);
  console.log(`  전체 상품 ${all.length}개`);
  const catOf = new Map();
  const tagsOf = new Map();
  const bestRank = new Map();
  for (const [no, name] of cats) {
    if (no === ALL) continue;
    const items = await crawlCategory(no);
    process.stdout.write(`\r  카테고리 '${name}' ${items.length}개            `);
    items.forEach((it, i) => {
      if (TAGS[no]) { (tagsOf.get(it.id) || tagsOf.set(it.id, []).get(it.id)).push(TAGS[no]); if (no === "242") bestRank.set(it.id, i); }
      else if (!catOf.has(it.id)) catOf.set(it.id, name);
      if (!all.find((x) => x.id === it.id)) all.push(it);
    });
  }
  process.stdout.write("\n");

  const products = all.map((x, i) => {
    const price = x.custom > x.price ? x.custom : x.price;
    const salePrice = x.sale && x.sale < x.price ? x.sale : x.price;
    const p = {
      id: x.id, name: x.name, category: catOf.get(x.id) || "기타", price, salePrice,
      image: x.image, images: [x.image], options: [], soldOut: x.soldOut, reviewCount: x.reviewCount,
      badge: (tagsOf.get(x.id) || [])[0] || "",
      rank: bestRank.has(x.id) ? bestRank.get(x.id) : 1000 + i,
      url: `${site}/product/detail.html?product_no=${x.id}`,
      createdAt: x.image.match(/\/(20\d{6})\//)?.[1] || "",
      _hasOptions: x.hasOptions,
    };
    return p;
  });

  if (withDetails) {
    let i = 0;
    for (const p of products) {
      try { parseDetail(await fetchText(p.url), p); } catch (e) { console.warn(`\n  상세 실패 ${p.id}: ${e.message}`); }
      process.stdout.write(`\r  상세 ${++i}/${products.length}`);
      await sleep(250);
    }
    process.stdout.write("\n");
  }
  for (const p of products) delete p._hasOptions;
  await saveProducts(products, `cafe24:${site}`);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
