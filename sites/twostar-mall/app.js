// 투스타몰 — 구매 단계를 줄인 스토어프런트
// 흐름: 목록에서 [바로구매] → 한 화면 결제(옵션·수량·배송지·결제수단) → 완료
// 재구매 고객은 배송지가 저장돼 있어 [바로구매] → [결제하기] 두 번이면 끝.

const CFG = window.STORE_CONFIG || {};
const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 사생활 보호 모드 등 */ } },
};

const state = {
  products: [],
  byId: new Map(),
  cat: "전체",
  q: "",
  sort: "popular",
  limit: 40,
  cart: store.get("ts.cart", []),
  ship: store.get("ts.ship", null),
  pay: store.get("ts.pay", null),
};

/* ---------------- data ---------------- */
async function loadProducts() {
  const get = async (url) => {
    try { const r = await fetch(url, { cache: "no-cache" }); return r.ok ? r.json() : null; } catch { return null; }
  };
  let data = await get("data/products.json");
  let list = Array.isArray(data) ? data : data?.products;
  if (!list || list.length === 0) {
    const sample = await get("data/products.sample.json");
    list = sample?.products || sample || [];
    $("#sampleNotice").hidden = false;
  }
  return list.map(normalize).filter((p) => p.id && p.name);
}

function normalize(p, i) {
  const price = Number(p.price) || 0;
  const sale = Number(p.salePrice) || price;
  return {
    id: String(p.id ?? i),
    name: p.name,
    category: p.category || "기타",
    price,
    salePrice: Math.min(sale, price || sale),
    image: p.image || (p.images && p.images[0]) || "",
    images: p.images?.length ? p.images : p.image ? [p.image] : [],
    options: Array.isArray(p.options) ? p.options.filter((o) => o.values?.length) : [],
    soldOut: !!p.soldOut,
    reviewCount: Number(p.reviewCount) || 0,
    rating: Number(p.rating) || 0,
    badge: p.badge || "",
    shippingFee: p.shippingFee ?? null,
    description: p.description || "",
    createdAt: p.createdAt || "",
    rank: p.rank ?? i,
    url: p.url || "",
  };
}

/* ---------------- pricing ---------------- */
function optExtra(p, opts) {
  return p.options.reduce((sum, o) => {
    const v = o.values.find((x) => x.label === opts?.[o.name]);
    return sum + (Number(v?.extra) || 0);
  }, 0);
}
const unitPrice = (p, opts) => p.salePrice + optExtra(p, opts);
const optText = (opts) => Object.entries(opts || {}).map(([k, v]) => `${k}: ${v}`).join(" / ");
const itemKey = (id, opts) => `${id}|${JSON.stringify(opts || {})}`;

function totals(items) {
  const lines = items.map((it) => ({ ...it, p: state.byId.get(it.id) })).filter((l) => l.p);
  const subtotal = lines.reduce((s, l) => s + unitPrice(l.p, l.opts) * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const allFree = lines.length > 0 && lines.every((l) => l.p.shippingFee === 0);
  const baseFee = Math.max(0, ...lines.map((l) => (l.p.shippingFee ?? CFG.shippingFee ?? 0)));
  const threshold = CFG.freeShippingOver || Infinity;
  const shipping = lines.length === 0 || allFree || subtotal >= threshold ? 0 : baseFee;
  return { lines, subtotal, count, shipping, total: subtotal + shipping, toFree: Math.max(0, threshold - subtotal), threshold };
}

/* ---------------- cart ---------------- */
function saveCart() { store.set("ts.cart", state.cart); renderBar(); renderCardActionsAll(); }
function addToCart(id, opts = {}, qty = 1) {
  const key = itemKey(id, opts);
  const hit = state.cart.find((x) => x.key === key);
  if (hit) hit.qty += qty; else state.cart.push({ key, id, opts, qty });
  saveCart();
}
function setQty(list, key, qty) {
  const i = list.findIndex((x) => x.key === key);
  if (i < 0) return;
  if (qty <= 0) list.splice(i, 1); else list[i].qty = Math.min(qty, 99);
}

/* ---------------- list ---------------- */
function renderCats() {
  const count = {};
  state.products.forEach((p) => (count[p.category] = (count[p.category] || 0) + 1));
  const cats = ["전체", ...Object.keys(count).sort((a, b) => (a === "기타") - (b === "기타") || count[b] - count[a])];
  $("#cats").innerHTML = cats.map((c) => `<button class="chip" type="button" aria-pressed="${c === state.cat}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
}

function visible() {
  const q = state.q.trim().toLowerCase();
  let list = state.products.filter((p) => (state.cat === "전체" || p.category === state.cat) && (!q || p.name.toLowerCase().includes(q)));
  const by = {
    popular: (a, b) => a.rank - b.rank,
    new: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    low: (a, b) => a.salePrice - b.salePrice,
    high: (a, b) => b.salePrice - a.salePrice,
    review: (a, b) => b.reviewCount - a.reviewCount,
  }[state.sort];
  return [...list].sort(by).sort((a, b) => a.soldOut - b.soldOut);
}

function priceHtml(p) {
  const rate = p.price > p.salePrice ? Math.round((1 - p.salePrice / p.price) * 100) : 0;
  return `<div class="price">${rate ? `<span class="price__rate">${rate}%</span>` : ""}<span class="price__now">${won(p.salePrice)}</span>${rate ? `<span class="price__was">${won(p.price)}</span>` : ""}</div>`;
}

function cardActions(p) {
  if (p.soldOut) return `<button class="btn btn--block" disabled style="grid-column:1/-1">품절</button>`;
  const inCart = !p.options.length && state.cart.find((x) => x.key === itemKey(p.id, {}));
  const left = inCart
    ? `<div class="stepper" style="grid-column:1/-1"><button type="button" data-act="dec" aria-label="수량 빼기">−</button><output>${inCart.qty}</output><button type="button" data-act="inc" aria-label="수량 더하기">+</button></div>`
    : `<button class="btn" type="button" data-act="add">담기</button>`;
  return `${left}<button class="btn btn--primary" type="button" data-act="buy" ${inCart ? 'style="grid-column:1/-1"' : ""}>바로구매</button>`;
}

function renderGrid() {
  const list = visible();
  $("#resultCount").textContent = `상품 ${list.length.toLocaleString()}개`;
  $("#empty").hidden = list.length > 0;
  $("#more").hidden = list.length <= state.limit;
  $("#grid").innerHTML = list.slice(0, state.limit).map((p) => `
    <li class="card" data-id="${esc(p.id)}">
      <button class="card__media" type="button" data-act="detail" aria-label="${esc(p.name)} 자세히 보기">
        <img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">
        ${p.soldOut ? `<span class="badge badge--sold">품절</span>` : p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}
      </button>
      <div class="card__body">
        <h3 class="card__name">${esc(p.name)}</h3>
        ${priceHtml(p)}
        <div class="meta">${p.reviewCount ? `<span><span class="star">★</span> ${p.rating ? p.rating.toFixed(1) : ""} (${p.reviewCount.toLocaleString()})</span>` : ""}${p.shippingFee === 0 ? `<span class="ship-tag">무료배송</span>` : ""}</div>
        <div class="card__actions">${cardActions(p)}</div>
      </div>
    </li>`).join("");
}

function renderCardActionsAll() {
  document.querySelectorAll(".card").forEach((li) => {
    const p = state.byId.get(li.dataset.id);
    if (p) $(".card__actions", li).innerHTML = cardActions(p);
  });
}

function renderBar() {
  const t = totals(state.cart);
  const bar = $("#bar");
  bar.hidden = t.count === 0;
  $("#cartCount").hidden = t.count === 0;
  $("#cartCount").textContent = t.count;
  $("#barItems").textContent = `${t.count}개 상품`;
  $("#barTotal").textContent = won(t.total);
  $("#barShip").innerHTML = shipHint(t);
  document.documentElement.style.setProperty("--bar-h", bar.hidden ? "0px" : `${bar.offsetHeight}px`);
}

function shipHint(t) {
  if (!isFinite(t.threshold)) return t.shipping ? `배송비 ${won(t.shipping)}` : "무료배송";
  const pct = Math.min(100, (t.subtotal / t.threshold) * 100);
  const msg = t.shipping === 0 ? `<b>무료배송</b> 적용됐어요` : `<b>${won(t.toFree)}</b> 더 담으면 무료배송`;
  return `${msg}<div class="progress"><i style="width:${pct}%"></i></div>`;
}

/* ---------------- sheet ---------------- */
let lastFocus = null;
function openSheet(title, body, foot = "") {
  lastFocus = document.activeElement;
  $("#sheetTitle").textContent = title;
  $("#sheetBody").innerHTML = body;
  $("#sheetFoot").innerHTML = foot;
  $("#sheet").hidden = false;
  $("#scrim").hidden = false;
  document.body.style.overflow = "hidden";
  $("#sheetBody").scrollTop = 0;
  setTimeout(() => $("#sheetClose").focus(), 30);
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#scrim").hidden = true;
  document.body.style.overflow = "";
  sheetCtx = null;
  if (location.hash.startsWith("#p=")) history.replaceState(null, "", location.pathname + location.search);
  lastFocus?.focus?.();
}
let sheetCtx = null;

/* 옵션 선택 시트 — 옵션 있는 상품만 거침. 같은 시트에서 바로 결제로 넘어감 */
function openPicker(p, intent = "buy") {
  const opts = {};
  p.options.forEach((o) => {
    const avail = o.values.filter((v) => !v.soldOut);
    if (avail.length === 1) opts[o.name] = avail[0].label; // 선택지가 하나면 자동 선택
  });
  sheetCtx = { type: "picker", p, opts, qty: 1, intent };
  renderPicker();
}
function renderPicker() {
  const { p, opts, qty } = sheetCtx;
  const ready = p.options.every((o) => opts[o.name]);
  const body = `
    <div class="pick"><img src="${esc(p.image)}" alt=""><div><p class="pick__name">${esc(p.name)}</p>${priceHtml(p)}</div></div>
    ${p.options.map((o) => `
      <span class="field-label">${esc(o.name)}</span>
      <div class="opts" role="group" aria-label="${esc(o.name)}">
        ${o.values.map((v) => `<button class="opt" type="button" data-opt="${esc(o.name)}" data-val="${esc(v.label)}" aria-pressed="${opts[o.name] === v.label}" ${v.soldOut ? "disabled" : ""}>${esc(v.label)}${Number(v.extra) ? `<small>${v.extra > 0 ? "+" : ""}${won(v.extra)}</small>` : ""}${v.soldOut ? "<small>품절</small>" : ""}</button>`).join("")}
      </div>`).join("")}
    <div class="row-between" style="margin-top:16px">
      <span class="field-label" style="margin:0">수량</span>
      ${stepperHtml(qty, "pqty")}
    </div>
    <div class="sum-line sum-line--total"><span>상품 금액</span><span>${won(unitPrice(p, opts) * qty)}</span></div>`;
  const foot = `<div class="foot-actions">
      <button class="btn btn--lg" type="button" data-act="picker-cart" ${ready ? "" : "disabled"}>담기</button>
      <button class="btn btn--primary btn--lg" type="button" data-act="picker-buy" ${ready ? "" : "disabled"}>${ready ? "바로 결제하기" : "옵션을 골라주세요"}</button>
    </div>`;
  if ($("#sheet").hidden) openSheet("옵션 선택", body, foot);
  else { $("#sheetBody").innerHTML = body; $("#sheetFoot").innerHTML = foot; }
}
const stepperHtml = (n, key) => `<div class="stepper"><button type="button" data-step="-1" data-key="${esc(key)}" aria-label="수량 빼기">−</button><output>${n}</output><button type="button" data-step="1" data-key="${esc(key)}" aria-label="수량 더하기">+</button></div>`;

function openDetail(p) {
  const body = `
    <div class="gallery">${(p.images.length ? p.images : [p.image]).map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join("")}</div>
    <div style="padding:14px 0 6px">${priceHtml(p)}</div>
    <div class="meta" style="margin-bottom:10px">${p.reviewCount ? `<span><span class="star">★</span> ${p.rating ? p.rating.toFixed(1) : ""} 리뷰 ${p.reviewCount.toLocaleString()}</span>` : ""}<span>${p.shippingFee === 0 ? "무료배송" : `배송비 ${won(p.shippingFee ?? CFG.shippingFee ?? 0)}${CFG.freeShippingOver ? ` · ${won(CFG.freeShippingOver)} 이상 무료` : ""}`}</span></div>
    <div class="desc">${sanitize(p.description) || ""}</div>`;
  const foot = p.soldOut ? `<button class="btn btn--lg btn--block" disabled>품절</button>` : `<div class="foot-actions">
      <button class="btn btn--lg" type="button" data-act="detail-cart">담기</button>
      <button class="btn btn--primary btn--lg" type="button" data-act="detail-buy">바로구매</button>
    </div>`;
  sheetCtx = { type: "detail", p };
  openSheet(p.name, body, foot);
}
function sanitize(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((n) => n.remove());
  t.content.querySelectorAll("*").forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name); }));
  return t.innerHTML;
}

/* ---------------- checkout: 한 화면 ---------------- */
function openCheckout(items, source) {
  if (!items.length) return toast("담긴 상품이 없어요");
  const editing = !state.ship;
  sheetCtx = { type: "checkout", items: items.map((x) => ({ ...x })), source, editingShip: editing, pay: state.pay || CFG.payMethods?.[0]?.id || "card", errors: {} };
  openSheet("주문 · 결제", "", "");
  renderCheckout();
}

function renderCheckout() {
  const c = sheetCtx;
  const t = totals(c.items);
  if (t.lines.length === 0) { closeSheet(); return; }
  const s = c.draft || state.ship || {};
  const shipBlock = c.editingShip ? `
    <div class="form" id="shipForm">
      <div class="two">
        <input class="input" name="name" placeholder="받는 분" autocomplete="name" value="${esc(s.name)}" aria-invalid="${!!c.errors.name}">
        <input class="input" name="phone" placeholder="휴대폰 번호" inputmode="tel" autocomplete="tel" value="${esc(s.phone)}" aria-invalid="${!!c.errors.phone}">
      </div>
      <div class="addr-row">
        <input class="input" name="addr1" placeholder="주소" autocomplete="street-address" value="${esc(s.addr1)}" aria-invalid="${!!c.errors.addr1}">
        <button class="btn" type="button" data-act="postcode" style="height:46px">주소 검색</button>
      </div>
      <input class="input" name="addr2" placeholder="상세 주소 (동·호수)" value="${esc(s.addr2)}">
      <input type="hidden" name="zip" value="${esc(s.zip)}">
      <input class="input" name="memo" placeholder="배송 메모 (선택)" value="${esc(s.memo)}" list="memoList">
      <datalist id="memoList"><option value="문 앞에 놓아주세요"><option value="경비실에 맡겨주세요"><option value="배송 전 연락 부탁드려요"></datalist>
      <p class="err" id="shipErr">${esc(Object.values(c.errors)[0] || "")}</p>
    </div>` : `
    <div class="saved-addr">
      <div><p><b>${esc(s.name)}</b> · ${esc(s.phone)}</p><p class="muted">${s.zip ? `(${esc(s.zip)}) ` : ""}${esc(s.addr1)} ${esc(s.addr2)}</p>${s.memo ? `<p class="muted">${esc(s.memo)}</p>` : ""}</div>
      <button class="link-btn" type="button" data-act="edit-ship">변경</button>
    </div>`;

  $("#sheetBody").innerHTML = `
    <div class="section">
      <h3>주문 상품 <small>${t.count}개</small></h3>
      ${t.lines.map((l) => `
        <div class="line-item">
          <img src="${esc(l.p.image)}" alt="${esc(l.p.name)}">
          <div><p class="line-item__name">${esc(l.p.name)}</p>${l.opts && Object.keys(l.opts).length ? `<div class="line-item__opt">${esc(optText(l.opts))}</div>` : ""}${stepperHtml(l.qty, l.key)}</div>
          <div class="line-item__right"><span class="line-item__price">${won(unitPrice(l.p, l.opts) * l.qty)}</span><button class="link-btn" type="button" data-remove="${esc(l.key)}">삭제</button></div>
        </div>`).join("")}
      ${t.shipping > 0 && isFinite(t.threshold) ? `<p class="consent" style="text-align:left;margin-top:6px">${won(t.toFree)} 더 담으면 배송비 무료</p>` : ""}
    </div>
    <div class="section">
      <h3>배송지 ${state.ship ? "" : "<small>다음 주문부터는 자동 입력돼요</small>"}</h3>
      ${shipBlock}
    </div>
    <div class="section">
      <h3>결제 수단</h3>
      <div class="pays" role="radiogroup" aria-label="결제 수단">
        ${(CFG.payMethods || []).map((m) => `<button class="opt" type="button" role="radio" data-pay="${esc(m.id)}" aria-pressed="${c.pay === m.id}" aria-checked="${c.pay === m.id}">${esc(m.label)}</button>`).join("")}
      </div>
    </div>
    <div class="section">
      <div class="sum-line"><span>상품 금액</span><span>${won(t.subtotal)}</span></div>
      <div class="sum-line"><span>배송비</span><span>${t.shipping ? won(t.shipping) : "무료"}</span></div>
      <div class="sum-line sum-line--total"><span>총 결제 금액</span><span>${won(t.total)}</span></div>
    </div>`;
  $("#sheetFoot").innerHTML = `
    <button class="btn btn--primary btn--lg btn--block" type="button" data-act="pay">${won(t.total)} 결제하기</button>
    <p class="consent">주문 내용을 확인했으며, 결제 진행 및 개인정보 제공에 동의합니다.</p>`;
}

function readShipForm() {
  const f = $("#shipForm");
  if (!f) return state.ship;
  const v = Object.fromEntries([...f.querySelectorAll("input")].map((i) => [i.name, i.value.trim()]));
  v.phone = formatPhone(v.phone);
  return v;
}
function formatPhone(s) {
  const d = String(s || "").replace(/\D/g, "").slice(0, 11);
  if (d.length < 10) return d;
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}
function validateShip(v) {
  const e = {};
  if (!v?.name) e.name = "받는 분 이름을 입력해주세요";
  else if (!/^01\d-?\d{3,4}-?\d{4}$/.test(v.phone || "")) e.phone = "휴대폰 번호를 확인해주세요";
  else if (!v.addr1) e.addr1 = "주소를 입력해주세요";
  return e;
}

async function submitOrder() {
  const c = sheetCtx;
  const ship = readShipForm();
  c.errors = validateShip(ship);
  if (Object.keys(c.errors).length) {
    c.editingShip = true;
    c.draft = ship;
    renderCheckout();
    $(`#shipForm [name="${Object.keys(c.errors)[0]}"]`)?.focus();
    return;
  }
  state.ship = ship; store.set("ts.ship", ship);
  state.pay = c.pay; store.set("ts.pay", c.pay);

  const t = totals(c.items);
  const order = {
    id: `TS${new Date().toISOString().slice(2, 10).replace(/-/g, "")}${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    items: t.lines.map((l) => ({ id: l.id, name: l.p.name, options: l.opts, qty: l.qty, unitPrice: unitPrice(l.p, l.opts) })),
    subtotal: t.subtotal, shipping: t.shipping, total: t.total,
    payMethod: c.pay, ship,
  };

  const btn = $('[data-act="pay"]');
  btn.disabled = true; btn.textContent = "결제 진행 중…";
  try {
    await requestPayment(order);
  } catch (err) {
    btn.disabled = false; renderCheckout();
    return toast(err?.message || "결제가 취소됐어요");
  }
  const orders = store.get("ts.orders", []); orders.unshift(order); store.set("ts.orders", orders.slice(0, 50));
  if (CFG.orderWebhook) fetch(CFG.orderWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) }).catch(() => {});
  if (c.source === "cart") { state.cart = []; saveCart(); }
  showDone(order);
}

// 결제: 포트원 설정이 있으면 실제 결제창, 없으면 데모
async function requestPayment(order) {
  const pg = CFG.portone || {};
  const channelKey = pg.channelKeys?.[order.payMethod];
  if (order.payMethod === "bank") return; // 무통장: 완료 화면에서 계좌 안내
  if (!pg.storeId || !channelKey) { await new Promise((r) => setTimeout(r, 600)); return; }
  if (!window.PortOne) await loadScript("https://cdn.portone.io/v2/browser-sdk.js");
  const easy = { naverpay: "NAVERPAY", kakaopay: "KAKAOPAY", tosspay: "TOSSPAY" }[order.payMethod];
  const res = await window.PortOne.requestPayment({
    storeId: pg.storeId,
    channelKey,
    paymentId: order.id,
    orderName: order.items.length > 1 ? `${order.items[0].name} 외 ${order.items.length - 1}건` : order.items[0].name,
    totalAmount: order.total,
    currency: "CURRENCY_KRW",
    payMethod: easy ? "EASY_PAY" : "CARD",
    ...(easy ? { easyPay: { easyPayProvider: easy } } : {}),
    customer: { fullName: order.ship.name, phoneNumber: order.ship.phone.replace(/-/g, "") },
    redirectUrl: location.href.split("#")[0],
  });
  if (res?.code) throw new Error(res.message || "결제에 실패했어요");
  // 실서비스에서는 서버에서 paymentId 로 결제 금액을 반드시 검증하세요.
}

function showDone(order) {
  const m = (CFG.payMethods || []).find((x) => x.id === order.payMethod);
  sheetCtx = { type: "done" };
  $("#sheetTitle").textContent = "주문 완료";
  $("#sheetBody").innerHTML = `
    <div class="done">
      <div class="done__icon"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3>주문이 완료됐어요</h3>
      <p>주문번호 <b>${esc(order.id)}</b></p>
      <div class="receipt">
        ${order.items.map((i) => `<div class="sum-line"><span>${esc(i.name)} × ${i.qty}</span><span>${won(i.unitPrice * i.qty)}</span></div>`).join("")}
        <div class="sum-line"><span>배송비</span><span>${order.shipping ? won(order.shipping) : "무료"}</span></div>
        <div class="sum-line sum-line--total"><span>${esc(m?.label || "")}</span><span>${won(order.total)}</span></div>
        <p class="consent" style="text-align:left">${esc(order.ship.name)} · ${esc(order.ship.addr1)} ${esc(order.ship.addr2)}</p>
        ${order.payMethod === "bank" ? `<div class="bank"><b>입금 계좌</b> (예금주 ${esc(CFG.bankHolder || "")})${(CFG.bankAccounts || []).map((b) => `<div class="sum-line"><span>${esc(b.bank)}</span><span>${esc(b.number)} <button class="link-btn" type="button" data-copy="${esc(b.number)}">복사</button></span></div>`).join("")}<p class="consent" style="text-align:left">${won(order.total)}을 입금해주시면 확인 후 바로 출고됩니다.</p></div>` : ""}
      </div>
    </div>`;
  $("#sheetFoot").innerHTML = `<button class="btn btn--primary btn--lg btn--block" type="button" data-act="close">쇼핑 계속하기</button>`;
}

/* ---------------- helpers ---------------- */
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
  } catch { toast("주소 검색을 열 수 없어요. 직접 입력해주세요"); }
}
let toastTimer;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 1800);
}

/* ---------------- events ---------------- */
function bind() {
  $("#cats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    state.cat = b.dataset.cat; state.limit = 40; renderCats(); renderGrid(); window.scrollTo({ top: 0 });
  });
  let qt; $("#q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { state.q = e.target.value; state.limit = 40; renderGrid(); }, 120); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; state.limit = 40; renderGrid(); });
  const more = () => { state.limit += 40; renderGrid(); };
  $("#more").addEventListener("click", more);
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => es[0].isIntersecting && !$("#more").hidden && more(), { rootMargin: "600px" }).observe($("#more"));

  $("#grid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const p = state.byId.get(b.closest(".card").dataset.id); if (!p) return;
    const act = b.dataset.act;
    if (act === "detail") return openDetail(p);
    if (act === "buy") return p.options.length ? openPicker(p, "buy") : openCheckout([{ key: itemKey(p.id, {}), id: p.id, opts: {}, qty: 1 }], "now");
    if (act === "add") { if (p.options.length) return openPicker(p, "cart"); addToCart(p.id); return toast("장바구니에 담았어요"); }
    if (act === "inc" || act === "dec") { setQty(state.cart, itemKey(p.id, {}), (state.cart.find((x) => x.key === itemKey(p.id, {}))?.qty || 0) + (act === "inc" ? 1 : -1)); saveCart(); }
  });

  $("#barCheckout").addEventListener("click", () => openCheckout(state.cart, "cart"));
  $("#openCart").addEventListener("click", () => openCheckout(state.cart, "cart"));
  $("#sheetClose").addEventListener("click", closeSheet);
  $("#scrim").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

  $("#sheet").addEventListener("input", (e) => {
    if (e.target.name === "phone") { const pos = e.target.value.length; e.target.value = formatPhone(e.target.value); if (pos >= e.target.value.length) e.target.setSelectionRange(e.target.value.length, e.target.value.length); }
  });

  $("#sheet").addEventListener("click", (e) => {
    const c = sheetCtx; if (!c) return;
    const t = e.target;
    const opt = t.closest("[data-opt]");
    if (opt && c.type === "picker") { c.opts[opt.dataset.opt] = opt.dataset.val; return renderPicker(); }
    const step = t.closest("[data-step]");
    if (step) {
      const d = Number(step.dataset.step);
      if (c.type === "picker") { c.qty = Math.max(1, Math.min(99, c.qty + d)); return renderPicker(); }
      if (c.type === "checkout") {
        keepDraft();
        const it = c.items.find((x) => x.key === step.dataset.key); if (!it) return;
        setQty(c.items, it.key, it.qty + d);
        if (c.source === "cart") { state.cart = c.items.map((x) => ({ ...x })); saveCart(); }
        return renderCheckout();
      }
    }
    const cp = t.closest("[data-copy]");
    if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => toast("계좌번호를 복사했어요"), () => {}); return; }
    const rm = t.closest("[data-remove]");
    if (rm && c.type === "checkout") { keepDraft(); setQty(c.items, rm.dataset.remove, 0); if (c.source === "cart") { state.cart = c.items.map((x) => ({ ...x })); saveCart(); } return renderCheckout(); }
    const pay = t.closest("[data-pay]");
    if (pay && c.type === "checkout") { keepDraft(); c.pay = pay.dataset.pay; return renderCheckout(); }

    const act = t.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "picker-cart") { addToCart(c.p.id, { ...c.opts }, c.qty); closeSheet(); return toast("장바구니에 담았어요"); }
    if (act === "picker-buy") { const p = c.p; return openCheckout([{ key: itemKey(p.id, c.opts), id: p.id, opts: { ...c.opts }, qty: c.qty }], "now"); }
    if (act === "detail-cart") { if (c.p.options.length) { closeSheet(); return openPicker(c.p, "cart"); } addToCart(c.p.id); closeSheet(); return toast("장바구니에 담았어요"); }
    if (act === "detail-buy") { const p = c.p; closeSheet(); return p.options.length ? openPicker(p, "buy") : openCheckout([{ key: itemKey(p.id, {}), id: p.id, opts: {}, qty: 1 }], "now"); }
    if (act === "edit-ship") { c.editingShip = true; return renderCheckout(); }
    if (act === "postcode") return openPostcode();
    if (act === "pay") return submitOrder();
    if (act === "close") return closeSheet();
  });
}

// 결제 시트를 다시 그릴 때 입력 중인 배송지가 지워지지 않도록 보관
function keepDraft() {
  if ($("#shipForm")) sheetCtx.draft = readShipForm();
}

function renderFooter() {
  const co = CFG.company || {};
  const parts = [
    co.name && `<b>${esc(co.name)}</b>`, co.ceo && `대표 ${esc(co.ceo)}`, co.bizNo && `사업자등록번호 ${esc(co.bizNo)}`,
    co.mailOrderNo && `통신판매업 ${esc(co.mailOrderNo)}`, co.address && esc(co.address), co.tel && `고객센터 <a href="tel:${esc(co.tel)}">${esc(co.tel)}</a>${co.hours ? ` (${esc(co.hours)})` : ""}`, co.email && esc(co.email),
  ].filter(Boolean);
  $("#foot").innerHTML = `<p>${parts.join(" · ") || `<b>${esc(CFG.name || "투스타몰")}</b> · 사업자 정보는 config.js 에서 설정하세요`}</p><p>© ${new Date().getFullYear()} ${esc(CFG.name || "투스타몰")}</p>`;
  if (!CFG.freeShippingOver) $("#freeShipCopy").innerHTML = `<b>무료배송</b> 상품 다수`;
  if (CFG.freeShippingOver) $("#freeShipCopy").innerHTML = `<b>${(CFG.freeShippingOver / 10000).toLocaleString()}만원↑</b> 무료배송`;
}

function openFromHash() {
  const m = location.hash.match(/^#p=(.+)$/);
  const p = m && state.byId.get(decodeURIComponent(m[1]));
  if (p && !p.soldOut) p.options.length ? openPicker(p, "buy") : openCheckout([{ key: itemKey(p.id, {}), id: p.id, opts: {}, qty: 1 }], "now");
}

// 이미지 로드 실패 → 상품명 타일로 대체 (카페24 이미지 서버 차단 환경 등)
function bindImageFallback() {
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.failed) return;
    img.dataset.failed = "1";
    const host = img.closest(".card, .pick, .line-item, .gallery");
    const p = state.byId.get(host?.closest(".card")?.dataset.id) || (img.alt ? null : sheetCtx?.p) || null;
    const label = (p?.name || img.alt || "투스타몰").replace(/\s*\d+\s*(ml|l|g|kg|개|캔|병|입|페트|팩).*$/i, "").slice(0, 24);
    const ph = document.createElement("div");
    ph.className = "ph" + (img.width && img.width < 90 ? " ph--sm" : "");
    ph.textContent = label;
    if (img.closest(".desc")) { img.remove(); return; }
    img.replaceWith(ph);
  }, true);
}

(async function init() {
  bindImageFallback();
  bind();
  renderFooter();
  state.products = await loadProducts();
  state.byId = new Map(state.products.map((p) => [p.id, p]));
  state.cart = state.cart.filter((x) => state.byId.has(x.id));
  renderCats(); renderGrid(); renderBar();
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
  window.addEventListener("resize", renderBar);
})();
