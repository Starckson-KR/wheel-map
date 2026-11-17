// 턴바이턴 안내: 경로선을 "직진·좌회전·우회전 + 거리" 단계로 나눈다. 순수 함수라 브라우저와 Node 테스트가 같이 쓴다.
import { alongM, type Hit, type Obstacle, type Pt } from './engine.ts'
import { M } from './walkGraph.ts'

export type Turn = 'straight' | 'slight-left' | 'left' | 'sharp-left' | 'slight-right' | 'right' | 'sharp-right' | 'uturn'
export type StepKind = 'depart' | 'turn' | 'crossing' | 'stairs' | 'arrive'
export type StepNote = { kind: 'avoid'; o: Obstacle } | { kind: 'hit'; o: Obstacle; role: 'X' | 'T' }
export type Step = {
  kind: StepKind
  turn: Turn
  title: string // 예: 좌회전, 횡단보도 건너기
  startM: number
  endM: number
  distM: number
  at: Pt // 이 단계가 시작하는 지점(꺾는 곳)
  coords: Pt[] // 이 단계의 경로선(지도에서 강조)
  notes: StepNote[]
}

const M_LAT = 111320
const LOOK_M = 15 // 꺾임을 재는 앞뒤 거리
const MIN_TURN_DEG = 35 // 이보다 덜 꺾이면 직진으로 본다
const MIN_STEP_M = 8 // 이보다 짧은 단계는 앞 단계에 합친다(횡단보도·계단 제외)

export const TURN_TITLE: Record<Turn, string> = {
  straight: '직진',
  'slight-left': '왼쪽 방향',
  left: '좌회전',
  'sharp-left': '왼쪽으로 크게 돌기',
  'slight-right': '오른쪽 방향',
  right: '우회전',
  'sharp-right': '오른쪽으로 크게 돌기',
  uturn: '뒤로 돌기',
}

export function turnOf(deg: number): Turn {
  const a = Math.abs(deg)
  if (a < MIN_TURN_DEG) return 'straight'
  const left = deg < 0
  if (a >= 165) return 'uturn'
  if (a >= 125) return left ? 'sharp-left' : 'sharp-right'
  if (a >= 60) return left ? 'left' : 'right'
  return left ? 'slight-left' : 'slight-right'
}

const norm = (d: number) => {
  while (d > 180) d -= 360
  while (d <= -180) d += 360
  return d
}

// 길 위에서 거리 s(m) 지점의 점(xy)
function pointAt(X: number[], Y: number[], cum: number[], s: number): [number, number] {
  if (s <= 0) return [X[0], Y[0]]
  if (s >= cum[cum.length - 1]) return [X[X.length - 1], Y[Y.length - 1]]
  let i = 1
  while (cum[i] < s) i++
  const L = cum[i] - cum[i - 1]
  const t = L > 0 ? (s - cum[i - 1]) / L : 0
  return [X[i - 1] + t * (X[i] - X[i - 1]), Y[i - 1] + t * (Y[i] - Y[i - 1])]
}

export function buildSteps(coords: Pt[], seg: number[] | undefined, hits: Hit[], avoided: Hit[] = []): Step[] {
  const n = coords.length
  if (n < 2) return []
  const kx = M_LAT * Math.cos((coords[0][0] * Math.PI) / 180)
  const X = coords.map((p) => (p[1] - coords[0][1]) * kx)
  const Y = coords.map((p) => (p[0] - coords[0][0]) * M_LAT)
  const cum = [0]
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]))
  const total = cum[n - 1]
  const bearing = (ax: number, ay: number, bx: number, by: number) => (Math.atan2(bx - ax, by - ay) * 180) / Math.PI

  // 1) 꺾임 후보: 각 꼭짓점에서 앞 LOOK_M 지점→꼭짓점, 꼭짓점→뒤 LOOK_M 지점의 방향 차이
  type Cand = { s: number; deg: number }
  const cands: Cand[] = []
  for (let i = 1; i < n - 1; i++) {
    const [bx, by] = pointAt(X, Y, cum, cum[i] - LOOK_M)
    const [ax, ay] = pointAt(X, Y, cum, cum[i] + LOOK_M)
    if (Math.hypot(X[i] - bx, Y[i] - by) < 3 || Math.hypot(ax - X[i], ay - Y[i]) < 3) continue
    const deg = norm(bearing(X[i], Y[i], ax, ay) - bearing(bx, by, X[i], Y[i]))
    if (Math.abs(deg) >= MIN_TURN_DEG) cands.push({ s: cum[i], deg })
  }
  // 이어진 후보(굽은 길)는 가장 많이 꺾이는 한 곳만
  const turns: Cand[] = []
  for (const c of cands) {
    const last = turns[turns.length - 1]
    if (last && c.s - last.s < LOOK_M * 1.5) {
      if (Math.abs(c.deg) > Math.abs(last.deg)) turns[turns.length - 1] = c
    } else turns.push(c)
  }

  // 2) 횡단보도·계단 구간 경계
  type Special = { kind: 'crossing' | 'stairs'; s0: number; s1: number }
  const specials: Special[] = []
  if (seg) {
    let cur: Special | null = null
    for (let i = 0; i < n - 1; i++) {
      const m = seg[i] ?? 0
      const k: 'crossing' | 'stairs' | null = m & M.STEPS ? 'stairs' : m & M.CROSSING ? 'crossing' : null
      if (k && cur && cur.kind === k) cur.s1 = cum[i + 1]
      else {
        if (cur) specials.push(cur)
        cur = k ? { kind: k, s0: cum[i], s1: cum[i + 1] } : null
      }
    }
    if (cur) specials.push(cur)
  }

  // 3) 경계 모으기(거리 순). 특수 구간 안의 꺾임은 버린다.
  type Brk = { s: number; kind: 'turn' | 'crossing' | 'stairs' | 'after'; deg: number }
  const brks: Brk[] = []
  for (const t of turns) if (!specials.some((sp) => t.s > sp.s0 - 1 && t.s < sp.s1 + 1)) brks.push({ s: t.s, kind: 'turn', deg: t.deg })
  for (const sp of specials) {
    brks.push({ s: sp.s0, kind: sp.kind, deg: 0 })
    if (sp.s1 < total - 0.5) brks.push({ s: sp.s1, kind: 'after', deg: 0 })
  }
  brks.sort((a, b) => a.s - b.s)
  // 너무 가까운 경계: 앞 것이 특수·꺾임이면 뒤 꺾임을 버린다
  const kept: Brk[] = []
  for (const b of brks) {
    const last = kept[kept.length - 1]
    if (last && b.s - last.s < MIN_STEP_M && last.kind !== 'crossing' && last.kind !== 'stairs' && b.kind === 'turn') {
      if (last.kind === 'turn' && Math.abs(b.deg) > Math.abs(last.deg)) kept[kept.length - 1] = b
      continue
    }
    if (last && b.s - last.s < 0.5) continue
    kept.push(b)
  }

  // 4) 단계 만들기
  const steps: Step[] = []
  const starts: Brk[] = [{ s: 0, kind: 'after', deg: 0 }, ...kept]
  const latlng = (s: number): Pt => {
    const [x, y] = pointAt(X, Y, cum, s)
    return [coords[0][0] + y / M_LAT, coords[0][1] + x / kx]
  }
  const slice = (s0: number, s1: number): Pt[] => {
    const out: Pt[] = [latlng(s0)]
    for (let i = 1; i < n - 1; i++) if (cum[i] > s0 + 0.01 && cum[i] < s1 - 0.01) out.push(coords[i])
    out.push(latlng(s1))
    return out
  }
  for (let i = 0; i < starts.length; i++) {
    const b = starts[i]
    const s0 = b.s
    const s1 = i + 1 < starts.length ? starts[i + 1].s : total
    if (s1 - s0 < 0.5 && i > 0) continue
    let kind: StepKind = 'turn'
    let turn: Turn = 'straight'
    let title = TURN_TITLE.straight
    if (i === 0) {
      kind = 'depart'
      title = '출발'
    } else if (b.kind === 'crossing') {
      kind = 'crossing'
      title = '횡단보도 건너기'
    } else if (b.kind === 'stairs') {
      kind = 'stairs'
      title = '계단'
    } else if (b.kind === 'turn') {
      turn = turnOf(b.deg)
      title = TURN_TITLE[turn]
    } else {
      title = TURN_TITLE.straight
    }
    steps.push({ kind, turn, title, startM: s0, endM: s1, distM: Math.round(s1 - s0), at: latlng(s0), coords: slice(s0, s1), notes: [] })
  }
  // 도착 단계
  steps.push({ kind: 'arrive', turn: 'straight', title: '도착', startM: total, endM: total, distM: 0, at: coords[n - 1], coords: [coords[n - 1]], notes: [] })

  // 5) 장애요소 메모
  const stepAt = (s: number) => {
    for (let i = 0; i < steps.length - 1; i++) if (s >= steps[i].startM - 0.01 && s < steps[i].endM + 0.01) return i
    return steps.length - 1
  }
  for (const h of hits) {
    if (h.role !== 'X' && h.role !== 'T') continue
    steps[stepAt(h.atM)].notes.push({ kind: 'hit', o: h.o, role: h.role })
  }
  for (const h of avoided) steps[stepAt(alongM(coords, h.anchor))].notes.push({ kind: 'avoid', o: h.o })
  return steps
}

// 지금 위치(경로 위 진행 거리)가 속한 단계 번호
export function stepIndexAt(steps: Step[], along: number): number {
  for (let i = 0; i < steps.length - 1; i++) if (along < steps[i].endM) return i
  return Math.max(0, steps.length - 1)
}

export const fmtStepDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.max(5, Math.round(m / 5) * 5)}m`)

// 안내 문장(해요체). 화면 문구는 여기 한 곳에 둔다.
export function stepText(s: Step): { title: string; sub: string } {
  switch (s.kind) {
    case 'depart':
      return { title: '출발', sub: `${fmtStepDist(s.distM)} 가요` }
    case 'crossing':
      return { title: '횡단보도 건너기', sub: `${Math.max(1, Math.round(s.distM))}m 건너요` }
    case 'stairs':
      return { title: '계단이 있어요', sub: `${fmtStepDist(s.distM)} 구간이에요` }
    case 'arrive':
      return { title: '도착', sub: '목적지에 도착했어요' }
    default:
      return { title: s.title, sub: `${fmtStepDist(s.distM)} 가요` }
  }
}

