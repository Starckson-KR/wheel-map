import { TO } from '../nav'

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

// 이동 주소. TODO(확인 필요): report_new의 유형 미리 선택, route의 출발·도착 미리 채우기는 앱에 아직 없어 화면만 열린다.
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

export type Target = { intent: MovableIntent; label: string; hash: string | null }

// 점수 중에서도 순위·등수를 묻는 말은 랭킹이 있는 혜택알림 탭으로 보낸다.
export function targetFor(intent: MovableIntent, question = ''): Target {
  if (intent === 'my_score' && RANK_RE.test(question)) return { intent, label: '참여 랭킹', hash: TO.alerts }
  return { intent, label: INTENT_LABEL[intent], hash: HASH[intent] }
}
