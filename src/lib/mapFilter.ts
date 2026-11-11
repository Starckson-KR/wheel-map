import type { Report } from '../types'
import { stageOfReport } from './progress'
import { isExpired } from './reportStore'

// 지도에 그리는 시민 제보 핀의 표시 규칙(표시만 바꾸고 데이터는 그대로). 팀 조사 지점은 이 규칙과 상관없이 항상 보인다.
export type StatusKey = 'severe' | 'caution' | 'overdue' | 'active' | 'done' | 'other'
export type KindKey = 'passage' | 'boarding' | 'entry' | 'zone'
export type MapFilter = { status: Record<StatusKey, boolean>; kind: Record<KindKey, boolean> }

export const DEFAULT_FILTER: MapFilter = {
  status: { severe: true, caution: true, overdue: true, active: false, done: false, other: false },
  kind: { passage: true, boarding: true, entry: true, zone: true },
}

export const STATUS_CHIPS: { id: StatusKey; label: string }[] = [
  { id: 'severe', label: '어려움' },
  { id: 'caution', label: '주의' },
  { id: 'overdue', label: '기한 지남' },
  { id: 'active', label: '접수·처리 중' },
  { id: 'done', label: '완료' },
  { id: 'other', label: '괜찮음·평가 없음' },
]

/** 제보 한 건이 어느 표시 항목에 해당하는지(여러 개 가능) */
export function statusKeysOf(r: Report, now: number): StatusKey[] {
  const out: StatusKey[] = []
  const rating = r.verification.rating
  if (rating === 'X') out.push('severe')
  else if (rating === 'TRIANGLE') out.push('caution')
  else out.push('other')
  const stage = stageOfReport(r, now)
  if (stage === 'overdue' || isExpired(r, now)) out.push('overdue')
  if (stage === 'intake' || stage === 'agency') out.push('active')
  if (stage === 'done' || stage === 'rechecked') out.push('done')
  return out
}

export function showCitizen(r: Report, kind: KindKey, f: MapFilter, now: number): boolean {
  if (!f.kind[kind]) return false
  return statusKeysOf(r, now).some((k) => f.status[k])
}
