# 시드 데이터 추가·수정 흐름
1. `pilot_candidates.json`에 새 후보(id, name, geometryKind, query 등)를 추가한다.
2. `npm run dev` 후 `http://localhost:5173/wheel-map/#/verify`에서 지도에 찍고 "JSON 내보내기"로 `pilot_coords.json`을 받는다.
3. 받은 파일로 `data/seed/pilot_coords.json`을 교체한다(위치·하위 점은 여기서만 관리, 좌표를 다른 파일에 복사하지 않는다).
4. 평가·실측·출처 같은 속성은 `barriers.json`에 같은 id로 추가한다(없어도 지도에는 나오며, 속성은 비어 있다).
5. 앱이 id로 합치며(`src/lib/seed.ts`), 짝이 안 맞으면 개발 콘솔에 경고하고 위치 없는 항목은 '위치 미확정'으로 표시한다.
