import type { Barrier, Report } from '../types'
import { agencyOf } from './caseMetrics'
import { DEMAND_FACILITY_TYPES, PRIORITY_DEMAND_RADIUS_M, PRIORITY_REPORT_RADIUS_M, PRIORITY_WEIGHTS } from './config'
import { distanceM, distanceToGeometryM } from './geo'
import { findAgencyName } from './agencyName'
import { findAgencies, guessLocationKind } from './agencyGuide'
import type { PubDataset } from './publicLayers'
import { ratingOfBarrier, type RowRating } from './routeStats'
import { noAltFor, type NoAltMap } from './routing/noAlt.ts'

// 개선 우선순위(안) 계산. 우선순위 화면과 개선계획·예산 화면이 같은 결과를 쓰도록 한곳에 둔다.
const SHOWN = ['verified', 'filed', 'assigned', 'in_progress', 'resolved', 'rechecked']

// 지도에 올라간 지점(팀 조사 지점 + 검증 이후 시민 제보). 위치가 확정된 것만.
// key는 새로고침해도 바뀌지 않는다: 팀 조사 지점은 지점 id, 시민 제보는 제보 id.
export type Pt = { key: string; label: string; lat: number; lng: number; rating: RowRating; seed?: Barrier; report?: Report }

export function collectPoints(barriers: Barrier[], reports: Report[]): Pt[] {
  const byId = new Map(barriers.map((b) => [b.id, b]))
  const out: Pt[] = []
  for (const b of barriers) {
    if (!b.geometry) continue
    const a = b.geometry.kind === 'point' ? b.geometry.at : b.geometry.path[0]
    out.push({ key: b.id, label: `${b.id} · ${b.name}`, lat: a[0], lng: a[1], rating: ratingOfBarrier(b, byId, reports), seed: b })
  }
  for (const r of reports) {
    if (r.seedId || !SHOWN.includes(r.status)) continue
    out.push({ key: r.id, label: `${r.type} (시민 제보)`, lat: r.lat, lng: r.lng, rating: r.verification.rating ?? 'none', report: r })
  }
  return out
}

export type Cand = { pt: Pt; reportsN: number; bus: number; fac: number; alt: string[] | null; score: number }

export function computePriority(barriers: Barrier[], reports: Report[], data: { bus: PubDataset; fac: PubDataset }, noAlt: NoAltMap): Cand[] {
  const W = PRIORITY_WEIGHTS
  const pts = collectPoints(
    barriers.filter((b) => !b.parentId),
    reports,
  )
  const citizen = reports.filter((r) => !r.seedId && r.status !== 'rejected')
  const fac = data.fac.items.filter((i) => i.lat != null && i.lng != null && DEMAND_FACILITY_TYPES.includes(String(i.fields['faclTyCd'])))
  const bus = data.bus.items.filter((i) => i.lat != null && i.lng != null)
  return pts
    .map((pt) => {
      const near = (lat: number, lng: number) => (pt.seed?.geometry ? distanceToGeometryM(lat, lng, pt.seed.geometry) : distanceM(pt.lat, pt.lng, lat, lng))
      const reportsN = citizen.filter((r) => distanceM(pt.lat, pt.lng, r.lat, r.lng) <= PRIORITY_REPORT_RADIUS_M).length
      const b = bus.filter((i) => near(i.lat as number, i.lng as number) <= PRIORITY_DEMAND_RADIUS_M).length
      const f = fac.filter((i) => near(i.lat as number, i.lng as number) <= PRIORITY_DEMAND_RADIUS_M).length
      // 지금도 X인 지점만 반영(재확인을 통과해 ○가 되면 점수에서 빠진다)
      const rec = pt.rating === 'X' ? noAltFor(noAlt, pt.key) : undefined
      return { pt, reportsN, bus: b, fac: f, alt: rec ? rec.pairs : null, score: reportsN * W.report + b * W.bus + f * W.facility + (rec ? W.alternative : 0) }
    })
    .sort((a, b) => b.score - a.score)
}

// 담당 기관 이름. 접수된 민원이 있으면 그 기관, 없으면 지점 종류로 소관이 하나로 정해질 때만 알려 주고 아니면 빈칸.
export function agencyNameOf(pt: Pt, reports: Report[]): string {
  const filed = pt.report ?? reports.find((r) => r.seedId === pt.key)
  const id = filed ? agencyOf(filed) : null
  if (id) return findAgencyName(id)
  const b = pt.seed
  if (!b?.reportType) return ''
  const kind = guessLocationKind(b.type)
  if (!kind) return ''
  const sure = findAgencies(b.reportType, kind).filter((m) => !m.candidate && !m.condition)
  return sure.length === 1 ? sure[0].agency.name : ''
}
