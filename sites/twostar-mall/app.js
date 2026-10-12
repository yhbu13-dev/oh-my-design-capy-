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
  cat: "전체", q: "", sort: "popular", freeOnly: false, limit: PAGE,
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

/* ---------------- 목록 ---------------- */
function renderTabs() {
  const count = {};
  state.products.forEach((p) => (count[p.category] = (count[p.category] || 0) + 1));
  const cats = Object.keys(count).sort((a, b) => (a === "기타") - (b === "기타") || count[b] - count[a]);
  $("#cats").innerHTML = ["전체", ...cats].map((c) => `<button class="tab" type="button" role="tab" data-cat="${esc(c)}" aria-selected="${c === state.cat}">${esc(c)}</button>`).join("");
}

function visible() {
  const q = state.q.trim().toLowerCase().replace(/\s+/g, "");
  const list = state.products.filter((p) =>
    (state.cat === "전체" || p.category === state.cat) &&
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
  $("#resultCount").innerHTML = `<b>${list.length.toLocaleString()}</b>개 상품`;
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
}
function productBody(p) {
  const { opts } = sheet;
  const comp = [p.pack.volume, p.pack.count > 1 ? `${p.pack.count}${p.pack.unit}` : ""].filter(Boolean).join(" × ");
  return `
    <div class="pd__media"><img src="${esc(p.image)}" alt="${esc(p.name)}"></div>
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
    const p = state.byId.get(img.closest(".item")?.dataset.id) || state.products.find((x) => x.name === img.alt) || (sheet?.type === "product" ? sheet.p : null);
    const ph = document.createElement("div");
    ph.className = "ph" + (img.closest(".line__img") ? " ph--sm" : "");
    const spec = p ? [p.pack.volume, p.pack.count > 1 ? `${p.pack.count}${p.pack.unit}` : ""].filter(Boolean).join(" × ") : "";
    ph.innerHTML = `<b>${esc(p ? shortName(p.name) : "투스타몰")}</b>${spec ? `<span>${esc(spec)}</span>` : ""}`;
    img.replaceWith(ph);
  }, true);
}

/* ---------------- 이벤트 ---------------- */
function bind() {
  $("#cats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    state.cat = b.dataset.cat; state.limit = PAGE;
    renderTabs(); renderGrid();
    $(`[data-cat="${CSS.escape(state.cat)}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
    window.scrollTo({ top: Math.min(window.scrollY, $("#cats").offsetTop) });
  });
  let qt;
  $("#q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { state.q = e.target.value; state.limit = PAGE; renderGrid(); }, 120); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; state.limit = PAGE; renderGrid(); });
  $("#freeOnly").addEventListener("click", (e) => { state.freeOnly = !state.freeOnly; e.currentTarget.setAttribute("aria-pressed", state.freeOnly); state.limit = PAGE; renderGrid(); });
  const more = () => { state.limit += PAGE; renderGrid(); };
  $("#more").addEventListener("click", more);
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => es[0].isIntersecting && !$("#more").hidden && more(), { rootMargin: "800px" }).observe($("#more"));

  $("#grid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const p = state.byId.get(b.closest(".item")?.dataset.id); if (!p) return;
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
    ${co.tel ? `<p class="cs">고객센터 ${esc(co.tel)}<small>${esc(co.hours || "")}</small></p>` : ""}
    <p>${[co.name && `<b>${esc(co.name)}</b>`, co.ceo && `대표 ${esc(co.ceo)}`, co.bizNo && `사업자등록번호 ${esc(co.bizNo)}`, co.mailOrderNo && `통신판매업신고 ${esc(co.mailOrderNo)}`].filter(Boolean).join(" · ")}</p>
    <p>${[co.address && esc(co.address), co.email && esc(co.email)].filter(Boolean).join(" · ")}</p>
    ${(CFG.bankAccounts || []).length ? `<p>무통장입금 ${CFG.bankAccounts.map((b) => `${esc(b.bank)} ${esc(b.number)}`).join(" / ")} (예금주 ${esc(CFG.bankHolder || "")})</p>` : ""}
    <p style="margin-top:10px">© ${new Date().getFullYear()} ${esc(CFG.name || "투스타몰")}</p>`;
}

(async function init() {
  bindImageFallback();
  bind();
  renderFooter();
  state.products = await loadProducts();
  state.byId = new Map(state.products.map((p) => [p.id, p]));
  state.cart = state.cart.filter((x) => state.byId.has(x.id));
  renderTabs(); renderGrid(); renderBar();
  window.addEventListener("resize", renderBar);
})();
