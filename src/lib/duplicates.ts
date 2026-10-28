import type { Barrier, Report } from '../types'
import { DUP_DAYS, DUP_RADIUS_M } from './config'
import { distanceM, distanceToGeometryM } from './geo'

export type DupCandidate = {
  kind: 'report' | 'seed'
  id: string
  label: string
  type: string
  distanceM: number
  at?: string
}

// 같은 유형이 반경 15m·최근 30일 안에 있는 기존 건(명세서 4-1(2)).
// - 기존 제보: 반려·합쳐진 건은 제외, 30일 이내만.
// - 지도 지점(시드): barriers.json의 reportType이 같을 때만(시드는 조사일 형식이 제각각이라 기간은 따지지 않음).
export function findDuplicates(lat: number, lng: number, type: string, reports: Report[], seeds: Barrier[], now = Date.now()): DupCandidate[] {
  const out: DupCandidate[] = []
  const since = now - DUP_DAYS * 24 * 3600 * 1000
  for (const r of reports) {
    if (r.type !== type || r.status === 'rejected' || r.status === 'merged') continue
    if (new Date(r.createdAt).getTime() < since) continue
    const d = distanceM(lat, lng, r.lat, r.lng)
    if (d <= DUP_RADIUS_M) out.push({ kind: 'report', id: r.id, label: '시민 제보', type: r.type, distanceM: d, at: r.createdAt })
  }
  for (const b of seeds) {
    if (!b.geometry || (b.reportType ?? '') !== type) continue
    const d = distanceToGeometryM(lat, lng, b.geometry)
    if (d <= DUP_RADIUS_M) out.push({ kind: 'seed', id: b.id, label: `지도 지점 ${b.id} · ${b.name}`, type: b.type, distanceM: d })
  }
  return out.sort((a, b) => a.distanceM - b.distanceM)
}
