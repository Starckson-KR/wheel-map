import type { Barrier, Rating, Report } from '../../types'
import type { Impact, ObRating, Obstacle } from './engine.ts'
import { impactOfReport } from './impact.ts'

// 경로 검사 대상(장애요소) 만들기. 팀 조사 지점(점·선·영역, 하위 점) + 검증된 시민 제보.
// 평가는 현재 상태 반영: 민원 흐름이 있으면 그 평가(재확인 통과 시 ○)가 자료의 평가를 덮어쓴다(seedRatings).
// 하위 점에 평가가 없으면 상위 항목의 평가를 따른다.
export function buildObstacles(barriers: Barrier[], seedRatings: Map<string, Rating | undefined>, citizenReports: Report[]): Obstacle[] {
  const byId = new Map(barriers.map((b) => [b.id, b]))
  const out: Obstacle[] = []
  for (const b of barriers) {
    const g = b.geometry
    if (!g) continue // 위치 미확정·여러 점(group) 자체는 모양이 없다
    const parent = b.parentId ? byId.get(b.parentId) : undefined
    const rating: ObRating = (seedRatings.has(b.id) ? seedRatings.get(b.id) : (b.rating ?? parent?.rating)) ?? 'none'
    // 영향 종류: barriers.json의 impact, 하위 점은 상위 따라감, 없으면 영역은 zone·나머지는 passage
    const impact: Impact = (b as { impact?: Impact }).impact ?? (parent as { impact?: Impact } | undefined)?.impact ?? (g.kind === 'area' ? 'zone' : 'passage')
    out.push({
      id: b.id,
      name: parent ? `${b.id} · ${parent.name} (${b.name})` : `${b.id} · ${b.name}`,
      kind: g.kind,
      impact,
      rating,
      path: g.kind === 'point' ? [g.at] : g.path,
      ...(b.parentId ? { parentId: b.parentId } : {}),
      origin: 'seed',
    })
  }
  for (const r of citizenReports) {
    const rating = r.verification.rating
    out.push({
      id: r.id,
      name: `${r.type} (시민 제보)`,
      kind: 'point',
      impact: impactOfReport(r.type, r.locationKind),
      // 판정 전인 검증 완료 제보는 안전 쪽(△ 주의)으로 본다
      rating: rating ?? 'TRIANGLE',
      path: [[r.lat, r.lng]],
      ...(rating ? {} : { pending: true }),
      origin: 'report',
    })
  }
  return out
}
