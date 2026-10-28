// 경로 검색 엔진(명세서 4-0). 브라우저와 Node(prefetch·개발 중계)가 같은 코드를 쓰도록 의존성 없이 작성했다.
// 좌표는 [위도, 경도]. 거리 계산은 경로 시작점 기준의 평면 근사(수 km 안에서 오차 미미).

export type Pt = [number, number]
export type V = [number, number]
export type RouteData = { distance: number; time: number; coords: Pt[] }

export type ObstacleKind = 'point' | 'line' | 'area'
export type ObRating = 'O' | 'TRIANGLE' | 'X' | 'none'
// 영향 종류: passage=지나가기 어려움(우회 대상), boarding=버스 타기 어려움(정류장), entry=건물 들어가기 어려움, zone=동네 단위 주의 영역
export type Impact = 'passage' | 'boarding' | 'entry' | 'zone'
export type Obstacle = {
  id: string
  name: string
  kind: ObstacleKind
  impact: Impact
  rating: ObRating
  path: Pt[]
  parentId?: string
  pending?: boolean // 시민 제보 중 판정 대기(주의로 간주)
  origin: 'seed' | 'report'
}

// X=지나가기 불가(passage), T=△ 주의(passage), Z=주의 구역, B=버스 타기 불편(boarding X·△), E=출입 불편(entry X·△), O=○, N=평가 없음
export type HitRole = 'X' | 'T' | 'Z' | 'B' | 'E' | 'O' | 'N'
export type Hit = { o: Obstacle; role: HitRole; distM: number; atM: number; anchor: Pt; segIdx: number }

const M_LAT = 111320

function makeProj(ref: Pt) {
  const kx = M_LAT * Math.cos((ref[0] * Math.PI) / 180)
  return {
    fwd: (p: Pt): V => [(p[1] - ref[1]) * kx, (p[0] - ref[0]) * M_LAT],
    inv: (v: V): Pt => [ref[0] + v[1] / M_LAT, ref[1] + v[0] / kx],
  }
}

function pointSeg(p: V, a: V, b: V) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const q: V = [a[0] + t * dx, a[1] + t * dy]
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), t, q }
}

const cross = (o: V, a: V, b: V) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

// 선분 AB와 CD의 최소 거리. pa=AB 위 가장 가까운 점(ta=AB 위 비율), pb=CD 위 가장 가까운 점.
function segSeg(a: V, b: V, c: V, d: V) {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const ta = d1 / (d1 - d2)
    const q: V = [a[0] + ta * (b[0] - a[0]), a[1] + ta * (b[1] - a[1])]
    return { d: 0, pa: q, pb: q, ta }
  }
  const c1 = pointSeg(a, c, d)
  const c2 = pointSeg(b, c, d)
  const c3 = pointSeg(c, a, b)
  const c4 = pointSeg(d, a, b)
  let best = { d: c1.d, pa: a, pb: c1.q, ta: 0 }
  if (c2.d < best.d) best = { d: c2.d, pa: b, pb: c2.q, ta: 1 }
  if (c3.d < best.d) best = { d: c3.d, pa: c3.q, pb: c, ta: c3.t }
  if (c4.d < best.d) best = { d: c4.d, pa: c4.q, pb: d, ta: c4.t }
  return best
}

function inside(p: V, poly: V[]) {
  let on = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) on = !on
  }
  return on
}

export const distM = (a: Pt, b: Pt) => {
  const pr = makeProj(a)
  const v = pr.fwd(b)
  return Math.hypot(v[0], v[1])
}

// 점에서 경로선까지 최소 거리(m)
export function distToRoute(coords: Pt[], p: Pt): number {
  if (coords.length < 2) return Infinity
  const pr = makeProj(coords[0])
  const R = coords.map(pr.fwd)
  const P = pr.fwd(p)
  let m = Infinity
  for (let i = 0; i < R.length - 1; i++) m = Math.min(m, pointSeg(P, R[i], R[i + 1]).d)
  return m
}

// 경로 위에서 점이 가장 가까운 지점까지의 누적 거리(m)
export function alongM(coords: Pt[], p: Pt): number {
  const pr = makeProj(coords[0])
  const R = coords.map(pr.fwd)
  const P = pr.fwd(p)
  let acc = 0
  let best = { d: Infinity, at: 0 }
  for (let i = 0; i < R.length - 1; i++) {
    const len = Math.hypot(R[i + 1][0] - R[i][0], R[i + 1][1] - R[i][1])
    const r = pointSeg(P, R[i], R[i + 1])
    if (r.d < best.d) best = { d: r.d, at: acc + r.t * len }
    acc += len
  }
  return best.at
}

export function roleOf(o: Obstacle): HitRole {
  const bad = o.rating === 'X' || o.rating === 'TRIANGLE'
  if (o.impact === 'boarding') return bad ? 'B' : o.rating === 'O' ? 'O' : 'N'
  if (o.impact === 'entry') return bad ? 'E' : o.rating === 'O' ? 'O' : 'N'
  if (o.impact === 'zone' || o.kind === 'area') return o.rating === 'O' ? 'O' : 'Z'
  if (o.rating === 'X') return 'X'
  if (o.rating === 'TRIANGLE') return 'T'
  if (o.rating === 'O') return 'O'
  return 'N'
}

// 경로선 반경 radiusM 안의 장애요소(점·선·영역). 선분 간 최소거리로 계산한다. 경로 진행 순서로 정렬.
export function analyze(coords: Pt[], obstacles: Obstacle[], radiusM: number): Hit[] {
  if (coords.length < 2) return []
  const pr = makeProj(coords[0])
  const R = coords.map(pr.fwd)
  const cum = [0]
  for (let i = 1; i < R.length; i++) cum.push(cum[i - 1] + Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]))
  const hits: Hit[] = []
  for (const o of obstacles) {
    if (o.path.length === 0) continue
    const O = o.path.map(pr.fwd)
    let best: { d: number; i: number; ta: number; q: V } | null = null
    const upd = (d: number, i: number, ta: number, q: V) => {
      if (!best || d < best.d) best = { d, i, ta, q }
    }
    if (o.kind === 'point') {
      for (let i = 0; i < R.length - 1; i++) {
        const r = pointSeg(O[0], R[i], R[i + 1])
        upd(r.d, i, r.t, O[0])
      }
    } else if (o.kind === 'line') {
      for (let i = 0; i < R.length - 1; i++)
        for (let j = 0; j < O.length - 1; j++) {
          const r = segSeg(R[i], R[i + 1], O[j], O[j + 1])
          upd(r.d, i, r.ta, r.pb)
        }
    } else {
      for (let i = 0; i < R.length - 1; i++) {
        if (inside(R[i], O)) {
          upd(0, i, 0, R[i])
          continue
        }
        for (let j = 0; j < O.length; j++) {
          const r = segSeg(R[i], R[i + 1], O[j], O[(j + 1) % O.length])
          upd(r.d, i, r.ta, r.pa)
        }
      }
    }
    const b = best as { d: number; i: number; ta: number; q: V } | null
    if (!b || b.d > radiusM) continue
    const segLen = Math.hypot(R[b.i + 1][0] - R[b.i][0], R[b.i + 1][1] - R[b.i][1])
    hits.push({ o, role: roleOf(o), distM: Math.round(b.d * 10) / 10, atM: cum[b.i] + b.ta * segLen, anchor: pr.inv(b.q), segIdx: b.i })
  }
  return hits.sort((a, b) => a.atM - b.atM)
}

// 경로를 따라 s(m) 지점에서 수직으로 m(m) 떨어진 점(m>0은 진행 방향 왼쪽)
function offsetAt(coords: Pt[], s: number, m: number): Pt | null {
  const pr = makeProj(coords[0])
  const R = coords.map(pr.fwd)
  let acc = 0
  const target = Math.max(0, s)
  for (let i = 0; i < R.length - 1; i++) {
    const len = Math.hypot(R[i + 1][0] - R[i][0], R[i + 1][1] - R[i][1])
    if (len === 0) continue
    if (acc + len >= target || i === R.length - 2) {
      const t = Math.min(1, (target - acc) / len)
      const px = R[i][0] + t * (R[i + 1][0] - R[i][0])
      const py = R[i][1] + t * (R[i + 1][1] - R[i][1])
      const dx = (R[i + 1][0] - R[i][0]) / len
      const dy = (R[i + 1][1] - R[i][1]) / len
      const p = pr.inv([px - dy * m, py + dx * m])
      return [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]
    }
    acc += len
  }
  return null
}

export type AttemptStep =
  | { kind: 'single'; m: number } // X 지점에서 경로 수직으로 ±m 떨어진 경유지 1개
  | { kind: 'pair'; d: number; m: number } // X 앞뒤 경로를 따라 d만큼 떨어진 두 지점을 같은 쪽으로 m 옮긴 경유지 2개(평행한 다른 길 유도)
  | { kind: 'option'; opt: number } // 경유지 없이 TMAP searchOption(4 추천+대로우선, 10 최단, 30 최단+계단 제외)만 바꿈
export type Spec = { label: string; via: Pt[]; opt?: number }

// 한 X에 대한 시도 목록. 계획(config의 attemptPlan) 순서대로, 경유지 방식은 +쪽·−쪽 번갈아.
export function planAttempts(hit: Hit, coords: Pt[], plan: AttemptStep[], curOpt?: number): Spec[] {
  const out: Spec[] = []
  for (const st of plan) {
    if (st.kind === 'option') {
      if (st.opt !== curOpt) out.push({ label: `searchOption ${st.opt}`, via: [], opt: st.opt })
      continue
    }
    for (const sg of [1, -1]) {
      const sign = sg > 0 ? '+' : '-'
      if (st.kind === 'single') {
        const p = offsetAt(coords, hit.atM, st.m * sg)
        // X 지점(경로 최근접점이 아니라 X 자체)에서 수직: atM 기준 경로점에서 옮긴다
        if (p) out.push({ label: `${sign}${st.m}m`, via: [p] })
      } else {
        const a = offsetAt(coords, hit.atM - st.d, st.m * sg)
        const b = offsetAt(coords, hit.atM + st.d, st.m * sg)
        if (a && b) out.push({ label: `쌍 ±${st.d}m ${sign}${st.m}m`, via: [a, b] })
      }
    }
  }
  return out
}

export const viaKey = (via: Pt[], opt?: number) => via.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join('_') + (opt ? `|o${opt}` : '')

// TMAP 보행자 경로 응답(GeoJSON) → 경로. 좌표는 [위도, 경도].
export function parseTmap(json: unknown): RouteData | null {
  const fs = (json as { features?: unknown })?.features
  if (!Array.isArray(fs)) return null
  let distance = 0
  let time = 0
  const coords: Pt[] = []
  for (const f of fs as { properties?: { totalDistance?: number; totalTime?: number }; geometry?: { type?: string; coordinates?: number[][] } }[]) {
    const p = f.properties
    if (p && typeof p.totalDistance === 'number' && distance === 0) {
      distance = p.totalDistance
      time = typeof p.totalTime === 'number' ? p.totalTime : 0
    }
    if (f.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates)) {
      for (const c of f.geometry.coordinates) {
        const pt: Pt = [Math.round(c[1] * 1e6) / 1e6, Math.round(c[0] * 1e6) / 1e6]
        const last = coords[coords.length - 1]
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) coords.push(pt)
      }
    }
  }
  return coords.length >= 2 ? { distance, time, coords } : null
}

export type RouteCfg = {
  radiusM: number
  offsetsM: number[] // (표시용) 단일 경유지 거리들
  attemptPlan: AttemptStep[] // 우회 시도 순서
  maxLengthRatio: number
  maxAttempts: number // 기본 경로 요청을 포함한 경로 요청 최대 횟수
  maxVia: number
  stopRadiusM: number // 출발·도착 근처 정류장 범위
  destRadiusM: number // 도착지 건물로 보는 범위(출입 불편 판단)
}

export type AttemptResult = 'accepted' | 'still-blocked' | 'too-long' | 'new-barrier' | 'no-route' | 'not-stored' | 'at-endpoint'
export type Attempt = { targetId: string; offsetLabel: string; via: Pt[]; opt?: number; result: AttemptResult }

// 근처 정류장(버스 타기 불편, boarding): 경로 위(route) 또는 출발·도착 근처(start·end). 걸어서 지나가는 경로의 판정에는 넣지 않는다.
export type NearStop = { o: Obstacle; distM: number; where: 'route' | 'start' | 'end' }

export type Verdict = 'pass' | 'caution' | 'blocked'
export const VERDICT_LABEL: Record<Verdict, string> = { pass: '통과 가능', caution: '주의', blocked: '어려움' }

export type RouteSummary = {
  verdict: Verdict // 지나가기 기준(passage·zone): X 없음&△·구역 없음=pass, △·구역만=caution, 우회 못 한 X=blocked
  blockedCount: number // 지나가기 어려운 곳(passage X, 출발·도착 지점 자체 제외)
  cautionCount: number // 주의(passage △) 곳
  zoneCount: number // 주의 구역(영역)
  boardingCount: number // 버스 타기 불편 정류장(상위 항목 기준 중복 제거)
  stops: NearStop[]
  entryDest: Hit[] // 도착지 건물의 출입 불편(entry X·△)
  entryMid: Hit[] // 경로 중간의 출입 불편 지점(정보만)
  endpointX: Hit[] // 출발·도착 지점 자체의 X(피할 수 없음, 판정 제외)
  text: string // 예: 지나가기 어려운 곳 0곳 · 주의 1곳 · 버스 타기 불편 정류장 2곳
}

export type SearchResult = {
  base: RouteData | null
  baseHits: Hit[]
  detour: RouteData | null
  detourHits: Hit[]
  via: Pt[]
  detourOption?: number // 우회 경로를 받을 때 쓴 searchOption(없으면 기본)
  unresolved: Hit[] // 마지막 경로에 남은 passage X 중 우회 시도가 모두 실패한 것(대안 경로 없음)
  untested: Hit[] // 시도 횟수 한도로 확인하지 못한 X
  endpoint: Hit[] // 출발·도착 지점 자체(반경 안)의 X: 경로로 피할 수 없어 우회 대상도 '대안 경로 없음' 기록 대상도 아니다
  attempts: Attempt[]
  requests: number
  summary: { base: RouteSummary | null; detour: RouteSummary | null }
  error?: string
}

// ignoreIds: 출발·도착 지점 자체의 장애요소(경고로 따로 보여 주고 판정에서는 뺀다). X·△·Z(지나가기 기준)만 판정에 쓴다.
export function verdictOf(hits: Hit[], ignoreIds: string[] = []): Verdict {
  hits = hits.filter((h) => !ignoreIds.includes(h.o.id))
  if (hits.some((h) => h.role === 'X')) return 'blocked'
  if (hits.some((h) => h.role === 'T' || h.role === 'Z')) return 'caution'
  return 'pass'
}

export function nearStops(coords: Pt[], obstacles: Obstacle[], cfg: Pick<RouteCfg, 'radiusM' | 'stopRadiusM'>): NearStop[] {
  const start = coords[0]
  const end = coords[coords.length - 1]
  const out: NearStop[] = []
  for (const o of obstacles) {
    if (o.impact !== 'boarding' || o.path.length === 0 || !(o.rating === 'X' || o.rating === 'TRIANGLE')) continue
    const dr = Math.min(...o.path.map((q) => distToRoute(coords, q)))
    if (dr <= cfg.radiusM) {
      out.push({ o, distM: Math.round(dr), where: 'route' })
      continue
    }
    const ds = Math.min(...o.path.map((q) => distM(start, q)))
    const de = Math.min(...o.path.map((q) => distM(end, q)))
    if (Math.min(ds, de) <= cfg.stopRadiusM) out.push(ds <= de ? { o, distM: Math.round(ds), where: 'start' } : { o, distM: Math.round(de), where: 'end' })
  }
  return out.sort((a, b) => a.distM - b.distM)
}

export function summarize(coords: Pt[], hits: Hit[], obstacles: Obstacle[], endpointIds: string[], cfg: RouteCfg): RouteSummary {
  const end = coords[coords.length - 1]
  const mid = hits.filter((h) => !endpointIds.includes(h.o.id))
  const stops = nearStops(coords, obstacles, cfg)
  const entry = hits.filter((h) => h.role === 'E')
  const entryDest = entry.filter((h) => distM(h.anchor, end) <= cfg.destRadiusM)
  const entryMid = entry.filter((h) => !entryDest.includes(h))
  const blockedCount = mid.filter((h) => h.role === 'X').length
  const cautionCount = mid.filter((h) => h.role === 'T').length
  const zoneCount = mid.filter((h) => h.role === 'Z').length
  const boardingCount = new Set(stops.map((s) => s.o.parentId ?? s.o.id)).size
  const verdict = verdictOf(hits, endpointIds)
  const text =
    `지나가기 어려운 곳 ${blockedCount}곳 · 주의 ${cautionCount + zoneCount}곳 · 버스 타기 불편 정류장 ${boardingCount}곳` + (entryDest.length > 0 ? ' · 도착지 출입 불편' : '')
  return { verdict, blockedCount, cautionCount, zoneCount, boardingCount, stops, entryDest, entryMid, endpointX: hits.filter((h) => endpointIds.includes(h.o.id)), text }
}

// fetchRoute(via, opt): null이면 경로를 얻지 못한 것(오류), 'not-stored'이면 저장본에 없는 조합.
export async function searchRoute(opts: {
  obstacles: Obstacle[]
  cfg: RouteCfg
  fetchRoute: (via: Pt[], opt?: number) => Promise<RouteData | null | 'not-stored'>
}): Promise<SearchResult> {
  const { obstacles, cfg, fetchRoute } = opts
  const res: SearchResult = { base: null, baseHits: [], detour: null, detourHits: [], via: [], unresolved: [], untested: [], endpoint: [], attempts: [], requests: 0, summary: { base: null, detour: null } }
  const b0 = await fetchRoute([])
  res.requests = 1
  if (!b0 || b0 === 'not-stored') {
    res.error = b0 === 'not-stored' ? '미리 저장된 경로가 없습니다.' : '경로를 받지 못했습니다.'
    return res
  }
  const base = b0
  res.base = base
  res.baseHits = analyze(base.coords, obstacles, cfg.radiusM)

  let cur = base
  let curHits = res.baseHits
  let acc: Pt[] = []
  let curOpt: number | undefined
  const failed = new Set<string>()
  const endpointIds = new Set<string>()
  let exhausted = false
  const isX = (h: Hit) => h.role === 'X' // 우회 대상은 지나가기 어려운 곳(passage X)만
  // 같은 상위 항목의 하위 점(예: 양쪽 정류장)은 한 곳으로 본다: 한쪽을 피해 반대쪽으로 지나가는 것은 우회가 아니다
  const gk = (h: Hit) => h.o.parentId ?? h.o.id
  const atEnds = (h: Hit, c: RouteData) => distM(h.anchor, c.coords[0]) <= cfg.radiusM || distM(h.anchor, c.coords[c.coords.length - 1]) <= cfg.radiusM

  while (!exhausted) {
    const target = curHits.find((h) => isX(h) && !failed.has(gk(h)))
    if (!target) break
    // 출발·도착 지점 자체가 X이면 어떤 경로도 그 곳을 지나므로 우회를 시도하지 않는다(요청도 쓰지 않는다)
    if (atEnds(target, cur)) {
      res.attempts.push({ targetId: target.o.id, offsetLabel: '-', via: [], result: 'at-endpoint' })
      failed.add(gk(target))
      endpointIds.add(gk(target))
      continue
    }
    const curX = new Set(curHits.filter(isX).map(gk))
    let accepted = false
    for (const spec of planAttempts(target, cur.coords, cfg.attemptPlan, curOpt)) {
      if (acc.length + spec.via.length > cfg.maxVia) continue
      if (res.requests >= cfg.maxAttempts) {
        exhausted = true
        break
      }
      const via = [...acc, ...spec.via].sort((p, q) => alongM(base.coords, p) - alongM(base.coords, q))
      const opt = spec.opt ?? curOpt
      res.requests++
      const r = await fetchRoute(via, opt)
      const at = (result: AttemptResult) => res.attempts.push({ targetId: target.o.id, offsetLabel: spec.label, via, ...(opt ? { opt } : {}), result })
      if (r === 'not-stored') {
        at('not-stored')
        continue
      }
      if (!r) {
        at('no-route')
        continue
      }
      const h = analyze(r.coords, obstacles, cfg.radiusM)
      if (h.some((x) => isX(x) && gk(x) === gk(target))) {
        at('still-blocked')
        continue
      }
      if (r.distance > base.distance * cfg.maxLengthRatio) {
        at('too-long')
        continue
      }
      if (h.some((x) => isX(x) && !curX.has(gk(x)))) {
        at('new-barrier')
        continue
      }
      at('accepted')
      cur = r
      curHits = h
      acc = via
      curOpt = opt
      accepted = true
      break
    }
    if (!accepted) {
      if (exhausted) break
      failed.add(gk(target))
    }
  }

  if (acc.length > 0 || curOpt) {
    res.detour = cur
    res.detourHits = curHits
    res.via = acc
    if (curOpt) res.detourOption = curOpt
  }
  const rest = curHits.filter(isX)
  res.endpoint = rest.filter((h) => endpointIds.has(gk(h)))
  res.unresolved = rest.filter((h) => failed.has(gk(h)) && !endpointIds.has(gk(h)))
  res.untested = rest.filter((h) => !failed.has(gk(h)))
  const baseEndpoint = res.baseHits.filter((h) => isX(h) && atEnds(h, base)).map((h) => h.o.id)
  res.summary.base = summarize(base.coords, res.baseHits, obstacles, baseEndpoint, cfg)
  if (res.detour) res.summary.detour = summarize(res.detour.coords, res.detourHits, obstacles, res.endpoint.map((h) => h.o.id), cfg)
  return res
}

export function pathLenM(coords: Pt[]): number {
  let s = 0
  for (let i = 1; i < coords.length; i++) s += distM(coords[i - 1], coords[i])
  return s
}
