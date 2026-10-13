// 투스타몰 3D 레이어 (three.js r128)
// - hero(): 메인 배너의 3D 상품 진열 (가운데 상품 + 주변에 떠 있는 상품들)
// - pallet(): 탕비실 계산기 발주량을 팔레트 위 박스로 쌓아 보여줌
// - viewer(): 상품 시트에서 360° 돌려보는 3D 포장
// WebGL 이 없거나 three.js 를 못 불러오면 window.TS3D 는 null 이고, 화면은 2D 그대로 동작한다.
(function () {
  const T = window.THREE;
  const ok = (() => {
    if (!T) return false;
    try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
  })();
  if (!ok) { window.TS3D = null; return; }

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE = matchMedia("(pointer: fine)").matches;
  const FONT = '"Pretendard Variable", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif';
  const TONES = { red: "#e2412f", brown: "#8a5530", green: "#1f8a5b", orange: "#ef8a1f", amber: "#d39a00", teal: "#0f8a8a", blue: "#1769e0", slate: "#66717f", navy: "#0d2742" };
  const shade = (hex, k) => { const c = new T.Color(hex); c.offsetHSL(0, 0, k); return `#${c.getHexString()}`; };

  /* ---------- 라벨 텍스처 (캔버스로 인쇄) ---------- */
  const texCache = new Map();
  function fitText(ctx, text, maxW, size, weight = 800) {
    let s = size;
    do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 12);
    return s + 2;
  }
  function labelTexture(info, shape) {
    const key = `${shape}|${info.name}|${info.tone}`;
    if (texCache.has(key)) return texCache.get(key);
    const wrap = shape === "can" || shape === "band" || shape === "cup";
    const W = wrap ? 1024 : 512; const H = wrap ? 512 : 640;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const base = TONES[info.tone] || TONES.slate;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, shade(base, 0.08)); grad.addColorStop(1, shade(base, -0.08));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    // 대각선 띠
    g.fillStyle = "rgba(255,255,255,.14)";
    g.beginPath(); g.moveTo(0, H * 0.62); g.lineTo(W, H * 0.38); g.lineTo(W, H * 0.52); g.lineTo(0, H * 0.76); g.fill();
    const cx = wrap ? W * 0.25 : W / 2; // 캔은 앞면(오프셋 적용 시 가운데)에 인쇄
    const zoneW = wrap ? W * 0.42 : W * 0.84;
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff";
    const brand = info.brand || info.short;
    let s = fitText(g, brand, zoneW, wrap ? 96 : 92);
    g.font = `800 ${s}px ${FONT}`;
    g.fillText(brand, cx, H * (wrap ? 0.34 : 0.3));
    const rest = info.rest || "";
    if (rest) {
      s = fitText(g, rest, zoneW, wrap ? 46 : 44, 600);
      g.font = `600 ${s}px ${FONT}`; g.fillStyle = "rgba(255,255,255,.92)";
      g.fillText(rest, cx, H * (wrap ? 0.52 : 0.46));
    }
    if (info.spec) {
      g.font = `700 ${wrap ? 34 : 34}px ${FONT}`;
      const tw = g.measureText(info.spec).width + 36;
      g.fillStyle = "rgba(255,255,255,.95)";
      roundRect(g, cx - tw / 2, H * (wrap ? 0.7 : 0.66), tw, 54, 27); g.fill();
      g.fillStyle = base; g.fillText(info.spec, cx, H * (wrap ? 0.7 : 0.66) + 28);
    }
    if (wrap) { // 뒷면: 반복 패턴
      g.fillStyle = "rgba(255,255,255,.18)";
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(W * 0.62 + (i % 3) * 110, H * 0.3 + Math.floor(i / 3) * 140, 34, 0, Math.PI * 2); g.fill(); }
    }
    const tex = new T.CanvasTexture(c);
    tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
    if (wrap) { tex.wrapS = T.RepeatWrapping; tex.offset.x = 0.25; } // 원통 UV u=0 이 정면 → 캔버스 1/4 지점(라벨)을 정면에
    texCache.set(key, tex);
    return tex;
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function canTopTexture(tone) {
    const key = `top|${tone}`;
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement("canvas"); c.width = 384; c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#c79a63"; g.fillRect(0, 0, 384, 256);
    const col = TONES[tone] || TONES.slate;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) {
      const cx = 32 + x * 64; const cy = 32 + y * 64;
      g.fillStyle = col; g.beginPath(); g.arc(cx, cy, 29, 0, 7); g.fill();
      g.fillStyle = "#d9dde2"; g.beginPath(); g.arc(cx, cy, 22, 0, 7); g.fill();
      g.fillStyle = "#aab1b9"; g.fillRect(cx - 5, cy - 12, 10, 14);
    }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; texCache.set(key, t); return t;
  }
  function cartonSideTexture(tone, label) {
    const key = `side|${tone}|${label}`;
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement("canvas"); c.width = 384; c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#c99b62"; g.fillRect(0, 0, 384, 256);
    g.fillStyle = "rgba(0,0,0,.06)"; for (let i = 0; i < 384; i += 6) g.fillRect(i, 0, 2, 256);
    g.fillStyle = TONES[tone] || TONES.slate; g.fillRect(0, 186, 384, 30);
    g.fillStyle = "#3b2a17"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `800 64px ${FONT}`; g.fillText(label, 192, 100);
    g.font = `700 26px ${FONT}`; g.fillText("TWOSTAR · 이쪽 위로 ↑", 192, 150);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; texCache.set(key, t); return t;
  }
  let shadowTex = null;
  function contactShadow(size, opacity = 1) {
    if (!shadowTex) {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const g = c.getContext("2d"); const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      r.addColorStop(0, "rgba(0,0,0,.42)"); r.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = r; g.fillRect(0, 0, 128, 128);
      shadowTex = new T.CanvasTexture(c);
    }
    const m = new T.Mesh(new T.PlaneGeometry(size, size), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  /* ---------- 포장 모델 ---------- */
  const metal = new T.MeshStandardMaterial({ color: 0xd2d7dd, metalness: 0.85, roughness: 0.28 });
  const metalDark = new T.MeshStandardMaterial({ color: 0xa9b0b8, metalness: 0.9, roughness: 0.35 });
  /* ---------- 실사 페트병 (상품 사진을 몸통에 감고 PBR 재질·스튜디오 반사로 렌더링) ---------- */
  // info.photo = { src, cx, r, top, bottom, band:[y0,y1] } : 사진 속 병 몸통 중심 x·반지름(px), 초록 몸통 위·아래 y, 라벨(엠블럼) 세로 범위
  function photoBodyTexture(img, ph) {
    const W = 2048, H = 1024;
    const src = document.createElement("canvas"); src.width = img.naturalWidth; src.height = img.naturalHeight;
    const sg = src.getContext("2d"); sg.drawImage(img, 0, 0);
    const top = ph.top, sh = ph.bottom - ph.top;
    const S = sg.getImageData(0, 0, src.width, src.height).data, SW = src.width;
    const at = (x, y) => { const i = (Math.round(y) * SW + Math.round(x)) * 4; return [S[i], S[i + 1], S[i + 2]]; };
    const A0 = 0.95, FEATHER = 0.18;                       // 사진은 정면 ±54°만 쓰고, 그 밖은 몸통 색을 이어 그린다
    const b0 = ph.band ? ph.band[0] : -1, b1 = ph.band ? ph.band[1] : -1;
    // 가장자리 색(라벨 띠는 위·아래 색으로 보간) — 왼쪽/오른쪽 따로
    const edgeCol = (side, y) => {
      const x = ph.cx + side * Math.sin(A0) * ph.r * 0.985;
      if (y >= b0 && y <= b1) { const t = (y - b0) / (b1 - b0), c0 = at(x, b0 - 2), c1 = at(x, b1 + 2); return c0.map((v, k) => v * (1 - t) + c1[k] * t); }
      return at(x, y);
    };
    const out = new ImageData(W, H), O = out.data;
    for (let y = 0; y < H; y++) {
      const sy = top + (y / H) * sh;
      const eL = edgeCol(-1, sy), eR = edgeCol(1, sy);
      // 둥근 라벨 행에서는 라벨 윤곽(타원)만큼 사진 범위를 넓혀, 사각형 경계 없이 라벨이 잘리지 않게 한다
      let AR = A0;
      if (ph.label) {
        const [lx, ly, lw, lh] = ph.label, q = (sy - ly) / lh;
        if (Math.abs(q) < 1) AR = Math.max(A0, Math.asin(Math.min(0.985, (lw * Math.sqrt(1 - q * q) + Math.abs(lx - ph.cx) + 4) / ph.r)));
      }
      for (let x = 0; x < W; x++) {
        let th = (x / W - 0.25) * Math.PI * 2; if (th > Math.PI) th -= Math.PI * 2;
        const a = Math.abs(th);
        // 뒤쪽 이어 그리기: 양쪽 가장자리 색을 뒤로 갈수록 섞는다
        const mix = Math.min(1, Math.max(0, (a - A0) / (Math.PI - A0)));
        const side = th < 0 ? eL : eR, other = th < 0 ? eR : eL;
        let c = side.map((v, k) => v * (1 - mix * 0.5) + other[k] * mix * 0.5);
        if (a < AR + FEATHER) {
          const p = at(ph.cx + Math.sin(Math.max(-AR, Math.min(AR, th))) * ph.r * 0.985, sy);
          const w = a <= AR ? 1 : 1 - (a - AR) / FEATHER;
          c = c.map((v, k) => p[k] * w + v * (1 - w));
        }
        const i = (y * W + x) * 4; O[i] = c[0]; O[i + 1] = c[1]; O[i + 2] = c[2]; O[i + 3] = 255;
      }
    }
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.putImageData(out, 0, 0);
    // 사진에 보이는 페트 성형 세로줄 + 뒤쪽 기포
    g.globalCompositeOperation = "soft-light";
    for (let x = 0; x < W; x += 9) { g.fillStyle = x % 18 ? "rgba(255,255,255,.10)" : "rgba(0,0,0,.08)"; g.fillRect(x, 0, 3, H); }
    g.globalCompositeOperation = "source-over";
    g.strokeStyle = "rgba(225,255,235,.55)"; g.lineWidth = 2;
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 70; n++) {
      const u = 0.55 + rnd() * 0.4, y = H * (rnd() < 0.5 ? 0.05 + rnd() * 0.12 : 0.55 + rnd() * 0.25), r = 3 + rnd() * 9;
      g.beginPath(); g.arc(u * W, y, r, 0, Math.PI * 2); g.stroke();
    }
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding; t.anisotropy = 8; t.wrapS = T.RepeatWrapping; t.offset.x = 0.25;
    return t;
  }
  const photoCache = new Map();
  function loadPhoto(src) {
    if (!photoCache.has(src)) photoCache.set(src, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));
    return photoCache.get(src);
  }
  // 원주 방향으로 홈(골)을 판 회전체: 페트 어깨의 세로 홈, 바닥 꽃모양, 뚜껑 톱니
  function grooved(points, segs, fn) {
    const geo = new T.LatheGeometry(points.map(([x, y]) => new T.Vector2(x, y)), segs);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = fn(Math.atan2(z, x), y);
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  }
  function photoBottle(info) {
    const ph = info.photo;
    const g = new T.Group();
    const R = 0.175, TOP = 0.92, BOT = 0.05;
    // 몸통: 사진 텍스처 + 광택 코팅(클리어코트) → 스튜디오 조명이 비친다
    const bodyMat = new T.MeshPhysicalMaterial({ color: ph.body || "#01954a", roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.0 });
    const body = new T.Mesh(new T.CylinderGeometry(R, R, TOP - BOT, 128, 1, true), bodyMat);
    body.position.y = BOT + (TOP - BOT) / 2;
    loadPhoto(ph.src).then((img) => { bodyMat.map = photoBodyTexture(img, ph); bodyMat.color.set("#ffffff"); bodyMat.needsUpdate = true; }).catch(() => {});
    // 투명 페트 공통 재질 (빛 투과)
    const pet = new T.MeshPhysicalMaterial({ color: "#e6f3ec", metalness: 0, roughness: 0.06, transmission: 0.82, transparent: true, opacity: 1, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6, side: T.DoubleSide });
    // 어깨: 위로 좁아지며 세로 홈 28줄
    const shoulderPts = [[R, TOP], [0.172, 0.97], [0.162, 1.03], [0.143, 1.09], [0.12, 1.15], [0.1, 1.2], [0.091, 1.235], [0.09, 1.262]];
    const shoulder = new T.Mesh(grooved(shoulderPts, 168, (a, y) => (y > 0.95 && y < 1.2 ? 1 + 0.018 * Math.cos(a * 28) * Math.sin(((y - 0.95) / 0.25) * Math.PI) : 1)), pet);
    // 어깨 아래쪽에 찬 탄산수 (수면 1.0)
    const liquid = new T.MeshPhysicalMaterial({ color: "#1fa34f", metalness: 0, roughness: 0.1, transmission: 0.55, transparent: true, envMapIntensity: 0.8 });
    const fill = new T.Mesh(new T.LatheGeometry([[0, TOP - 0.01], [R - 0.006, TOP - 0.01], [0.168, 0.97], [0.158, 1.0], [0, 1.0]].map(([x, y]) => new T.Vector2(x, y)), 96), liquid);
    // 바닥: 다섯 갈래 꽃모양
    const footMat = new T.MeshPhysicalMaterial({ color: "#04813f", roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, transmission: 0.25, transparent: true });
    const foot = new T.Mesh(grooved([[0, 0.004], [0.07, 0], [0.13, 0.006], [0.165, 0.025], [R, BOT]], 160, (a, y) => 1 - 0.07 * Math.max(0, Math.cos(a * 5)) * (1 - y / BOT)), footMat);
    // 목 링 + 뚜껑(톱니 48개)
    const capMat = new T.MeshPhysicalMaterial({ color: ph.cap || "#f2f4f3", roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    const ring = new T.Mesh(new T.TorusGeometry(0.098, 0.009, 12, 96), capMat); ring.rotation.x = Math.PI / 2; ring.position.y = 1.262;
    const cap = new T.Mesh(grooved([[0.096, 1.27], [0.098, 1.28], [0.098, 1.395], [0.094, 1.405], [0, 1.405]], 192, (a, y) => (y > 1.278 && y < 1.395 ? 1 + 0.012 * Math.sign(Math.cos(a * 48)) : 1)), capMat);
    g.add(foot, body, fill, shoulder, ring, cap);
    const shd = contactShadow(1.0, 0.85); shd.position.y = 0.002; g.add(shd);
    g.userData.height = 1.41;
    g.userData.studio = true; // 스튜디오 반사·톤 보정 켜기
    return g;
  }

  // 스튜디오 반사 환경: 어두운 방에 큰 소프트박스 3개 → PMREM 으로 구워 반사광으로 쓴다
  const envCache = new WeakMap();
  function studioEnv(renderer) {
    if (envCache.has(renderer)) return envCache.get(renderer);
    const room = new T.Scene();
    room.add(new T.Mesh(new T.BoxGeometry(10, 10, 10), new T.MeshBasicMaterial({ color: 0x3a3f45, side: T.BackSide })));
    const panel = (w, h, x, y, z, ry, c) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; room.add(m); };
    panel(2.6, 6, -4.4, 0.6, 1.2, Math.PI / 2, 0xffffff * 1);   // 왼쪽 세로 소프트박스
    panel(2.2, 6, 4.4, 0.4, -0.4, -Math.PI / 2, 0xe8f2ff);      // 오른쪽
    panel(5, 1.4, 0, 4.6, 0, 0, 0xffffff);                       // 위
    const top = room.children[room.children.length - 1]; top.rotation.x = Math.PI / 2;
    panel(4, 3, 0, 1, -4.6, 0, 0x9aa3ad);                        // 뒤 은은한 판
    const pm = new T.PMREMGenerator(renderer);
    const tex = pm.fromScene(room, 0.03).texture; pm.dispose();
    envCache.set(renderer, tex);
    return tex;
  }
  function setStudio(st, on) {
    st.scene.environment = on ? studioEnv(st.renderer) : null;
    st.renderer.toneMapping = T.NoToneMapping;
    st.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
  }

  function makePack(info) {
    if (info.photo && info.kind === "bottle") return photoBottle(info);
    const g = new T.Group();
    const tone = TONES[info.tone] || TONES.slate;
    if (info.kind === "can") {
      const body = new T.Mesh(new T.CylinderGeometry(0.34, 0.34, 1.02, 64, 1, true), new T.MeshStandardMaterial({ map: labelTexture(info, "can"), metalness: 0.35, roughness: 0.32 }));
      body.position.y = 0.55;
      const shoulder = new T.Mesh(new T.CylinderGeometry(0.29, 0.34, 0.09, 64, 1, true), metal); shoulder.position.y = 1.105;
      const lid = new T.Mesh(new T.CylinderGeometry(0.285, 0.285, 0.02, 64), metalDark); lid.position.y = 1.15;
      const rim = new T.Mesh(new T.TorusGeometry(0.287, 0.017, 10, 64), metal); rim.rotation.x = Math.PI / 2; rim.position.y = 1.16;
      const tab = new T.Mesh(new T.BoxGeometry(0.1, 0.012, 0.16), metal); tab.position.set(0, 1.168, 0.06);
      const foot = new T.Mesh(new T.CylinderGeometry(0.34, 0.29, 0.06, 64), metal); foot.position.y = 0.03;
      g.add(body, shoulder, lid, rim, tab, foot);
    } else if (info.kind === "bottle") {
      const pts = [[0, 0], [0.28, 0], [0.32, 0.04], [0.33, 0.12], [0.31, 0.2], [0.33, 0.3], [0.33, 0.78], [0.29, 0.9], [0.15, 1.06], [0.12, 1.14], [0.12, 1.2], [0, 1.2]].map(([x, y]) => new T.Vector2(x, y));
      const shellMat = new T.MeshStandardMaterial({ color: shade(tone, 0.32), transparent: true, opacity: 0.42, roughness: 0.06, metalness: 0.1 });
      const shell = new T.Mesh(new T.LatheGeometry(pts, 64), shellMat);
      const liquid = new T.Mesh(new T.LatheGeometry(pts.slice(0, 8).map((v) => new T.Vector2(Math.max(0, v.x - 0.025), Math.min(v.y, 0.86))).concat([new T.Vector2(0, 0.86)]), 48), new T.MeshStandardMaterial({ color: shade(tone, 0.1), roughness: 0.3 }));
      const band = new T.Mesh(new T.CylinderGeometry(0.336, 0.336, 0.4, 64, 1, true), new T.MeshStandardMaterial({ map: labelTexture(info, "band"), roughness: 0.5 }));
      band.position.y = 0.52;
      const cap = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.12, 32), new T.MeshStandardMaterial({ color: shade(tone, -0.12), roughness: 0.4 }));
      cap.position.y = 1.24;
      g.add(liquid, shell, band, cap);
    } else if (info.kind === "cup") {
      const body = new T.Mesh(new T.CylinderGeometry(0.42, 0.3, 0.98, 64, 1, true), new T.MeshStandardMaterial({ map: labelTexture(info, "cup"), roughness: 0.7, side: T.DoubleSide }));
      body.position.y = 0.49;
      const lipM = new T.Mesh(new T.TorusGeometry(0.42, 0.02, 8, 64), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
      lipM.rotation.x = Math.PI / 2; lipM.position.y = 0.98;
      const bottom = new T.Mesh(new T.CircleGeometry(0.3, 48), new T.MeshStandardMaterial({ color: 0xeeeeee })); bottom.rotation.x = -Math.PI / 2; bottom.position.y = 0.01;
      g.add(body, lipM, bottom);
    } else {
      const flat = info.kind === "pouch";
      const w = flat ? 0.82 : 0.9; const h = flat ? 1.12 : 1.15; const d = flat ? 0.2 : 0.44;
      const face = new T.MeshStandardMaterial({ map: labelTexture(info, "face"), roughness: flat ? 0.35 : 0.6 });
      const side = new T.MeshStandardMaterial({ color: shade(tone, -0.04), roughness: 0.6 });
      const top = new T.MeshStandardMaterial({ color: shade(tone, 0.08), roughness: 0.6 });
      const box = new T.Mesh(new T.BoxGeometry(w, h, d), [side, side, top, side, face, face]);
      box.position.y = h / 2;
      g.add(box);
    }
    const sh = contactShadow(1.5); sh.position.y = 0.002; g.add(sh);
    g.userData.height = info.kind === "bottle" ? 1.3 : info.kind === "can" ? 1.18 : 1.15;
    return g;
  }

  /* ---------- 공통 무대 ---------- */
  function stage(canvas, { fov = 30, pos = [0, 1.2, 6], target = [0, 0.7, 0], io = true } = {}) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(fov, 1, 0.1, 100);
    camera.position.set(...pos); camera.lookAt(...target);
    scene.add(new T.HemisphereLight(0xffffff, 0x8899aa, 0.95));
    const key = new T.DirectionalLight(0xffffff, 1.1); key.position.set(3, 5, 4); scene.add(key);
    const rim = new T.DirectionalLight(0xbcd4ff, 0.6); rim.position.set(-4, 2, -3); scene.add(rim);
    const st = { renderer, scene, camera, target: new T.Vector3(...target), tick: null, visible: true, alive: true, clock: new T.Clock(), dirty: true };
    const resize = () => {
      const w = canvas.clientWidth; const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); st.dirty = true;
    };
    new ResizeObserver(resize).observe(canvas); resize();
    // 화면 밖이면 그리기를 멈춘다. (시트 안 뷰어는 열려 있는 동안만 그리므로 io:false)
    if (io) new IntersectionObserver((es) => { st.visible = es[0].isIntersecting; if (st.visible) loop(); }, { rootMargin: "100px" }).observe(canvas);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) loop(); });
    let raf = 0;
    function loop() {
      cancelAnimationFrame(raf);
      const frame = () => {
        if (!st.alive || !canvas.isConnected || (io && !st.visible) || document.hidden) return;
        const dt = Math.min(st.clock.getDelta(), 0.05);
        const keep = st.tick ? st.tick(dt, st.clock.elapsedTime) : false;
        renderer.render(scene, camera);
        st.dirty = false;
        if (keep !== false || !REDUCED) raf = requestAnimationFrame(frame);
      };
      st.clock.getDelta(); raf = requestAnimationFrame(frame);
    }
    st.loop = loop;
    loop();
    return st;
  }
  // 드래그로 돌리기 (관성 포함)
  function spinControl(el, { touch = true } = {}) {
    const s = { vel: 0, angle: 0, drag: false, last: 0, touched: false };
    if (!touch && !FINE) return s;
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", (e) => { s.drag = true; s.touched = true; s.last = e.clientX; el.setPointerCapture(e.pointerId); el.classList.add("is-grab"); });
    el.addEventListener("pointermove", (e) => { if (!s.drag) return; const dx = e.clientX - s.last; s.last = e.clientX; s.vel = dx * 0.012; s.angle += s.vel; });
    const up = () => { s.drag = false; el.classList.remove("is-grab"); };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    s.step = (dt, auto) => { if (!s.drag) { s.vel *= 0.94; s.angle += s.vel + (s.touched || REDUCED ? 0 : auto * dt); } return s.angle; };
    return s;
  }
  const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

  /* ---------- 메인 배너 ---------- */
  function hero(canvas, satellitesInfo) {
    const st = stage(canvas, { fov: 28, pos: [0, 1.1, 7.2], target: [0, 0.75, 0] });
    const root = new T.Group(); st.scene.add(root);
    const spin = spinControl(canvas, { touch: false });
    // 주변에 떠 있는 상품들
    const sats = satellitesInfo.slice(0, 8).map((info, i) => {
      const m = makePack(info);
      const a = (i / 8) * Math.PI * 2;
      const r = 2.2 + (i % 2) * 0.5;
      m.userData = { ...m.userData, a, r, y: -0.2 + (i % 3) * 0.55, s: 0.42 + (i % 3) * 0.1, spin: (i % 2 ? 1 : -1) * (0.3 + i * 0.05) };
      m.scale.setScalar(m.userData.s);
      root.add(m);
      return m;
    });
    let center = null; let incoming = null; let tIn = 1; let outgoing = null;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    if (FINE) canvas.parentElement.addEventListener("pointermove", (e) => {
      const r = canvas.parentElement.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    });
    st.tick = (dt, t) => {
      pointer.x += (pointer.tx - pointer.x) * 0.06; pointer.y += (pointer.ty - pointer.y) * 0.06;
      root.rotation.y = pointer.x * 0.25; root.rotation.x = pointer.y * 0.08;
      sats.forEach((m) => {
        const u = m.userData; const a = u.a + (REDUCED ? 0 : t * 0.12);
        m.position.set(Math.cos(a) * u.r, u.y + (REDUCED ? 0 : Math.sin(t * 1.3 + u.a * 3) * 0.08), Math.sin(a) * u.r * 0.55 - 0.8);
        m.rotation.y += REDUCED ? 0 : u.spin * dt;
      });
      const ang = spin.step(dt, 0.55);
      if (incoming) {
        tIn += dt / 0.7;
        const k = ease(tIn);
        incoming.scale.setScalar(1.55 * k); incoming.rotation.y = ang + (1 - k) * Math.PI * 2;
        if (outgoing) { const o = 1 - ease(tIn * 1.6); outgoing.scale.setScalar(1.55 * Math.max(o, 0.001)); outgoing.position.y = (1 - o) * 1.2; if (o <= 0) { root.remove(outgoing); outgoing = null; } }
        if (tIn >= 1) { center = incoming; incoming = null; }
      } else if (center) {
        center.rotation.y = ang;
        center.position.y = REDUCED ? 0 : Math.sin(t * 1.6) * 0.05;
      }
      return true;
    };
    return {
      show(info) {
        const next = info === "pallet" ? miniPallet() : makePack(info);
        setStudio(st, !!next.userData.studio);
        next.scale.setScalar(0.001);
        root.add(next);
        if (incoming) { root.remove(center); center = incoming; }
        outgoing = center; incoming = next; tIn = 0;
        st.loop();
      },
    };
  }
  function miniPallet() {
    const g = new T.Group();
    const tones = ["red", "brown", "green", "orange", "red", "brown"];
    for (let i = 0; i < 6; i++) {
      const box = carton(tones[i], ["탄산", "커피", "차", "주스", "탄산", "커피"][i]);
      box.scale.setScalar(0.62);
      box.position.set((i % 2) * 0.42 - 0.21, Math.floor(i / 2) * 0.27 + 0.13, 0);
      g.add(box);
    }
    const sh = contactShadow(1.6); sh.position.y = 0.002; g.add(sh);
    return g;
  }

  /* ---------- 팔레트 ---------- */
  const BOX = { w: 0.62, h: 0.42, d: 0.42 };
  const geoBox = new T.BoxGeometry(BOX.w, BOX.h, BOX.d);
  const cartonMats = new Map();
  function carton(tone, label) {
    const key = `${tone}|${label}`;
    if (!cartonMats.has(key)) {
      const side = new T.MeshStandardMaterial({ map: cartonSideTexture(tone, label), roughness: 0.85 });
      const end = new T.MeshStandardMaterial({ color: 0xc08f55, roughness: 0.9 });
      const top = new T.MeshStandardMaterial({ map: canTopTexture(tone), roughness: 0.6, metalness: 0.15 });
      cartonMats.set(key, [end, end, top, end, side, side]);
    }
    const m = new T.Mesh(geoBox, cartonMats.get(key));
    return m;
  }
  function palletBase() {
    const g = new T.Group();
    const wood = new T.MeshStandardMaterial({ color: 0xb8875a, roughness: 0.9 });
    const W = BOX.w * 4 + 0.08; const D = BOX.d * 3 + 0.06;
    for (let i = 0; i < 5; i++) { const s = new T.Mesh(new T.BoxGeometry(W, 0.04, D / 5 - 0.03), wood); s.position.set(0, 0.16, -D / 2 + (i + 0.5) * (D / 5)); g.add(s); }
    for (let i = 0; i < 3; i++) { const b = new T.Mesh(new T.BoxGeometry(0.14, 0.12, D), wood); b.position.set(-W / 2 + 0.07 + i * (W / 2 - 0.07), 0.08, 0); g.add(b); }
    const sh = contactShadow(Math.max(W, D) * 1.4, 0.4); sh.position.y = 0.002; g.add(sh);
    return g;
  }
  function pallet(canvas) {
    const st = stage(canvas, { fov: 30, pos: [4.5, 3.6, 5.8], target: [0, 0.8, 0] });
    const world = new T.Group(); st.scene.add(world);
    const spin = spinControl(canvas);
    const bases = []; let boxes = []; let goalDist = 7.5; let dist = 7.5;
    const PER_LAYER = 12; const LAYERS = 4; const PER_PALLET = PER_LAYER * LAYERS; const MAX = PER_PALLET * 3;
    st.tick = (dt, t) => {
      const a = spin.step(dt, 0) + Math.sin(t * 0.35) * (REDUCED || spin.touched ? 0 : 0.28);
      dist += (goalDist - dist) * 0.06;
      const cx = (bases.length - 1) * 1.45;
      st.camera.position.set(cx + Math.sin(a + 0.45) * dist, dist * 0.5, Math.cos(a + 0.45) * dist);
      st.camera.lookAt(cx, 0.75, 0);
      let moving = Math.abs(goalDist - dist) > 0.01;
      boxes.forEach((b) => {
        const u = b.userData;
        if (u.t < 1) { u.t += dt / 0.55; moving = true; const k = ease(u.t); b.position.y = u.y + (1 - k) * 3.2; b.rotation.y = (1 - k) * 0.6; }
        if (u.dying) { u.d -= dt / 0.3; b.scale.setScalar(Math.max(0.001, u.d)); if (u.d <= 0) world.remove(b); }
      });
      boxes = boxes.filter((b) => !(b.userData.dying && b.userData.d <= 0));
      return moving || !REDUCED;
    };
    function slot(i) {
      const p = Math.floor(i / PER_PALLET); const k = i % PER_PALLET;
      const layer = Math.floor(k / PER_LAYER); const c = k % PER_LAYER;
      const x = (c % 4) * BOX.w - BOX.w * 1.5 + p * 2.9; const z = Math.floor(c / 4) * BOX.d - BOX.d;
      return { x, z, y: 0.18 + BOX.h / 2 + layer * BOX.h, p };
    }
    return {
      set(rows) {
        const want = [];
        rows.forEach((r) => { for (let i = 0; i < r.boxes; i++) want.push(r); });
        const shown = want.slice(0, MAX);
        const nPallets = Math.max(1, Math.ceil(shown.length / PER_PALLET));
        while (bases.length < nPallets) { const b = palletBase(); b.position.x = bases.length * 2.9; world.add(b); bases.push(b); }
        while (bases.length > nPallets) world.remove(bases.pop());
        world.position.x = 0;
        const live = boxes.filter((b) => !b.userData.dying);
        shown.forEach((r, i) => {
          const s = slot(i); const cur = live[i];
          if (cur && cur.userData.key === `${r.t.tone}|${r.t.label}`) { cur.position.set(s.x, s.y, s.z); cur.userData.y = s.y; return; }
          if (cur) { cur.userData.dying = true; cur.userData.d = 1; }
          const b = carton(r.t.tone, r.t.label.split("·")[0]);
          const gap = Math.min(0.035, 0.9 / Math.max(1, shown.length)); // 전체 낙하가 1초 안에 끝나게
          b.position.set(s.x, s.y + 3.2, s.z); b.userData = { key: `${r.t.tone}|${r.t.label}`, y: s.y, t: -i * gap };
          if (REDUCED) { b.userData.t = 1; b.position.y = s.y; }
          world.add(b); live[i] = b; boxes.push(b);
        });
        live.slice(shown.length).forEach((b) => { if (b && !b.userData.dying) { b.userData.dying = true; b.userData.d = 1; } });
        const layers = Math.ceil(Math.min(shown.length, PER_PALLET) / PER_LAYER);
        goalDist = 4.4 + (nPallets - 1) * 2.4 + layers * 0.25;
        st.loop();
        return { shown: shown.length, hidden: want.length - shown.length };
      },
    };
  }

  /* ---------- 상품 360° 보기 ---------- */
  let viewerSt = null; let viewerCanvas = null; let viewerItem = null; let viewerSpin = null;
  function viewer(info) {
    if (!viewerCanvas) {
      viewerCanvas = document.createElement("canvas"); viewerCanvas.className = "pd3d__canvas";
      viewerSt = stage(viewerCanvas, { fov: 26, pos: [0, 1.0, 5.4], target: [0, 0.68, 0], io: false });
      viewerSpin = spinControl(viewerCanvas);
      viewerSt.tick = (dt, t) => {
        if (!viewerItem) return false;
        viewerItem.rotation.y = viewerSpin.step(dt, 0.6);
        viewerItem.position.y = REDUCED ? 0 : Math.sin(t * 1.5) * 0.03;
        return true;
      };
    }
    if (viewerItem) viewerSt.scene.remove(viewerItem);
    viewerItem = makePack(info); viewerItem.scale.setScalar(viewerItem.userData.studio ? 1.22 : 1.35);
    setStudio(viewerSt, !!viewerItem.userData.studio);
    viewerSpin.angle = info.photo ? 0 : -0.5; viewerSpin.vel = 0; viewerSpin.touched = false;
    viewerSt.scene.add(viewerItem);
    // 캔버스는 반환 뒤에 시트에 붙으므로, 붙은 다음 프레임에 보임 상태로 돌려서 그리기 시작
    requestAnimationFrame(() => viewerSt.loop());
    return viewerCanvas;
  }

  window.TS3D = { hero, pallet, viewer, ready: document.fonts ? document.fonts.ready : Promise.resolve() };
})();
