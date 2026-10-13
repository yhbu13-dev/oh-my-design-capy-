// 투스타몰 스토어프런트
// 구매 흐름: 사진 위 [+] 로 담기 → 하단 [주문하기] → 한 화면 주문서 [결제하기]
// 상품을 누르면 상세·옵션·수량·[바로 구매]가 한 시트에 있다. 배송지·결제수단은 다음 주문에 자동 입력.

const CFG = window.STORE_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
const PAGE = 40;

const state = {
  products: [], byId: new Map(),
  cat: "전체", coll: null, q: "", sort: "popular", freeOnly: false, limit: PAGE,
  cart: store.get("ts.cart", []),
  ship: store.get("ts.ship", null),
  pay: store.get("ts.pay", null),
};
let sheet = null; // 현재 열린 시트의 상태

/* ---------------- 데이터 ---------------- */
async function loadProducts() {
  const get = async (url) => { try { const r = await fetch(url, { cache: "no-cache" }); return r.ok ? r.json() : null; } catch { return null; } };
  const data = await get("data/products.json");
  let list = Array.isArray(data) ? data : data?.products;
  if (!list?.length) {
    const sample = await get("data/products.sample.json");
    list = sample?.products || sample || [];
    $("#sampleNotice").hidden = false;
  }
  return list.map(normalize).filter((p) => p.id && p.name);
}

function normalize(p, i) {
  const price = Number(p.price) || 0;
  const sale = Number(p.salePrice) || price;
  const n = {
    id: String(p.id ?? i), name: String(p.name).trim(), category: p.category || "기타",
    price: Math.max(price, sale), salePrice: sale,
    image: p.image || p.images?.[0] || "",
    options: Array.isArray(p.options) ? p.options.filter((o) => o.values?.length) : [],
    soldOut: !!p.soldOut, reviewCount: Number(p.reviewCount) || 0, rating: Number(p.rating) || 0,
    badge: p.badge || "", shippingFee: p.shippingFee ?? null, description: p.description || "",
    createdAt: String(p.createdAt || ""), rank: p.rank ?? i,
  };
  n.pack = parsePack(n.name);
  n.unitPrice = n.pack.count > 1 ? n.salePrice / n.pack.count : null;
  return n;
}

// "355ml x 24캔", "100ml x 100병", "1.5L, 6개", "총 12개" → 용량·입수
function parsePack(name) {
  const UNIT = "(개입|개|캔|병|입|페트|팩|봉|매|포|스틱|ea)";
  const vol = name.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg)(?![a-z])/i);
  const pats = [new RegExp(`총\\s*(\\d+)\\s*${UNIT}`, "i"), new RegExp(`[x×*]\\s*(\\d+)\\s*${UNIT}?`, "gi"), new RegExp(`,\\s*(\\d+)\\s*${UNIT}`, "i"), new RegExp(`(\\d+)\\s*(개입|입)(?![가-힣])`), /(\d+)\s*(티백|티|T|포|매|스틱)(?![a-zA-Z가-힣])/, /(\d+)\s*(개)(?!월)/];
  let count = 0; let unit = "";
  for (const [i, re] of pats.entries()) {
    const all = [...name.matchAll(re.global ? re : new RegExp(re.source, re.flags + "g"))];
    const m = i >= 4 ? all[0] : all[all.length - 1]; // 'x 24' 는 마지막, '280티+종이컵50매' 는 첫 번째
    if (m && Number(m[1]) > 1 && Number(m[1]) <= 1000) { count = Number(m[1]); unit = m[2] || ""; break; }
  }
  const u = /티백/.test(unit) ? "티백" : /캔|병|페트|팩|봉|포|스틱|매/.exec(unit)?.[0] || "개";
  return { count, unit: u, volume: vol ? `${vol[1]}${vol[2].toLowerCase() === "l" ? "L" : vol[2].toLowerCase()}` : "" };
}

function splitBrand(name) {
  const m = name.match(/^(\S+)\s+(.*)$/);
  return m && m[1].length <= 8 ? [m[1], m[2]] : ["", name];
}
function shortName(name) {
  const core = name.replace(/\s*[\d.]+\s*(ml|l|g|kg)\b.*$/i, "").replace(/,.*$/, "").trim() || name;
  return core.split(/\s+/).slice(0, 3).join(" ");
}

/* ---------------- 금액 ---------------- */
const optExtra = (p, opts) => p.options.reduce((s, o) => s + (Number(o.values.find((v) => v.label === opts?.[o.name])?.extra) || 0), 0);
const priceOf = (p, opts) => p.salePrice + optExtra(p, opts);
const keyOf = (id, opts) => `${id}|${JSON.stringify(opts || {})}`;
const optText = (opts) => Object.values(opts || {}).join(" / ");
const feeOf = (p) => (p.shippingFee ?? CFG.shippingFee ?? 0);

function totals(items) {
  const lines = items.map((it) => ({ ...it, p: state.byId.get(it.id) })).filter((l) => l.p);
  const subtotal = lines.reduce((s, l) => s + priceOf(l.p, l.opts) * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const threshold = CFG.freeShippingOver || Infinity;
  const paid = lines.filter((l) => feeOf(l.p) > 0);
  const shipping = !lines.length || !paid.length || subtotal >= threshold ? 0 : Math.max(...paid.map((l) => feeOf(l.p)));
  return { lines, subtotal, count, shipping, total: subtotal + shipping, toFree: Math.max(0, threshold - subtotal), threshold };
}

/* ---------------- 장바구니 ---------------- */
function commitCart() { store.set("ts.cart", state.cart); renderBar(); refreshItemActions(); }
function addToCart(id, opts = {}, qty = 1) {
  const key = keyOf(id, opts);
  const hit = state.cart.find((x) => x.key === key);
  if (hit) hit.qty = Math.min(99, hit.qty + qty); else state.cart.push({ key, id, opts, qty });
  commitCart();
}
function setQty(list, key, qty) {
  const i = list.findIndex((x) => x.key === key);
  if (i < 0) return;
  if (qty <= 0) list.splice(i, 1); else list[i].qty = Math.min(qty, 99);
}
const cartQty = (p) => state.cart.find((x) => x.key === keyOf(p.id, {}))?.qty || 0;

/* ---------------- 기획전 ---------------- */
// 실제 상품 데이터로 묶는 컬렉션. art: 위에서 내려다본 캔 박스(열×행)
const COLLECTIONS = [
  { id: "office", tone: "navy", title: "탕비실은\n한 박스로", art: [6, 4], pick: (p) => p.category === "음료수" && feeOf(p) === 0,
    sub: (l) => `음료수 무료배송 ${l.length}종` },
  { id: "cafe", tone: "blue", title: "카페 사장님\n장바구니", art: [4, 3], pick: (p) => ["시럽/소스/파우더", "원두/믹스커피/스틱", "종이컵/일회용품", "설탕/차/청류/액상"].includes(p.category),
    sub: (l) => `시럽·원두·차·컵 ${l.length}종` },
  { id: "unit", tone: "sun", title: "한 캔·한 병\n500원 이하", art: [5, 6], pick: (p) => p.unitPrice && p.unitPrice <= 500 && ["음료수", "커피음료", "과즙/어린이음료"].includes(p.category),
    sub: (l) => `음료 ${l.length}종 · 최저 ${won(Math.min(...l.map((p) => p.unitPrice)))}부터` },
  { id: "deal", tone: "red", title: "정가보다\n30% 이상", art: [3, 4], pick: (p) => rateOf(p) >= 30,
    sub: (l) => `${l.length}종 · 최대 ${Math.max(...l.map(rateOf))}% 할인` },
];

// 위에서 본 캔 박스: 캔 윗면(원) + 따개
function canBox(cols, rows) {
  const s = 28; const w = cols * s; const h = rows * s;
  let cans = "";
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const cx = x * s + s / 2; const cy = y * s + s / 2;
    cans += `<circle cx="${cx}" cy="${cy}" r="12.2" class="can"/><circle cx="${cx}" cy="${cy}" r="9.4" class="lid"/><rect x="${cx - 3.2}" y="${cy - 6.6}" width="6.4" height="8" rx="3.2" class="tab"/>`;
  }
  return `<svg class="cans" viewBox="-4 -4 ${w + 8} ${h + 8}" aria-hidden="true">${cans}</svg>`;
}

function renderHero() {
  const html = COLLECTIONS.map((c) => {
    const list = state.products.filter(c.pick);
    if (list.length < 4) return "";
    return `<button class="promo promo--${c.tone}" type="button" data-coll="${c.id}" aria-pressed="${state.coll === c.id}">
      <span class="promo__text"><strong>${esc(c.title).replace("\n", "<br>")}</strong><span>${esc(c.sub(list))}</span><em>보러 가기</em></span>
      ${canBox(...c.art)}
    </button>`;
  }).join("");
  $("#promos").innerHTML = html;
}

/* ---------------- 오늘 출발 카운트다운 (한국 시간 기준) ---------------- */
function startCountdown() {
  const el = $("#cutoff"); if (!el) return;
  const [hh, mm] = String(CFG.todayShipCutoff || "").split(":").map(Number);
  if (!Number.isFinite(hh)) { el.closest(".strip__ship").hidden = true; document.querySelector(".tile--dark")?.remove(); return; }
  const cut = hh * 3600 + (mm || 0) * 60;
  const tick = () => {
    const kst = new Date(Date.now() + 9 * 3600e3);
    const now = kst.getUTCHours() * 3600 + kst.getUTCMinutes() * 60 + kst.getUTCSeconds();
    const left = cut - now;
    if (left <= 0) {
      el.closest(".strip__ship").innerHTML = `오늘 주문 마감 · 지금 결제하면 <b>내일 출발</b>`;
      document.querySelectorAll("[data-cutoff]").forEach((x) => (x.textContent = "내일 출발"));
      return clearInterval(t);
    }
    const f = (n) => String(n).padStart(2, "0");
    const txt = `${f(Math.floor(left / 3600))}:${f(Math.floor(left / 60) % 60)}:${f(left % 60)}`;
    el.textContent = txt;
    document.querySelectorAll("[data-cutoff]").forEach((x) => (x.textContent = txt));
    document.querySelectorAll("[data-dayprogress]").forEach((x) => (x.style.width = `${Math.min(100, (now / cut) * 100)}%`));
  };
  const t = setInterval(tick, 1000); tick();
}

/* ---------------- 목록 ---------------- */
function renderTabs() {
  const count = {};
  state.products.forEach((p) => (count[p.category] = (count[p.category] || 0) + 1));
  const cats = Object.keys(count).sort((a, b) => (a === "기타") - (b === "기타") || count[b] - count[a]);
  $("#cats").innerHTML = ["전체", ...cats].map((c) => `<button class="tab" type="button" role="tab" data-cat="${esc(c)}" aria-selected="${!state.coll && c === state.cat}">${esc(c)}</button>`).join("");
}

function visible() {
  const q = state.q.trim().toLowerCase().replace(/\s+/g, "");
  const coll = COLLECTIONS.find((c) => c.id === state.coll);
  const list = state.products.filter((p) =>
    (coll ? coll.pick(p) : state.cat === "전체" || p.category === state.cat) &&
    (!state.freeOnly || feeOf(p) === 0) &&
    (!q || p.name.toLowerCase().replace(/\s+/g, "").includes(q)));
  const by = {
    popular: (a, b) => a.rank - b.rank,
    unit: (a, b) => (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity),
    low: (a, b) => a.salePrice - b.salePrice,
    high: (a, b) => b.salePrice - a.salePrice,
    review: (a, b) => b.reviewCount - a.reviewCount,
    new: (a, b) => b.createdAt.localeCompare(a.createdAt),
  }[state.sort];
  return list.sort(by).sort((a, b) => a.soldOut - b.soldOut);
}

const rateOf = (p) => (p.price > p.salePrice ? Math.round((1 - p.salePrice / p.price) * 100) : 0);
function priceHtml(p) {
  const r = rateOf(p);
  return `${r ? `<div class="was">${won(p.price)}</div>` : ""}<div class="price">${r ? `<span class="price__rate">${r}%</span>` : ""}<span class="price__now">${won(p.salePrice)}</span></div>`;
}
const unitHtml = (p) => (p.unitPrice ? `<div class="unit">${p.pack.unit}당 ${won(p.unitPrice)}</div>` : "");
const shipText = (p) => (feeOf(p) === 0 ? `<span class="free">무료배송</span>` : `<span>배송비 ${won(feeOf(p))}</span>`);

function mediaActions(p) {
  if (p.soldOut) return `<div class="item__sold">품절</div>`;
  const n = !p.options.length && cartQty(p);
  if (n) return `<div class="qty"><button type="button" data-act="dec" aria-label="빼기">−</button><output>${n}</output><button type="button" data-act="inc" aria-label="더하기">+</button></div>`;
  return `<button class="add" type="button" data-act="add" aria-label="${esc(p.name)} 장바구니 담기"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
}

function itemHtml(p) {
  const [brand, rest] = splitBrand(p.name);
  return `<li class="item" data-id="${esc(p.id)}">
    <div class="item__media">
      <button class="item__open" type="button" data-act="open" aria-label="${esc(p.name)}"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async"></button>
      ${p.badge && !p.soldOut ? `<span class="item__flag">${esc(p.badge)}</span>` : ""}
      <div class="item__act">${mediaActions(p)}</div>
    </div>
    <div class="item__text" data-act="open">
      <p class="item__name">${brand ? `<b>${esc(brand)}</b> ` : ""}${esc(rest)}</p>
      ${priceHtml(p)}${unitHtml(p)}
      <div class="tags">${shipText(p)}${p.reviewCount ? `<span>리뷰 ${p.reviewCount.toLocaleString()}</span>` : ""}</div>
    </div>
  </li>`;
}

function renderGrid() {
  const list = visible();
  const coll = COLLECTIONS.find((c) => c.id === state.coll);
  $("#resultCount").innerHTML = coll
    ? `<button class="coll-chip" type="button" data-clear-coll aria-label="기획전 해제">${esc(coll.title.replace("\n", " "))}<span aria-hidden="true">✕</span></button> <b>${list.length.toLocaleString()}</b>개`
    : isHome() ? `<span class="shelf__title">전체 상품</span> <b>${list.length.toLocaleString()}</b>개` : `<b>${list.length.toLocaleString()}</b>개 상품`;
  $("#empty").hidden = list.length > 0;
  $("#more").hidden = list.length <= state.limit;
  $("#grid").innerHTML = list.slice(0, state.limit).map(itemHtml).join("");
}
function refreshItemActions() {
  document.querySelectorAll(".item").forEach((li) => {
    const p = state.byId.get(li.dataset.id);
    if (p) $(".item__act", li).innerHTML = mediaActions(p);
  });
}

function renderBar() {
  const t = totals(state.cart);
  const bar = $("#bar");
  bar.hidden = t.count === 0;
  $("#cartCount").hidden = t.count === 0;
  $("#cartCount").textContent = t.count;
  $("#barItems").textContent = `${t.count}개`;
  $("#barTotal").textContent = won(t.total);
  const s = $("#barShip");
  s.className = t.shipping ? "" : "free";
  s.textContent = t.shipping ? `배송비 ${won(t.shipping)} 포함${isFinite(t.threshold) ? ` · ${won(t.toFree)} 더 담으면 무료` : ""}` : "무료배송";
  document.documentElement.style.setProperty("--bar-h", bar.hidden ? "0px" : `${bar.offsetHeight}px`);
}

/* ---------------- 시트 ---------------- */
let lastFocus = null;
function openSheet(title, body, foot) {
  if ($("#sheet").hidden) lastFocus = document.activeElement;
  $("#sheetTitle").textContent = title;
  $("#sheetBody").innerHTML = body;
  $("#sheetFoot").innerHTML = foot || "";
  $("#sheet").hidden = false;
  $("#scrim").hidden = false;
  document.body.style.overflow = "hidden";
  $("#sheetBody").scrollTop = 0;
  setTimeout(() => $("#sheetClose").focus({ preventScroll: true }), 40);
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#scrim").hidden = true;
  document.body.style.overflow = "";
  sheet = null;
  lastFocus?.focus?.({ preventScroll: true });
}

/* 상품 시트: 상세 + 옵션 + 수량 + 담기/바로구매 */
function openProduct(p) {
  const opts = {};
  p.options.forEach((o) => {
    const ok = o.values.filter((v) => !v.soldOut);
    if (ok.length === 1) opts[o.name] = ok[0].label;
  });
  sheet = { type: "product", p, opts, qty: 1 };
  openSheet(p.category, productBody(p), productFoot());
  if (TS3D) TS3D.ready.then(() => { try { $(".pd3d__mount")?.appendChild(TS3D.viewer(info3d(p))); } catch { $(".pd3d")?.classList.remove("is-3d"); } });
}
function productBody(p) {
  const { opts } = sheet;
  const comp = [p.pack.volume, p.pack.count > 1 ? `${p.pack.count}${p.pack.unit}` : ""].filter(Boolean).join(" × ");
  return `
    <div class="pd__media${TS3D ? " pd3d is-3d" : ""}">
      ${TS3D ? `<div class="pd3d__mount"></div><span class="pd3d__hint">드래그해서 360° 돌려보기</span><div class="pd3d__switch" role="group" aria-label="보기 방식"><button type="button" data-view="3d" aria-pressed="true">3D</button><button type="button" data-view="photo" aria-pressed="false">사진</button></div>` : ""}
      <img src="${esc(p.image)}" alt="${esc(p.name)}">
    </div>
    <div class="pd__info">
      <h3 class="pd__name">${esc(p.name)}</h3>
      ${priceHtml(p)}${unitHtml(p)}
    </div>
    <dl class="facts">
      <dt>배송비</dt><dd>${feeOf(p) === 0 ? `<span class="free">무료배송</span>` : won(feeOf(p))}</dd>
      ${comp ? `<dt>구성</dt><dd>${esc(comp)}</dd>` : ""}
      <dt>배송</dt><dd>택배 · 평일 출고</dd>
      ${p.reviewCount ? `<dt>리뷰</dt><dd>${p.reviewCount.toLocaleString()}건</dd>` : ""}
    </dl>
    ${p.options.map((o) => `
      <span class="label">${esc(o.name)}</span>
      <div class="choices" role="group" aria-label="${esc(o.name)}">
        ${o.values.map((v) => `<button class="choice" type="button" data-opt="${esc(o.name)}" data-val="${esc(v.label)}" aria-pressed="${opts[o.name] === v.label}" ${v.soldOut || p.soldOut ? "disabled" : ""}><span>${esc(v.label)}</span>${Number(v.extra) ? `<small>${v.extra > 0 ? "+" : ""}${won(v.extra)}</small>` : v.soldOut ? "<small>품절</small>" : ""}</button>`).join("")}
      </div>`).join("")}
    ${p.soldOut ? "" : `<div class="qtyrow"><span>수량</span>${stepper(sheet.qty, "pqty")}</div>`}
    ${p.description ? `<section class="desc"><h3>상품 상세</h3>${sanitize(p.description)}</section>` : ""}
    <div style="height:16px"></div>`;
}
function productFoot() {
  const { p, opts, qty } = sheet;
  if (p.soldOut) return `<button class="cta cta--block" type="button" disabled>품절된 상품입니다</button>`;
  const ready = p.options.every((o) => opts[o.name]);
  return `<div class="foot-total"><span>${ready ? `${qty}개 상품 금액` : "옵션을 선택하세요"}</span><strong>${ready ? won(priceOf(p, opts) * qty) : ""}</strong></div>
    <div class="foot-row">
      <button class="ghost" type="button" data-act="p-cart" ${ready ? "" : "disabled"}>장바구니</button>
      <button class="cta" type="button" data-act="p-buy" ${ready ? "" : "disabled"}>바로 구매</button>
    </div>`;
}
const stepper = (n, key, sm) => `<div class="stepper${sm ? " stepper--sm" : ""}"><button type="button" data-step="-1" data-key="${esc(key)}" aria-label="빼기">−</button><output>${n}</output><button type="button" data-step="1" data-key="${esc(key)}" aria-label="더하기">+</button></div>`;

function sanitize(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("script,style,iframe,object,embed,link,meta,form").forEach((n) => n.remove());
  t.content.querySelectorAll("*").forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name); }));
  t.content.querySelectorAll("img").forEach((img) => { img.loading = "lazy"; img.alt = ""; });
  return t.innerHTML;
}

/* ---------------- 주문서 ---------------- */
function openCheckout(items, source) {
  if (!items.length) return toast("장바구니가 비어 있어요");
  sheet = { type: "checkout", items: items.map((x) => ({ ...x })), source, editShip: !state.ship, pay: state.pay || CFG.payMethods?.[0]?.id || "card", errors: {}, draft: null };
  openSheet("주문서", "", "");
  renderCheckout();
}

function renderCheckout() {
  const c = sheet;
  const t = totals(c.items);
  if (!t.lines.length) return closeSheet();
  const s = c.draft || state.ship || {};
  const ship = c.editShip ? `
    <div class="form" id="shipForm">
      <div class="two">
        <input class="input" id="f-name" name="name" placeholder="받는 분" autocomplete="name" value="${esc(s.name)}" aria-invalid="${!!c.errors.name}">
        <input class="input" id="f-phone" name="phone" placeholder="휴대폰 번호" inputmode="tel" autocomplete="tel" value="${esc(s.phone)}" aria-invalid="${!!c.errors.phone}">
      </div>
      <div class="addr">
        <input class="input" id="f-addr1" name="addr1" placeholder="주소" autocomplete="street-address" value="${esc(s.addr1)}" aria-invalid="${!!c.errors.addr1}">
        <button class="ghost" type="button" data-act="postcode">주소 찾기</button>
      </div>
      <input class="input" id="f-addr2" name="addr2" placeholder="상세 주소" value="${esc(s.addr2)}">
      <input type="hidden" name="zip" value="${esc(s.zip)}">
      <input class="input" id="f-memo" name="memo" placeholder="배송 요청사항 (선택)" value="${esc(s.memo)}" list="memoList">
      <datalist id="memoList"><option value="문 앞에 놓아주세요"><option value="경비실에 맡겨주세요"><option value="배송 전 연락 부탁드립니다"></datalist>
      <p class="err">${esc(Object.values(c.errors)[0] || "")}</p>
    </div>` : `
    <div class="saved">
      <div><p><b>${esc(s.name)}</b> ${esc(s.phone)}</p><p class="muted">${s.zip ? `(${esc(s.zip)}) ` : ""}${esc(s.addr1)} ${esc(s.addr2)}</p>${s.memo ? `<p class="muted">${esc(s.memo)}</p>` : ""}</div>
      <button class="link" type="button" data-act="edit-ship">변경</button>
    </div>`;

  $("#sheetBody").innerHTML = `
    <section class="block">
      <h3>주문 상품 <small>${t.count}개</small></h3>
      ${t.lines.map((l) => `
        <div class="line">
          <div class="line__img"><img src="${esc(l.p.image)}" alt="${esc(l.p.name)}"></div>
          <div>
            <p class="line__name">${esc(l.p.name)}</p>
            ${Object.keys(l.opts || {}).length ? `<div class="line__opt">${esc(optText(l.opts))}</div>` : ""}
            <div class="line__row">${stepper(l.qty, l.key, true)}<span class="line__price">${won(priceOf(l.p, l.opts) * l.qty)}</span></div>
            <button class="link" type="button" data-remove="${esc(l.key)}">삭제</button>
          </div>
        </div>`).join("")}
      ${t.shipping && isFinite(t.threshold) ? `<p class="hint">${won(t.toFree)} 더 담으면 무료배송</p>` : ""}
    </section>
    <section class="block">
      <h3>배송지 ${state.ship ? "" : "<small>다음 주문부터 자동 입력</small>"}</h3>
      ${ship}
    </section>
    <section class="block">
      <h3>결제 수단</h3>
      <div class="pays" role="radiogroup" aria-label="결제 수단">
        ${(CFG.payMethods || []).map((m) => `<button class="pay" type="button" role="radio" data-pay="${esc(m.id)}" aria-checked="${c.pay === m.id}">${esc(m.label)}</button>`).join("")}
      </div>
    </section>
    <section class="block">
      <div class="sum">
        <div><span>상품 금액</span><span>${won(t.subtotal)}</span></div>
        <div><span>배송비</span><span>${t.shipping ? won(t.shipping) : "무료"}</span></div>
        <div class="total"><span>결제 금액</span><span>${won(t.total)}</span></div>
      </div>
    </section>`;
  $("#sheetFoot").innerHTML = `<button class="cta cta--block" type="button" data-act="pay">${won(t.total)} 결제하기</button>
    <p class="agree">주문 내용을 확인했으며 결제 및 개인정보 제공에 동의합니다.</p>`;
}

function readShip() {
  const f = $("#shipForm");
  if (!f) return null;
  const v = Object.fromEntries([...f.querySelectorAll("input")].map((i) => [i.name, i.value.trim()]));
  v.phone = formatPhone(v.phone);
  return v;
}
function keepDraft() { if ($("#shipForm")) sheet.draft = readShip(); }
function formatPhone(s) {
  const d = String(s || "").replace(/\D/g, "").slice(0, 11);
  if (d.length < 10) return d;
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}
function validate(v) {
  if (!v?.name) return { name: "받는 분 이름을 입력하세요" };
  if (!/^01\d-?\d{3,4}-?\d{4}$/.test(v.phone || "")) return { phone: "휴대폰 번호를 확인하세요" };
  if (!v.addr1) return { addr1: "주소를 입력하세요" };
  return {};
}

async function submitOrder() {
  const c = sheet;
  const ship = readShip() || state.ship;
  c.errors = validate(ship);
  if (Object.keys(c.errors).length) {
    c.editShip = true; c.draft = ship; renderCheckout();
    $(`#f-${Object.keys(c.errors)[0]}`)?.focus();
    return;
  }
  state.ship = ship; store.set("ts.ship", ship);
  state.pay = c.pay; store.set("ts.pay", c.pay);
  const t = totals(c.items);
  const order = {
    id: `TS${new Date().toISOString().slice(2, 10).replace(/-/g, "")}${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    items: t.lines.map((l) => ({ id: l.id, name: l.p.name, options: l.opts, qty: l.qty, unitPrice: priceOf(l.p, l.opts) })),
    subtotal: t.subtotal, shipping: t.shipping, total: t.total, payMethod: c.pay, ship,
  };
  const btn = $('[data-act="pay"]');
  btn.disabled = true; btn.textContent = "결제 진행 중…";
  try { await requestPayment(order); }
  catch (err) { renderCheckout(); return toast(err?.message || "결제가 취소됐어요"); }
  const orders = store.get("ts.orders", []); orders.unshift(order); store.set("ts.orders", orders.slice(0, 50));
  if (CFG.orderWebhook) fetch(CFG.orderWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) }).catch(() => {});
  if (c.source === "cart") { state.cart = []; commitCart(); }
  showDone(order);
}

// 포트원 키가 있으면 실제 결제창, 없으면 데모
async function requestPayment(order) {
  const pg = CFG.portone || {};
  const channelKey = pg.channelKeys?.[order.payMethod];
  if (order.payMethod === "bank") return;
  if (!pg.storeId || !channelKey) { await new Promise((r) => setTimeout(r, 500)); return; }
  if (!window.PortOne) await loadScript("https://cdn.portone.io/v2/browser-sdk.js");
  const easy = { naverpay: "NAVERPAY", kakaopay: "KAKAOPAY", tosspay: "TOSSPAY" }[order.payMethod];
  const res = await window.PortOne.requestPayment({
    storeId: pg.storeId, channelKey, paymentId: order.id,
    orderName: order.items.length > 1 ? `${order.items[0].name} 외 ${order.items.length - 1}건` : order.items[0].name,
    totalAmount: order.total, currency: "CURRENCY_KRW",
    payMethod: easy ? "EASY_PAY" : "CARD", ...(easy ? { easyPay: { easyPayProvider: easy } } : {}),
    customer: { fullName: order.ship.name, phoneNumber: order.ship.phone.replace(/-/g, "") },
    redirectUrl: location.href.split("#")[0],
  });
  if (res?.code) throw new Error(res.message || "결제에 실패했어요");
  // 실서비스: 서버에서 paymentId 로 결제 금액을 반드시 검증
}

function showDone(order) {
  const m = (CFG.payMethods || []).find((x) => x.id === order.payMethod);
  const bank = order.payMethod === "bank";
  sheet = { type: "done" };
  $("#sheetTitle").textContent = "주문 완료";
  $("#sheetBody").innerHTML = `
    <div class="done">
      <div class="done__check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3>${bank ? "입금하시면 바로 출고됩니다" : "주문이 완료됐습니다"}</h3>
      <p>주문번호 ${esc(order.id)}</p>
      ${bank ? `<div class="bank"><b>${won(order.total)} 입금 · 예금주 ${esc(CFG.bankHolder || "")}</b>${(CFG.bankAccounts || []).map((b) => `<div><span>${esc(b.bank)} ${esc(b.number)}</span><button class="link" type="button" data-copy="${esc(b.number)}">복사</button></div>`).join("")}</div>` : ""}
      <div class="receipt sum">
        ${order.items.map((i) => `<div><span>${esc(i.name)} × ${i.qty}</span><span>${won(i.unitPrice * i.qty)}</span></div>`).join("")}
        <div><span>배송비</span><span>${order.shipping ? won(order.shipping) : "무료"}</span></div>
        <div class="total"><span>${esc(m?.label || "")}</span><span>${won(order.total)}</span></div>
      </div>
      <p style="margin-top:14px;font-size:13px">${esc(order.ship.name)} · ${esc(order.ship.addr1)} ${esc(order.ship.addr2)}</p>
    </div>`;
  $("#sheetFoot").innerHTML = `<button class="cta cta--block" type="button" data-act="close">계속 쇼핑하기</button>`;
}

/* ---------------- 보조 ---------------- */
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("스크립트를 불러오지 못했어요")); document.head.appendChild(s); });
}
async function openPostcode() {
  try {
    if (!window.daum?.Postcode) await loadScript("https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js");
    new window.daum.Postcode({
      oncomplete: (d) => {
        const f = $("#shipForm"); if (!f) return;
        f.querySelector('[name="addr1"]').value = d.roadAddress || d.jibunAddress;
        f.querySelector('[name="zip"]').value = d.zonecode;
        f.querySelector('[name="addr2"]').focus();
      },
    }).open();
  } catch { toast("주소 찾기를 열 수 없어요. 직접 입력해 주세요"); }
}
let toastTimer;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 1600);
}

// 이미지가 안 뜨면 포장 라벨 형태로 대체
function bindImageFallback() {
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.failed) return;
    img.dataset.failed = "1";
    if (img.closest(".desc")) { img.remove(); return; }
    const p = state.byId.get(img.closest("[data-id]")?.dataset.id) || state.products.find((x) => x.name === img.alt) || (sheet?.type === "product" ? sheet.p : null);
    if (!p) { img.style.visibility = "hidden"; return; }
    const small = img.closest(".line__img, .rankrow__img, .trow__img");
    const wrap = document.createElement("div");
    wrap.innerHTML = packArt(p, small ? "ph--sm" : "");
    img.replaceWith(wrap.firstElementChild);
  }, true);
}

/* ================= 홈 화면 ================= */
const DRINK_CATS = ["음료수", "커피음료", "과즙/어린이음료"];
const TYPES = [
  { id: "soda", label: "탄산", tone: "red", re: /콜라|사이다|스프라이트|환타|탄산|트레비|펩시|칠성|웰치스|몬스터|핫식스|토닉|진저|소다|에너지/ },
  { id: "coffee", label: "커피", tone: "brown", re: /커피|아메리카노|라떼|콜드브루|카누|맥심|티오피|조지아|칸타타|바리스타|더블샷|프렌치카페|에스프레소/ },
  { id: "tea", label: "차·이온·물", tone: "green", re: /차(?![가-힣])|녹차|보리|옥수수|헛개|이온|게토레이|포카리|파워에이드|토레타|생수|삼다수|워터|아이시스|광천수|비타|홍삼/ },
  { id: "juice", label: "주스", tone: "orange", re: /주스|쥬스|과즙|사과|오렌지|포도|망고|자연은|델몬트|썬키스트|토마토|배|복숭아|알로에|매실|자몽|레몬/ },
];
const typeOf = (p) => (DRINK_CATS.includes(p.category) ? TYPES.find((t) => t.re.test(p.name)) || null : null);
const mlOf = (p) => { const m = p.pack.volume.match(/^([\d.]+)(ml|L)$/); return m ? Number(m[1]) * (m[2] === "L" ? 1000 : 1) : 0; };
const per100 = (p) => (p.pack.count > 1 && mlOf(p) ? (p.salePrice / (p.pack.count * mlOf(p))) * 100 : null);

const CAT_TONE = { "음료수": "red", "커피음료": "brown", "시럽/소스/파우더": "amber", "과즙/어린이음료": "orange", "설탕/차/청류/액상": "green", "원두/믹스커피/스틱": "brown", "건강기능식품": "teal", "코스트코": "blue" };
const toneOf = (p) => CAT_TONE[p.category] || "slate";
function kindOf(p) {
  const n = p.name;
  if (/컵|장갑|빨대|일회용|봉투/.test(n)) return "cup";
  if (/믹스|스틱|티백|\d\s*T\b|\d+티|\d+포|크래커|젤리|과자|빵|크로와상/.test(n)) return "box";
  if (/캔/.test(n) || (mlOf(p) && mlOf(p) <= 355 && !/병|페트/.test(n))) return "can";
  if (/병|페트|\dL|시럽|원액|청/.test(n) || mlOf(p) > 355) return "bottle";
  if (/파우더|\d+\s*(g|kg)\b/i.test(n)) return "pouch";
  return "box";
}
// 사진이 없을 때 쓰는 포장 실루엣
const PACK = {
  can: `<rect x="34" y="18" width="52" height="86" rx="9" class="pk-b"/><ellipse cx="60" cy="20" rx="26" ry="6" class="pk-t"/><rect x="34" y="46" width="52" height="30" class="pk-l"/>`,
  bottle: `<path d="M52 8h16v14c0 6 14 10 14 24v58a8 8 0 0 1-8 8H46a8 8 0 0 1-8-8V46c0-14 14-18 14-24z" class="pk-b"/><rect x="50" y="4" width="20" height="9" rx="2" class="pk-t"/><rect x="38" y="58" width="44" height="30" class="pk-l"/>`,
  box: `<path d="M26 34l34-14 34 14v64l-34 14-34-14z" class="pk-b"/><path d="M26 34l34 14 34-14-34-14z" class="pk-t"/><path d="M60 48v64" class="pk-e"/><rect x="32" y="60" width="22" height="16" transform="skewY(22) translate(0 -22)" class="pk-l"/>`,
  cup: `<path d="M34 22h52l-7 88H41z" class="pk-b"/><rect x="30" y="16" width="60" height="10" rx="3" class="pk-t"/><path d="M38 50h44l-2 22H40z" class="pk-l"/>`,
  pouch: `<path d="M36 14h48l4 12-4 6v70a6 6 0 0 1-6 6H42a6 6 0 0 1-6-6V32l-4-6z" class="pk-b"/><rect x="36" y="14" width="48" height="8" class="pk-t"/><rect x="36" y="56" width="48" height="26" class="pk-l"/>`,
};
function packArt(p, size = "") {
  const spec = [p.pack.volume, p.pack.count > 1 ? `${p.pack.count}${p.pack.unit}` : ""].filter(Boolean).join(" × ");
  return `<div class="ph tone-${toneOf(p)} ${size}"><svg viewBox="0 0 120 120" class="pk" aria-hidden="true">${PACK[kindOf(p)]}</svg><b>${esc(shortName(p.name))}</b>${spec ? `<span>${esc(spec)}</span>` : ""}</div>`;
}

/* --- 3D (three3d.js) --- */
const TS3D = window.TS3D || null;
function info3d(p) {
  const core = shortName(p.name); const [brand, rest] = splitBrand(core);
  return { name: p.name, brand: brand || core, rest: brand ? rest : "", short: core, tone: toneOf(p), kind: kindOf(p),
    spec: [p.pack.volume, p.pack.count > 1 ? `${p.pack.count}${p.pack.unit}` : ""].filter(Boolean).join(" × ") };
}
let hero3d = null;
let pallet3d = null; let palletEl = null;
function mountPallet() {
  const mount = $("#palletMount");
  if (!TS3D || !mount) return;
  if (!palletEl) {
    palletEl = document.createElement("div");
    palletEl.className = "pallet3d__stage";
    palletEl.innerHTML = `<canvas aria-label="발주 수량을 팔레트 위 박스로 표시한 3D 그림"></canvas><p class="pallet3d__info num"></p><span class="pallet3d__hint">${matchMedia("(pointer: fine)").matches ? "드래그해서 돌려보기" : "밀어서 돌려보기"}</span>`;
    mount.appendChild(palletEl);
    try { pallet3d = TS3D.pallet(palletEl.querySelector("canvas")); } catch { pallet3d = null; palletEl.remove(); palletEl = null; return; }
  } else { mount.appendChild(palletEl); }
  $("#planner").classList.add("has3d");
  syncPallet();
}
function syncPallet() {
  if (!pallet3d) return;
  const r = buildPlan();
  const res = pallet3d.set(r.rows);
  const boxes = r.rows.reduce((s, x) => s + x.boxes, 0);
  palletEl.querySelector(".pallet3d__info").innerHTML = `<b>${boxes}박스</b> · 팔레트 ${Math.max(1, Math.ceil(res.shown / 48))}개${res.hidden ? ` <em>+${res.hidden}박스 더</em>` : ""}`;
}

/* --- 라인 일러스트 (민트 채움 + 진한 선) --- */
const STAR = (x, y, s) => `<path class="la-s" transform="translate(${x} ${y}) scale(${s})" d="M5 0l1.5 3.3 3.5.4-2.6 2.4.7 3.5L5 7.9 1.9 9.6l.7-3.5L0 3.7l3.5-.4z"/>`;
const LINE = {
  van: `<svg viewBox="0 0 160 120" class="la" aria-hidden="true">
    <path class="la-d" d="M10 96h140" stroke-dasharray="3 6"/>
    <path class="la-d" d="M4 52h12M2 62h16M6 72h10"/>
    <path class="la-f" d="M22 82V40a6 6 0 0 1 6-6h62v48z"/>
    <path class="la-f2" d="M90 46h24l18 18v18H90z"/>
    <path d="M22 82V40a6 6 0 0 1 6-6h62v48M90 46h24l18 18v18H90M22 82h110"/>
    <path class="la-w0" d="M96 52h16l12 12H96z"/>
    <rect x="30" y="56" width="18" height="16" rx="1"/><rect x="52" y="56" width="18" height="16" rx="1"/><rect x="41" y="40" width="18" height="16" rx="1"/>
    <path d="M39 56v6M61 56v6M50 40v6"/>
    <circle cx="44" cy="84" r="9" class="la-wh"/><circle cx="44" cy="84" r="3.5"/><circle cx="112" cy="84" r="9" class="la-wh"/><circle cx="112" cy="84" r="3.5"/>
    ${STAR(108, 14, 1.2)}${STAR(124, 22, 0.9)}
  </svg>`,
  receipt: `<svg viewBox="0 0 160 120" class="la" aria-hidden="true">
    <path class="la-f" d="M30 14h64v92l-8-6-8 6-8-6-8 6-8-6-8 6-8-6-8 6z"/>
    <path d="M30 14h64v92l-8-6-8 6-8-6-8 6-8-6-8 6-8-6-8 6zM42 32h40M42 44h28M42 56h36M42 68h20"/>
    <path d="M74 44h8M74 68h8"/>
    <circle cx="104" cy="70" r="20" class="la-f2"/><circle cx="104" cy="70" r="13" class="la-wh"/><path d="M118 84l16 16"/>
    <circle cx="128" cy="30" r="11" class="la-dk"/><path class="la-inv" d="M124.5 27a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3M128 36.5v.5"/>
  </svg>`,
  boxes: `<svg viewBox="0 0 160 120" class="la" aria-hidden="true">
    <path class="la-d" d="M8 104h144" stroke-dasharray="3 6"/>
    <rect x="34" y="66" width="36" height="34" class="la-f"/><rect x="72" y="66" width="36" height="34" class="la-f2"/><rect x="52" y="30" width="36" height="34" class="la-f"/>
    <path d="M34 66h36v34H34zM72 66h36v34H72zM52 30h36v34H52zM46 66v10M84 66v10M64 30v10"/>
    <path d="M118 22v76h18M118 98l-4 6M136 98l4 6"/><circle cx="114" cy="104" r="4" class="la-wh"/><circle cx="140" cy="104" r="4" class="la-wh"/>
    <path class="la-d" d="M20 40c4-4 8-4 12 0M14 52c4-4 8-4 12 0"/>
  </svg>`,
  repeat: `<svg viewBox="0 0 160 120" class="la" aria-hidden="true">
    <rect x="24" y="22" width="84" height="80" rx="6" class="la-f"/>
    <path d="M24 40h84M44 14v14M88 14v14"/><rect x="24" y="22" width="84" height="80" rx="6"/>
    <path d="M36 54l5 5 8-9M60 54l5 5 8-9M84 54l5 5 8-9M36 78l5 5 8-9M60 78l5 5 8-9"/><rect x="82" y="72" width="16" height="16" rx="2" class="la-wh"/>
    <circle cx="124" cy="80" r="18" class="la-dk"/><path class="la-inv" d="M124 70v10l7 5"/>
    <path d="M118 30a20 20 0 0 1 20 14l4-6M138 44l-7-1"/>
  </svg>`,
  clip: `<svg viewBox="0 0 200 130" class="la" aria-hidden="true">
    <rect x="44" y="12" width="78" height="106" rx="8" class="la-wh"/><rect x="68" y="6" width="30" height="14" rx="4" class="la-f2"/>
    <rect x="44" y="12" width="78" height="106" rx="8"/><rect x="68" y="6" width="30" height="14" rx="4"/>
    <path d="M58 40h30M58 54h50M58 68h42M58 82h46M58 96h24"/><path d="M96 40l4 4 8-8"/>
    <rect x="128" y="74" width="30" height="26" class="la-f"/><rect x="146" y="50" width="30" height="24" class="la-f2"/><rect x="128" y="74" width="30" height="26"/><rect x="146" y="50" width="30" height="24"/>
    <path d="M143 74v8M161 50v7"/><path d="M118 118h70" stroke-dasharray="3 5"/>
    <path d="M18 98l30-30 8 8-30 30-12 4z" class="la-f2"/><path d="M18 98l30-30 8 8-30 30-12 4zM44 72l8 8"/>
    ${STAR(160, 18, 1.4)}${STAR(178, 30, 1)}
  </svg>`,
};
const ICON = {
  calc: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11v6M8 15h2M12 15h2"/>`,
  truck: `<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.5"/><circle cx="17" cy="17.5" r="1.5"/>`,
  repeat: `<path d="M4 12a7 7 0 0 1 12-5l2 2M20 12a7 7 0 0 1-12 5l-2-2"/><path d="M18 4v5h-5M6 20v-5h5"/>`,
  search: `<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>`,
  bars: `<path d="M5 20V10M10 20V4M15 20v-7M20 20v-4"/>`,
  tag: `<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="7.5" r="1.3"/>`,
  sheet: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>`,
  clock: `<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>`,
  pin: `<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>`,
  grid: `<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>`,
};
const ico = (k, cls = "ico") => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${ICON[k]}</svg>`;
const initial = (p) => (splitBrand(p.name)[0] || p.name).slice(0, 1);

/* --- 히어로 벤토 --- */
let heroTimer = null; let heroIdx = 0; let heroItems = [];
function heroPicks() {
  const drinks = state.products.filter((p) => !p.soldOut && !p.options.length && typeOf(p));
  const best = drinks.find((p) => p.badge === "BEST") || [...drinks].sort((a, b) => a.rank - b.rank)[0];
  const deal = [...drinks].sort((a, b) => rateOf(b) - rateOf(a))[0];
  const cheap = [...drinks].filter((p) => p.unitPrice).sort((a, b) => a.unitPrice - b.unitPrice)[0];
  return [
    best && { p: best, label: "THIS WEEK BEST" },
    deal && deal !== best && { p: deal, label: "BIGGEST DROP" },
    cheap && cheap !== best && cheap !== deal && { p: cheap, label: "LOWEST PER UNIT" },
  ].filter(Boolean);
}
function renderBento() {
  heroItems = heroPicks();
  const free = state.products.filter((p) => feeOf(p) === 0).length;
  $("#heroFacts").innerHTML = `
    <div><dt>취급 상품</dt><dd class="num">${state.products.length}<small>종</small></dd></div>
    <div><dt>무료배송</dt><dd class="num">${free}<small>종</small></dd></div>
    <div><dt>당일 출고 마감</dt><dd class="num">${esc(CFG.todayShipCutoff || "-")}</dd></div>`;
  const last = store.get("ts.orders", [])[0];
  $("#bento").innerHTML = `
    <article class="pcard" id="pcard">
      <div class="pcard__media" id="pcardMedia"></div>
      <div class="pcard__body" id="pcardBody"></div>
      <div class="pcard__dots" id="pcardDots" role="tablist" aria-label="추천 상품 넘기기">${heroItems.map((_, i) => `<button type="button" role="tab" data-hero="${i}" aria-label="${i + 1}번째 추천"><i></i></button>`).join("")}</div>
    </article>
    <div class="tiles">
      <div class="tile tile--art">${LINE.van}<span class="tile__cap">문 앞까지 택배 · 박스 단위</span></div>
      <button class="tile" type="button" data-scroll="planner"><b>탕비실 계산기</b><small>인원만 넣으면 발주서</small>${ico("calc")}</button>
      <button class="tile" type="button" data-free-only><b>무료배송</b><small>${free}종 모아보기</small>${ico("truck")}</button>
      <div class="tile tile--dark"><span class="tag tag--neon">SAME-DAY</span><strong class="num" data-cutoff>--:--:--</strong><small>${esc(CFG.todayShipCutoff || "")} 전 결제 시 오늘 출발</small><div class="tile__track" aria-hidden="true"><i data-dayprogress></i></div></div>
      ${last ? `<button class="tile" type="button" data-reorder><b>지난 주문</b><small>그대로 다시 담기</small>${ico("repeat")}</button>`
        : `<button class="tile" type="button" data-word="제로"><b>인기 검색어</b><small>제로 · 탄산수 · 시럽</small>${ico("search")}</button>`}
      <button class="tile" type="button" data-scroll="compare"><b>100ml당 비교</b><small>같은 기준 가격표</small>${ico("bars")}</button>
    </div>`;
  if (TS3D) {
    const cv = document.createElement("canvas");
    cv.className = "pcard__canvas"; cv.setAttribute("aria-hidden", "true");
    $("#pcardMedia").appendChild(cv);
    TS3D.ready.then(() => {
      try { hero3d = TS3D.hero(cv, []); $("#pcardMedia").classList.add("has3d"); showHero(heroIdx, true); } catch { cv.remove(); }
    });
  }
  showHero(0);
  const card = $("#pcard");
  const stop = () => clearInterval(heroTimer);
  const start = () => { stop(); if (heroItems.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) heroTimer = setInterval(() => showHero((heroIdx + 1) % heroItems.length), 6000); };
  card.addEventListener("pointerenter", stop); card.addEventListener("pointerleave", start);
  card.addEventListener("focusin", stop); card.addEventListener("focusout", start);
  start();
}
function showHero(i, only3d = false) {
  heroIdx = i;
  const it = heroItems[i]; if (!it) return;
  const p = it.p;
  if (hero3d) hero3d.show(info3d(p));
  if (only3d) return;
  $("#pcard").dataset.id = p.id;
  const media = $("#pcardMedia");
  media.querySelectorAll(".pcard__img, .ph").forEach((n) => n.remove());
  const img = document.createElement("img");
  img.className = "pcard__img"; img.alt = p.name; img.src = p.image;
  media.prepend(img);
  const t = typeOf(p);
  const similar = state.products.filter((q) => q !== p && !q.soldOut && typeOf(q) === t && q.unitPrice).sort((a, b) => a.unitPrice - b.unitPrice).slice(0, 3);
  const spec = [p.pack.volume, p.pack.count > 1 ? `${p.pack.count}${p.pack.unit}` : ""].filter(Boolean).join(" × ");
  $("#pcardBody").innerHTML = `
    <div class="pcard__head">
      <span class="tag tag--mint">${esc(it.label)}</span>
      <h3>${esc(shortName(p.name))}</h3>
      <p class="mono">${esc(spec)}${spec ? " · " : ""}No.${esc(p.id)}</p>
      <div class="pcard__btns"><button class="btn btn--ghost btn--sm" type="button" data-act="open">상품 상세 보기</button><button class="btn btn--dark btn--sm" type="button" data-act="add">담기</button></div>
    </div>
    <p class="pcard__label">한눈에 보기</p>
    <div class="offer">
      <div class="offer__top"><span class="sq tone-${toneOf(p)}">${esc(initial(p))}</span><b>투스타몰 판매가</b><span class="tag tag--mint tag--sm">BEST OFFER</span></div>
      <div class="offer__m">
        <div><b class="num">${rateOf(p) ? `${rateOf(p)}%` : "—"}</b><small>할인율</small></div>
        <div><b class="num">${won(p.salePrice)}</b><small>판매가</small></div>
        <div><b class="num">${p.unitPrice ? won(p.unitPrice) : "—"}</b><small>${esc(p.pack.unit)}당</small></div>
      </div>
    </div>
    ${similar.length ? `<p class="pcard__label">비슷한 상품</p>
    <ul class="others">${similar.map((q) => `<li data-id="${esc(q.id)}"><button type="button" data-act="open">
      <span class="sq tone-${toneOf(q)}">${esc(initial(q))}</span><span class="others__name">${esc(shortName(q.name))}</span>
      <span class="others__price num">${won(q.unitPrice)}<small>/${esc(q.pack.unit)}</small></span><span class="dot-tag ${feeOf(q) === 0 ? "is-free" : ""}">${feeOf(q) === 0 ? "무료배송" : "배송비"}</span>
    </button></li>`).join("")}</ul>` : ""}`;
  document.querySelectorAll("#pcardDots button").forEach((d, k) => {
    d.setAttribute("aria-selected", k === i);
    const bar = d.querySelector("i"); bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
  });
}

/* --- 문제 제기 3칸 --- */
function renderDilemma() {
  const free = state.products.filter((p) => feeOf(p) === 0).length;
  const items = [
    { art: LINE.receipt, title: "제각각인 용량과 입수", text: "355ml × 24캔과 1.5L × 12병, 어느 쪽이 싼지 매번 계산해야 합니다.", fix: "100ml당 가격 비교", go: "compare" },
    { art: LINE.boxes, title: "무겁고 자리 차지하는 박스", text: "생수·탄산 박스를 사러 마트를 오가는 시간과 수고가 듭니다.", fix: `무료배송 ${free}종`, free: true },
    { art: LINE.repeat, title: "끝없이 반복되는 발주", text: "탕비실이 비면 다시 인원과 수량을 세고 장바구니를 채워야 합니다.", fix: "탕비실 계산기", go: "planner" },
  ];
  $("#dilemma").innerHTML = items.map((d) => `
    <article class="dl">
      <div class="dl__art">${d.art}</div>
      <h3>${esc(d.title)}</h3>
      <p>${esc(d.text)}</p>
      <button class="dl__fix" type="button" ${d.go ? `data-scroll="${d.go}"` : "data-free-only"}>${esc(d.fix)}으로 해결 →</button>
    </article>`).join("");
}

/* --- 카테고리 아이콘 --- */
const CAT_ICON = {
  "음료수": `<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M8 8h8M8 16h8"/>`,
  "커피음료": `<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>`,
  "시럽/소스/파우더": `<path d="M9 9h6v11a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z"/><path d="M10 9V6h4v3M12 6V3h4"/>`,
  "과즙/어린이음료": `<path d="M7 8h10v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z"/><path d="M7 8l2-3h6l2 3M14 5l2-3"/>`,
  "설탕/차/청류/액상": `<path d="M6 8h12v10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"/><path d="M5 5h14v3H5z"/>`,
  "원두/믹스커피/스틱": `<ellipse cx="12" cy="12" rx="6" ry="8" transform="rotate(30 12 12)"/><path d="M9 6c3 3 3 9 6 12"/>`,
  "생활잡화": `<path d="M8 10h8v10H8zM10 10V6h4v4M14 7h3"/>`,
  "코스트코": `<path d="M3 10l9-6 9 6v10H3z"/><path d="M8 20v-6h8v6"/>`,
  "종이컵/일회용품": `<path d="M6 5h12l-1.5 15h-9z"/><path d="M6.5 9h11"/>`,
  "건강기능식품": `<rect x="4" y="9" width="16" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="M10 9.5l4 5"/>`,
};
function renderCatIcons() {
  const count = {};
  state.products.forEach((p) => (count[p.category] = (count[p.category] || 0) + 1));
  const cats = Object.keys(count).filter((c) => c !== "기타").sort((a, b) => count[b] - count[a]);
  $("#catIcons").innerHTML = cats.map((c) => `<button type="button" data-cat-ico="${esc(c)}"><span class="ci tone-${CAT_TONE[c] || "slate"}"><svg viewBox="0 0 24 24" aria-hidden="true">${CAT_ICON[c] || `<rect x="5" y="5" width="14" height="14" rx="3"/>`}</svg></span><b>${esc(c.split("/")[0])}</b><small>${count[c]}</small></button>`).join("");
}

/* --- 탕비실 계산기 --- */
const PERIODS = [{ id: 5, label: "1주" }, { id: 10, label: "2주" }, { id: 22, label: "한 달" }];
const plan = { people: 20, days: 10, perDay: 1.5, types: ["soda", "coffee", "tea"], swap: {} };
function candidates(typeId) {
  return state.products
    .filter((p) => !p.soldOut && !p.options.length && typeOf(p)?.id === typeId && p.pack.count >= 10 && mlOf(p) >= 150 && mlOf(p) <= 600)
    .sort((a, b) => (feeOf(a) > 0) - (feeOf(b) > 0) || a.unitPrice - b.unitPrice);
}
function buildPlan() {
  const need = Math.ceil(plan.people * plan.days * plan.perDay);
  const types = plan.types.length ? plan.types : ["soda"];
  const share = Math.ceil(need / types.length);
  const rows = types.map((t) => {
    const list = candidates(t);
    if (!list.length) return null;
    const p = list[(plan.swap[t] || 0) % list.length];
    const boxes = Math.max(1, Math.ceil(share / p.pack.count));
    return { t: TYPES.find((x) => x.id === t), p, boxes, units: boxes * p.pack.count, alt: list.length };
  }).filter(Boolean);
  const items = rows.map((r) => ({ key: keyOf(r.p.id, {}), id: r.p.id, opts: {}, qty: r.boxes }));
  const t = totals(items);
  const units = rows.reduce((s, r) => s + r.units, 0);
  return { need, rows, items, t, units, perPersonDay: t.total / (plan.people * plan.days) };
}
function planStatsHtml(r) {
  const cells = 60;
  const waffle = r.rows.flatMap((row) => Array.from({ length: Math.round((row.units / r.units) * cells) }, () => row.t.tone)).slice(0, cells);
  while (waffle.length < cells) waffle.push(r.rows.at(-1)?.t.tone || "slate");
  return `<dl class="stats">
      <div><dt>예상 소비량</dt><dd class="num">${r.need.toLocaleString()}<small>잔</small></dd></div>
      <div><dt>발주 수량</dt><dd class="num">${r.units.toLocaleString()}<small>개</small></dd></div>
      <div><dt>1인 1일</dt><dd class="num">${won(r.perPersonDay)}</dd></div>
    </dl>
    <div class="waffle" aria-hidden="true">${waffle.map((t) => `<i class="tone-${t}"></i>`).join("")}</div>`;
}
function planOrderHtml(r) {
  return `<p class="step__title">발주서</p>
    <ul class="order">
      ${r.rows.map((row) => `<li data-id="${esc(row.p.id)}">
        <i class="sw tone-${row.t.tone}"></i>
        <div class="order__name"><b>${esc(row.t.label)}</b><span>${esc(row.p.name)}</span><small class="num">${row.p.pack.unit}당 ${won(row.p.unitPrice)} · ${row.units}${row.p.pack.unit}</small></div>
        <div class="order__qty num">${row.boxes}박스<span>${won(row.p.salePrice * row.boxes)}</span></div>
        ${row.alt > 1 ? `<button type="button" class="order__swap" data-pl-swap="${row.t.id}" aria-label="${esc(row.t.label)} 다른 상품으로">바꾸기</button>` : ""}
      </li>`).join("")}
    </ul>
    <div class="order__foot">
      <div><span>합계${r.t.shipping ? ` · 배송비 ${won(r.t.shipping)} 포함` : " · 무료배송"}</span><strong class="num">${won(r.t.total)}</strong></div>
      <button type="button" class="btn btn--dark btn--block" data-pl-add ${r.rows.length ? "" : "disabled"}>발주서 그대로 담기 <span aria-hidden="true">→</span></button>
    </div>`;
}
function updatePlan() {
  const r = buildPlan();
  $("#planStats").innerHTML = planStatsHtml(r);
  $("#planOrder").innerHTML = planOrderHtml(r);
  syncPallet();
}
function renderPlanner() {
  const r = buildPlan();
  $("#planner").innerHTML = `
    <div class="planner__head">
      <div><span class="tag tag--mint">HOW IT WORKS</span><h2 id="plannerTitle">탕비실 음료,<br>3단계면 발주 끝.</h2></div>
      <p>인원·기간·종류만 고르면 가성비 좋은 박스로 발주서를 짜고, 팔레트에 쌓아 보여드립니다. 1인 하루 ${plan.perDay}잔 기준.</p>
    </div>
    <div class="steps">
      <article class="step">
        <div class="step__card planner__controls">
          <div class="ctl">
            <label for="pl-people">인원 <output class="num">${plan.people}명</output></label>
            <input type="range" id="pl-people" min="3" max="150" step="1" value="${plan.people}" data-pl="people">
            <div class="ctl__scale num"><span>3</span><span>50</span><span>100</span><span>150</span></div>
          </div>
          <div class="ctl">
            <span class="ctl__name">기간</span>
            <div class="seg" role="radiogroup" aria-label="기간">${PERIODS.map((d) => `<button type="button" role="radio" aria-checked="${plan.days === d.id}" data-pl-days="${d.id}">${d.label}<small>${d.id}일</small></button>`).join("")}</div>
          </div>
          <div class="ctl">
            <span class="ctl__name">무엇을 마시나요? <small>여러 개 선택</small></span>
            <div class="seg seg--multi">${TYPES.map((t) => `<button type="button" aria-pressed="${plan.types.includes(t.id)}" data-pl-type="${t.id}"><i class="sw tone-${t.tone}"></i>${t.label}</button>`).join("")}</div>
          </div>
        </div>
        <div class="step__cap"><b>Step 1</b><span>인원·기간·마실 종류를 고릅니다.</span></div>
      </article>
      <article class="step">
        <div class="step__card step__card--viz"><div class="pallet3d" id="palletMount"></div><div id="planStats">${planStatsHtml(r)}</div></div>
        <div class="step__cap"><b>Step 2</b><span>필요한 양을 박스로 계산해 팔레트에 쌓아 봅니다.</span></div>
      </article>
      <article class="step">
        <div class="step__card" id="planOrder">${planOrderHtml(r)}</div>
        <div class="step__cap"><b>Step 3</b><span>발주서를 확인하고 그대로 장바구니에 담습니다.</span></div>
      </article>
    </div>`;
  mountPallet();
}

/* --- 오늘의 할인 / 가격 비교 / 발주 표 --- */
function renderDeals() {
  const list = state.products.filter((p) => !p.soldOut && rateOf(p) >= 15).sort((a, b) => rateOf(b) - rateOf(a)).slice(0, 14);
  $("#deals").innerHTML = list.map(itemHtml).join("");
}
let cmpType = "soda";
function renderCompare() {
  const list = state.products.filter((p) => !p.soldOut && typeOf(p)?.id === cmpType && per100(p)).sort((a, b) => per100(a) - per100(b)).slice(0, 8);
  const max = Math.max(...list.map(per100), 1);
  const t = TYPES.find((x) => x.id === cmpType);
  $("#compare").innerHTML = `
    <div class="compare__head">
      <div><span class="tag tag--mint">PRICE / 100ML</span><h2 id="compareTitle">100ml당 가격,<br>한눈에 비교.</h2></div>
      <p>용량과 입수가 달라도 같은 기준으로 봅니다. 막대가 짧을수록 저렴합니다.</p>
    </div>
    <div class="compare__card">
      <div class="pills" role="tablist">${TYPES.map((x) => `<button type="button" role="tab" aria-selected="${x.id === cmpType}" data-cmp="${x.id}"><i class="sw tone-${x.tone}"></i>${x.label}</button>`).join("")}</div>
      <ol class="bars tone-${t.tone}">
        ${list.map((p, i) => `<li data-id="${esc(p.id)}">
          <button type="button" class="bars__row" data-act="open">
            <span class="bars__name">${i === 0 ? `<em>최저</em>` : ""}${esc(p.name)}</span>
            <span class="bars__track"><i style="width:${Math.max(6, (per100(p) / max) * 100)}%"></i></span>
            <span class="bars__val num"><b>${won(per100(p))}</b><small>${p.pack.unit}당 ${won(p.unitPrice)}</small></span>
          </button>
        </li>`).join("")}
      </ol>
    </div>`;
}
let rankCat = "전체";
function renderRank() {
  const count = {};
  state.products.forEach((p) => (count[p.category] = (count[p.category] || 0) + 1));
  const cats = ["전체", ...Object.keys(count).filter((c) => c !== "기타").sort((a, b) => count[b] - count[a]).slice(0, 7)];
  const list = state.products.filter((p) => !p.soldOut && (rankCat === "전체" || p.category === rankCat)).sort((a, b) => a.rank - b.rank).slice(0, 10);
  // 같은 음료 종류 평균 개당가 대비 (툴팁)
  const avg = {};
  TYPES.forEach((t) => { const l = state.products.filter((p) => typeOf(p) === t && p.unitPrice); avg[t.id] = l.reduce((s, p) => s + p.unitPrice, 0) / (l.length || 1); });
  const co = CFG.company || {};
  $("#dash").innerHTML = `
    <aside class="dash__side">
      <div class="dash__logo"><svg class="mark" viewBox="0 0 40 24" aria-hidden="true"><path class="mark__a" d="M11 1.5l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L11 16.7l-6.1 3.4 1.4-6.8L1.2 8.6l6.9-.8z"/><path class="mark__b" d="M27 3.5l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L27 18.7l-6.1 3.4 1.4-6.8-5.1-4.7 6.9-.8z"/></svg>투스타몰</div>
      <nav class="dash__nav" role="tablist" aria-label="카테고리">${cats.map((c) => `<button type="button" role="tab" data-rank="${esc(c)}" aria-selected="${c === rankCat}"><svg viewBox="0 0 24 24" aria-hidden="true">${c === "전체" ? ICON.grid : CAT_ICON[c] || ICON.grid}</svg>${esc(c === "전체" ? "추천 전체" : c.split("/")[0])}</button>`).join("")}</nav>
      <div class="dash__user"><span class="avatar">TS</span><div><b>고객센터</b><small class="num">${esc(co.tel || "")}</small></div></div>
    </aside>
    <div class="dash__main">
      <header class="dash__top"><h3>${esc(rankCat === "전체" ? "추천 상품" : rankCat)}</h3><button class="btn btn--ghost btn--sm" type="button" data-open-cart>${ico("sheet")} 장바구니 보기</button></header>
      <div class="dash__tools"><span class="tag tag--mint tag--sm">TOP ${list.length}</span><span>행에 마우스를 올리면 같은 종류 평균과 비교합니다.</span></div>
      <div class="dash__table" role="table" aria-label="추천 상품 표">
        <div class="trow trow--head" role="row"><span role="columnheader">상품</span><span role="columnheader">구성</span><span role="columnheader">개당</span><span role="columnheader">판매가</span><span role="columnheader">할인</span><span role="columnheader">배송</span><span role="columnheader"><span class="sr-only">담기</span></span></div>
        ${list.map((p) => {
          const t = typeOf(p); const a = t && avg[t.id]; const diff = a && p.unitPrice ? Math.round((1 - p.unitPrice / a) * 100) : null;
          return `<div class="trow item" role="row" data-id="${esc(p.id)}">
            <span class="trow__p" role="cell"><button type="button" class="trow__img" data-act="open" aria-label="${esc(p.name)}"><img src="${esc(p.image)}" alt="" loading="lazy"></button><span data-act="open"><b>${esc(shortName(p.name))}</b><small class="mono">No.${esc(p.id)}</small></span></span>
            <span role="cell" class="num">${esc([p.pack.volume, p.pack.count > 1 ? `${p.pack.count}${p.pack.unit}` : ""].filter(Boolean).join(" × ") || "—")}</span>
            <span role="cell" class="num">${p.unitPrice ? won(p.unitPrice) : "—"}</span>
            <span role="cell" class="num"><b>${won(p.salePrice)}</b></span>
            <span role="cell" class="num trow__rate">${rateOf(p) ? `${rateOf(p)}%` : "—"}</span>
            <span role="cell"><span class="dot-tag ${feeOf(p) === 0 ? "is-free" : ""}">${feeOf(p) === 0 ? "무료배송" : won(feeOf(p))}</span></span>
            <span role="cell" class="item__act">${mediaActions(p)}</span>
            ${diff !== null ? `<span class="trow__tip" aria-hidden="true"><b>${diff >= 0 ? "평균보다 저렴" : "평균보다 비쌈"}</b> ${Math.abs(diff)}%<small>${esc(t.label)} 평균 개당 ${won(a)}</small></span>` : ""}
          </div>`;
        }).join("")}
      </div>
    </div>`;
  $("#features").innerHTML = [
    ["tag", "모든 박스에 개당 가격", "캔·병·스틱 단위 가격을 함께 보여줘 바로 비교됩니다."],
    ["sheet", "한 화면 주문서", "수량·배송지·결제수단을 한 화면에서 끝냅니다."],
    ["clock", `${CFG.todayShipCutoff || ""} 전 결제 시 오늘 출발`, "마감까지 남은 시간을 상단에서 계속 보여줍니다."],
    ["pin", "배송지·결제수단 기억", "두 번째 주문부터는 자동으로 채워집니다."],
  ].map(([i, t, d]) => `<article class="feat">${ico(i)}<h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join("");
}
function renderBiz() {
  const co = CFG.company || {};
  $("#biz").innerHTML = `
    <div class="band__in">
      <div class="band__copy"><span class="tag tag--dark">GET STARTED</span><h2 id="bizTitle">대량 구매·정기 납품,<br>지금 상담하세요.</h2></div>
      <div class="band__card">
        <div class="band__art">${LINE.clip}</div>
        <p>카페·사무실·단체 납품은 담당자가 견적부터 세금계산서까지 챙깁니다. ${esc(co.hours || "")}</p>
        <div class="band__btns">
          <button class="btn btn--dark" type="button" data-copy="${esc(co.tel || "")}"><span class="num">${esc(co.tel || "")}</span> 번호 복사 <span aria-hidden="true">→</span></button>
          <button class="btn btn--white" type="button" data-scroll="planner">탕비실 계산하기</button>
        </div>
      </div>
    </div>`;
}

const isHome = () => state.cat === "전체" && !state.coll && !state.q.trim();
function renderHome() {
  $("#home").hidden = !isHome();
  if (!isHome()) return;
  renderPlanner(); renderDeals(); renderCompare(); renderRank();
}
function scrollToList() { $("#listTop").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }

function bindHome() {
  $("#home").addEventListener("input", (e) => {
    if (e.target.dataset.pl === "people") {
      plan.people = Number(e.target.value);
      e.target.previousElementSibling.querySelector("output").textContent = `${plan.people}명`;
      updatePlan();
    }
  });
  $("#home").addEventListener("click", (e) => {
    const t = e.target;
    const hd = t.closest("[data-hero]"); if (hd) return showHero(Number(hd.dataset.hero));
    const w = t.closest("[data-word]"); if (w) { $("#q").value = w.dataset.word; state.q = w.dataset.word; state.limit = PAGE; renderAll(); return scrollToList(); }
    if (t.closest("[data-reorder]")) { const last = store.get("ts.orders", [])[0]; last?.items.forEach((i) => state.byId.has(i.id) && addToCart(i.id, i.options || {}, i.qty)); return toast("지난 주문을 담았어요"); }
    const ci = t.closest("[data-cat-ico]"); if (ci) { state.cat = ci.dataset.catIco; state.coll = null; state.limit = PAGE; renderAll(); return scrollToList(); }
    const days = t.closest("[data-pl-days]"); if (days) { plan.days = Number(days.dataset.plDays); return renderPlanner(); }
    const ty = t.closest("[data-pl-type]"); if (ty) { const id = ty.dataset.plType; plan.types = plan.types.includes(id) ? plan.types.filter((x) => x !== id) : [...plan.types, id]; if (!plan.types.length) plan.types = [id]; return renderPlanner(); }
    const sw = t.closest("[data-pl-swap]"); if (sw) { plan.swap[sw.dataset.plSwap] = (plan.swap[sw.dataset.plSwap] || 0) + 1; return updatePlan(); }
    if (t.closest("[data-pl-add]")) { buildPlan().items.forEach((i) => addToCart(i.id, {}, i.qty)); return toast("발주서를 장바구니에 담았어요"); }
    const cm = t.closest("[data-cmp]"); if (cm) { cmpType = cm.dataset.cmp; return renderCompare(); }
    const rk = t.closest("[data-rank]"); if (rk) { rankCat = rk.dataset.rank; return renderRank(); }
    const gc = t.closest("[data-goto-coll]"); if (gc) { state.coll = gc.dataset.gotoColl; state.limit = PAGE; renderAll(); return scrollToList(); }
  });
}
// 홈 밖에서도 쓰는 버튼: 섹션 이동, 주문하기, 무료배송 모아보기, 번호 복사
function bindGlobal() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("#sheet")) return;
    const sc = t.closest("[data-scroll]");
    if (sc) {
      const id = sc.dataset.scroll;
      if (id !== "listTop" && !isHome()) { state.cat = "전체"; state.coll = null; state.q = ""; $("#q").value = ""; renderAll(); }
      return $(`#${id}`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
    if (t.closest("#navOrder") || t.closest("[data-open-cart]")) return openCheckout(state.cart, "cart");
    if (t.closest("[data-free-only]")) { state.freeOnly = true; $("#freeOnly").setAttribute("aria-pressed", "true"); state.limit = PAGE; renderGrid(); return scrollToList(); }
    const cp = t.closest("[data-copy]");
    if (cp) { const v = cp.dataset.copy; navigator.clipboard?.writeText(v).then(() => toast(`${v} 복사했어요`), () => toast(v)); }
  });
}

function renderAll() { renderTabs(); renderHero(); renderHome(); renderGrid(); }

/* ---------------- 이벤트 ---------------- */
function bind() {
  $("#cats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    state.cat = b.dataset.cat; state.coll = null; state.limit = PAGE;
    renderAll();
    $(`[data-cat="${CSS.escape(state.cat)}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
    window.scrollTo({ top: Math.min(window.scrollY, $("#cats").offsetTop) });
  });
  $("#promos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-coll]"); if (!b) return;
    state.coll = state.coll === b.dataset.coll ? null : b.dataset.coll; state.cat = "전체"; state.limit = PAGE;
    renderAll();
    if (state.coll) scrollToList();
  });
  $("#resultCount").addEventListener("click", (e) => {
    if (!e.target.closest("[data-clear-coll]")) return;
    state.coll = null; state.limit = PAGE; renderAll();
  });
  let qt;
  $("#q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { const wasHome = isHome(); state.q = e.target.value; state.limit = PAGE; if (wasHome !== isHome()) renderAll(); else renderGrid(); }, 160); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; state.limit = PAGE; renderGrid(); });
  $("#freeOnly").addEventListener("click", (e) => { state.freeOnly = !state.freeOnly; e.currentTarget.setAttribute("aria-pressed", state.freeOnly); state.limit = PAGE; renderGrid(); });
  const more = () => { state.limit += PAGE; renderGrid(); };
  $("#more").addEventListener("click", more);
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => es[0].isIntersecting && !$("#more").hidden && state.limit < PAGE * 3 && more(), { rootMargin: "800px" }).observe($("#more")); // 120개까지만 자동으로, 그 뒤는 버튼(푸터가 보이도록)

  $(".shelf").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const p = state.byId.get(b.closest("[data-id]")?.dataset.id); if (!p) return;
    const act = b.dataset.act;
    if (act === "open") return openProduct(p);
    if (act === "add") { if (p.options.length) return openProduct(p); addToCart(p.id); return toast("장바구니에 담았어요"); }
    if (act === "inc" || act === "dec") { setQty(state.cart, keyOf(p.id, {}), cartQty(p) + (act === "inc" ? 1 : -1)); commitCart(); }
  });

  $("#barCheckout").addEventListener("click", () => openCheckout(state.cart, "cart"));
  $("#openCart").addEventListener("click", () => openCheckout(state.cart, "cart"));
  $("#sheetClose").addEventListener("click", closeSheet);
  $("#scrim").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
  $("#sheet").addEventListener("input", (e) => { if (e.target.name === "phone") e.target.value = formatPhone(e.target.value); });

  $("#sheet").addEventListener("click", (e) => {
    const c = sheet; if (!c) return;
    const t = e.target;
    const opt = t.closest("[data-opt]");
    if (opt && c.type === "product") { c.opts[opt.dataset.opt] = opt.dataset.val; opt.parentElement.querySelectorAll("[data-opt]").forEach((b) => b.setAttribute("aria-pressed", b === opt)); $("#sheetFoot").innerHTML = productFoot(); return; }
    const step = t.closest("[data-step]");
    if (step) {
      const d = Number(step.dataset.step);
      if (c.type === "product") { c.qty = Math.max(1, Math.min(99, c.qty + d)); step.parentElement.querySelector("output").textContent = c.qty; $("#sheetFoot").innerHTML = productFoot(); return; }
      if (c.type === "checkout") {
        keepDraft();
        const it = c.items.find((x) => x.key === step.dataset.key); if (!it) return;
        setQty(c.items, it.key, it.qty + d);
        if (c.source === "cart") { state.cart = c.items.map((x) => ({ ...x })); commitCart(); }
        return renderCheckout();
      }
    }
    const rm = t.closest("[data-remove]");
    if (rm && c.type === "checkout") { keepDraft(); setQty(c.items, rm.dataset.remove, 0); if (c.source === "cart") { state.cart = c.items.map((x) => ({ ...x })); commitCart(); } return renderCheckout(); }
    const pay = t.closest("[data-pay]");
    if (pay && c.type === "checkout") { keepDraft(); c.pay = pay.dataset.pay; return renderCheckout(); }
    const vw = t.closest("[data-view]");
    if (vw) { const box = vw.closest(".pd3d"); box.classList.toggle("is-3d", vw.dataset.view === "3d"); box.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b === vw)); return; }
    const cp = t.closest("[data-copy]");
    if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => toast("계좌번호를 복사했어요"), () => toast(cp.dataset.copy)); return; }

    const act = t.closest("[data-act]")?.dataset.act;
    if (act === "p-cart") { addToCart(c.p.id, { ...c.opts }, c.qty); closeSheet(); return toast("장바구니에 담았어요"); }
    if (act === "p-buy") return openCheckout([{ key: keyOf(c.p.id, c.opts), id: c.p.id, opts: { ...c.opts }, qty: c.qty }], "now");
    if (act === "edit-ship") { c.editShip = true; return renderCheckout(); }
    if (act === "postcode") return openPostcode();
    if (act === "pay") return submitOrder();
    if (act === "close") return closeSheet();
  });
}

function renderFooter() {
  const co = CFG.company || {};
  $("#foot").innerHTML = `
    <div class="foot__in">
      <div class="foot__row">
        <span>© ${new Date().getFullYear()} ${esc(CFG.name || "투스타몰")}</span>
        <nav aria-label="하단 바로가기">
          <button type="button" data-scroll="listTop">전체 상품</button><button type="button" data-scroll="planner">탕비실 계산기</button>
          <button type="button" data-scroll="compare">가격 비교</button><button type="button" data-scroll="biz">대량 구매</button>
        </nav>
      </div>
      <div class="foot__info">
        <p>${[co.name && `<b>${esc(co.name)}</b>`, co.ceo && `대표 ${esc(co.ceo)}`, co.bizNo && `사업자등록번호 ${esc(co.bizNo)}`, co.mailOrderNo && `통신판매업신고 ${esc(co.mailOrderNo)}`].filter(Boolean).join(" · ")}</p>
        <p>${[co.address && esc(co.address), co.tel && `고객센터 ${esc(co.tel)}`, co.hours && esc(co.hours), co.email && esc(co.email)].filter(Boolean).join(" · ")}</p>
        ${(CFG.bankAccounts || []).length ? `<p>무통장입금 ${CFG.bankAccounts.map((b) => `${esc(b.bank)} ${esc(b.number)}`).join(" / ")} (예금주 ${esc(CFG.bankHolder || "")})</p>` : ""}
      </div>
      <div class="foot__mark" aria-hidden="true">
        <svg viewBox="0 0 40 24"><path d="M11 1.5l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L11 16.7l-6.1 3.4 1.4-6.8L1.2 8.6l6.9-.8z"/><path d="M27 3.5l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L27 18.7l-6.1 3.4 1.4-6.8-5.1-4.7 6.9-.8z"/></svg>
        <span>TWOSTAR</span>
      </div>
    </div>`;
}

// 마우스를 따라 기울어지는 입체 효과
function bindTilt() {
  if (!matchMedia("(pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const SEL = ".item__media, .promo, .caticons button, .tile, .pcard, .feat, .dl, .step__card";
  let cur = null;
  const reset = (el) => { el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); el.classList.remove("is-tilt"); };
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(SEL);
    if (cur && cur !== el) { reset(cur); cur = null; }
    if (!el) return;
    cur = el;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
    const k = el.matches(".pcard, .step__card") ? 2.5 : el.matches(".tile, .feat, .dl") ? 6 : 9;
    el.classList.add("is-tilt");
    el.style.setProperty("--rx", `${((0.5 - y) * k).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * k).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  }, { passive: true });
  document.addEventListener("pointerleave", () => cur && reset(cur));
}

(async function init() {
  bindTilt();
  bindImageFallback();
  bind();
  renderFooter();
  state.products = await loadProducts();
  state.byId = new Map(state.products.map((p) => [p.id, p]));
  state.cart = state.cart.filter((x) => state.byId.has(x.id));
  renderBento(); renderDilemma(); renderCatIcons(); renderBiz();
  renderAll(); renderBar();
  bindHome(); bindGlobal();
  startCountdown();
  window.addEventListener("resize", renderBar);
})();
