// 스토어 기본 설정 — 실제 값으로 바꿔서 쓰세요.
window.STORE_CONFIG = {
  name: "투스타몰",
  // 배송비 정책 (상품별 shippingFee가 있으면 그 값이 우선)
  shippingFee: 3000,
  freeShippingOver: 30000,
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
  company: {
    name: "",
    ceo: "",
    bizNo: "",
    mailOrderNo: "",
    address: "",
    tel: "",
    email: "",
  },
};
