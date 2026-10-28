# 북구동행지도

휠체어 이용자의 이동경로에서 장애요소(단차, 좁은 보도, 경사, 승강 시설 등)를 지도 위에 보여 주는 웹 서비스입니다.
광주 북구를 대상으로, 현장조사 데이터와 공공데이터를 겹쳐 경로별 이동 부담을 확인하고 시민 제보를 소관 기관 민원으로 연결하는 흐름을 담았습니다.
대학원 수업(디자인사고와 정책난제)에서 만든 발표용 프로토타입이며, 실제 서비스가 아닙니다.

- 배포 주소: https://starckson-kr.github.io/wheel-map/ (TODO: 배포 후 확인)
- 기술: Vite, React, TypeScript, 카카오 지도

## 실행 방법

Node.js 24 이상이 필요합니다.

```
npm ci
copy .env.example .env     # macOS/Linux는 cp .env.example .env
npm.cmd run dev            # macOS/Linux는 npm run dev
```

`.env`에 `VITE_KAKAO_JS_KEY`(카카오 지도 JavaScript 키)를 입력하면 지도가 표시됩니다.
나머지 키(`KAKAO_REST_KEY`, `TMAP_APP_KEY`, `DATA_GO_KR_KEY`)는 데이터를 미리 내려받는 스크립트(`scripts/`)에만 쓰이며, 브라우저 코드와 배포 빌드에는 들어가지 않습니다.
저장소에는 미리 받아 둔 JSON(`data/`)이 들어 있어 키 없이도 화면 구성은 확인할 수 있습니다.

```
npm run build   # 배포용 빌드
npm run lint
```

## 데이터 출처

- 공공데이터포털: 전국횡단보도표준데이터, 공중화장실 정보(북구), 장애인편의시설 정보(목록·상세), 국토교통부 TAGO 버스정류소정보·버스도착정보, 광주 버스정보
- 카카오: 지도 JavaScript SDK, 로컬(주소 변환) API
- SK TMAP: 보행자 경로 API (미리 받은 경로를 `data/routes/`에 저장해 사용)
- 현장조사 데이터: 팀원 A·B·C 현장조사

각 데이터의 이용 조건은 원 제공처의 안내를 따릅니다.

## 라이선스

확인 필요 (공공데이터 이용허락범위와 소스 코드 라이선스는 아직 정하지 않았습니다.)
