// 규칙 기반 보정(모델 호출 전·후). 순수 함수만 둔다. 의도 id는 문자열로만 다뤄 intents.ts와 순환 참조하지 않는다.

// ---------- 유형 목록 ----------
// 앱의 목록을 그대로 복사한 것이다. 앱이 바뀌면 같이 고친다.
//  - REPORT_TYPES: src/lib/reportTypes.ts (제보 장애요소 유형 12개)
//  - LOCATION_KINDS: src/lib/agencyGuide.ts (위치 성격 8개)
export const REPORT_TYPE_NAMES = [
  '계단·턱',
  '좁은 보도',
  '급경사',
  '파손 노면',
  '경사로 없음',
  '수동문',
  '장애인화장실 없음',
  '쓰레기',
  '킥보드·자전거',
  '입간판·노점',
  '공사 자재',
  '불법 주정차',
] as const
export const LOCATION_KIND_NAMES = [
  '구·시 도로의 보도',
  '버스정류장',
  '횡단보도·신호',
  '공공건물 출입',
  '민간 건물 출입',
  '대학 캠퍼스 내부',
  '공원',
  '공사 현장',
] as const
export const TYPE_VALUES: readonly string[] = [...REPORT_TYPE_NAMES, ...LOCATION_KIND_NAMES]

// 모델이 쓰기 쉬운 말 → 앱 목록의 값. 위에서부터 먼저 맞는 것을 쓴다.
const TYPE_ALIASES: [RegExp, string][] = [
  [/급경사|가파/, '급경사'],
  [/경사로/, '경사로 없음'],
  [/좁/, '좁은 보도'],
  [/구멍|패[임인였]|파[임인손]|포트홀|깨[진짐졌]|울퉁|파손/, '파손 노면'],
  [/계단|턱|단차/, '계단·턱'],
  [/수동\s*문|자동\s*문/, '수동문'],
  [/화장실/, '장애인화장실 없음'],
  [/쓰레기|적치물/, '쓰레기'],
  [/킥보드|자전거/, '킥보드·자전거'],
  [/입간판|노점|좌판/, '입간판·노점'],
  [/공사\s*자재|공사\s*장비/, '공사 자재'],
  [/주정차|불법\s*주차|주차/, '불법 주정차'],
  [/횡단보도|신호/, '횡단보도·신호'],
  [/정류장/, '버스정류장'],
]

// 값(또는 문장)에서 앱 유형 목록의 값을 찾는다. 없으면 null.
export function normalizeType(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  const exact = TYPE_VALUES.find((t) => t === s)
  if (exact) return exact
  for (const [re, t] of TYPE_ALIASES) if (re.test(s)) return t
  return null
}

// ---------- 질문 판정 ----------
const compact = (s: string) => s.replace(/\s+/g, '')

// 질문에 그 구절이 실제로 있는가(공백 무시)
export function inQuestion(question: string, phrase: string): boolean {
  const p = compact(phrase)
  return p.length > 0 && compact(question).includes(p)
}

// 자음·모음만 있거나 한글 음절이 2개 미만이면 뜻 없는 입력으로 본다(모델에 보내지 않는다).
export function isNonsense(question: string): boolean {
  return (question.match(/[가-힣]/g) ?? []).length < 2
}

const INJECTION_RE =
  /이전\s*(지시|명령|지침|대화)|위\s*(지시|명령)|지시\s*(를|사항을?)?\s*(모두\s*|전부\s*)?(무시|잊)|명령\s*(을|를)?\s*무시|시스템\s*프롬프트|프롬프트|ignore|previous\s+instruction|system\s*prompt|jailbreak|탈옥|너의?\s*(규칙|설정|지침)|내부\s*(지침|설정|규칙)/i
export function isInjection(question: string): boolean {
  return INJECTION_RE.test(question)
}

// 앱이 답하지 않는 정보(처리기한·법령·전화번호)를 묻는 말. 마스킹 표시 "[전화]"는 해당하지 않는다.
const UNSUPPORTED_RE = /기한|며칠|언제까지|법령|조문|법\s*조항|전화\s*번호|연락처|담당자\s*번호/
export function asksUnsupported(question: string): boolean {
  return UNSUPPORTED_RE.test(question)
}
// 이 의도들은 질문 속 「기한」 같은 말이 곁가지일 수 있어(예: 며칠 전에 낸 접수번호) 보정하지 않는다.
const UNSUPPORTED_EXEMPT = new Set(['report_new', 'route', 'bus', 'receipt_lookup'])

const HELP_RE = /어떻게\s*(써|쓰|사용|이용)|사용\s*법|사용\s*방법|이용\s*방법|쓰는\s*법|쓰는\s*방법|도움말|처음|뭐\s*할\s*수|뭘\s*할\s*수|무엇을\s*할\s*수/
export function hasHelpCue(question: string): boolean {
  return HELP_RE.test(question)
}

type Like = { intent: string; slots: Record<string, string>; confidence: number }

// 모델 답 뒤에 적용하는 안전 보정. 의도만 unknown으로 낮추고, 다른 값을 새로 만들지 않는다.
export function applyRules<T extends Like>(question: string, r: T): T {
  const toUnknown = (): T => ({ ...r, intent: 'unknown', slots: {} })
  if (isInjection(question)) return r.intent === 'unknown' ? r : toUnknown()
  if (r.intent === 'unknown') return r
  if (!UNSUPPORTED_EXEMPT.has(r.intent) && asksUnsupported(question)) return toUnknown()
  if (r.intent === 'help' && !hasHelpCue(question)) return toUnknown()
  return r
}
