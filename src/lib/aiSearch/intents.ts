import { TO } from '../nav'
import { placeFromQuery, typeFromQuery, withQuery } from './handoff'

// AI 검색창의 의도 목록과 이동 대상. 모델은 이 목록의 id만 고를 수 있고, 주소와 안내 문구는 모두 여기(앱)에 고정돼 있다.
export const AI_INTENTS = ['report_new', 'receipt_lookup', 'my_reports', 'route', 'bus', 'progress', 'my_score', 'agency', 'alerts', 'help', 'unknown'] as const
export type AiIntent = (typeof AI_INTENTS)[number]
export type MovableIntent = Exclude<AiIntent, 'unknown'>
export type SlotKey = 'type' | 'place' | 'from' | 'to'
export type Slots = Partial<Record<SlotKey, string>>

export const isIntent = (v: unknown): v is AiIntent => typeof v === 'string' && (AI_INTENTS as readonly string[]).includes(v)

// 의도별로 받아도 되는 빈칸 이름(worker/src/intents.ts의 INTENTS와 같다)
export const SLOT_KEYS: Record<AiIntent, readonly SlotKey[]> = {
  report_new: ['type', 'place'],
  receipt_lookup: [],
  my_reports: [],
  route: ['from', 'to'],
  bus: ['place'],
  progress: [],
  my_score: [],
  agency: [],
  alerts: [],
  help: [],
  unknown: [],
}

// 화면에 보이는 고정 문구(해요체). 모델이 만든 문장은 화면에 쓰지 않는다.
export const INTENT_LABEL: Record<MovableIntent, string> = {
  report_new: '문제 신고하기',
  receipt_lookup: '접수번호로 민원 찾기',
  my_reports: '내 민원 진행 상황',
  route: '휠체어 길찾기',
  bus: '저상버스 도착',
  progress: '개선 현황',
  my_score: '내 참여 점수',
  agency: '담당 기관 안내',
  alerts: '혜택알림',
  help: '이용 안내',
}

// 이동 주소. report_new는 검증된 유형(type), route는 검증된 출발·도착(from·to)을 쿼리로 더한다(buildHash).
// help는 주소 이동이 아니라 홈의 「이용 안내 확인하기」를 여는 동작이라 hash가 없다.
const HASH: Record<MovableIntent, string | null> = {
  report_new: TO.newReport,
  receipt_lookup: '#/report?section=receipt',
  my_reports: '#/report?section=mine',
  route: TO.route,
  bus: TO.bus,
  progress: TO.progress,
  my_score: TO.me,
  agency: TO.agency,
  alerts: TO.alerts,
  help: null,
}

const RANK_RE = /등수|몇\s*등|\d\s*등|순위|랭킹|위예요|위에요/

export type Target = { intent: MovableIntent; label: string; hash: string | null; note?: string }

// 이동 주소에 검증된 빈칸을 쿼리로 더한다. 허용 밖 값은 버리므로 쿼리가 없으면 기본 주소 그대로다.
export function buildHash(intent: MovableIntent, slots: Slots = {}): string | null {
  const base = HASH[intent]
  if (base === null) return null
  if (intent === 'report_new') return withQuery(base, { type: typeFromQuery(slots.type) ?? undefined })
  if (intent === 'route') {
    const from = placeFromQuery(slots.from) ?? undefined
    const to = placeFromQuery(slots.to) ?? undefined
    return from && to && from === to ? base : withQuery(base, { from, to })
  }
  return base
}

// 받침에 맞춰 '로/으로'를 붙인다(받침 없음·ㄹ받침은 '로'). 한글이 아니면 '로'.
export function withRo(word: string): string {
  const c = word.charCodeAt(word.length - 1)
  if (c < 0xac00 || c > 0xd7a3) return `${word}로`
  const jong = (c - 0xac00) % 28
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`
}

// 결과 카드에 보이는 고정 문구(모델이 만든 문장은 쓰지 않는다)
export function noteFor(intent: MovableIntent, slots: Slots = {}): string | undefined {
  const h = buildHash(intent, slots)
  if (h === null) return undefined
  if (intent === 'report_new') {
    const t = typeFromQuery(slots.type)
    return t ? `${t} 유형으로 신고 화면을 열어요` : undefined
  }
  if (intent === 'route') {
    const from = placeFromQuery(slots.from)
    const to = placeFromQuery(slots.to)
    if (from && to && from !== to) return `출발 ${from} · 도착 ${withRo(to)} 길찾기를 열어요`
    if (from && to) return undefined
    if (from) return `출발 ${withRo(from)} 길찾기를 열어요`
    if (to) return `도착 ${withRo(to)} 길찾기를 열어요`
  }
  return undefined
}

// 점수 중에서도 순위·등수를 묻는 말은 랭킹이 있는 혜택알림 탭으로 보낸다.
export function targetFor(intent: MovableIntent, question = '', slots: Slots = {}): Target {
  if (intent === 'my_score' && RANK_RE.test(question)) return { intent, label: '참여 랭킹', hash: TO.alerts }
  return { intent, label: INTENT_LABEL[intent], hash: buildHash(intent, slots), note: noteFor(intent, slots) }
}
