// 자체 보행망(OpenStreetMap) 만들기와 읽기. 브라우저와 Node(scripts/buildWalkGraph.ts, 테스트)가 같은 코드를 쓰도록 의존성 없이 작성했다.
// 자료 출처: © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright)
// 태그 뜻: highway=steps / footway=crossing·sidewalk / kerb=* / wheelchair=* / incline=* — OSM 위키(보고서의 출처 목록 참고)

// 길 한 토막(edge)의 성질 비트
export const M = {
  STEPS: 1, // highway=steps(계단). conveying=yes(에스컬레이터)도 휠체어로는 못 타서 같이 본다
  CROSSING: 2, // footway=crossing(횡단보도)
  ROAD: 4, // 차도(보도 없이 도로를 걷는 길): residential·service·tertiary 등
  ROUGH: 8, // 비포장·거친 노면(dirt·unpaved·gravel·sett·grass 등)
  WC_NO: 16, // wheelchair=no
  WC_YES: 32, // wheelchair=yes·designated
  WC_LIMITED: 64, // wheelchair=limited
  MAJOR: 128, // 큰 도로(primary·secondary·tertiary와 link)
  SERVICE: 256, // 단지·주차장 안길(highway=service)
  SIDEWALK: 512, // footway=sidewalk
  INDOOR: 1024, // 건물 안 통로(indoor·corridor)
} as const

// 노드(점) 성질: kerb=raised·rolled·yes 이거나 barrier=kerb(높이 모름)이면 턱 있음, kerb=lowered·flush는 턱 낮춤
export const NK = { KERB_HIGH: 1, KERB_LOW: 2, GATE: 4 } as const

export type OsmEl = {
  type: 'node' | 'way'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  tags?: Record<string, string>
}

// 저장 형식(JSON): 좌표는 1e-5도(약 1m) 정수. 길 토막은 [시작점번호, 끝점번호, 성질비트, 경사%, 중간점들(직전 점과의 차이를 평평하게)]
export type WalkGraphFile = {
  v: 1
  source: string
  fetchedAt: string
  bbox: [number, number, number, number] // 남, 서, 북, 동
  q: number
  n: number[] // [lat5, lng5, ...]
  nk: Record<string, number> // 노드번호 → NK 비트
  e: [number, number, number, number, number[]][]
}

const WALK_HIGHWAY = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'living_street', 'residential', 'service', 'unclassified',
  'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'trunk', 'trunk_link', 'track', 'cycleway', 'corridor',
])
const ROUGH_SURFACE = new Set(['dirt', 'unpaved', 'gravel', 'sett', 'grass', 'ground', 'sand', 'mud', 'earth', 'fine_gravel', 'cobblestone', 'pebblestone', 'compacted', 'woodchips'])
const Q = 1e5

export function wayMask(t: Record<string, string>): number {
  const hw = t.highway
  let m = 0
  if (hw === 'steps') m |= M.STEPS
  if (t.conveying === 'yes' || t.conveying === 'forward' || t.conveying === 'backward') m |= M.STEPS
  if (t.footway === 'crossing' || t.cycleway === 'crossing') m |= M.CROSSING
  if (t.footway === 'sidewalk') m |= M.SIDEWALK
  if (['residential', 'living_street', 'unclassified', 'service', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'trunk', 'trunk_link', 'track'].includes(hw)) m |= M.ROAD
  if (['tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'trunk', 'trunk_link'].includes(hw)) m |= M.MAJOR
  if (hw === 'service') m |= M.SERVICE
  if (t.surface && ROUGH_SURFACE.has(t.surface)) m |= M.ROUGH
  if (hw === 'track' || t.tracktype) m |= M.ROUGH
  if (t.wheelchair === 'no') m |= M.WC_NO
  else if (t.wheelchair === 'yes' || t.wheelchair === 'designated') m |= M.WC_YES
  else if (t.wheelchair === 'limited') m |= M.WC_LIMITED
  if (t.indoor === 'yes' || hw === 'corridor') m |= M.INDOOR
  return m
}

// incline=* 가 "10%"·"-8%"처럼 숫자일 때만 읽는다(up·down만 있는 값은 크기를 몰라 버린다)
export function parseIncline(v: string | undefined): number {
  if (!v) return 0
  const m = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(v.trim())
  return m ? Math.round(Number(m[1])) : 0
}

function nodeBits(t: Record<string, string> | undefined): number {
  if (!t) return 0
  let b = 0
  const kerb = t.kerb
  if (kerb === 'raised' || kerb === 'rolled' || kerb === 'yes') b |= NK.KERB_HIGH
  else if (kerb === 'lowered' || kerb === 'flush') b |= NK.KERB_LOW
  else if (t.barrier === 'kerb') b |= NK.KERB_HIGH // 높이 모르는 턱은 높다고 본다(안전 쪽)
  if (t.barrier === 'gate' || t.barrier === 'lift_gate' || t.barrier === 'hampshire_gate') b |= NK.GATE
  return b
}

// Overpass 응답(elements) → 저장 형식. 걸을 수 있는 길만 남기고, 교차점·끝점·턱 점으로 토막 낸다.
export function buildWalkGraph(elements: OsmEl[], bbox: [number, number, number, number], meta: { source: string; fetchedAt: string }): WalkGraphFile {
  const pos = new Map<number, [number, number]>()
  const ntags = new Map<number, Record<string, string>>()
  for (const e of elements) {
    if (e.type === 'node' && e.lat != null && e.lon != null) {
      pos.set(e.id, [e.lat, e.lon])
      if (e.tags) ntags.set(e.id, e.tags)
    }
  }
  const ways = elements.filter((e): e is OsmEl & { nodes: number[]; tags: Record<string, string> } => e.type === 'way' && !!e.nodes && !!e.tags && WALK_HIGHWAY.has(e.tags.highway))
  const usable = ways.filter((w) => {
    const t = w.tags
    if (t.foot === 'no' || t.access === 'no' || t.access === 'private' || t.foot === 'private') return false
    if (t.highway === 'cycleway' && t.foot !== 'yes' && t.foot !== 'designated') return false
    return true
  })
  const count = new Map<number, number>()
  for (const w of usable) {
    for (const id of w.nodes) count.set(id, (count.get(id) ?? 0) + 1)
  }
  const keep = (id: number, idx: number, len: number) => idx === 0 || idx === len - 1 || (count.get(id) ?? 0) > 1 || nodeBits(ntags.get(id)) !== 0
  const nodeIndex = new Map<number, number>()
  const n: number[] = []
  const nk: Record<string, number> = {}
  const idx = (id: number) => {
    let i = nodeIndex.get(id)
    if (i === undefined) {
      const p = pos.get(id) as [number, number]
      i = n.length / 2
      n.push(Math.round(p[0] * Q), Math.round(p[1] * Q))
      nodeIndex.set(id, i)
      const b = nodeBits(ntags.get(id))
      if (b) nk[String(i)] = b
    }
    return i
  }
  const e: WalkGraphFile['e'] = []
  for (const w of usable) {
    if (w.nodes.some((id) => !pos.has(id))) continue
    const mask = wayMask(w.tags)
    const inc = parseIncline(w.tags.incline)
    let last = 0
    for (let k = 1; k < w.nodes.length; k++) {
      if (!keep(w.nodes[k], k, w.nodes.length)) continue
      const a = w.nodes[last]
      const b = w.nodes[k]
      const ia = idx(a)
      const ib = idx(b)
      if (ia !== ib) {
        const shape: number[] = []
        let pl = n[ia * 2]
        let pg = n[ia * 2 + 1]
        for (let j = last + 1; j < k; j++) {
          const p = pos.get(w.nodes[j]) as [number, number]
          const la = Math.round(p[0] * Q)
          const lo = Math.round(p[1] * Q)
          shape.push(la - pl, lo - pg)
          pl = la
          pg = lo
        }
        e.push([ia, ib, mask, inc, shape])
      }
      last = k
    }
  }
  return { v: 1, source: meta.source, fetchedAt: meta.fetchedAt, bbox, q: Q, n, nk, e }
}

// ───────── 읽은 뒤 쓰는 모양 ─────────
const M_LAT = 111320

export type WEdge = {
  a: number
  b: number
  mask: number
  inc: number
  len: number
  x: number[] // 평면 좌표(m) 점들
  y: number[]
  bb: [number, number, number, number] // 최소x, 최소y, 최대x, 최대y
}
export type WalkGraph = {
  ref: [number, number]
  kx: number
  nx: Float64Array
  ny: Float64Array
  nk: Map<number, number>
  edges: WEdge[]
  adj: number[][]
  meta: { source: string; fetchedAt: string; bbox: [number, number, number, number] }
}

export function projOf(ref: [number, number]) {
  const kx = M_LAT * Math.cos((ref[0] * Math.PI) / 180)
  return {
    kx,
    fwd: (lat: number, lng: number): [number, number] => [(lng - ref[1]) * kx, (lat - ref[0]) * M_LAT],
    inv: (x: number, y: number): [number, number] => [ref[0] + y / M_LAT, ref[1] + x / kx],
  }
}

export function makeEdge(a: number, b: number, mask: number, inc: number, x: number[], y: number[]): WEdge {
  let len = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i < x.length; i++) {
    if (i > 0) len += Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1])
    x0 = Math.min(x0, x[i])
    y0 = Math.min(y0, y[i])
    x1 = Math.max(x1, x[i])
    y1 = Math.max(y1, y[i])
  }
  return { a, b, mask, inc, len, x, y, bb: [x0, y0, x1, y1] }
}

export function loadWalkGraph(f: WalkGraphFile): WalkGraph {
  const ref: [number, number] = [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2]
  const pr = projOf(ref)
  const N = f.n.length / 2
  const nx = new Float64Array(N)
  const ny = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const [x, y] = pr.fwd(f.n[i * 2] / f.q, f.n[i * 2 + 1] / f.q)
    nx[i] = x
    ny[i] = y
  }
  const edges: WEdge[] = []
  const adj: number[][] = Array.from({ length: N }, () => [])
  for (const [a, b, mask, inc, shape] of f.e) {
    const x = [nx[a]]
    const y = [ny[a]]
    let la = f.n[a * 2]
    let lo = f.n[a * 2 + 1]
    for (let i = 0; i < shape.length; i += 2) {
      la += shape[i]
      lo += shape[i + 1]
      const [px, py] = pr.fwd(la / f.q, lo / f.q)
      x.push(px)
      y.push(py)
    }
    x.push(nx[b])
    y.push(ny[b])
    const id = edges.length
    edges.push(makeEdge(a, b, mask, inc, x, y))
    adj[a].push(id)
    adj[b].push(id)
  }
  const nk = new Map<number, number>()
  for (const [k, v] of Object.entries(f.nk)) nk.set(Number(k), v)
  return { ref, kx: pr.kx, nx, ny, nk, edges, adj, meta: { source: f.source, fetchedAt: f.fetchedAt, bbox: f.bbox } }
}
