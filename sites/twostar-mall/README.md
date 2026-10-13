# 투스타몰 — 구매 단계를 줄인 스토어프런트

[twostar.net](https://twostar.net/) / [스마트스토어 twostarmall](https://smartstore.naver.com/twostarmall) 상품을 옮겨 담는 정적 쇼핑몰입니다.
빌드 없이 `index.html` 하나로 돌아가며, 아무 정적 호스팅(Vercel, Netlify, GitHub Pages, S3)에 그대로 올리면 됩니다.

## 구매 단계 비교

| | 스마트스토어 (기존) | 투스타몰 (신규) |
|---|---|---|
| 첫 구매 · 옵션 없음 | 목록 → 상세 → 구매하기 → 로그인 → 주문서 → 결제수단 → 결제 (6~7단계) | 목록 **[바로구매]** → 배송지 입력 → **[결제하기]** (2탭 + 입력) |
| 첫 구매 · 옵션 있음 | 위 + 옵션 드롭다운 | **[바로구매]** → 옵션 칩 → **[바로 결제하기]** → **[결제하기]** |
| 재구매 | 위와 동일 | **[바로구매]** → **[결제하기]** (배송지·결제수단 자동 기억, 2탭) |
| 여러 개 담기 | 상품마다 상세 진입 → 장바구니 → 주문서 | 목록에서 [담기]·수량 ± → 하단 바 **[바로 주문하기]** |

줄인 방법
- **상세 페이지를 거치지 않음** — 목록 카드에서 바로 담기/수량 조절/바로구매. 상세는 이미지를 눌렀을 때만.
- **로그인 없음** — 비회원 주문이 기본. 배송지·결제수단은 브라우저에 저장돼 다음 주문에 자동 입력.
- **한 화면 결제** — 주문 상품(수량 수정·삭제), 배송지, 결제수단, 금액, 결제 버튼이 한 시트에.
- **옵션 자동 선택** — 고를 값이 하나뿐인 옵션은 미리 선택, 품절 옵션은 비활성.
- **하단 고정 주문 바** — 합계와 "무료배송까지 N원" 진행 바를 항상 보여줌.
- **딥링크** — `index.html#p=상품ID` 로 들어오면 바로 결제 시트가 열림 (광고·카톡 공유용).

## 전 상품 가져오기

### 가장 쉬운 방법 — 더블클릭
1. [Node.js](https://nodejs.org) LTS 설치
2. 이 폴더(`sites/twostar-mall`)에서
   - Windows: `import-windows.bat` 더블클릭
   - Mac: `import-mac.command` 더블클릭 (처음엔 우클릭 → 열기)
3. 스마트스토어 → twostar.net(카페24) 순서로 상품을 가져온 뒤 브라우저에 미리보기가 열립니다.

### 명령어로 직접

> 현재 `data/products.json` 에는 **twostar.net(카페24) 전 상품**이 들어 있습니다 (`import-cafe24.mjs` 로 수집).
> 스마트스토어는 네이버가 자동 접근을 차단(429)해 포함되지 않았습니다. 필요하면 아래 2)를 본인 PC에서 실행하거나 판매자센터 엑셀을 쓰세요.
> 상품 이미지는 카페24 이미지 서버(ecimg.cafe24img.com) 주소를 그대로 씁니다. 상품 정보가 바뀌면 다시 실행하면 됩니다.

```bash
cd sites/twostar-mall

# 1) 가장 확실: 판매자센터/관리자에서 상품 엑셀 다운로드 → CSV UTF-8 로 저장
node scripts/import-csv.mjs 상품목록.csv

# 2) 스마트스토어 크롤링 (옵션·추가이미지까지: --details)
node scripts/import-smartstore.mjs twostarmall --details

# 3) twostar.net(카페24) 전 상품 — 목록 + 옵션·배송비·상세이미지
node scripts/import-cafe24.mjs https://twostar.net --merge   # --merge: 기존 상품과 합치기

# (카페24가 아닌 일반 쇼핑몰: sitemap + JSON-LD/og 태그)
node scripts/import-site.mjs https://example.com
```

크롤링은 사이트 구조나 차단 정책이 바뀌면 실패할 수 있습니다. 그럴 땐 1)번 엑셀 방식을 쓰세요.

## 3D

`three3d.js` (three.js r128, cdnjs) 가 세 곳을 실시간 3D 로 그린다. WebGL 이 없거나 라이브러리를 못 불러오면 2D 화면 그대로 동작한다.

- 메인 배너: 슬라이드 상품을 캔·페트·박스로 렌더링, 주변에 다른 상품이 떠 있고 마우스로 회전
- 탕비실 계산기: 발주 박스를 팔레트(층당 12박스 × 4층) 위에 쌓아 보여줌, 수량이 바뀌면 박스가 떨어져 쌓임
- 상품 시트: 360° 돌려보기 (3D / 사진 전환)

라벨은 상품명·용량으로 캔버스에 인쇄한 텍스처라 실제 패키지 디자인과는 다르다. 화면 밖이거나 탭이 숨겨지면 그리기를 멈추고, 움직임 줄이기 설정이면 자동 회전을 끈다.

## 설정 — `config.js`

- `shippingFee`, `freeShippingOver` : 배송비 정책
- `payMethods` : 결제수단 노출 순서 (첫 번째가 기본값)
- `portone.storeId`, `portone.channelKeys` : [포트원 V2](https://portone.io) 키를 넣으면 실제 결제창이 열립니다. 비워두면 데모 모드(주문 완료 화면까지).
  실서비스에서는 서버에서 `paymentId` 로 결제 금액을 반드시 검증하세요.
- `orderWebhook` : 주문 JSON 을 POST 받을 주소 (구글 Apps Script, Slack 웹훅 등)
- `company` : 푸터 사업자 정보 (전자상거래법 표시 의무)

## 로컬 실행

```bash
cd sites/twostar-mall && node scripts/serve.mjs   # http://localhost:8080
```

## 상품 데이터 형식 (`data/products.json`)

```json
{ "products": [{
  "id": "123", "name": "상품명", "category": "커피", "price": 12900, "salePrice": 9900,
  "image": "https://…", "images": ["https://…"], "soldOut": false, "shippingFee": 0,
  "reviewCount": 10, "rating": 4.8, "badge": "BEST", "description": "<p>상세 HTML</p>",
  "options": [{ "name": "용량", "values": [{ "label": "1kg", "extra": 8000, "soldOut": false }] }]
}]}
```
