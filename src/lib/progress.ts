import type { Barrier, Geometry, LatLng, Report } from '../types'
import { DAY, deadlineOf } from './caseMetrics'
import type { PlanEntry } from './planStore'

// 시민용 개선 현황: 민원과 팀 조사 지점을 진행 단계로 나눠 센다. 화면 코드가 없는 순수 함수만 둔다.
export type ProgressStage = 'intake' | 'agency' | 'overdue' | 'done' | 'rechecked' | 'plan'

export const PROGRESS_ORDER: ProgressStage[] = ['intake', 'agency', 'overdue', 'done', 'rechecked', 'plan']

// glyph: 색만으로 구분하지 않도록 지도 핀·범례·칩에 같이 쓰는 글자
export const PROGRESS_INFO: Record<ProgressStage, { label: string; short: string; glyph: string }> = {
  intake: { label: '접수·검증 중', short: '접수', glyph: '접' },
  agency: { label: '기관 처리 중', short: '처리 중', glyph: '처' },
  overdue: { label: '기한 지남', short: '기한 지남', glyph: '!' },
  done: { label: '조치 완료', short: '조치 완료', glyph: '완' },
  rechecked: { label: '재확인 완료', short: '재확인', glyph: '확' },
  plan: { label: '개선계획 반영', short: '계획 반영', glyph: '계' },
}

export const PERIODS = [
  { id: '30', label: '30일', days: 30 },
  { id: '90', label: '90일', days: 90 },
  { id: '365', label: '1년', days: 365 },
  { id: 'all', label: '전체', days: null },
] as const
export type PeriodId = (typeof PERIODS)[number]['id']

// 민원 한 건의 단계. 제외 대상(반려·합쳐짐)은 null.
export function stageOfReport(r: Report, now: number): ProgressStage | null {
  switch (r.status) {
    case 'submitted':
    case 'pending':
    case 'verified':
      return 'intake'
    case 'filed':
    case 'assigned':
    case 'in_progress': {
      const d = deadlineOf(r, now)
      return d && (d.overdueDays > 0 || d.longDays > 0) ? 'overdue' : 'agency'
    }
    case 'resolved':
      return 'done'
    case 'rechecked':
      return 'rechecked'
    default:
      return null
  }
}

export type ProgressItem = {
  key: string
  kind: 'report' | 'seed'
  id: string
  stage: ProgressStage
  lat: number
  lng: number
  title: string
  sub: string // 목록 둘째 줄(민원 종류 또는 계획 반영 연도)
  at: number // 정렬·날짜 표시 기준(ms). 0이면 날짜 없음
}

export type ProgressSummary = {
  received: number // 기간 내 접수된 제보(반려·합쳐짐 제외)
  inProgress: number // 기관 처리 중(기한 지남 포함)
  done: number // 조치 완료 + 재확인 완료
  overdue: number
  filed: number // 기관에 접수된 건(개선율의 분모)
  rate: number | null
  avgDays: number | null
  planCount: number
  counts: Record<ProgressStage, number>
}

export function anchorOf(g: Geometry): LatLng {
  return g.kind === 'point' ? g.at : g.path[0]
}

// 처리 기간 평균(일): 접수일부터 조치 기록일까지. 행정 화면과 같은 계산이다.
export function avgProcessDays(cases: Report[]): number | null {
  const done = cases.filter((r) => r.action?.doneAt && r.complaint)
  if (done.length === 0) return null
  const sum = done.reduce((s, r) => s + (new Date(r.action?.doneAt ?? 0).getTime() - new Date(r.complaint?.submittedAt ?? 0).getTime()) / DAY, 0)
  return sum / done.length
}

type Input = {
  reports: Report[]
  barriers: Barrier[]
  plans: Record<string, PlanEntry | undefined>
  now: number // 시연 시각(nowMs())
  periodDays: number | null
  placeName: (r: Report) => string
  seedName: (b: Barrier) => string
}

// 민원은 접수일(createdAt)이 기간 안에 있는 것만 센다. 개선계획 반영 지점은 "지금의 상태"라 기간과 무관하게 늘 넣는다.
export function buildProgress({ reports, barriers, plans, now, periodDays, placeName, seedName }: Input): { items: ProgressItem[]; summary: ProgressSummary } {
  const since = periodDays === null ? -Infinity : now - periodDays * DAY
  const items: ProgressItem[] = []
  const cases: Report[] = []
  for (const r of reports) {
    const stage = stageOfReport(r, now)
    if (!stage) continue
    const created = new Date(r.createdAt).getTime()
    if (created < since) continue
    items.push({ key: 'r:' + r.id, kind: 'report', id: r.id, stage, lat: r.lat, lng: r.lng, title: placeName(r), sub: r.type, at: created })
    if (r.complaint) cases.push(r)
  }
  for (const b of barriers) {
    const p = plans[b.id]
    if (!b.geometry || b.provisional || !p || (p.stage !== '계획 반영' && p.stage !== '집행')) continue
    const a = anchorOf(b.geometry)
    items.push({ key: 's:' + b.id, kind: 'seed', id: b.id, stage: 'plan', lat: a[0], lng: a[1], title: seedName(b), sub: `${p.stage}${p.year ? ` · ${p.year}년` : ''}`, at: p.updatedAt ? new Date(p.updatedAt).getTime() : 0 })
  }
  items.sort((x, y) => y.at - x.at)

  const counts = Object.fromEntries(PROGRESS_ORDER.map((s) => [s, 0])) as Record<ProgressStage, number>
  for (const it of items) counts[it.stage]++
  const filedCases = cases.filter((r) => ['agency', 'overdue', 'done', 'rechecked'].includes(stageOfReport(r, now) ?? ''))
  const doneCount = counts.done + counts.rechecked
  const filed = filedCases.length
  const finished = cases.filter((r) => r.status === 'resolved' || r.status === 'rechecked')
  return {
    items,
    summary: {
      received: counts.intake + counts.agency + counts.overdue + counts.done + counts.rechecked,
      inProgress: counts.agency + counts.overdue,
      done: doneCount,
      overdue: counts.overdue,
      filed,
      rate: filed > 0 ? doneCount / filed : null,
      avgDays: avgProcessDays(finished),
      planCount: counts.plan,
      counts,
    },
  }
}
