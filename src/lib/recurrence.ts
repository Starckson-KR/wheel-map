import type { Report } from '../types'
import { RECURRENCE_RADIUS_M, RECURRENCE_SAME_TYPE } from './config'
import { distanceM } from './geo'

// 재발 판정(순수 함수): 앞선 민원 A가 조치 완료(resolved) 또는 재확인 완료(rechecked)된 뒤에,
// 같은 곳·같은 유형의 새 민원 B가 접수(createdAt)되면 B를 "재발"로 본다. 반려·합쳐진 건은 A로도 B로도 세지 않는다.

export type RecurrenceInfo = {
  priorId: string // 앞선 건(조치 시각이 가장 늦은 건)
  priorActionMs: number // 앞선 건의 조치 시각
  nth: number // 이 곳의 몇 번째 재발인지(1부터)
  rootId: string // 이 곳의 처음 건 id(지점 묶음의 기준)
}

export type RecurrenceSite = {
  rootId: string
  memberIds: string[] // 처음 건과 재발 건 모두(접수 순)
  recurIds: string[] // 그중 재발 건(접수 순)
  latestId: string // 가장 최근에 접수된 건
  lastActionMs: number | null // 이 곳의 마지막 조치 시각
}

export type RecurrenceResult = {
  byId: Map<string, RecurrenceInfo> // 재발인 민원만 들어 있다
  sites: RecurrenceSite[] // 재발이 1번 이상 있었던 곳. 재발 횟수 많은 순
}

const created = (r: Report) => new Date(r.createdAt).getTime()
const counted = (r: Report) => r.status !== 'rejected' && r.status !== 'merged'

// 조치 시각: action.doneAt이 있으면 그것, 없으면 history의 마지막 resolved 시각. 조치 완료·재확인 완료가 아니면 null.
export function actionMsOf(r: Report): number | null {
  if (r.status !== 'resolved' && r.status !== 'rechecked') return null
  let ms = r.action?.doneAt ? new Date(r.action.doneAt).getTime() : NaN
  if (Number.isNaN(ms)) {
    const h = [...r.history].reverse().find((x) => x.status === 'resolved')
    ms = h ? new Date(h.at).getTime() : NaN
  }
  return Number.isNaN(ms) ? null : ms
}

export function sameSite(a: Report, b: Report, radiusM = RECURRENCE_RADIUS_M): boolean {
  if (a.seedId && a.seedId === b.seedId) return true
  return distanceM(a.lat, a.lng, b.lat, b.lng) <= radiusM
}

export function computeRecurrence(reports: Report[]): RecurrenceResult {
  const pool = reports.filter(counted).sort((x, y) => created(x) - created(y) || x.id.localeCompare(y.id))
  const actionOf = new Map<string, number>()
  for (const r of pool) {
    const ms = actionMsOf(r)
    if (ms !== null) actionOf.set(r.id, ms)
  }

  // 1차: 어떤 건이 재발인지, 앞선 건은 무엇인지
  const prior = new Map<string, { id: string; ms: number }>()
  for (const b of pool) {
    const bMs = created(b)
    let best: { id: string; ms: number } | null = null
    for (const a of pool) {
      if (a.id === b.id) continue
      const aMs = actionOf.get(a.id)
      if (aMs === undefined || aMs >= bMs) continue // 조치 전에 접수된 건은 재발이 아니다
      if (RECURRENCE_SAME_TYPE && a.type !== b.type) continue
      if (!sameSite(a, b)) continue
      if (!best || aMs > best.ms) best = { id: a.id, ms: aMs }
    }
    if (best) prior.set(b.id, best)
  }

  // 2차: 앞선 건을 따라 올라가 처음 건(root)을 찾고, 같은 root 안에서 접수 순으로 번호를 매긴다.
  const rootOf = (id: string): string => {
    const seen = new Set<string>()
    let cur = id
    while (prior.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = (prior.get(cur) as { id: string }).id
    }
    return cur
  }
  const byId = new Map<string, RecurrenceInfo>()
  const countByRoot = new Map<string, number>()
  const siteMap = new Map<string, RecurrenceSite>()
  const byPoolId = new Map(pool.map((r) => [r.id, r]))
  for (const b of pool) {
    const p = prior.get(b.id)
    if (!p) continue
    const rootId = rootOf(b.id)
    const nth = (countByRoot.get(rootId) ?? 0) + 1
    countByRoot.set(rootId, nth)
    byId.set(b.id, { priorId: p.id, priorActionMs: p.ms, nth, rootId })
    const site = siteMap.get(rootId) ?? { rootId, memberIds: [rootId], recurIds: [], latestId: rootId, lastActionMs: null }
    site.memberIds.push(b.id)
    site.recurIds.push(b.id)
    site.latestId = b.id
    siteMap.set(rootId, site)
  }
  for (const s of siteMap.values()) {
    const ms = s.memberIds.map((id) => actionOf.get(id)).filter((v): v is number => v !== undefined)
    s.lastActionMs = ms.length > 0 ? Math.max(...ms) : null
    s.memberIds = [...new Set(s.memberIds)].filter((id) => byPoolId.has(id))
  }
  const sites = [...siteMap.values()].sort((x, y) => y.recurIds.length - x.recurIds.length || (y.lastActionMs ?? 0) - (x.lastActionMs ?? 0))
  return { byId, sites }
}
