#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."; read -r; exit 1; }

echo; echo "[1/3] 스마트스토어 전 상품 가져오는 중... (상품 수에 따라 몇 분 걸립니다)"
node scripts/import-smartstore.mjs twostarmall --details
echo; echo "[2/3] twostar.net 전 상품(옵션·상세 포함) 합치는 중..."
node scripts/import-cafe24.mjs https://twostar.net --merge
echo; echo "[3/3] 미리보기를 엽니다. 이 창을 닫으면 종료됩니다."
node scripts/serve.mjs 8080
