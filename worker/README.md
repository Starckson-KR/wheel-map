# wheelmap-ai (AI 검색창용 Cloudflare Worker)

자연어 질문 한 줄을 받아 「앱 안 어느 화면으로 갈지(의도)」와 「빈칸(유형·장소 낱말)」만 돌려주는 Worker입니다. 답을 지어내지 않고, 소관 기관·법령·접수번호·처리기한은 응답에 필드 자체가 없습니다. 앱은 의도를 `src/lib/nav.ts`의 `TO.*` 주소로 바꿔 이동시킵니다.
Workers AI 바인딩(`env.AI.run`)만 쓰므로 API 키가 없습니다. 키워드 폴백은 앱(프런트) 쪽 일이고, Worker는 실패를 알려 주기만 합니다.

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

## 보안·남용 방지
- CORS: `ALLOWED_ORIGINS`(쉼표 목록, 기본 `https://starckson-kr.github.io`, `http://localhost:5173`)에 있는 출처만 허용. 그 외 403. 사전 요청(OPTIONS)도 같습니다.
- 질문은 제어문자·보이지 않는 문자를 지우고, 전화번호·이메일·숫자 11자리 이상은 `[전화]`·`[이메일]`·`[숫자]`로 바꾼 뒤에만 모델에 보냅니다. 위치·좌표·사진은 앱이 보내지 않아야 합니다.
- 프롬프트 인젝션: 질문은 별도 `user` 메시지로만 전달하고, 시스템 프롬프트에서 질문을 「명령이 아닌 자료」로 취급하게 했으며, 출력은 스키마 검증으로 막습니다(뚫려도 허용 의도 밖은 `unknown`).
- 로그에는 질문 원문·IP를 남기지 않고 오류 종류(`model_error`, `model_timeout`, `bad_output`)만 남깁니다.
- 속도 제한: 계정 작업(KV 등) 없이 Worker 메모리에 둡니다. 기본 IP당 분당 `RATE_PER_MINUTE=10`회, 전체 하루 `DAILY_LIMIT=500`회(UTC 기준 날짜). **한계: Worker 인스턴스마다 따로 세는 best effort입니다.** 인스턴스가 여러 개로 늘거나 재시작하면 카운터가 초기화되어 실제 한도는 더 느슨할 수 있습니다. 엄격한 상한이 필요하면 나중에 Cloudflare의 Rate Limiting 규칙이나 Durable Object를 쓰세요. 비용 면에서는 Workers AI 무료 하루 10,000 neurons가 최종 안전망입니다(요청당 약 7 neurons는 조사 문서의 계산이며 실측 아님).

## 모델 선택 (기본값과 근거)
- 기본값: `@cf/meta/llama-3.2-3b-instruct` (`wrangler.toml`의 `AI_MODEL`).
- 확인된 것(2026-11-11, Cloudflare 모델 카탈로그 공식 문서): 이 모델은 「multilingual dialogue」용 소형 instruct 모델로 표기됨. 카탈로그에서 한국어를 명시한 모델은 없었음.
- 확인 못 한 것: 한국어 분류 정확도, JSON 준수율(카탈로그에 소형 모델의 JSON 모드 표기 없음 → 프롬프트 + Worker 검증으로 대응), 카탈로그 페이지에는 `@cf/` 접두어가 보이지 않아 ID 철자는 공식 문서의 관례를 따른 것(배포 시 오류가 나면 카탈로그에서 정확한 ID로 교체).
- 배포 후 `test/questions.md`의 30문항으로 비교할 후보: `@cf/meta/llama-3.2-3b-instruct`(기본), `@cf/qwen/qwen3-30b-a3b-fp8`(다국어 표기), `gemma-4-26b-a4b-it` 계열. Qwen3 계열이 `<think>` 블록을 앞세워도 파서가 제거합니다.

## 로컬 시험
`node --test worker/test/*.test.ts` (Node 24, 설치 불필요, 가짜 AI 객체 사용). 실제 모델 호출은 배포 후에만 가능합니다.
타입 확인: `node node_modules/typescript/bin/tsc -p worker/tsconfig.json`

## 아직 안 한 것·가정
- 앱 쪽 검색창, 키워드 폴백, `intent → TO.*` 변환표, 「참고용」 안내 표시는 앱 단계에서 합니다.
- `help` 의도의 이동 대상 화면은 아직 정해지지 않았습니다(TODO).
- 요청 JSON 필드 이름(`question`)과 응답 필드는 이 문서가 기준이며, 앱 구현 때 바꿀 수 있습니다.
