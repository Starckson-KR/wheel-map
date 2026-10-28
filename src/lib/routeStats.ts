import routesData from '../../data/seed/routes.json'
import type { Barrier, Rating, Report } from '../types'
import { agencyOf } from './caseMetrics'

export type RouteDef = { id: string; name: string; barrierIds: string[]; coordinatorAgencyId: string | null }
export const ROUTES = routesData as RouteDef[]

export type RowRating = Rating | 'none'

// 지점의 유효 평가: 민원 흐름이 있으면 그 평가(재확인 통과 시 ○), 없으면 자료의 평가(하위 점은 상위 항목 평가를 따름).
export function ratingOfBarrier(b: Barrier, byId: Map<string, Barrier>, reports: Report[]): RowRating {
  const flow = reports.find((r) => r.seedId === b.id)
  if (flow) return flow.verification.rating ?? 'none'
  return b.rating ?? (b.parentId ? byId.get(b.parentId)?.rating : undefined) ?? 'none'
}

export type RouteRow = { b: Barrier; located: boolean; rating: RowRating; flow?: Report; agencyId: string | null }

export function routeStats(route: RouteDef, barriers: Barrier[], reports: Report[]) {
  const byId = new Map(barriers.map((b) => [b.id, b]))
  const rows: RouteRow[] = []
  for (const id of route.barrierIds) {
    const b = byId.get(id)
    if (!b) continue
    const located = !!b.geometry || barriers.some((c) => c.parentId === b.id && !!c.geometry)
    const flow = reports.find((r) => r.seedId === b.id)
    rows.push({ b, located, rating: ratingOfBarrier(b, byId, reports), flow, agencyId: flow ? agencyOf(flow) : null })
  }
  const counts = { O: 0, TRIANGLE: 0, X: 0, none: 0, unplaced: 0 }
  for (const r of rows) {
    if (!r.located) counts.unplaced++
    else counts[r.rating]++
  }
  const located = rows.length - counts.unplaced
  const ratio = located > 0 ? counts.O / located : null
  const agencies = new Map<string, number>()
  for (const r of rows) if (r.agencyId) agencies.set(r.agencyId, (agencies.get(r.agencyId) ?? 0) + 1)
  return { rows, counts, located, ratio, agencies }
}

const KEY = 'wheelmap.routeCoordinator'
// 경로 조정 담당 지정은 routes.json을 고치지 않고 localStorage에만 저장한다.
export function loadCoordinators(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
export function saveCoordinator(routeId: string, agencyId: string) {
  try {
    const all = loadCoordinators()
    if (agencyId) all[routeId] = agencyId
    else delete all[routeId]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* 저장 실패 시 화면 상태만 유지 */
  }
}
export const COORDINATOR_KEY = KEY
