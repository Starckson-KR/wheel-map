# 혜택·행사 데이터 (사람이 고른 큐레이션)

`benefits.json`은 앱의 혜택알림 탭 "나에게 맞는 혜택·행사"가 정적으로 불러오는 목록이에요. 확인일 **2026-11-12**.

## 원칙
- 공식 누리집 페이지를 직접 열어 확인한 내용만 담고, 문장은 짧게 바꿔 썼어요(원문 복사 없음). 북구 누리집은 공공누리 4유형이라 제목·요약·원문 링크만 써요.
- 확인 못 한 칸은 `"확인 필요"`로 두고 `unknowns`에 적어요. 금액·기간·대상을 짐작해서 채우지 않아요.
- 모든 항목에 `sourceUrl`과 `confirmedAt`이 있어야 해요(`tests/benefits.test.ts`가 검사).
- 종료일(`period.end`)이 지난 항목은 앱이 숨겨요. 발표 전에 확인일과 기간을 다시 점검해요.

## 항목 형식
`id, title, summary, category(mobility|device|welfare|culture), target, wheelchairRelevant(true|false|null), area, period({type: always|range|unknown, start, end}), agency, contact, sourceName, sourceUrl, confirmedAt, status(확인됨|확인 필요), unknowns[]`

## 출처 목록 (모두 2026-11-12 확인, 페이지를 열어 읽음)
| 항목 | 출처 |
|---|---|
| 장애인 자동차 표지, 장애인연금, 장애수당·장애아동수당, 주택개조 | 북구청 장애인복지시책 https://bukgu.gwangju.kr/menu.es?mid=a10305070100 (페이지 갱신 2026/06/22) |
| 장애인활동지원 | 북구청 https://bukgu.gwangju.kr/menu.es?mid=a10305030000 |
| 전동보장구 충전소 33곳 | 북구청 https://bukgu.gwangju.kr/menu.es?mid=a10305090000 (갱신 2026/06/22) |
| 장애인복지시설·자립생활센터 | 북구청 https://bukgu.gwangju.kr/menu.es?mid=a10305080000 (갱신 2025/01/15) |
| 보장구 건강보험 급여 | 국민건강보험공단 https://www.nhis.or.kr/nhis/policy/wbhada10900m02.do |
| 보조기기 교부사업 | 국가보조기기센터 https://knat.go.kr/knw/home/knat_DB/assist_detail.php?assist_biz_idx=1 (갱신 2026.01.16, 페이지 글자가 깨져 소득 기준은 북구청 시책 표로 보완하되 세부는 확인 필요) |
| 장애인 스포츠강좌이용권 | https://dvoucher.kspo.or.kr/main.do (2027년도 접수 11/9~11/27) |
| 문화누리카드 | https://www.mnuri.kr/notice/userNotice/detail.do?nttId=43151 |
| 열린관광 모두의 여행 | https://access.visitkorea.or.kr/main/main.do |
| 비엔날레 문화콘서트 4회차(연기), 전통음식강좌 | 북구청 문화행사 게시판 https://bukgu.gwangju.kr/board.es?mid=a10201110000&bid=0315 |
| 교통약자 이동지원(새빛콜) | 공공데이터포털 표준데이터 https://www.data.go.kr/data/15028207/standard.do (광주 행은 열람하지 못함) |

## 확인 못 한 것
- **광주 새빛콜 현행 대상·요금·예약**: 공식 현행 페이지를 못 찾았어요. 앱 카드는 "확인 필요"로 표시해요.
- 북구 문화행사 게시글에는 휠체어석·접근성 안내가 없어요(행사 두 건은 "확인 필요").
- 보조기기 교부사업의 정확한 소득 기준, 열린관광 운영기관, 문화누리카드 문의 전화.
- 광주복지플랫폼, 복지로 개별 서비스 검색은 이번에 열지 않았어요.

## 변경 감시 (AI 없이 무료, 매일 1회)
출처 페이지가 바뀌거나 깨졌는지 자동으로 알려 주는 장치예요. 12개 고유 주소(15개 항목)를 대상으로 해요.

- **동작**: `.github/workflows/benefit-watch.yml`이 **매일 한국 시간 09:17**(UTC 00:17)에 `scripts/watchBenefits.mjs`를 돌려요. 각 주소의 HTTP 상태·최종 주소·제목, 그리고 본문에서 script/style/주석/태그와 잡음(날짜·시각·조회수·긴 숫자열·토큰)을 걷어낸 텍스트의 SHA-256 지문을 기준 파일 `watch-state.json`과 비교해요. 페이지 본문은 저장하지 않고 지문·상태·제목·확인 시각만 담아요(저작권).
- **판정**: 같음 / 바뀜 / 깨짐(404·5xx 등) / 접속 막힘 의심(네트워크 오류·401·403·429).
- **이슈**: 문제가 있으면 라벨 `benefit-watch`의 열린 이슈에 댓글을 달고, 없으면 새로 만들어요. 이미 알린 변경(같은 주소·같은 판정·같은 새 지문·같은 상태)은 숨김 주석 `watch-sig`로 비교해서 매일 다시 알리지 않아요. 변경이 없으면 아무것도 하지 않아요. 기준 파일은 자동으로 커밋하지 않아요.
- **수동 실행**: GitHub 저장소의 Actions 탭 → "Benefit watch" → Run workflow. 로컬에서는 `node scripts/watchBenefits.mjs`(비교만), `--report 결과.md`(마크다운 저장).
- **이슈를 받으면**: ① 해당 항목의 출처를 다시 읽어요 → ② `benefits.json` 수정(확인일 포함) → ③ 로컬에서 `node scripts/watchBenefits.mjs --update`로 기준 갱신 → ④ 커밋. 이슈는 확인 후 닫아요(닫으면 다음 변경 때 새 이슈가 열려요).
- **접속 막힘 의심**: 한국 공공 누리집이 해외 IP(GitHub 서버)를 막을 수 있어요. 막혔는지는 로컬에서는 알 수 없어요. 막힘 의심이 계속 나오면 로컬(한국 네트워크)에서 다시 확인하고, 계속 막히면 해당 주소를 `scripts/watchBenefits.mjs`의 `STATUS_ONLY`로 돌리거나 감시에서 빼요.
- **상태만 감시하는 항목**: 없음. 2026-11-12 로컬에서 12개 주소를 3번 받아 모두 지문이 흔들리지 않았어요(2번째·3번째는 비교 실행에서 모두 "같음"). 나중에 매번 바뀌는 페이지가 생기면 `STATUS_ONLY`(상태만) 또는 `CONTENT_SELECTORS`(본문 영역 정규식)에 추가해요.
- **User-Agent**: `wheelmap-benefit-watch/1.0 (compatible; Starckson-KR/wheel-map)`. 괄호 안에 `+https://` 주소를 넣으면 국민건강보험공단 서버가 연결을 끊어서 이 형태로 정했어요.
- 숫자 중 6자리 미만(금액 등)은 지문에 남겨서 금액이 바뀌면 "바뀜"으로 잡혀요. 대신 날짜·조회수가 표시 형식을 바꾸면 거짓 알림이 날 수 있어요.
- **북구청 날씨 위젯(2026-11-12 수정)**: 북구청 누리집 머리말의 날씨·기온·미세먼지 문구가 시간마다 바뀌어 거짓 "바뀜"이 났어요. 정규화에서 이 문구를 지웠고(기준 재생성 후 10분 간격 2번 비교 모두 같음), 해당 주소를 상태만 감시로 돌리지는 않았어요.
