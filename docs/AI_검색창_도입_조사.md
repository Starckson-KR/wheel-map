# AI 검색창(비서) 도입 조사

조사일·가격 확인일 2026-11-11 · 조사·설계만, 코드 수정 없음 · 공개 페이지만 열람(가입·로그인·결제·키 발급 없음)
표기: 「확인 안 됨」은 공식 문서로 확인하지 못했다는 뜻이다. 앞선 조사는 `docs/국산LLM_활용_조사.md`.

## ① 한 줄 결론
- **LLM에게는 「질문 분류 + 빈칸 채우기」만 시키고, 답은 앱의 기존 화면으로 이동시키는 방식(D-1안)을 추천한다.** 소관 기관·법령·접수번호는 모델이 말하지 않고 앱 데이터만 보여 준다. 모델 호출이 실패하면 키워드 검색(D-3안)으로 바로 대체한다.
- 모델은 **Cloudflare Workers AI(같은 계정에서 무료 하루 10,000 neurons)**로 먼저 시험하고, 한국어가 아쉬우면 **Gemini Flash-Lite** 또는 **Claude Haiku 5.5**(발표 규모에서 수십~수백 원 수준)로 바꾸는 순서가 안전하다. 국산 모델(EXAONE·Kanana)은 지금 부를 수 있는 공개 API가 확인되지 않았다.
- 사용자가 기억한 미국 서비스는 **America.gov**(2026-09-29 공개)로 확인했다. 다만 첫 버전은 「검색」이고 「행정 처리」는 2027년부터라고 보도됐다.

## ② 참고 서비스 사실 확인
### 2-1. America.gov (미국 연방정부)
| 항목 | 확인 내용 |
|---|---|
| 있는가 | **있음.** 2026-09-29 공개. 이름은 사용자 기억(america.gov)이 맞다. |
| 운영 | 트럼프 행정부. 정부 첫 최고디자인책임자(Chief Design Officer) 조 게비아(Airbnb 공동창업자)가 주도. 행정명령으로 각 기관에 공공 서비스를 이 사이트와 연동하도록 지시. |
| 무엇을 하나 | 연방 웹사이트 2만 9천여 곳을 따로 뒤지지 않고 **자연어로 질문**해 정보·서비스를 찾는 「정문(front door)」. 지금은 질문에 답하는 검색 수준이고, 여권 갱신·메디케어 가입·야영장 예약 같은 **행정 처리는 2027년부터** 「답에서 행동으로」 확장한다고 발표. |
| 사용 모델 | 매체마다 다름. 더스타(말레이시아) 기사는 게비아가 CNBC에 「구글 Gemini와 SpaceXAI의 Grok의 도움으로 만들었다」고 말했다고 전함. 다른 지역 방송 기사는 모델을 특정하지 않음 → **모델명은 보도 간 불일치, 공식 확인 안 됨.** |
| 책임·개인정보 문구 | 확인한 두 기사에는 정확도·개인정보 안내 문구가 없음. **공식 사이트 자체는 열어 보지 못했다(확인 안 됨).** |
| 비판 | 완전한 원스톱 서비스는 의회 입법이 필요하다는 지적(보도). |
출처: https://news3lv.com/news/nation-world/america-gov-launches-as-president-donald-trumps-new-ai-shortcut-to-federal-services-government-agencies-chief-design-officer-joe-gebbia · https://www.thestar.com.my/tech/tech-news/2026/09/30/trump-launches-americagov-in-ai-push-for-federal-services
**배울 점**: ① 처음엔 「찾아 주기」만 하고 「대신 처리」는 나중에 — 우리도 안내·이동까지만. ② 책임 문구는 직접 넣어야 한다(참고 사례에서 확인되지 않음).

### 2-2. 국민비서 「구삐」(행정안전부)
- **하는 일**: 세금·건강검진·운전면허 적성검사·교통 범칙금 등 생활 행정정보를 **알려 주는(푸시) 서비스** + 챗봇 상담. 본인 인증 후 받을 항목을 직접 골라야 알림이 온다.
- **채널**: 네이버 앱·카카오톡·토스 등 민관 협력 17개 앱(전용 앱 없음, 사칭 앱 주의 안내). 수신 앱은 최대 2개. 2026-08 KB스타뱅킹 연동 협약 보도, 알림 항목 23종(보도 기준; 자료마다 수치가 달라 최신은 국민비서 누리집 확인).
- **자연어 질의**: 검색 결과 기준 「상담 서비스(챗봇)」가 있다는 것까지만 확인. 자연어 검색의 구체 방식은 확인 안 됨.
- **배울 점**: 사칭 방지 문구, 사용자가 항목을 직접 선택하는 방식, 알림은 개인 확인 뒤에만.
출처: https://www.korea.kr/news/reporterView.do?newsId=148973305 · https://www.bokjiro.go.kr/ssis-tbu/cms/pc/news/promotion/1302865_1118.html (검색 결과 요약 기준, 본문 전체는 읽지 않음)

### 2-3. 정부24 AI 검색 · 국민신문고
- **정부24 AI 검색(AI정부24, 정부24+ 등 명칭 혼재)**: 2026-03-09부터 시범. 일상어(예 「이사했어」)로 관련 민원·혜택 안내, 오타 보정, 결과 없으면 추천 질문 5개 제시. 보도에 따르면 시범 3개월(3.9~6.20) 누적 이용자 2,848만 명·질의 3,046만 건. **검증된 FAQ에 기반해 답하고 금지 질문은 차단**한다고 밝힘. 2027년 말 정부24·국민비서·혜택 알리미를 하나의 AI 창구로 통합 계획. 정책브리핑 기사(2026-07-03)에는 별도 유의·면책 문구가 보이지 않음.
- **국민신문고**: 정부24+에서 고충·건의 민원 등 50종을 직접 처리 가능하다는 보도, 국민신문고 자체 대화형 AI는 도입 예정이라는 기사. (검색 결과 요약 기준)
출처: https://www.korea.kr/policy/civilView.do?newsId=148967560 · 위 검색 결과(https://www.insight.co.kr/news/545765 등)
**배울 점**: 「검증된 FAQ 기반 + 금지 질문 차단」, 결과 없을 때 **추천 질문**, 일상어 → 절차 연결. 정부 서비스도 책임 문구를 눈에 띄게 달지는 않으므로 우리가 먼저 「참고용」을 분명히 쓰는 쪽이 차별점이 된다.

## ③ API 후보 비교 (확인일 2026-11-11)
공통: 키는 브라우저에 넣지 않고 Worker에서만 쓴다(`wrangler secret`). 따라서 「브라우저 직접 호출(CORS)」은 어느 후보도 쓰지 않으며, CORS는 **우리 Worker가 Pages 도메인만 허용**하면 된다(Workers AI는 같은 Worker에서 바인딩으로 호출).

| 후보 | 무료 한도·가격 | 한국어 근거 | 요청 한도 | 입력의 학습 사용(약관) | 키 | JSON(구조화) 출력 |
|---|---|---|---|---|---|---|
| **Cloudflare Workers AI** | 무료 하루 10,000 neurons(UTC 0시 초기화), 초과 시 Workers Paid에서 1,000 neurons당 $0.011. 예: qwen3-30b-a3b 입력 $0.051/출력 $0.335 (100만 토큰), llama-3.2-3b $0.051/$0.335, gemma-4-26b-a4b $0.10/$0.30. 대략 계산(800 입력+100 출력 토큰)이면 요청당 약 7 neurons → 하루 1,000건대 무료(내 계산, 실측 아님) | 목록에서 **한국어 명시 모델 없음.** qwen3-30b는 「multilingual」, llama-3.2 1B/3B는 「multilingual dialogue」 표기. 한국어 품질은 **직접 시험 필요** | 텍스트 생성 기본 분당 300건(일부 모델 20~50건), 계정·모델 단위 | 페이지에 언급 없음 → **확인 안 됨** | 별도 키 불필요(Worker 바인딩). 같은 Cloudflare 계정 | 카탈로그에 JSON 모드 명시 없음(glm-5.3·kimi 등만 structured outputs 표기). **프롬프트로 JSON을 요구하고 Worker에서 검증**하는 방식 권장 |
| **Google Gemini API** | Flash·Flash-Lite 계열 **무료 등급 입출력 무료**(페이지에 한도 수치 없음). 유료: 3.1 Flash-Lite $0.25/$1.50, 3.5 Flash-Lite $0.30/$2.50 (100만 토큰) | 한국어 지원 수치는 이번에 확인 안 됨(일반적으로 다국어 지원, 근거 못 찾음) | 한도는 프로젝트 단위, 수치는 AI Studio 계정 화면에서만 확인 가능 → **확인 안 됨** | **무료 등급: 입력을 제품 개선에 사용하고 사람이 읽을 수 있음. 「개인·민감 정보를 넣지 말라」 명시.** 유료 등급: 학습에 안 씀(로그는 단기 보관). **18세 미만 대상·접근 가능성이 높은 앱 사용 금지 조항** | API 키 필요(Google 계정) | 있음(공식 문서 구조화 출력은 이번에 열람 안 함 → 확인 안 됨) |
| **Anthropic Claude Haiku 5.5** | 무료 등급 확인 안 됨(결제 필요로 보임). 100만 토큰당 입력 $0.10 / 출력 $0.50(프롬프트 10만 토큰 이하). 1,000건(800+100 토큰) ≈ $0.13 | 한국어 수치 근거는 이번에 확인 안 됨 | 확인 안 됨 | 이번에 약관 확인 안 됨 | 키 필요, 결제수단 등록 | 도구 호출(tool use)로 JSON 가능(이번에 문서 확인 안 함) |
| Groq | 무료 한도는 페이지에서 추출 안 됨(계정 화면에만) → **확인 안 됨**. 개발자 플랜 기준 gpt-oss-20b 분당 30건·일 1,000건 | 한국어 언급 없음 | 위와 같음 | 확인 안 됨 | 키 필요 | **json_schema 엄격 모드**: gpt-oss-20b/120b, qwen3.8-27b. JSON 객체 모드는 전 모델 |
| OpenRouter 무료 모델(`:free`) | 분당 20건, 일 50건(누적 충전 $10 미만) / 일 1,000건($10 이상) | 모델별로 다름, 확인 안 됨 | 위와 같음 | 페이지에 언급 없음 → 확인 안 됨 | 키 필요 | 모델별, 확인 안 됨 |
| Hugging Face Inference Providers | 무료 사용자 월 크레딧 **없음**(구매 필요), PRO 월 $2 크레딧 | EXAONE·Kanana는 배포 Provider 없음(앞선 조사) | 확인 안 됨 | 제공사별, 확인 안 됨 | HF 토큰 | 모델·제공사별 |
| Upstage Solar | Solar Mini 4 $0.10/$0.40, Solar Pro 4 $0.30/$1.20 (100만 토큰). 일반 API 무료 등급 확인 안 됨(Studio 에이전트 10회 무료, 학교 대상 최대 1년 무료 접근 안내) | 한국어 회사(Upstage)이나 페이지에 한국어 성능 수치 없음 | 기본 Tier 1은 월 선결제 $100+ 기준 초당 30건 → **소액 시험에는 부적합해 보임** | 페이지에 언급 없음 → 확인 안 됨 | 키 필요 | 확인 안 됨 |
| 네이버 CLOVA Studio(HyperCLOVA X) | 토큰 단가는 공식 요금 페이지에서 비어 있음 → **확인 안 됨**. 신규 무료 크레딧도 확인 안 됨(네이버클라우드 신규 가입 크레딧 10만 원은 Aside로 확인, 아래 ⑦) | 한국 회사 모델(HCX-005·DASH-002 경량). 성능 수치 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 네이버클라우드 가입·키 | 확인 안 됨 |
| 카카오 Kanana(-o) | **일반 공개 API 확인 안 됨.** 비공개 베타(2026-02-27~05-27) 종료, 현재 접속 페이지 없음 | Kanana-2-30B KMMLU 67.32 등(앞선 조사, 모델 카드) | - | - | - | - |
| FriendliAI(EXAONE) | 현재 서버리스 가격표에 **EXAONE 없음**(GLM-5.x, gemma-4 등만). 전용 GPU A100 시간당 $4.0부터 | - | - | 확인 안 됨 | 키 필요 | - |

출처: https://developers.cloudflare.com/workers-ai/platform/pricing/ · https://developers.cloudflare.com/workers-ai/platform/limits/ · https://developers.cloudflare.com/workers-ai/models/ · https://aistudio.google.com/docs/pricing · https://aistudio.google.com/docs/terms · https://aistudio.google.com/docs/rate-limits · https://platform.claude.com/docs/en/about-claude/pricing · https://console.groq.com/docs/rate-limits · https://console.groq.com/docs/structured-outputs · https://openrouter.ai/docs/api-reference/limits · https://huggingface.co/docs/inference-providers/pricing · https://www.upstage.ai/pricing · https://www.ncloud.com/product/aiService/clovaStudio · https://friendli.ai/pricing (Aside)

### 우리 용도 상위 3개
1. **Cloudflare Workers AI** — 같은 Worker·같은 계정이라 키·CORS·결제 설정이 가장 적고, 하루 10,000 neurons 무료 안에서 시연·시범이 충분해 보임. 입력이 외부 회사(구글 등)로 나가지 않는다. **단점: 한국어 품질과 JSON 안정성은 모르므로 내일 가입 직후 20~30개 질문으로 시험**해야 한다(`qwen3-30b-a3b-fp8`, `gemma-4-26b-a4b-it`, `llama-3.2-3b` 비교).
2. **Google Gemini Flash-Lite** — 무료로 시작 가능하고 구조화 출력 지원이 일반적으로 알려진 쪽. **단, 무료 등급은 입력이 학습·사람 검토에 쓰이고 개인정보 금지, 18세 미만 대상 앱 금지**라 질문에 위치·이름을 보내지 않는 설계가 필수다. 한도가 필요하면 유료 등급($0.25/$1.50)으로 올리면 학습에 쓰이지 않는다.
3. **Claude Haiku 5.5** — 무료는 아니지만 100만 토큰당 $0.10/$0.50이라 시연 규모 비용이 사실상 몇십~몇백 원이고 한국어·JSON 지시 준수가 안정적일 것으로 기대(내 판단, 이번 조사에서 한국어 수치는 못 확인). 무료 모델 품질이 부족할 때의 「소액 대안」.
국산(Solar·HyperCLOVA X)은 가격·한도 수치를 공식 페이지에서 못 구했고(Solar는 소액 시험에 불리한 선결제 구조) 상위에서 제외했다. 가격 확인되면 재검토.

## ④ 앱 설계 비교와 추천
현재 구조: `HomePage.tsx` 166행 `hp-search` 버튼(「어디로 가세요? 휠체어 길찾기」)이 `go(TO.route)`로 이동한다(입력창이 아니라 버튼). `src/lib/nav.ts`에 이미 쓸 수 있는 도착지가 있다: `TO.route(#/map?go=route)`, `TO.bus(…&mode=bus)`, `TO.progress(#/map?go=progress)`, `TO.newReport(#/map?go=report)`, `TO.report`, `TO.agency(#/report?section=agency)`, `TO.me`, `TO.alerts`, `TO.openReport(id)`. 「접수번호 찾기」가 어느 화면에 있는지는 이번에 코드를 더 읽지 않아 **TODO(확인 필요)**.

| | D-1 의도 분류 + 빈칸 채우기 | D-2 우리 데이터 검색 + 요약 | D-3 LLM 없는 키워드·유사어 |
|---|---|---|---|
| 동작 | 모델이 `{intent, 유형, 장소어}` JSON만 반환 → 앱이 허용 목록의 해시 주소로 이동 | agencies.json·처리기한·FAQ에서 후보를 코드로 찾고, 모델은 후보를 쉬운 말로 요약 | 유사어 사전(「턱」「계단」「경사로」「엘리베이터 고장」 등)으로 intent 점수 계산 |
| 환각 위험 | **낮음** — 모델 출력이 열거형·허용 목록으로 제한되고 모델이 사실을 말하지 않음 | 중간 — 요약에 지어낸 말이 섞일 수 있음. 근거 항목을 같이 표시해 완화 | 없음(틀릴 수는 있으나 지어내지 않음) |
| 발표 시연 | 인터넷·Worker 필요, 실패 시 D-3 | 가장 불안정(모델 지연 + 데이터 결합) | **가장 안정**(오프라인 가능) |
| 비용 | Workers AI 무료 범위(요청당 약 7 neurons, 내 계산) | 입력이 길어져 몇 배 | 0원 |
| 구현 | 낮음~중간 | 중간~높음 | 낮음 |

### 추천: D-1을 주 경로, D-3을 대비책으로 같이 구현 (D-2는 발표 뒤)
구성(브라우저 → Worker → 모델):
1. 홈 검색 버튼을 입력창으로 바꾸고, 입력 문장만 `POST https://<worker>.workers.dev/intent`로 보낸다. **위치·좌표·사진·기기 식별자·제보 내용은 보내지 않는다**(문장도 이름·전화번호 패턴이 있으면 보내기 전에 지우고 안내).
2. Worker: ① `Origin`이 Pages 도메인(+로컬 개발 주소)일 때만 CORS 허용 ② 입력 200자 제한 ③ IP·세션당 분당 N회와 하루 총량 상한(남용·비용 방지, Workers 무료 하루 10만 요청 안에서 별도 상한) ④ 로그에 본문 기록 안 함(상태 코드·시간만).
3. 시스템 프롬프트 가드레일: 「너는 분류기다. 허용된 intent 목록 중 하나와 slots만 JSON으로 답한다. 기관명·법령·접수번호·전화번호·기한을 말하지 않는다. 모르면 `unknown`」. Worker가 JSON을 파싱해 **intent가 허용 목록에 없으면 버린다.**
4. 앱: `intent → 해시 주소` 변환표는 앱 코드에 고정(모델이 URL을 만들지 못하게). 이동 전에 「이 화면으로 안내할까요?」 확인 한 줄과 「AI 안내는 참고용입니다. 소관 기관과 처리기한은 해당 화면의 안내를 확인하세요」를 표시. 소관 기관 안내는 기존 `agency` 화면의 데이터만 사용.
5. 실패(타임아웃 3초, 429, 오프라인, JSON 오류) → 자동으로 D-3 키워드 검색 결과를 같은 화면에 표시하고 「AI 연결이 안 돼 키워드로 찾았어요」 표시. 결과가 없으면 추천 질문 5개 제시(정부24 방식).
6. 앱인토스를 나중에 하면 생성형 AI 고지·AI 표시(라벨)·AI 채팅 안전 요건이 적용됨(⑦). 처음부터 「AI 사용 고지」 문구와 라벨을 넣어 두면 재작업이 줄어든다.

예상 비용: Workers AI 무료 범위 안(시연·시범). 발표 규모에서 Gemini 유료나 Haiku로 바꿔도 1,000건에 약 $0.1~0.3 수준(내 계산). Workers Paid($5/월)는 필요 없음.

## ⑤ 내일 체크리스트 (Cloudflare Workers 무료 가입)
**사용자가 직접 할 일**
1. Cloudflare 계정 가입(무료) — 이메일·비밀번호는 직접 입력, 채팅에 붙이지 않기.
2. 터미널에서 `npx wrangler login` 실행해 브라우저 승인(로그인 정보는 승인 화면에서만).
3. Workers AI 사용 확인: 대시보드 → AI → Workers AI에서 무료 할당(하루 10,000 neurons)이 보이는지 확인(결제수단 등록이 요구되는지 보고 알려 주기).
4. (Gemini/Haiku로 바꿀 때만) 해당 사이트에서 키 발급 후 **채팅에 붙이지 말고** 터미널에서 `npx wrangler secret put GEMINI_API_KEY`(또는 `ANTHROPIC_API_KEY`)를 실행해 프롬프트에 직접 붙여넣기. 키는 코드·`.env`·저장소에 쓰지 않는다. Workers AI만 쓰면 키가 필요 없다.
5. 배포 후 나온 `https://<이름>.<계정>.workers.dev` 주소만 우리에게 알려 주기(주소는 비밀 아님).

**그 뒤 우리가 할 일**
1. Worker 코드 작성(`/intent`): CORS(Pages 도메인만), 입력 제한, 속도 제한, JSON 검증, 허용 intent 목록. `wrangler.toml`에 AI 바인딩만 추가.
2. 한국어 시험 질문 30개(예: 「경사로가 막혔어요」「내가 접수한 번호 찾고 싶어요」「가까운 저상버스」)로 모델 3종 비교해 선택.
3. 홈 검색창 + D-3 키워드 폴백 + 안내 문구 구현, 실패 때 폴백 동작 확인(오프라인 리허설).
4. 주소를 `.env`의 `VITE_AI_INTENT_URL` 같은 값으로 연결(공개 주소라 저장소에는 넣지 않아도 되고 Pages 빌드 변수로 둘 수 있음 — 방식은 단계에서 결정).
5. 저상버스 중계(`VITE_BUS_RELAY_URL`)와 한 Worker로 합칠지 결정.

## ⑥ 사용자에게 확인할 것
1. 시연에서 AI 검색을 **실제로 입력받아 보여 줄지**, 아니면 예시 질문 몇 개만 버튼으로 둘지(후자면 D-3만으로도 가능).
2. 질문 문장이 외부 회사(구글 등)로 나가도 되는가. 허용 안 하면 Workers AI(Cloudflare 안)만 쓴다.
3. 무료로 품질이 안 나올 때 월 얼마까지 낼 수 있는가(Haiku 쓰면 시연 규모는 월 1천 원 미만으로 추정, 카드 등록 필요).
4. 앱인토스 출시를 정말 할 것인가(하면 AI 고지·라벨·AI 채팅 안전 요건이 생김).
5. 「접수번호 찾기」가 앱 안에서 이동할 화면(TODO).

## ⑦ 부록 A: 앞선 조사의 「확인 안 됨」 재확인 결과 (Aside, 읽기 전용)
| 항목 | 결과 |
|---|---|
| Oracle Cloud Free 카드 | **필요.** 신용/체크카드 등록, 일시 승인 보류(3~5일 내 해제, 실제 청구 없음). PIN 체크카드·가상·일회용·선불카드는 불가. 무료 체험 $300/30일, Always Free는 기간 제한 없음. 한국 체크카드 통과 여부는 확인 안 됨. https://www.oracle.com/cloud/free/faq/ |
| 국내 클라우드 크레딧 | 네이버클라우드: 신규 10만 원(3개월), 학생(Green Rookie) 20만 원(제휴 학교 이메일, 1년), 스타트업 최대 1억 원(제휴 AC/VC). 카카오클라우드: 신규 30만 원(가입 3개월 내 신청), 스타트업 로켓런처 500만/2,000만/3,500만 원. NHN Cloud: 스타트업 1,000만 원~(법인), 신규 20만 원(2023~24 공식 글 기준). 카카오·NHN 학생 전용은 못 찾음. 결제수단 등록 필요. https://www.ncloud.com/main/creditEvent · https://kakaocloud.com/business/support/new · https://info.nhncloud.com/promotion/startup |
| 앱인토스 | HTTPS 필수(라이브에서 HTTP 차단, `wss://`만), CSR/SSG만(SSR 불가). 외부 서버는 CORS에 미니앱 Origin(`https://<appName>.apps.tossmini.com` 등) 등록 필요. 자사 도메인 WebView/iframe 금지, `eval` 금지. **생성형 AI: 첫 사용 시 고지, AI 결과물 라벨 표시 의무, 위반 시 최대 3,000만 원 과태료.** AI 채팅·상담은 위험 키워드 필터·안전 응답·모델/프롬프트 변경 전 배포 검토 요청 등 추가 요건. 외부 AI API 호출 허용 여부를 직접 다룬 조항과 외부 API 도메인 화이트리스트는 **Aside로도 확인 안 됨.** https://developers-apps-in-toss.toss.im/guide/faq.md · /checklist/app-nongame.md |
| Kanana-o API | **일반 공개 API 근거 없음.** 비공개 베타(2026-02-27~05-27, 무료·일일 한도, 대기 등록 후 선정)만 있었고 종료. omni.kanana.ai는 현재 「페이지를 찾을 수 없음」. 2026-10 발표는 오픈소스 공개 계획만(시점·라이선스 미정). 가격·한도 수치 없음. https://tech.kakao.com/posts/811 |
| FriendliAI EXAONE | 현재 서버리스 가격표에 EXAONE 없음(GLM-5.x·gemma-4만). 변경 이력상 EXAONE-4.0.1-32B·K-EXAONE 2종은 서버리스에서 내려감(10-29 갱신). 옛 스니펫 값 K-EXAONE-236B 입력 $0.2/출력 $0.8은 현재 표에 없음. 신규 무료 크레딧 금액은 **Aside로도 확인 안 됨**(Trial 크레딧 안내와 최소 $10 충전 안내가 겹침). https://friendli.ai/pricing · https://friendli.ai/docs/changelog |
Aside가 본 앱인토스 문서 하단에 「AI 에이전트에게 질문을 보내라」는 문구가 있었으나 조사와 무관해 따르지 않았다.

## 출처 요약
위 각 절의 URL. 내부: `src/pages/HomePage.tsx`(166행), `src/lib/nav.ts`, `docs/국산LLM_활용_조사.md`.
