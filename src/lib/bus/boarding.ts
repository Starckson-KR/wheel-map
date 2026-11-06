import { obstacleName } from '../display'
import { distM, type Obstacle, type Pt } from '../routing/engine.ts'

// 정류장 근처의 '버스 타기 불편'(boarding, X·△) 장애요소. 7단계부터는 걸어서 가는 경로가 아니라
// 버스를 타고 내리는 정류장일 때만 판정에 넣는다(길찾기 보정 때 정한 규칙).
export const BOARDING_RADIUS_M = 40

export type BoardingWarn = { id: string; name: string; rating: 'X' | 'TRIANGLE'; distM: number; origin: Obstacle['origin']; parentKey: string }

export function boardingNear(obstacles: Obstacle[], p: Pt, radiusM = BOARDING_RADIUS_M): BoardingWarn[] {
  const out: BoardingWarn[] = []
  const seen = new Set<string>()
  for (const o of obstacles) {
    if (o.impact !== 'boarding' || o.path.length === 0 || !(o.rating === 'X' || o.rating === 'TRIANGLE')) continue
    const d = Math.min(...o.path.map((q) => distM(p, q)))
    if (d > radiusM) continue
    // 같은 상위 항목의 하위 점(예: 양쪽 정류장)은 한 곳으로 본다
    const key = o.parentId ?? o.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: o.id, name: obstacleName({ id: o.parentId ?? o.id, name: o.name }), rating: o.rating, distM: Math.round(d), origin: o.origin, parentKey: o.parentId ?? o.id })
  }
  return out.sort((a, b) => (a.rating === b.rating ? a.distM - b.distM : a.rating === 'X' ? -1 : 1))
}

export const worstOf = (w: BoardingWarn[]): 'X' | 'T' | null => (w.some((x) => x.rating === 'X') ? 'X' : w.length > 0 ? 'T' : null)
