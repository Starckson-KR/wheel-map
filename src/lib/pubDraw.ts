// 공공 핀을 한 화면에 그리는 개수 제한(전체 합계). 지도 중심에 가까운 것부터 그린다.
// 순수 함수라 지도 없이 시험할 수 있다.

export const PUB_TOTAL_DRAW = 800

type Pt = { lat?: number | null; lng?: number | null }

/**
 * 레이어별 후보를 모아 합계 max개까지만 남긴다. 중심에서 가까운 순으로 고른다(같은 거리면 앞선 레이어·앞선 항목 먼저).
 * 돌려주는 목록은 입력과 같은 레이어 순서이고, 레이어 안의 순서는 입력 순서를 지킨다.
 */
export function pickNearestTotal<T extends Pt>(
  groups: { layer: string; items: T[] }[],
  center: { lat: number; lng: number },
  max: number = PUB_TOTAL_DRAW,
): { layer: string; items: T[] }[] {
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  if (total <= max) return groups.map((g) => ({ layer: g.layer, items: g.items }))
  // 경도는 위도 쪽 거리와 맞추려고 cos(위도)를 곱한다(순서만 필요해서 근사로 충분)
  const kx = Math.cos((center.lat * Math.PI) / 180)
  const all: { g: number; i: number; d: number }[] = []
  groups.forEach((g, gi) =>
    g.items.forEach((it, i) => {
      const dy = (it.lat as number) - center.lat
      const dx = ((it.lng as number) - center.lng) * kx
      all.push({ g: gi, i, d: dx * dx + dy * dy })
    }),
  )
  all.sort((a, b) => a.d - b.d || a.g - b.g || a.i - b.i)
  const keep = groups.map(() => new Set<number>())
  for (const e of all.slice(0, Math.max(0, max))) keep[e.g].add(e.i)
  return groups.map((g, gi) => ({ layer: g.layer, items: g.items.filter((_, i) => keep[gi].has(i)) }))
}
