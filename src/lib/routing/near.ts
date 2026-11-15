// 경로에서 가까운 점인지 판단한다(핀을 흐리게 할지 정할 때 쓴다). 위치는 어디에도 저장하지 않는다.
type Pt = [number, number]

export function makeNearRoute(paths: Pt[][], meters = 40): (lat: number, lng: number) => boolean {
  const M_LAT = 111320
  const boxes = paths
    .filter((p) => p.length > 0)
    .map((p) => {
      let s = 90, w = 180, n = -90, e = -180
      for (const [la, lo] of p) {
        s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo)
      }
      return { p, s, w, n, e }
    })
  return (lat, lng) => {
    const mLng = M_LAT * Math.cos((lat * Math.PI) / 180)
    const padLat = meters / M_LAT
    const padLng = meters / mLng
    for (const b of boxes) {
      if (lat < b.s - padLat || lat > b.n + padLat || lng < b.w - padLng || lng > b.e + padLng) continue
      for (let i = 0; i < b.p.length; i++) {
        const ax = (b.p[i][1] - lng) * mLng, ay = (b.p[i][0] - lat) * M_LAT
        const q = b.p[i + 1] ?? b.p[i]
        const bx = (q[1] - lng) * mLng, by = (q[0] - lat) * M_LAT
        const dx = bx - ax, dy = by - ay
        const len2 = dx * dx + dy * dy
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
        if (Math.hypot(ax + t * dx, ay + t * dy) <= meters) return true
      }
    }
    return false
  }
}

// 경로 위에 일정 간격(미터)으로 화살표 자리를 구한다. angle은 북쪽 기준 시계 방향 도(deg).
export function arrowSpots(path: Pt[], stepM: number): { at: Pt; angle: number }[] {
  const out: { at: Pt; angle: number }[] = []
  let carry = stepM / 2
  for (let i = 0; i + 1 < path.length; i++) {
    const [la1, lo1] = path[i]
    const [la2, lo2] = path[i + 1]
    const mLng = 111320 * Math.cos((la1 * Math.PI) / 180)
    const dy = (la2 - la1) * 111320, dx = (lo2 - lo1) * mLng
    const len = Math.hypot(dx, dy)
    if (len < 0.5) continue
    const angle = (Math.atan2(dx, dy) * 180) / Math.PI
    let d = carry
    while (d <= len) {
      const f = d / len
      out.push({ at: [la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f], angle })
      d += stepM
    }
    carry = d - len
  }
  return out
}
