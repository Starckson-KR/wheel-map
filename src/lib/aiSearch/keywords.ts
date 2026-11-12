import type { AiIntent, MovableIntent, Slots } from './intents'
import { verifySlots } from './validate'

// 키워드 폴백: 네트워크 없이 의도를 고른다. 의도별 낱말(정규식)에 점수를 주고 가장 높은 의도를 쓴다.
// AI가 켜져 있어도 앱이 답하지 않는 질문(지시 변경·내부 탐색·처리기한·법령·전화번호)은 여기서 먼저 걸러 unknown으로 둔다.

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')

type Rule = [RegExp, number]

// 점수 규칙은 공백을 지운 글에 적용한다(「몇 등」→「몇등」).
const RULES: Record<MovableIntent, Rule[]> = {
  report_new: [
    [/신고하|신고할|신고해|제보하|제보할|제보해|신고드|민원넣|민원을?넣|알리고싶|알려주고싶/, 3],
    [/신고|제보/, 1],
    [/막혔|막혀|막힘|막고|막아|가로막/, 3],
    [/계단|턱|단차|경사로|급경사|가파/, 3],
    [/구멍|파손|깨져|깨진|깨졌|덜컹|울퉁|패였|패인|포트홀|보도블록|흔들/, 3],
    [/좁아|좁은|좁다/, 3],
    [/고장|엘리베이터|엘베|수동문|자동문|화장실/, 3],
    [/쓰레기|킥보드|자전거|입간판|노점|공사|불법주|주차/, 3],
    [/점자블록|점자블럭|끊겨|끊어/, 3],
    [/못들어|못지나|못가|못올라|못내려|통과가?어렵|지나가기어렵|위험해|위험하/, 2],
    [/횡단보도|신호/, 2],
    [/짧아|짧은|부족해/, 1],
  ],
  receipt_lookup: [
    [/접수.{0,4}번호|번호.{0,4}접수/, 4],
    [/번호.{0,3}(찾|조회|잃|까먹|모르|확인)|(잃어|잊어|까먹).{0,4}번호/, 3],
    [/번호/, 3],
    [/접수증|민원번호|신청번호/, 3],
  ],
  my_reports: [
    [/내가?(올린|낸|한|넣은|접수한|보낸|남긴)(신고|민원|제보)?/, 3],
    [/내(신고|민원|제보)/, 3],
    [/(신고|민원|제보)(한|했던|한거|한것).{0,6}(상황|결과|처리|어디|진행)/, 3],
    [/처리(상황|결과|됐|돼|중|현황)|진행(상황|중|현황)|어디까지/, 3],
    [/민원진행|신고결과|민원결과|조치결과|결과가?나왔/, 3],
  ],
  route: [
    [/길찾기|길안내|경로|우회/, 4],
    [/가는길|가는법|가는방법|오는길|가는방향/, 3],
    [/어떻게(가|갈|가요|가나)|가려면|가고싶|갈수있는길|찾아가|어디로가/, 3],
    [/.{2,}에서.{2,}(까지|가는|가려|갈|로가)/, 3],
    [/까지/, 1],
    [/출발|목적지|도착지/, 2],
  ],
  bus: [
    [/저상/, 3],
    [/버스/, 2],
    [/정류장|정거장/, 1],
    [/언제와|언제오|도착시간|몇분|몇번/, 2],
    [/휠체어(탈|탑승).{0,6}버스|버스.{0,6}휠체어/, 2],
    [/도착/, 1],
  ],
  progress: [
    [/개선/, 3],
    [/고쳐|고친|나아졌|좋아졌|수리됐|수리된|해결된|조치된|조치완료|정비/, 3],
    [/얼마나(고|개선|좋|나아|해결|조치)/, 2],
    [/현황|진행률|통계|성과/, 2],
    [/동네|우리구|우리동/, 1],
  ],
  my_score: [
    [/칭호|등수|몇등|\d등|1등|순위|랭킹|등급|엠블럼|배지|뱃지|리워드/, 3],
    [/점수|포인트|기여|참여도|참여점수|적립/, 3],
    [/내(점수|포인트|순위|등급|기여)/, 1],
  ],
  agency: [
    [/기관|소관|담당|관할|부서|어느과|어디서처리|어디가처리/, 3],
    [/어디에(말|연락|문의|알려)|누구에게(말|연락|문의)/, 2],
    [/구청|시청|도로과|교통과|복지과/, 1],
  ],
  alerts: [[/알림|알람|새소식|혜택|공지|소식/, 3]],
  help: [
    [/어떻게(써|쓰|사용|이용|하나요|해요)|사용법|사용방법|이용방법|쓰는법|쓰는방법|도움말|이용안내|처음|뭐할수|뭘할수|무엇을할수|설명/, 3],
    [/이앱|이서비스|앱사용/, 1],
  ],
}

// 먼저 걸러 내는 질문(앱이 답하지 않는다). 점수와 상관없이 unknown.
const INJECTION_RE =
  /이전(지시|명령|지침|대화)|위(지시|명령)|지시(를|사항을?)?(모두|전부)?(무시|잊|바꿔|변경)|명령(을|를)?무시|시스템프롬프트|프롬프트|ignore|previousinstruction|systemprompt|jailbreak|탈옥|너의?(규칙|설정|지침)|내부(지침|설정|규칙|정보|구조|코드|주소)|관리자|어드민|admin|개발자모드|모드로?전환|모드로?바꿔|권한/
const PRIVACY_RE = /다른(사람|사용자|유저|이용자)|남의|타인|개인정보를?(알려|보여|보내)|전체(사용자|회원|명단)/
// 처리기한·법령·전화번호처럼 앱이 근거 없이 답할 수 없는 질문
const UNSUPPORTED_RE = /기한|며칠|몇일|언제까지|법령|법률|법적|조문|법조항|과태료|벌금|규정에따라|의무/
// 전화번호·연락처를 묻는 말은 어떤 의도라도 답하지 않는다(가려 놓은 [전화] 표시는 해당하지 않는다).
const PHONE_ASK_RE = /전화번호|연락처|담당자번호|핸드폰번호|휴대폰번호/
// 이 의도들은 질문 속 「기한」 같은 말이 곁가지일 수 있어 보정하지 않는다(worker/src/rules.ts와 같은 기준).
const UNSUPPORTED_EXEMPT: ReadonlySet<AiIntent> = new Set<AiIntent>(['report_new', 'route', 'bus', 'receipt_lookup'])

export function isNonsense(question: string): boolean {
  return (question.match(/[가-힣]/g) ?? []).length < 1
}

// AI 호출 전에 막을 질문(지시 변경·내부 탐색·남의 정보·뜻 없는 입력)
export function isBlockedQuestion(question: string): boolean {
  const s = squash(question)
  return isNonsense(question) || INJECTION_RE.test(s) || PRIVACY_RE.test(s) || PHONE_ASK_RE.test(s)
}

export function asksUnsupported(question: string): boolean {
  const s = squash(question)
  return UNSUPPORTED_RE.test(s) || PHONE_ASK_RE.test(s)
}

// AI든 키워드든 결과 의도에 같은 안전 규칙을 적용한다: 막을 질문이면 unknown, 미지원 정보를 묻는 말이면 일부 의도 외에는 unknown.
export function guardIntent(question: string, intent: AiIntent): AiIntent {
  if (intent === 'unknown') return intent
  if (isBlockedQuestion(question)) return 'unknown'
  if (!UNSUPPORTED_EXEMPT.has(intent) && asksUnsupported(question)) return 'unknown'
  return intent
}

export type KeywordResult = { intent: AiIntent; score: number; ranked: { intent: MovableIntent; score: number }[] }

const ORDER: MovableIntent[] = ['report_new', 'receipt_lookup', 'my_reports', 'my_score', 'route', 'bus', 'progress', 'agency', 'alerts', 'help']
const MIN_SCORE = 3

export function scoreIntents(question: string): { intent: MovableIntent; score: number }[] {
  const s = squash(question)
  return ORDER.map((intent) => ({ intent, score: RULES[intent].reduce((n, [re, w]) => n + (re.test(s) ? w : 0), 0) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
}

// 앱 안에서 쓰는 후보 목록(모름·실패 때 보여 준다). 점수가 있는 순서대로, 없으면 흔한 세 가지.
export const DEFAULT_CANDIDATES: MovableIntent[] = ['report_new', 'route', 'my_reports']

export function keywordIntent(question: string): KeywordResult {
  const ranked = scoreIntents(question)
  const top = ranked[0]
  let intent: AiIntent = top && top.score >= MIN_SCORE ? top.intent : 'unknown'
  // 신고하기와 길찾기·버스가 같은 점수면 문제 신고를 우선한다(ORDER 순서). help는 도움말 단서가 있어야만 통과한다.
  intent = guardIntent(question, intent)
  return { intent, score: top?.score ?? 0, ranked }
}

export function candidatesFor(question: string, n = 3): MovableIntent[] {
  if (isBlockedQuestion(question)) return DEFAULT_CANDIDATES.slice(0, n)
  const ranked = scoreIntents(question).map((r) => r.intent)
  for (const d of DEFAULT_CANDIDATES) if (!ranked.includes(d)) ranked.push(d)
  return ranked.slice(0, n)
}

// 키워드 폴백의 빈칸 뽑기: AI가 없어도 신고 유형·출발/도착을 같은 규칙(verifySlots)으로 검증해 넘긴다.
// 유형은 앞에 있는 것이 우선(「경사로」는 「경사」보다 먼저). 뒷받침 낱말이 없으면 검증에서 버려진다.
const TYPE_ORDER: [string, RegExp][] = [
  ['경사로 없음', /경사로/],
  ['계단·턱', /계단|턱|단차/],
  ['급경사', /급경사|가파|경사/],
  ['파손 노면', /구멍|패였|패인|파손|파인|깨져|깨진|깨졌|포트홀|울퉁|덜컹|보도블록|노면/],
  ['좁은 보도', /좁/],
  ['수동문', /문/],
  ['장애인화장실 없음', /화장실/],
  ['쓰레기', /쓰레기|적치/],
  ['킥보드·자전거', /킥보드|자전거/],
  ['입간판·노점', /입간판|노점|좌판/],
  ['공사 자재', /공사|자재/],
  ['불법 주정차', /주정차|주차/],
]
const ROUTE_RE = /([가-힣0-9 ]{2,30}?)에서\s*([가-힣0-9 ]{2,30}?)\s*(?:까지|으로|로\s|가는|가려|갈|오는)/
const lastWords = (s: string, n: number) => s.trim().split(/\s+/).slice(-n).join(' ')

export function keywordSlots(question: string, intent: AiIntent): Slots {
  if (intent === 'report_new') {
    const t = TYPE_ORDER.find(([, re]) => re.test(question))?.[0]
    return t ? verifySlots(intent, { type: t }, question) : {}
  }
  if (intent === 'route') {
    const m = ROUTE_RE.exec(question)
    return m ? verifySlots(intent, { from: lastWords(m[1], 2), to: lastWords(m[2], 2) }, question) : {}
  }
  return {}
}
