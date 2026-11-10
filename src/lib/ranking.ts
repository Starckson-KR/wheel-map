// 주간·월간 참여 랭킹 계산. 점수 규칙은 새로 만들지 않고 rewards.ts의 점수 사건(events)을 기간으로 걸러 더한다.
// 그래서 기간을 "전체"로 잡으면 합계가 리워드 total과 같다. 순수 함수만 있다(화면·저장소 의존 없음).
import type { Report } from '../types'
import { computeRewards, type PointEvent, type PointKind } from './rewards'

export type RankPeriod = 'week' | 'month'

export type PeriodRange = { start: number; end: number; label: string } // [start, end) 밀리초

const MD = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일`

// 기준 시각이 속한 기간(주는 월~일, 월은 달력 월). offset 1이면 지난주·지난달.
export function periodRange(period: RankPeriod, now: number, offset = 0): PeriodRange {
  const d = new Date(now)
  if (period === 'week') {
    const sinceMon = (d.getDay() + 6) % 7
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMon - 7 * offset)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
    return { start: start.getTime(), end: end.getTime(), label: `${MD(start)} ~ ${MD(last)}` }
  }
  const start = new Date(d.getFullYear(), d.getMonth() - offset, 1)
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  return { start: start.getTime(), end: end.getTime(), label: `${start.getFullYear()}년 ${start.getMonth() + 1}월` }
}

export const inRange = (iso: string, r: PeriodRange) => {
  const t = new Date(iso).getTime()
  return t >= r.start && t < r.end
}

// 랭킹 화면에 보여 줄 점수 종류 이름(어떤 활동이 점수가 됐는지)
export const KIND_LABEL: Record<PointKind, string> = {
  verified: '신규 신고 검증',
  evidence: '실측·사진 보강',
  ledToAction: '조치로 이어짐',
  voteMatch: '확인 투표',
  merge: '같은 곳 확인',
  recheck: '재확인',
}
const KIND_ORDER: PointKind[] = ['verified', 'ledToAction', 'recheck', 'evidence', 'voteMatch', 'merge']

// 기간 안에서 실제로 점수가 된 사건만(keepCapped가 true면 하루 상한 때문에 0점이 된 사건도 남긴다). 반려·합쳐진 건에서 나온 사건은 한 번 더 걸러 낸다(rewards가 이미 빼지만 랭킹 쪽에서도 막아 둔다).
export function eventsInRange(events: PointEvent[], reports: Report[], range: PeriodRange, keepCapped = false): PointEvent[] {
  const byId = new Map(reports.map((r) => [r.id, r]))
  return events.filter((e) => {
    if ((!keepCapped && e.points <= 0) || !inRange(e.at, range)) return false
    const r = byId.get(e.reportId)
    if (!r || r.status === 'rejected') return false
    if (r.status === 'merged' && e.kind !== 'merge') return false
    return true
  })
}

export type RankRow = {
  userId: string
  points: number
  rank: number | null // 점수 0이면 null(순위 없음). 동점은 같은 순위, 다음 순위는 건너뜀
  counts: { kind: PointKind; label: string; n: number }[] // 많이 한 순이 아니라 KIND_ORDER 순
  prevRank: number | null | undefined // 지난 기간 순위(null: 지난 기간 기록 없음, undefined: 비교 안 함)
}

export type RankResult = { range: PeriodRange; rows: RankRow[]; ranked: RankRow[]; idle: RankRow[] }

function rankOnce(reports: Report[], userIds: string[], range: PeriodRange): Omit<RankRow, 'prevRank'>[] {
  const rw = computeRewards(reports, userIds)
  const rows = userIds.map((userId) => {
    const evs = eventsInRange(rw[userId]?.events ?? [], reports, range)
    const points = evs.reduce((s, e) => s + e.points, 0)
    const counts = KIND_ORDER.map((kind) => ({ kind, label: KIND_LABEL[kind], n: evs.filter((e) => e.kind === kind).length })).filter((c) => c.n > 0)
    return { userId, points, counts }
  })
  rows.sort((a, b) => b.points - a.points || (a.userId < b.userId ? -1 : 1))
  return rows.map((r) => ({ ...r, rank: r.points > 0 ? 1 + rows.filter((o) => o.points > r.points).length : null }))
}

// 기간 랭킹. withPrev가 true면 직전 기간(지난주·지난달) 순위도 함께 붙인다.
export function computeRanking(reports: Report[], userIds: string[], period: RankPeriod, now: number, offset = 0, withPrev = true): RankResult {
  const range = periodRange(period, now, offset)
  const cur = rankOnce(reports, userIds, range)
  const prev = withPrev ? new Map(rankOnce(reports, userIds, periodRange(period, now, offset + 1)).map((r) => [r.userId, r.rank])) : null
  const rows: RankRow[] = cur.map((r) => ({ ...r, prevRank: prev ? (prev.get(r.userId) ?? null) : undefined }))
  return { range, rows, ranked: rows.filter((r) => r.rank !== null), idle: rows.filter((r) => r.rank === null) }
}

// 순위 변화: 양수면 올랐고 음수면 내려갔다. 지난 기간 기록이 없으면 null.
export function rankDelta(r: RankRow): number | null {
  return r.rank !== null && typeof r.prevRank === 'number' ? r.prevRank - r.rank : null
}
