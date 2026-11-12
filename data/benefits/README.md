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
