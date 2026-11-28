# wheelmap-ai (이의있음! 서버 쪽 Cloudflare Worker)

한 Worker가 아래 일을 모두 맡습니다(경로 분기는 `src/index.ts`). 자세한 표는 아래 「경로 한눈에 보기」.
- AI 검색창: 자연어 질문 한 줄을 받아 「앱 안 어느 화면으로 갈지(의도)」와 「빈칸(유형·장소 낱말)」만 돌려줍니다. 답을 지어내지 않고, 소관 기관·법령·접수번호·처리기한은 응답에 필드 자체가 없습니다. 앱은 의도를 `src/lib/nav.ts`의 `TO.*` 주소로 바꿔 이동시킵니다. Workers AI 바인딩(`env.AI.run`)을 쓰며, 키워드 폴백은 앱 쪽 일이고 Worker는 실패를 알려 주기만 합니다.
- 간편 계정·공유 제보·사진·개인 설정(D1), 실시간 알림(Durable Object `RealtimeHub`, WebSocket), 접속·오류 기록, 개발자 관리.
- 중계: 광주 BIS 저상버스(`/bis/*`), ODsay 버스 길찾기(`/transit`), 기상청 날씨(`/weather`).

## 비밀 값(secret)과 설정 변수
- secret은 이름만 적습니다(값은 어디에도 적지 않음). `npx.cmd wrangler secret put <이름>`으로 넣습니다.
  - `DATA_GO_KR_KEY` — 공공데이터포털 키(BIS·기상청 공용)
  - `KOREACONNECT_KEY` — 디지털융합플랫폼 ODsay 키
- `wrangler.toml [vars]`: `AI_MODEL`, `ALLOWED_ORIGINS`, `RATE_PER_MINUTE`, `DAILY_LIMIT`, `DAILY_WRITE_LIMIT`, `BIS_DAILY_CAP`, `BIS_PER_MINUTE`, `TRANSIT_DAILY_CAP`, `TRANSIT_PER_MINUTE`. 바인딩: `AI`, `DB`(D1 `wheelmap-db`), `HUB`(Durable Object).

## 경로 한눈에 보기
| 경로 | 설명 | 상한·캐시(코드 기준) |
|---|---|---|
| `POST /`, `/intent` | AI 의도 분류(아래 API 명세) | IP 분당·전체 하루, Worker 인스턴스 메모리(best effort) |
| `/auth/*`, `/prefs`, `/reports`, `/photos/*` | 계정·설정·공유 제보·사진(아래 계정 절) | 계정당 하루 쓰기 `DAILY_WRITE_LIMIT` |
| `POST /activity/visit`, `/activity/error` | 접속·오류 기록(로그인 본인 것만) | 오류 사용자당 하루 20건, 방문 10분 중복 무시 |
| `/admin/*` | 개발자(role='dev') 전용 관리 | 인증으로만 보호 |
| `POST /rt/ticket`, `GET /rt`(WebSocket) | 30초 1회용 티켓 → 실시간 연결 | 티켓 IP당 분당 20, 사용자당 연결 6개 |
| `GET /bis/arrive?station=`, `/bis/line?name=` | 광주 BIS 도착·노선별 저상 수 | 하루 상류 호출 `BIS_DAILY_CAP`, IP 분당 `BIS_PER_MINUTE`, D1 캐시(도착 25초·위치 10분·노선 목록 24시간) |
| `GET /transit?from=위도,경도&to=위도,경도` | ODsay 버스 경로 | 하루 `TRANSIT_DAILY_CAP`, IP 분당 `TRANSIT_PER_MINUTE`, D1 캐시(성공 6시간·길 없음 1시간) |
| `GET /weather` | 기상청 날씨(용봉동) | IP 분당 30(코드 고정), D1 캐시 10분(실패 2분) |
- 중계 3종의 캐시·하루 카운트는 D1 `bis_cache`·`bis_calls`를 같이 씁니다(workers.dev 주소에서는 Cache API가 안 되기 때문).
- 알려진 문제: `/transit`은 포털 앞단 웹 방화벽이 Cloudflare 요청을 막아 지금 배포판에서는 실패합니다(국내 PC에서는 정상). 시연 쌍은 저장본(`data/routes/transit.json`)을 쓰는 설계입니다.

## 배포 순서 (사용자가 직접)
> PowerShell에서는 `npx.cmd`, 명령 프롬프트(cmd)나 Git Bash에서는 `npx`도 됩니다. 아래는 모두 `npx.cmd`로 적었습니다.

1. 저장소 폴더에서 `cd worker`
2. `npx.cmd wrangler login` — 브라우저에서 Cloudflare 가입·로그인 후 직접 승인합니다(비밀번호는 채팅에 붙이지 않기).
3. `npx.cmd wrangler deploy` — 끝에 나오는 `https://wheelmap-ai.<계정>.workers.dev` 주소만 알려 주세요(주소는 비밀이 아닙니다).
4. Cloudflare 대시보드 → AI → Workers AI에서 무료 할당(하루 10,000 neurons)이 보이는지 확인하고, 결제수단 등록을 요구하는지 알려 주세요.

모델·허용 출처·한도는 `wrangler.toml`의 `[vars]`만 고치고 다시 `npx.cmd wrangler deploy` 하면 됩니다.

## 확인용 curl (Git Bash 또는 cmd; `-H Origin`이 필요합니다)
```
curl -s -X POST https://wheelmap-ai.<계정>.workers.dev/intent \
  -H "Origin: http://localhost:5173" -H "Content-Type: application/json" \
  -d '{"question":"경사로가 막혔어요"}'
```
출처가 허용 목록에 없으면 403입니다(Origin 헤더가 없는 호출도 403).

## API 명세
`POST /intent` (또는 `/`), 본문 `{ "question": "문장" }` (본문 2KB 이하, 문장 120자 이하).

성공(모델이 분류함, 「모름」 포함):
```json
{ "ok": true, "intent": "report_new", "slots": { "type": "경사로" }, "confidence": 0.9, "fallback": false, "notice": "AI 답변은 참고용이에요" }
```
모델을 한 번 더 불렀으면(첫 출력이 JSON이 아니었을 때) 응답에 선택 필드 `"retried": true`가 붙습니다(성공·실패 모두). 재시도가 없으면 이 필드는 아예 없습니다. 재시도도 하루 상한(`DAILY_LIMIT`) 호출량에 1회로 더해 셉니다.

실패(앱은 키워드 검색으로 대체):
```json
{ "ok": false, "intent": "unknown", "slots": {}, "confidence": 0, "fallback": true, "reason": "model_error", "notice": "AI 답변은 참고용이에요" }
```
| HTTP | 뜻 | reason |
|---|---|---|
| 200 | 정상 / 모델 호출 실패(8초 초과·오류) / 모델 출력이 JSON·스키마 위반 | (정상은 없음) `model_error`, `bad_output` |
| 400 | 형식 오류, 빈 질문, 120자 초과 | `bad_request`, `too_long` |
| 403 | 허용 출처 아님 | (본문 `error:"forbidden"`) |
| 405 / 404 | POST·OPTIONS 외 / 다른 경로 | `error` |
| 413 | 본문 2KB 초과 | `too_large` |
| 429 | 분당 또는 하루 상한 초과 | `rate_limited`, `daily_limit` |

허용 의도(`intent`) ↔ 앱 이동 대상(앱이 고정 변환표로 처리):
| intent | 빈칸(slots) | 앱 이동 대상 |
|---|---|---|
| report_new | type, place | `TO.newReport` |
| receipt_lookup | - | `TO.report` (접수번호로 찾기 구역) |
| my_reports | - | `TO.report` (내 민원 진행 상황 구역) |
| route | from, to | `TO.route` |
| bus | place | `TO.bus` |
| progress | - | `TO.progress` (개선 현황) |
| my_score | - | `TO.me` |
| agency | - | `TO.agency` |
| alerts | - | `TO.alerts` |
| help | - | TODO(확인 필요): 사용법 화면이 아직 없음 |
| unknown | - | 이동 없음(추천 질문·키워드 검색) |

모델이 목록에 없는 값을 내면 무조건 `unknown`으로 바뀌고, 허용되지 않은 필드(기관·법령 등)는 버립니다. `confidence`가 0.3 미만이어도 `unknown`입니다. 빈칸은 의도별 허용 이름만, 20자 이하, 링크·마스킹 표시가 든 값은 버립니다.

## 분류 정확도 보정 (모델 답 앞뒤의 규칙)
- 모델 호출 전: 한글 음절이 2개 미만인 입력(`ㅇㅅㅇ`, `??` 등)은 모델을 부르지 않고 바로 `unknown`(confidence 0.9).
- JSON 파싱: 코드펜스·앞뒤 설명·`<think>`·작은따옴표·따옴표 없는 키·끝 쉼표·잘린 꼬리를 보정하고, 그래도 안 되면 `intent` 등만 정규식으로 건집니다. 그래도 실패하면 1회 재시도(프롬프트에 「JSON 객체 하나만」 강조, 첫 호출과 합쳐 총 8초 안, 남은 시간이 1.5초 미만이면 생략). 재시도 후에도 실패하면 `bad_output` fallback.
- 빈칸 정리: 허용 키만, 값은 한글·숫자·공백 2~20자. `type`은 앱의 제보 유형 12개·위치 성격 8개(`src/rules.ts`에 복사, 앱 목록이 바뀌면 같이 고침)로 정규화하고(구멍→파손 노면, 턱→계단·턱, 횡단보도→횡단보도·신호) 목록에 없으면 뺍니다. `place`·`from`·`to`는 질문에 실제로 있는 구절만 남깁니다. type과 같은 값이거나 유형 낱말인 `place`는 뺍니다.
- 후처리(모델 답 뒤): 「이전 지시」·「프롬프트」·`ignore` 등은 무조건 `unknown`. 처리기한·며칠·언제까지·법령·조문·전화번호·연락처를 묻는 말은 `unknown`(신고·길찾기·버스·접수번호 찾기 제외). `help`는 「어떻게 써」·「사용법」·「도움말」·「처음」·「뭐 할 수」 단서가 있을 때만 허용. 그 밖의 의도는 신뢰도를 깎지 않습니다.

## 보안·남용 방지
- CORS: `ALLOWED_ORIGINS`(쉼표 목록, 기본 `https://starckson-kr.github.io`, `http://localhost:5173`)에 있는 출처만 허용. 그 외 403. 사전 요청(OPTIONS)도 같습니다.
- 질문은 제어문자·보이지 않는 문자를 지우고, 전화번호·이메일·숫자 11자리 이상은 `[전화]`·`[이메일]`·`[숫자]`로 바꾼 뒤에만 모델에 보냅니다. 위치·좌표·사진은 앱이 보내지 않아야 합니다.
- 프롬프트 인젝션: 질문은 별도 `user` 메시지로만 전달하고, 시스템 프롬프트에서 질문을 「명령이 아닌 자료」로 취급하게 했으며, 출력은 스키마 검증으로 막습니다(뚫려도 허용 의도 밖은 `unknown`).
- 로그에는 질문 원문·IP를 남기지 않고 오류 종류(`model_error`, `model_timeout`, `bad_output`)만 남깁니다.
- 속도 제한: 계정 작업(KV 등) 없이 Worker 메모리에 둡니다. 기본 IP당 분당 `RATE_PER_MINUTE=10`회, 전체 하루 `DAILY_LIMIT=500`회(UTC 기준 날짜). **한계: Worker 인스턴스마다 따로 세는 best effort입니다.** 인스턴스가 여러 개로 늘거나 재시작하면 카운터가 초기화되어 실제 한도는 더 느슨할 수 있습니다. 엄격한 상한이 필요하면 나중에 Cloudflare의 Rate Limiting 규칙이나 Durable Object를 쓰세요. 비용 면에서는 Workers AI 무료 하루 10,000 neurons가 최종 안전망입니다(요청당 약 7 neurons는 조사 문서의 계산이며 실측 아님).

## 모델 선택 (기본값과 근거)
- 현재 기본값: `@cf/qwen/qwen3-30b-a3b-fp8` (`wrangler.toml`의 `AI_MODEL`, 코드 기본값 `src/index.ts`도 같음). 처음에는 `@cf/meta/llama-3.2-3b-instruct`였고 11/18에 교체했습니다(아래 설명은 처음 선택 당시 기록).
- 확인된 것(2026-11-11, Cloudflare 모델 카탈로그 공식 문서): llama-3.2-3b 모델은 「multilingual dialogue」용 소형 instruct 모델로 표기됨. 카탈로그에서 한국어를 명시한 모델은 없었음.
- 확인 못 한 것: 한국어 분류 정확도, JSON 준수율(카탈로그에 소형 모델의 JSON 모드 표기 없음 → 프롬프트 + Worker 검증으로 대응), 카탈로그 페이지에는 `@cf/` 접두어가 보이지 않아 ID 철자는 공식 문서의 관례를 따른 것(배포 시 오류가 나면 카탈로그에서 정확한 ID로 교체).
- 배포 후 `test/questions.md`의 30문항으로 비교할 후보: `@cf/meta/llama-3.2-3b-instruct`(기본), `@cf/qwen/qwen3-30b-a3b-fp8`(다국어 표기), `gemma-4-26b-a4b-it` 계열. Qwen3 계열이 `<think>` 블록을 앞세워도 파서가 제거합니다.

## 로컬 시험
`node --test worker/test/*.test.ts` (Node 24, 설치 불필요, 가짜 AI 객체 사용). 실제 모델 호출은 배포 후에만 가능합니다.
타입 확인: `node node_modules/typescript/bin/tsc -p worker/tsconfig.json`

## 아직 안 한 것·가정
- 앱 쪽 검색창, 키워드 폴백, `intent → TO.*` 변환표, 「참고용」 안내 표시는 앱 단계에서 합니다.
- `help` 의도의 이동 대상 화면은 아직 정해지지 않았습니다(TODO).
- 요청 JSON 필드 이름(`question`)과 응답 필드는 이 문서가 기준이며, 앱 구현 때 바꿀 수 있습니다.

## 간편 계정·공유 제보 (D1 `wheelmap-db`, 같은 Worker·같은 주소)
피어 리뷰용입니다. 이름(한글·영문·숫자·공백 1~10자, 중복 불가) + 숫자 4자리로 가입하고, 제보는 모든 계정이 공유합니다. 설정은 본인만 봅니다. PIN은 PBKDF2-SHA256(10만 회, 사용자별 salt)로 해시해 저장하고 세션 토큰도 해시만 저장합니다. 이름·PIN·토큰·IP는 로그에 남기지 않습니다. 같은 `Authorization: Bearer <토큰>`(30일).
| 경로 | 설명 |
|---|---|
| POST `/auth/signup`, `/auth/login` | `{name, pin}` → `{ok, token, user:{id,name}}`. 실패 `{ok:false, code:'bad_input'｜'taken'｜'invalid'｜'locked', message}`. 이름·IP별 5회 실패 시 10분 잠금(이름 전체 30회도 잠금) |
| POST `/auth/logout`, GET `/auth/me` | 세션 삭제 / 내 정보 |
| GET·PUT `/prefs` | 본인 설정(허용 키만, 16KB). PUT `{data:{키:값｜null}}`은 키별 병합 |
| GET `/reports?since=ms` | 변경분(공유). `{serverTime, cursor, more, reports[], users:{id:이름}}` |
| PUT `/reports/:id` | 제보 한 건(64KB). 새 제보는 `userId`가 내 계정이어야 함, `demo`·`demoSet`은 거부. 기존 건은 history·투표자를 합집합으로 병합하고 나머지는 보낸 값 |
| PUT·GET `/photos/:id` | 사진 본문(JPEG/PNG/WebP, 400KB). 올린 사람만 덮어쓰기 |
쓰기(제보·사진·설정)는 계정당 하루 `DAILY_WRITE_LIMIT`(300)회. 허용 출처만(Authorization·Content-Type, GET/POST/PUT/DELETE/OPTIONS). 오류 본문은 `{ok:false, code, message}`.
시험: `node --test worker/test/*.test.ts` (가짜 D1은 `node:sqlite`). 마이그레이션: `worker/migrations/0001_accounts_reports.sql`.

### 리뷰가 끝난 뒤 전체 데이터 지우기 (`worker` 폴더에서, 되돌릴 수 없음)
```
npx.cmd wrangler d1 execute wheelmap-db --remote --command "DELETE FROM photos; DELETE FROM reports; DELETE FROM report_deletions; DELETE FROM prefs; DELETE FROM sessions; DELETE FROM write_quota; DELETE FROM throttle; DELETE FROM rt_tickets; DELETE FROM visits; DELETE FROM user_devices; DELETE FROM client_errors; DELETE FROM users;"
```
(`bis_cache`·`bis_calls`는 중계 캐시라 개인 자료가 아니어서 뺐습니다. 표 목록은 `migrations/0001`~`0006` 기준이며, 마이그레이션이 늘면 이 명령도 갱신하세요. 개발자 계정까지 지워지므로 남길 계정이 있으면 `DELETE FROM users WHERE ...`로 따로 처리하세요.)
계정 하나만: `... --command "DELETE FROM users WHERE name='이름'"` 후 그 사람의 sessions·prefs·reports(`author_id`)·photos(`owner_id`)도 같은 방식으로 지웁니다. 데이터베이스째 없애려면 `npx.cmd wrangler d1 delete wheelmap-db`.

## AI 답변 (`POST /answer`, 기본 꺼짐)
- 질문에서 필요를 읽고 공공 사이트만 검색해 출처와 함께 짧게 답한다. Claude Haiku 5.5 + Anthropic 웹 검색 서버 도구(`web_search_20250305`, `allowed_domains` = `src/answerSources.ts`, `max_uses` 2, 위치 광주).
- **`ANSWER_ENABLED = "1"`일 때만 살아 있다.** 없거나 다른 값이면 지금처럼 404 `not_found`이고 Anthropic을 부르지 않는다. 키는 secret `ANTHROPIC_API_KEY`(없으면 503 `not_configured`). 상한: `ANSWER_PER_MINUTE`(IP별, 기본 5), `ANSWER_DAILY_LIMIT`(전체, 기본 200) — Worker 인스턴스 메모리 기준(best effort)이다.
- 요청: `{ "question": "…", "history": [{ "q": "…", "a": "…" }] }`(history는 직전 2개까지, 서버에 저장하지 않는다). 질문 120자, 본문 4KB까지.
- 응답: 검사에서 걸리면 JSON `{ ok:false, error }`(400·413·429·503), 통과하면 `text/event-stream`. 조각(`event:` 이름 = `data.type`):
  - `need` `{ text }` · `status` `{ phase:"searching", query }` / `{ phase:"reading", sites:[{name,domain}] }` · `delta` `{ text }` · `reset`(흘린 답 글자 지우기)
  - `done` `{ kind:"answer"|"clarify"|"out_of_scope"|"not_found", need, answer, sources:[{name,domain,url,title}], actions:[{id,to?,phone?}], followups:[], clarify?:{question,options}, notice }`
  - `error` `{ reason:"timeout"|"busy"|"upstream" }`
- 지키는 것: 검색을 했고 허용 사이트 인용이 하나 이상 붙은 글만 `answer`로 친다(아니면 `not_found`). `actions`는 `src/answerCore.ts`의 `ACTIONS` 목록 안에서만, 전화하기는 인용 원문에 적힌 번호만. 출처(citations)와 구조화 출력은 같이 쓸 수 없어(400) 나머지 조각은 글 안의 `@@need`·`@@end {JSON}` 표시로 받고 코드에서 다시 검증한다.
- 실측: 저장소 루트에서 `node worker/scripts/measure-answer.ts [번호,…] [--full]`(실제 돈이 나간다. 2026-11-28: 답 1건 약 6~8초·약 1.2센트, 되묻기·범위 밖 1~3초·0.1센트 미만).
