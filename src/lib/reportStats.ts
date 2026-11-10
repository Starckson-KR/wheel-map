import type { Report } from '../types'
import { agencyOf, deadlineOf, fmtDate, pct } from './caseMetrics'
import type { CsvRow } from './csv'
import { buildProgress } from './progress'
import type { RecurrenceResult } from './recurrence'
import { inRange, isOngoing, previousRange, quarterOf, type PeriodRange } from './reportPeriod'

// 분기·연간 보고서의 숫자 계산(순수 함수). 개선 현황 지도와 같은 함수(buildProgress, avgProcessDays, deadlineOf)를 다시 쓴다.
// 기준: 기간 안에 접수(createdAt)된 제보를 모아, 그 건들의 "지금 상태"를 센다. 개선 현황 지도의 기간 세기와 같다.

export type Stats = {
  received: number // 제보 수(반려·합쳐짐 제외)
  filed: number // 민원 접수 수(기관에 접수된 건)
  done: number // 해결 수(조치 완료 + 재확인 완료)
  rate: number | null // 개선율 = 해결 ÷ 민원 접수
  avgDays: number | null
  overdue: number // 처리기한 경과
  long: number // 장기 미조치(60일+)
  recur: number // 재발 건수
  recurRate: number | null // 재발률 = 재발 ÷ 제보 수
}

export const EMPTY_STATS: Stats = { received: 0, filed: 0, done: 0, rate: null, avgDays: null, overdue: 0, long: 0, recur: 0, recurRate: null }

export const inPeriod = (reports: Report[], p: PeriodRange) => reports.filter((r) => inRange(new Date(r.createdAt).getTime(), p))

export function statsOf(list: Report[], now: number, rec: RecurrenceResult): Stats {
  const { summary } = buildProgress({ reports: list, barriers: [], plans: {}, now, periodDays: null, placeName: () => '', seedName: () => '' })
  const cases = list.filter((r) => r.complaint)
  const recur = list.filter((r) => rec.byId.has(r.id)).length
  return {
    received: summary.received,
    filed: summary.filed,
    done: summary.done,
    rate: summary.rate,
    avgDays: summary.avgDays,
    overdue: cases.filter((r) => (deadlineOf(r, now)?.overdueDays ?? 0) > 0).length,
    long: cases.filter((r) => (deadlineOf(r, now)?.longDays ?? 0) > 0).length,
    recur,
    recurRate: summary.received > 0 ? recur / summary.received : null,
  }
}

export type GroupRow = { key: string; stats: Stats }

// 묶음 기준(동·유형·기관)별 숫자. key가 null이면 뺀다. 접수 수 많은 순.
export function groupStats(list: Report[], keyOf: (r: Report) => string | null, now: number, rec: RecurrenceResult): GroupRow[] {
  const m = new Map<string, Report[]>()
  for (const r of list) {
    const k = keyOf(r)
    if (k === null) continue
    m.set(k, [...(m.get(k) ?? []), r])
  }
  return [...m]
    .map(([key, rs]) => ({ key, stats: statsOf(rs, now, rec) }))
    .filter((g) => g.stats.received > 0)
    .sort((a, b) => b.stats.filed - a.stats.filed || b.stats.received - a.stats.received || a.key.localeCompare(b.key, 'ko'))
}

export const agencyKey = (r: Report) => (r.complaint ? agencyOf(r) : null)

export type SiteRow = { rootId: string; count: number; lastActionMs: number | null; latestId: string }

// 자주 재발하는 곳: 기간 안에 접수된 재발 건 수가 많은 순
export function periodSites(rec: RecurrenceResult, reports: Report[], p: PeriodRange): SiteRow[] {
  const at = new Map(reports.map((r) => [r.id, new Date(r.createdAt).getTime()]))
  return rec.sites
    .map((s) => ({ rootId: s.rootId, count: s.recurIds.filter((id) => inRange(at.get(id) ?? NaN, p)).length, lastActionMs: s.lastActionMs, latestId: s.latestId }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || (b.lastActionMs ?? 0) - (a.lastActionMs ?? 0))
}

// ---- 이전 기간 대비 ----
export type Delta = { dir: 'up' | 'down' | 'flat'; text: string; sr: string }

const FLAT: Delta = { dir: 'flat', text: '변화 없음', sr: '' }

function deltaOf(cur: number | null, prev: number | null, unit: string, vs: string, digits = 0, mult = 1): Delta | null {
  if (cur === null || prev === null) return null
  const d = Math.round((cur - prev) * mult * 10 ** digits) / 10 ** digits
  const abs = Math.abs(d).toFixed(digits)
  if (d === 0) return { ...FLAT, sr: `${vs}와 같아요` }
  const dir = d > 0 ? 'up' : 'down'
  return { dir, text: `${d > 0 ? '▲' : '▼'} ${abs}${unit}`, sr: `${vs}보다 ${abs}${unit} ${d > 0 ? '늘었어요' : '줄었어요'}` }
}

export const prevWord = (p: PeriodRange) => (p.choice === 'year' ? '지난해' : '지난 분기')

export type Kpi = { id: string; label: string; value: string; formula: string; delta: Delta | null; prevText: string }

export function buildKpis(cur: Stats, prev: Stats | null, p: PeriodRange): Kpi[] {
  const vs = prevWord(p)
  const hasPrev = prev !== null && prev.received > 0
  const pv = (v: number | null, fmt: (n: number) => string) => (hasPrev && v !== null ? `${vs} ${fmt(v)}` : hasPrev ? `${vs} 산정 불가` : `${vs} 자료 없음`)
  const cnt = (n: number) => `${n}건`
  const day = (n: number) => `${n.toFixed(1)}일`
  const pp = (c: number | null, q: number | null) => (hasPrev ? deltaOf(c, q, '%p', vs, 0, 100) : null) // 개선율·재발률은 %p 차이
  const kpis: Kpi[] = [
    { id: 'received', label: '제보 수', value: cnt(cur.received), formula: '기간 안에 접수된 제보(반려·합쳐진 건 제외)', delta: hasPrev ? deltaOf(cur.received, prev.received, '건', vs) : null, prevText: pv(prev?.received ?? null, cnt) },
    { id: 'filed', label: '민원 접수 수', value: cnt(cur.filed), formula: '그중 기관에 접수된 건', delta: hasPrev ? deltaOf(cur.filed, prev.filed, '건', vs) : null, prevText: pv(prev?.filed ?? null, cnt) },
    { id: 'done', label: '해결 수', value: cnt(cur.done), formula: '조치 완료 + 재확인 완료', delta: hasPrev ? deltaOf(cur.done, prev.done, '건', vs) : null, prevText: pv(prev?.done ?? null, cnt) },
    { id: 'rate', label: '개선율', value: pct(cur.rate), formula: '해결 수 ÷ 민원 접수 수', delta: pp(cur.rate, prev?.rate ?? null), prevText: pv(prev?.rate ?? null, (n) => pct(n)) },
    { id: 'avg', label: '평균 처리 기간', value: cur.avgDays === null ? '자료 없음' : day(cur.avgDays), formula: '접수부터 조치 기록까지 걸린 일수의 평균', delta: hasPrev ? deltaOf(cur.avgDays, prev.avgDays, '일', vs, 1) : null, prevText: pv(prev?.avgDays ?? null, day) },
    { id: 'overdue', label: '처리기한 경과', value: cnt(cur.overdue), formula: '접수일 + 처리기한이 지났는데 조치가 끝나지 않은 건', delta: hasPrev ? deltaOf(cur.overdue, prev.overdue, '건', vs) : null, prevText: pv(prev?.overdue ?? null, cnt) },
    { id: 'long', label: '장기 미조치(60일+)', value: cnt(cur.long), formula: '접수 후 60일이 지났는데 조치가 끝나지 않은 건', delta: hasPrev ? deltaOf(cur.long, prev.long, '건', vs) : null, prevText: pv(prev?.long ?? null, cnt) },
    { id: 'recur', label: '재발 건수', value: cnt(cur.recur), formula: '조치된 뒤 같은 곳·같은 유형으로 다시 접수된 건', delta: hasPrev ? deltaOf(cur.recur, prev.recur, '건', vs) : null, prevText: pv(prev?.recur ?? null, cnt) },
    { id: 'recurRate', label: '재발률', value: pct(cur.recurRate), formula: '재발 건수 ÷ 기간 안에 접수된 제보 수', delta: pp(cur.recurRate, prev?.recurRate ?? null), prevText: pv(prev?.recurRate ?? null, (n) => pct(n)) },
  ]
  return kpis
}

const cmpWord = (d: number, unit: string) => (d === 0 ? '같아요' : `${Math.abs(d)}${unit} ${d > 0 ? '늘었어요' : '줄었어요'}`)

// 요약 문장: 숫자만 쓴다. 평가나 원인 해석은 넣지 않는다.
export function buildSummary(cur: Stats, prev: Stats | null, p: PeriodRange, now: number): string[] {
  const q = quarterOf(now)
  const thisPeriod = p.choice !== 'year' ? p.year === q.year && p.choice === q.choice : p.year === q.year
  const when = thisPeriod ? (p.choice === 'year' ? '올해' : '이번 분기') : p.label
  const out: string[] = []
  if (cur.received === 0) return [`${when}에는 접수된 제보가 없어요.`]
  out.push(`${when}에 민원 ${cur.filed}건이 접수되어 ${cur.done}건이 해결됐어요(개선율 ${pct(cur.rate)}). 재발은 ${cur.recur}건이에요.`)
  out.push(
    `평균 처리 기간은 ${cur.avgDays === null ? '자료가 없어요' : `${cur.avgDays.toFixed(1)}일이에요`}. 처리기한이 지난 건은 ${cur.overdue}건, 접수 후 60일이 넘은 미조치 건은 ${cur.long}건이에요.`,
  )
  if (prev && prev.received > 0) out.push(`${prevWord(p)}와 비교하면 민원 접수는 ${cmpWord(cur.filed - prev.filed, '건')}. 해결은 ${cmpWord(cur.done - prev.done, '건')}.`)
  return out
}

// ---- CSV ----
export type CsvInput = {
  p: PeriodRange
  cur: Stats
  prev: Stats | null
  dongs: GroupRow[] | null
  types: GroupRow[]
  agencies: { name: string; stats: Stats }[]
  sites: { name: string; count: number; lastActionMs: number | null; agency: string }[]
  summary: string[]
  now: number
}

const pr = (v: number | null) => (v === null ? '' : Math.round(v * 100))
const dayStr = (v: number | null) => (v === null ? '' : Number(v.toFixed(1)))

export function reportCsvRows({ p, cur, prev, dongs, types, agencies, sites, summary, now }: CsvInput): CsvRow[] {
  const rows: CsvRow[] = []
  const gap = () => rows.push([])
  rows.push(['[보고서]', p.label, isOngoing(p, now) ? `진행 중(${fmtDate(now)}까지)` : '', `${fmtDate(p.from)} ~ ${fmtDate(p.to - 1)}`])
  for (const s of summary) rows.push(['요약', s])
  gap()
  rows.push(['[지표]', '값', `${prevWord(p)} 값`, '계산식'])
  for (const k of buildKpis(cur, prev, p)) {
    const pvSrc: Record<string, number | string | undefined> = {
      received: prev?.received, filed: prev?.filed, done: prev?.done, rate: pr(prev?.rate ?? null), avg: dayStr(prev?.avgDays ?? null), overdue: prev?.overdue, long: prev?.long, recur: prev?.recur, recurRate: pr(prev?.recurRate ?? null),
    }
    const unit = k.id === 'rate' || k.id === 'recurRate' ? '(%)' : k.id === 'avg' ? '(일)' : '(건)'
    const curVal: Record<string, number | string> = {
      received: cur.received, filed: cur.filed, done: cur.done, rate: pr(cur.rate), avg: dayStr(cur.avgDays), overdue: cur.overdue, long: cur.long, recur: cur.recur, recurRate: pr(cur.recurRate),
    }
    const hasPrev = prev !== null && prev.received > 0
    rows.push([`${k.label}${unit}`, curVal[k.id], hasPrev ? (pvSrc[k.id] ?? '') : '', k.formula])
  }
  const table = (title: string, head: string, list: { name: string; stats: Stats }[]) => {
    gap()
    rows.push([title])
    rows.push([head, '민원 접수', '해결', '개선율(%)', '평균 처리 기간(일)', '재발'])
    for (const g of list) rows.push([g.name, g.stats.filed, g.stats.done, pr(g.stats.rate), dayStr(g.stats.avgDays), g.stats.recur])
    if (list.length === 0) rows.push(['(해당 없음)'])
  }
  if (dongs) table('[동별]', '동', dongs.map((g) => ({ name: g.key, stats: g.stats })))
  table('[유형별]', '유형', types.map((g) => ({ name: g.key, stats: g.stats })))
  table('[기관별]', '기관', agencies)
  gap()
  rows.push(['[자주 재발하는 곳]'])
  rows.push(['지점', '재발 횟수', '마지막 조치일', '담당 기관'])
  for (const s of sites) rows.push([s.name, s.count, s.lastActionMs === null ? '' : fmtDate(s.lastActionMs), s.agency])
  if (sites.length === 0) rows.push(['(해당 없음)'])
  return rows
}

export function reportCsvName(p: PeriodRange): string {
  return `민원보고서_${p.year}_${p.choice === 'year' ? '연간' : `${p.choice}분기`}.csv`
}

export { previousRange }
