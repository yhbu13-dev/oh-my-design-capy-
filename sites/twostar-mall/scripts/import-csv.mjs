#!/usr/bin/env node
// 판매자센터/쇼핑몰 관리자 엑셀 → products.json  (가장 확실한 전 상품 이전 방법)
//   node scripts/import-csv.mjs 상품목록.csv [--merge]
//
// 엑셀에서 "다른 이름으로 저장 → CSV UTF-8" 로 저장한 파일을 넣으세요.
// 열 이름은 아래 후보 중 하나를 포함하면 자동으로 인식합니다(스마트스토어·카페24·고도몰 양식 호환).
// 옵션: 스마트스토어 양식처럼 "옵션명"에 '색상\n사이즈', "옵션값"에 '빨강,파랑\nS,M' 형태면 그대로 읽습니다.

import { readFile } from "node:fs/promises";
import { saveProducts, num } from "./lib.mjs";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) { console.error("사용법: node scripts/import-csv.mjs <파일.csv> [--merge]"); process.exit(1); }

const COLS = {
  id: ["상품번호", "상품코드", "product_no", "goodsno", "id"],
  name: ["상품명", "name"],
  price: ["정가", "소비자가", "판매가", "price"],
  salePrice: ["할인가", "할인 적용가", "최종가", "sale"],
  image: ["대표이미지", "대표 이미지", "이미지", "image"],
  images: ["추가이미지", "추가 이미지"],
  category: ["카테고리", "분류", "category"],
  stock: ["재고", "stock"],
  status: ["판매상태", "상태", "status"],
  shippingFee: ["배송비", "기본배송비", "shipping"],
  optName: ["옵션명"],
  optValue: ["옵션값"],
  optPrice: ["옵션가"],
  description: ["상세설명", "상품설명", "description"],
  reviewCount: ["리뷰수", "리뷰 수", "review"],
};

function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const text = (await readFile(file, "utf8")).replace(/^﻿/, "");
const rows = parseCsv(text);
// 머리글 행: '상품명' 이 들어있는 첫 행 (스마트스토어 양식은 안내 행이 위에 있음)
const hi = rows.findIndex((r) => r.some((c) => /상품명|^name$/i.test(c.trim())));
if (hi < 0) { console.error("✗ '상품명' 열을 찾지 못했습니다"); process.exit(1); }
const head = rows[hi].map((h) => h.replace(/\s+/g, " ").trim().toLowerCase());
const col = Object.fromEntries(Object.entries(COLS).map(([k, cands]) => [k, head.findIndex((h) => cands.some((c) => h.includes(c.toLowerCase())))]));
// '판매가'만 있고 '정가'가 없으면 판매가를 정가로
const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? "").trim() : "");

const products = rows.slice(hi + 1).map((r, i) => {
  const name = get(r, "name");
  if (!name) return null;
  const price = num(get(r, "price"));
  const sale = num(get(r, "salePrice")) || price;
  const names = get(r, "optName").split(/\n/).map((s) => s.trim()).filter(Boolean);
  const values = get(r, "optValue").split(/\n/);
  const prices = get(r, "optPrice").split(/\n/);
  const options = names.map((n, gi) => {
    const labels = (values[gi] || "").split(",").map((s) => s.trim()).filter(Boolean);
    const extras = (prices[gi] || "").split(",").map(num);
    return { name: n, values: labels.map((label, vi) => ({ label, ...(extras[vi] ? { extra: extras[vi] } : {}) })) };
  }).filter((o) => o.values.length);
  const status = get(r, "status");
  const stock = get(r, "stock");
  const ship = get(r, "shippingFee");
  const p = {
    id: get(r, "id") || `csv-${i + 1}`,
    name,
    category: (get(r, "category").split(/[>/]/).pop() || "기타").trim() || "기타",
    price: Math.max(price, sale),
    salePrice: sale,
    image: get(r, "image").split(/[\n,]/)[0].trim(),
    images: [get(r, "image"), get(r, "images")].join("\n").split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    options,
    soldOut: /품절|중지|종료|soldout/i.test(status) || (stock !== "" && num(stock) <= 0),
    reviewCount: num(get(r, "reviewCount")),
    description: get(r, "description"),
  };
  if (ship !== "" && (/무료/.test(ship) || num(ship) === 0)) p.shippingFee = 0;
  else if (num(ship)) p.shippingFee = num(ship);
  return p;
}).filter(Boolean);

await saveProducts(products, `csv:${file}`);
