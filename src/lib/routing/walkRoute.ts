// 자체 보행망 위의 경로 탐색(A*). 브라우저와 Node가 같은 코드를 쓴다. 키·서버 없이 동작한다.
// 길 토막 비용 = 길이 × 길 종류 가중치 + 고정 벌점(횡단·턱·계단 등) + 장애요소 벌점(팀 조사 지점·검증된 시민 제보).
// 가중치 숫자는 이 팀이 정한 설계값이다(OSM이 정한 값이 아님). 바꿀 곳: src/lib/config.ts의 WALK_CFG.
import type { Obstacle, Pt, RouteData } from './engine.ts'
import { makeEdge, M, NK, projOf, type WalkGraph, type WEdge } from './walkGraph.ts'

export type WalkCfg = {
  obstacleRadiusM: number // 장애요소가 이 거리 안의 길 토막에 영향을 준다(경로 검사 반경과 같게 둔다)
  penaltyX: number // 지나가기 어려움(X) 곳을 지나는 길 토막에 더하는 벌점(m). 사실상 통과 금지
  penaltyT: number // 주의(△) 곳을 지나는 길 토막에 더하는 벌점(m)
  penaltyStepsM: number // 계단·휠체어 불가(wheelchair=no) 길 토막 고정 벌점(m)
  penaltyKerbM: number // 높은 턱(kerb=raised·rolled·yes, barrier=kerb) 지점을 지날 때 벌점(m)
  crossingM: number // 횡단보도 하나를 건널 때 더하는 거리(m)(신호 기다림·차도 건너기)
  roadMajorMult: number // 큰 차도 길이 배수
  roadServiceMult: number // 단지 안길 길이 배수
  roadOtherMult: number // 그 밖 차도 길이 배수
  roughMult: number // 거친 노면 추가 배수
  wcLimitedMult: number // wheelchair=limited 추가 배수
  wcYesMult: number // wheelchair=yes 배수(1 이하)
  inclineWarnPct: number // 이 경사(%) 이상이면 가파른 길로 본다(국내 경사로 기준 1/12=8.3%)
  snapMaxM: number // 출발·도착이 보행망에서 이 거리 넘게 떨어져 있으면 못 찾는다
  walkSpeedMs: number // 시간 계산용 속도(m/s). TMAP 시연 경로의 거리÷시간(약 1.37)에 맞춤
  maxDetourRatio: number // 피해 가는 길이 기본 길의 몇 배까지 허용
}

export type OwnRoute = RouteData & {
  seg: number[] // 경로선 각 구간(coords[i]→coords[i+1])의 길 성질 비트(walkGraph의 M)
  stepsM: number // 계단 구간 길이(m)
  kerbCount: number // 지난 높은 턱 지점 수
}
export type WalkResult = { route: OwnRoute | null; error?: 'outside' | 'no-path' }

type Snap = { edge: number; seg: number; x: number; y: number; dist: number; s: number }
const round6 = (v: number) => Math.round(v * 1e6) / 1e6

function ptSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * dx
  const qy = ay + t * dy
  return { d: Math.hypot(px - qx, py - qy), t, qx, qy }
}

function snapTo(g: WalkGraph, x: number, y: number, maxM: number): Snap | null {
  let best: Snap | null = null
  for (let ei = 0; ei < g.edges.length; ei++) {
    const e = g.edges[ei]
    if (x < e.bb[0] - maxM || x > e.bb[2] + maxM || y < e.bb[1] - maxM || y > e.bb[3] + maxM) continue
    if (e.mask & (M.INDOOR)) continue // 건물 안 통로에는 붙이지 않는다
    let acc = 0
    for (let i = 0; i < e.x.length - 1; i++) {
      const L = Math.hypot(e.x[i + 1] - e.x[i], e.y[i + 1] - e.y[i])
      const r = ptSeg(x, y, e.x[i], e.y[i], e.x[i + 1], e.y[i + 1])
      if (r.d <= maxM && (!best || r.d < best.dist)) best = { edge: ei, seg: i, x: r.qx, y: r.qy, dist: r.d, s: acc + r.t * L }
      acc += L
    }
  }
  return best
}

// 길 토막 e를 호 길이 s0~s1 구간으로 잘라 낸 점들
function cut(e: WEdge, s0: number, s1: number): { x: number[]; y: number[] } {
  const xs: number[] = []
  const ys: number[] = []
  const at = (s: number): [number, number] => {
    let acc = 0
    for (let i = 0; i < e.x.length - 1; i++) {
      const L = Math.hypot(e.x[i + 1] - e.x[i], e.y[i + 1] - e.y[i])
      if (acc + L >= s || i === e.x.length - 2) {
        const t = L > 0 ? Math.min(1, Math.max(0, (s - acc) / L)) : 0
        return [e.x[i] + t * (e.x[i + 1] - e.x[i]), e.y[i] + t * (e.y[i + 1] - e.y[i])]
      }
      acc += L
    }
    return [e.x[e.x.length - 1], e.y[e.y.length - 1]]
  }
  const [sx, sy] = at(s0)
  xs.push(sx)
  ys.push(sy)
  let acc = 0
  for (let i = 0; i < e.x.length - 1; i++) {
    acc += Math.hypot(e.x[i + 1] - e.x[i], e.y[i + 1] - e.y[i])
    if (acc > s0 + 0.01 && acc < s1 - 0.01) {
      xs.push(e.x[i + 1])
      ys.push(e.y[i + 1])
    }
  }
  const [ex, ey] = at(s1)
  xs.push(ex)
  ys.push(ey)
  return { x: xs, y: ys }
}

function dist2Poly(px: number, py: number, xs: number[], ys: number[]) {
  let m = Infinity
  for (let i = 0; i < xs.length - 1; i++) m = Math.min(m, ptSeg(px, py, xs[i], ys[i], xs[i + 1], ys[i + 1]).d)
  if (xs.length === 1) m = Math.hypot(px - xs[0], py - ys[0])
  return m
}

// 두 점 가까움(점 장애물은 점 대 길 토막, 선 장애물은 선분 대 선분 근사로 길 토막 점들·선 점들 양쪽에서 잰다)
function obstacleDist(o: { kind: 'point' | 'line'; x: number[]; y: number[] }, e: { x: number[]; y: number[] }): number {
  if (o.kind === 'point') return dist2Poly(o.x[0], o.y[0], e.x, e.y)
  let m = Infinity
  for (let i = 0; i < e.x.length; i++) m = Math.min(m, dist2Poly(e.x[i], e.y[i], o.x, o.y))
  for (let i = 0; i < o.x.length; i++) m = Math.min(m, dist2Poly(o.x[i], o.y[i], e.x, e.y))
  return m
}

class Heap {
  private a: [number, number][] = []
  get size() {
    return this.a.length
  }
  push(k: number, v: number) {
    const a = this.a
    a.push([k, v])
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): [number, number] {
    const a = this.a
    const top = a[0]
    const last = a.pop() as [number, number]
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < a.length && a[l][0] < a[s][0]) s = l
        if (r < a.length && a[r][0] < a[s][0]) s = r
        if (s === i) break
        ;[a[s], a[i]] = [a[i], a[s]]
        i = s
      }
    }
    return top
  }
}

// 길 종류 가중치와 고정 벌점. 장애요소 벌점은 따로 더한다.
export function edgeBaseCost(e: { mask: number; len: number; inc: number }, cfg: WalkCfg): number {
  let mult = 1
  const m = e.mask
  if (m & M.ROAD && !(m & (M.SIDEWALK | M.CROSSING))) mult = m & M.MAJOR ? cfg.roadMajorMult : m & M.SERVICE ? cfg.roadServiceMult : cfg.roadOtherMult
  if (m & M.ROUGH) mult *= cfg.roughMult
  if (m & M.WC_LIMITED) mult *= cfg.wcLimitedMult
  if (m & M.WC_YES) mult *= cfg.wcYesMult
  let c = e.len * mult
  if (m & M.CROSSING) c += cfg.crossingM
  if (m & (M.STEPS | M.WC_NO)) c += cfg.penaltyStepsM
  const inc = Math.abs(e.inc)
  if (inc >= cfg.inclineWarnPct) c += e.len * (inc >= 12 ? 3 : 1)
  return c
}

type Obs = { id: string; kind: 'point' | 'line'; x: number[]; y: number[]; penalty: number }

function obstaclesForCost(g: WalkGraph, obstacles: Obstacle[], cfg: WalkCfg, ignore: (id: string) => boolean): Obs[] {
  const pr = projOf(g.ref)
  const out: Obs[] = []
  for (const o of obstacles) {
    if (o.impact !== 'passage' || o.kind === 'area' || o.path.length === 0 || ignore(o.id)) continue
    if (o.rating !== 'X' && o.rating !== 'TRIANGLE') continue
    const xy = o.path.map((p) => pr.fwd(p[0], p[1]))
    out.push({ id: o.id, kind: o.kind === 'point' ? 'point' : 'line', x: xy.map((v) => v[0]), y: xy.map((v) => v[1]), penalty: o.rating === 'X' ? cfg.penaltyX : cfg.penaltyT })
  }
  return out
}

function obsPenalty(e: WEdge, obs: Obs[], r: number): number {
  let p = 0
  for (const o of obs) {
    const ox0 = Math.min(...o.x) - r
    const ox1 = Math.max(...o.x) + r
    const oy0 = Math.min(...o.y) - r
    const oy1 = Math.max(...o.y) + r
    if (e.bb[2] < ox0 || e.bb[0] > ox1 || e.bb[3] < oy0 || e.bb[1] > oy1) continue
    if (obstacleDist(o, e) <= r) p += o.penalty
  }
  return p
}

export type FindOpts = { avoid: boolean; obstacles?: Obstacle[]; ignoreIds?: string[] }

export function findWalkRoute(g: WalkGraph, from: Pt, to: Pt, cfg: WalkCfg, opts: FindOpts): WalkResult {
  const pr = projOf(g.ref)
  const [fx, fy] = pr.fwd(from[0], from[1])
  const [tx, ty] = pr.fwd(to[0], to[1])
  const sf = snapTo(g, fx, fy, cfg.snapMaxM)
  const st = snapTo(g, tx, ty, cfg.snapMaxM)
  if (!sf || !st) return { route: null, error: 'outside' }

  const N = g.nx.length
  const E0 = g.edges.length
  const edges: WEdge[] = g.edges.slice()
  const extraAdj = new Map<number, number[]>()
  const banned = new Set<number>()
  const nodeX: number[] = []
  const nodeY: number[] = []
  const X = (n: number) => (n < N ? g.nx[n] : nodeX[n - N])
  const Y = (n: number) => (n < N ? g.ny[n] : nodeY[n - N])
  const addAdj = (n: number, id: number) => {
    const l = extraAdj.get(n)
    if (l) l.push(id)
    else extraAdj.set(n, [id])
  }
  const adjOf = (n: number) => (n < N ? [...g.adj[n], ...(extraAdj.get(n) ?? [])] : (extraAdj.get(n) ?? []))

  // 출발·도착을 길 위의 점으로 만든다(길 토막을 자른다). 끝점에 아주 가까우면 그 점을 그대로 쓴다.
  const terminals = new Map<number, { s: number; node: number }[]>()
  const nodeFor = (sn: Snap): number => {
    const e = g.edges[sn.edge]
    if (sn.s <= 0.6) return e.a
    if (sn.s >= e.len - 0.6) return e.b
    const list = terminals.get(sn.edge) ?? []
    const same = list.find((t) => Math.abs(t.s - sn.s) < 0.01)
    if (same) return same.node
    const node = N + nodeX.length
    nodeX.push(sn.x)
    nodeY.push(sn.y)
    list.push({ s: sn.s, node })
    terminals.set(sn.edge, list)
    return node
  }
  const nStart = nodeFor(sf)
  const nEnd = nodeFor(st)
  for (const [ei, list] of terminals) {
    const e = g.edges[ei]
    banned.add(ei)
    const pts = [{ s: 0, node: e.a }, ...list.sort((p, q) => p.s - q.s), { s: e.len, node: e.b }]
    for (let i = 0; i < pts.length - 1; i++) {
      const c = cut(e, pts[i].s, pts[i + 1].s)
      // 끝점 좌표를 정확히 맞춘다
      c.x[0] = X(pts[i].node)
      c.y[0] = Y(pts[i].node)
      c.x[c.x.length - 1] = X(pts[i + 1].node)
      c.y[c.y.length - 1] = Y(pts[i + 1].node)
      const ne = makeEdge(pts[i].node, pts[i + 1].node, e.mask, e.inc, c.x, c.y)
      const id = edges.length
      edges.push(ne)
      addAdj(ne.a, id)
      addAdj(ne.b, id)
    }
  }

  // 출발·도착 근처 장애요소는 피할 수 없으니 벌점에서 뺀다
  const near = (o: Obstacle, px: number, py: number) => {
    const xy = o.path.map((p) => pr.fwd(p[0], p[1]))
    return obstacleDist({ kind: o.kind === 'point' ? 'point' : 'line', x: xy.map((v) => v[0]), y: xy.map((v) => v[1]) }, { x: [px], y: [py] }) <= cfg.obstacleRadiusM
  }
  const ignoreSet = new Set(opts.ignoreIds ?? [])
  const obs = opts.avoid && opts.obstacles ? obstaclesForCost(g, opts.obstacles, cfg, (id) => ignoreSet.has(id) || !!opts.obstacles?.find((o) => o.id === id && (near(o, fx, fy) || near(o, tx, ty)))) : []

  const cost: number[] = new Array(edges.length)
  const costOf = (id: number) => {
    let c = cost[id]
    if (c === undefined) {
      const e = edges[id]
      c = edgeBaseCost(e, cfg) + (obs.length ? obsPenalty(e, obs, cfg.obstacleRadiusM) : 0)
      cost[id] = c
    }
    return c
  }

  // A*
  const total = N + nodeX.length
  const gScore = new Float64Array(total).fill(Infinity)
  const prev = new Int32Array(total).fill(-1) // 도착한 길 토막 번호
  const closed = new Uint8Array(total)
  const ex = X(nEnd)
  const ey = Y(nEnd)
  const h = (n: number) => Math.hypot(X(n) - ex, Y(n) - ey) * Math.min(1, cfg.wcYesMult)
  const heap = new Heap()
  gScore[nStart] = 0
  heap.push(h(nStart), nStart)
  let found = nStart === nEnd
  while (heap.size > 0 && !found) {
    const [, n] = heap.pop()
    if (closed[n]) continue
    closed[n] = 1
    if (n === nEnd) {
      found = true
      break
    }
    for (const id of adjOf(n)) {
      if (id < E0 && banned.has(id)) continue
      const e = edges[id]
      const o = e.a === n ? e.b : e.a
      if (closed[o]) continue
      let c = costOf(id)
      if (o < N) {
        const k = g.nk.get(o) ?? 0
        if (k & NK.KERB_HIGH) c += cfg.penaltyKerbM
        if (k & NK.GATE) c += 5
      }
      const ng = gScore[n] + c
      if (ng < gScore[o]) {
        gScore[o] = ng
        prev[o] = id
        heap.push(ng + h(o), o)
      }
    }
  }
  if (!found) return { route: null, error: 'no-path' }

  // 경로 복원
  const chain: { id: number; from: number; to: number }[] = []
  for (let n = nEnd; n !== nStart; ) {
    const id = prev[n]
    const e = edges[id]
    const p = e.a === n ? e.b : e.a
    chain.push({ id, from: p, to: n })
    n = p
  }
  chain.reverse()
  const xs: number[] = []
  const ys: number[] = []
  const seg: number[] = []
  let stepsM = 0
  let kerbCount = 0
  const push = (x: number, y: number, mask: number) => {
    if (xs.length > 0) {
      const dx = x - xs[xs.length - 1]
      const dy = y - ys[ys.length - 1]
      if (Math.hypot(dx, dy) < 0.05) return
      seg.push(mask)
    }
    xs.push(x)
    ys.push(y)
  }
  // 출발 지점에서 길까지(길에서 많이 떨어졌을 때만 이어 붙인다)
  const lead = sf.dist > 2
  const tail = st.dist > 2
  if (lead) push(fx, fy, 0)
  for (const c of chain) {
    const e = edges[c.id]
    const fwd = e.a === c.from
    const L = e.x.length
    for (let i = 0; i < L; i++) {
      const j = fwd ? i : L - 1 - i
      push(e.x[j], e.y[j], e.mask)
    }
    if (e.mask & M.STEPS) stepsM += e.len
    if (c.to < N && (g.nk.get(c.to) ?? 0) & NK.KERB_HIGH) kerbCount++
  }
  if (chain.length === 0) push(X(nStart), Y(nStart), 0)
  if (tail) push(tx, ty, 0)
  const coords: Pt[] = xs.map((x, i) => {
    const p = pr.inv(x, ys[i])
    return [round6(p[0]), round6(p[1])]
  })
  let distance = 0
  for (let i = 1; i < xs.length; i++) distance += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
  if (coords.length < 2) coords.push([...coords[0]] as Pt)
  while (seg.length < coords.length - 1) seg.push(0)
  return { route: { distance: Math.round(distance), time: Math.round(distance / cfg.walkSpeedMs), coords, seg, stepsM: Math.round(stepsM), kerbCount } }
}
