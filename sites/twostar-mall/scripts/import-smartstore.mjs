#!/usr/bin/env node
// 네이버 스마트스토어 전 상품 가져오기
//   node scripts/import-smartstore.mjs [스토어주소] [--details] [--merge]
//   예) node scripts/import-smartstore.mjs twostarmall --details
//
// --details : 상품별 상세(옵션·추가 이미지·상세설명)까지 가져옴. 상품 수만큼 요청하므로 느림.
// 네이버는 짧은 시간에 많은 요청을 막습니다(429/490). 막히면 시간을 두고 다시 실행하거나
// 판매자센터 엑셀 내보내기 → import-csv.mjs 를 쓰세요(가장 확실한 방법).

import { fetchText, fetchJson, saveProducts, sleep, num } from "./lib.mjs";

const arg = process.argv.slice(2).find((a) => !a.startsWith("--")) || "twostarmall";
const slug = arg.replace(/^https?:\/\/smartstore\.naver\.com\//, "").split(/[/?#]/)[0];
const withDetails = process.argv.includes("--details");
const BASE = "https://smartstore.naver.com";
const H = { Referer: `${BASE}/${slug}` };

function preloadedState(html) {
  const m = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 8) return undefined;
  if (key in obj && obj[key] != null) return obj[key];
  for (const v of Object.values(obj)) { const r = findKey(v, key, depth + 1); if (r !== undefined) return r; }
}
// 상태 트리에서 상품처럼 생긴 배열을 모두 수집 (API가 막혔을 때 대비)
function collectProducts(obj, acc = new Map(), depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 10) return acc;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      if (x && typeof x === "object" && (x.productNo || x.id) && x.name && (x.salePrice != null || x.representativeImageUrl)) acc.set(String(x.productNo || x.id), x);
      else collectProducts(x, acc, depth + 1);
    }
  } else for (const v of Object.values(obj)) collectProducts(v, acc, depth + 1);
  return acc;
}

function mapSimple(p) {
  const price = num(p.salePrice);
  const discounted = num(p.benefitsView?.discountedSalePrice ?? p.discountedSalePrice) || price;
  const cat = p.category?.wholeCategoryName || p.category?.categoryName || p.categoryName || "";
  return {
    id: `ss-${p.productNo || p.id}`, // 카페24 상품번호와 겹치지 않게
    channelProductNo: String(p.id || ""),
    name: p.name || p.dispName,
    category: (cat.split(">").pop() || "기타").trim(),
    price,
    salePrice: discounted,
    image: p.representativeImageUrl || p.imageUrl || "",
    soldOut: /OUTOFSTOCK|SUSPENSION|CLOSE/.test(p.productStatusType || ""),
    reviewCount: num(p.reviewAmount?.totalReviewCount ?? p.totalReviewCount ?? p.reviewCount),
    rating: num(p.reviewAmount?.averageReviewScore ?? p.averageReviewScore),
    shippingFee: p.productDeliveryInfo?.deliveryFeeType === "FREE" || p.deliveryInfo?.deliveryFeeType === "FREE" ? 0 : undefined,
    url: `${BASE}/${slug}/products/${p.id || p.productNo}`,
    createdAt: p.regDate || p.saleStartDate || "",
  };
}

async function listViaApi(channelNo) {
  const all = [];
  for (let page = 1; page < 200; page++) {
    const url = `${BASE}/i/v1/stores/${channelNo}/categories/ALL/products?categoryId=ALL&categorySearchType=STDCATG&sortType=POPULAR&free=false&page=${page}&pageSize=80`;
    const j = await fetchJson(url, { headers: H });
    const items = j.simpleProducts || j.products || [];
    all.push(...items);
    process.stdout.write(`\r  목록 ${all.length}/${j.totalCount ?? "?"}`);
    if (!items.length || (j.totalCount && all.length >= j.totalCount)) break;
    await sleep(700);
  }
  process.stdout.write("\n");
  return all;
}

async function detail(channelUid, p) {
  const j = await fetchJson(`${BASE}/i/v2/channels/${channelUid}/products/${p.channelProductNo || p.id}?withWindow=false`, { headers: H });
  const imgs = (j.productImages || []).map((x) => x.url).filter(Boolean);
  if (imgs.length) p.images = imgs;
  // 옵션: 조합형(optionCombinations) → 옵션명별 값 목록 / 단독형(options)
  const groups = (j.options || []).map((o) => ({ name: o.groupName, values: [] }));
  for (const c of j.optionCombinations || []) {
    [c.optionName1, c.optionName2, c.optionName3].forEach((label, i) => {
      if (!label || !groups[i]) return;
      if (!groups[i].values.find((v) => v.label === label)) {
        groups[i].values.push({ label, extra: groups.length === 1 ? num(c.price) : 0, soldOut: groups.length === 1 ? num(c.stockQuantity) <= 0 : false });
      }
    });
  }
  for (const [i, o] of (j.options || []).entries()) {
    if (groups[i].values.length === 0 && o.optionValues) groups[i].values = String(o.optionValues).split(",").map((label) => ({ label: label.trim() }));
  }
  p.options = groups.filter((g) => g.name && g.values.length);
  if (j.detailContents?.detailContentText) p.description = j.detailContents.detailContentText;
  const d = j.productDeliveryInfo;
  if (d) p.shippingFee = d.deliveryFeeType === "FREE" ? 0 : num(d.baseFee) || p.shippingFee;
  return p;
}

(async () => {
  console.log(`스마트스토어 '${slug}' 가져오는 중…`);
  const html = await fetchText(`${BASE}/${slug}`);
  const st = preloadedState(html);
  if (!st) throw new Error("스토어 페이지에서 상품 데이터를 찾지 못했습니다. 네이버가 요청을 막았을 수 있어요.");
  const channelNo = findKey(st, "channelNo");
  const channelUid = findKey(st, "channelUid") || findKey(st, "id");
  console.log(`  channelNo=${channelNo} channelUid=${channelUid}`);

  let raw = [];
  try { raw = channelNo ? await listViaApi(channelNo) : []; }
  catch (e) { console.warn(`  목록 API 실패(${e.message}) → 페이지 내장 데이터로 대체`); }
  if (!raw.length) raw = [...collectProducts(st).values()];
  const products = [...new Map(raw.map(mapSimple).map((p) => [p.id, p])).values()].filter((p) => p.name);
  for (const p of products) if (p.shippingFee === undefined) delete p.shippingFee;

  if (withDetails && channelUid) {
    let i = 0;
    for (const p of products) {
      try { await detail(channelUid, p); } catch (e) { console.warn(`\n  상세 실패 ${p.id}: ${e.message}`); }
      process.stdout.write(`\r  상세 ${++i}/${products.length}`);
      await sleep(900);
    }
    process.stdout.write("\n");
  }
  await saveProducts(products, `smartstore:${slug}`);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
