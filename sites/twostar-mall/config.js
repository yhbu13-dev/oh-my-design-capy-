// 스토어 기본 설정 — 실제 값으로 바꿔서 쓰세요.
window.STORE_CONFIG = {
  name: "투스타몰",
  // 배송비 정책 (상품별 shippingFee가 있으면 그 값이 우선)
  // twostar.net 기준: 상품마다 '무료' 또는 3,000원 (상품 데이터의 shippingFee 우선)
  shippingFee: 3000,
  // 일정 금액 이상 무료배송 정책이 있으면 금액을 넣으세요 (예: 50000). 없으면 null.
  freeShippingOver: null,
  // 결제 수단 노출 순서. 첫 번째가 기본 선택.
  payMethods: [
    { id: "naverpay", label: "네이버페이" },
    { id: "kakaopay", label: "카카오페이" },
    { id: "tosspay", label: "토스페이" },
    { id: "card", label: "신용·체크카드" },
    { id: "bank", label: "무통장입금" },
  ],
  // PG 연동 (포트원 V2 예시). storeId / channelKey 를 넣으면 실제 결제창이 뜹니다.
  // 비워두면 데모 모드로 주문 완료 화면까지만 진행합니다.
  portone: {
    storeId: "",
    channelKeys: { naverpay: "", kakaopay: "", tosspay: "", card: "" },
  },
  // 주문 내역을 받을 서버 엔드포인트 (선택). 비워두면 브라우저에만 저장.
  orderWebhook: "",
  // 무통장입금 계좌 (주문 완료 화면에 표시)
  bankAccounts: [
    { bank: "기업", number: "492044-002-01018" },
    { bank: "국민", number: "618301-01-421165" },
  ],
  bankHolder: "투스타글로벌(주)",
  // 출처: twostar.net 하단 사업자 정보
  company: {
    name: "투스타글로벌(주)",
    ceo: "홍이성",
    bizNo: "222-81-33809",
    mailOrderNo: "20160458",
    address: "경기도 남양주시 화도읍 폭포로17번길 63-94",
    tel: "031-591-3447",
    hours: "평일 10:00~17:00 (점심 12:30~13:30, 주말·공휴일 휴무)",
    email: "twostar33@nate.com",
  },
};
