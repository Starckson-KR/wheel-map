import type { Barrier, Rating, Report, ReportStatus } from '../types'
import { DAY } from './caseMetrics'
import { deadlineFor, findAgencies, listAgencies } from './agencyGuide'
import { REWARD_DAILY_CAP } from './config'
import { distanceM } from './geo'
import { REJECT_REASONS } from './reportTypes'

// 대규모 시연 데이터 생성(순수 함수). 가상 사용자 약 300명과 용봉동 안 실제 시설 위치에 얹은 가상 지점·제보를 만든다.
// 설계: docs/시연데이터셋_설계.md. 같은 시드·같은 now면 같은 결과. 사진·새 지도 호출 없음. 모든 건에 "(시연)"을 붙인다.

export const LARGE_SEED = 20261111
export const LARGE_USER_COUNT = 300
export const LARGE_TARGET_REPORTS = 640
export const FILE_FORMAT = 'wheelmap-demo'
export const FILE_VERSION = 1
export const FILE_MAX_BYTES = 8 * 1024 * 1024
export const BADGE_TEXT = '시연용 가상 데이터 · 실제 제보가 아니에요'

// ───── 위치 후보 ─────
export type CandidateKind = 'crosswalk' | 'bus' | 'facility'
export type Candidate = { id: string; kind: CandidateKind; name: string; lat: number; lng: number; faclType?: string }
export type PubLike = { id: string; name: string; lat: number | null; lng: number | null; address: string; fields: Record<string, unknown> }
export type AvoidPoint = { lat: number; lng: number; r: number }

const AREA_WORD = '용봉동'

// 공공데이터 3종(횡단보도·정류장·편의시설)에서 주소가 용봉동인 것만 고른다. 좌표가 없는 것은 뺀다.
export function pickCandidates(sets: { crosswalk: PubLike[]; bus: PubLike[]; facility: PubLike[] }): Candidate[] {
  const out: Candidate[] = []
  const add = (kind: CandidateKind, list: PubLike[]) => {
    for (const it of list) {
      if (it.lat === null || it.lng === null || !(it.address ?? '').includes(AREA_WORD)) continue
      out.push({ id: it.id, kind, name: it.name, lat: it.lat, lng: it.lng, ...(kind === 'facility' ? { faclType: String(it.fields?.faclTyCd ?? '') } : {}) })
    }
  }
  add('crosswalk', sets.crosswalk)
  add('bus', sets.bus)
  add('facility', sets.facility)
  return out
}

// 발표 시나리오 2~5장이 쓰는 기존 시연 지점. 재발 판정(30m)·중복 확인(15m)에 걸리지 않도록 넓게 피한다.
const SCENARIO_SEEDS = ['R16', 'B02', 'R17', 'W-C', 'R19', 'B03', 'R18', 'N01', 'R15-1']
const SCENARIO_AVOID_M = 40
const TEAM_AVOID_M = 26
const SITE_GAP_M = 20 // 가상 지점끼리 최소 간격
const NEIGHBOR_M = 45 // 이 안의 이웃 지점끼리는 같은 유형을 쓰지 않는다(재발 판정이 지점 사이로 번지지 않게)
const JITTER_M = 3

// 기존 지점(팀 조사 34곳 등)의 모양을 10m 간격 점으로 풀어 피할 거리와 함께 돌려준다.
export function avoidFromBarriers(barriers: Barrier[]): AvoidPoint[] {
  const out: AvoidPoint[] = []
  for (const b of barriers) {
    const geometry = b.geometry ?? (b.provisional ? ({ kind: 'point', at: [b.provisional.lat, b.provisional.lng] } as const) : null)
    if (!geometry) continue
    const r = SCENARIO_SEEDS.includes(b.id) || (b.parentId && SCENARIO_SEEDS.includes(b.parentId)) ? SCENARIO_AVOID_M : TEAM_AVOID_M
    const path = geometry.kind === 'point' ? [geometry.at] : geometry.path
    path.forEach((p, i) => {
      out.push({ lat: p[0], lng: p[1], r })
      if (i === 0) return
      const q = path[i - 1]
      const n = Math.ceil(distanceM(q[0], q[1], p[0], p[1]) / 10)
      for (let j = 1; j < n; j++) out.push({ lat: q[0] + ((p[0] - q[0]) * j) / n, lng: q[1] + ((p[1] - q[1]) * j) / n, r })
    })
  }
  return out
}

// ───── 난수 ─────
function mulberry32(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ───── 가상 닉네임(실명 아님) ─────
const ADJ = ['푸른', '조용한', '용감한', '부지런한', '느긋한', '반짝이는', '씩씩한', '따뜻한', '엉뚱한', '느린', '든든한', '쾌활한', '차분한', '꼼꼼한', '활기찬', '다정한', '단단한', '맑은', '작은', '커다란', '재빠른', '호기심 많은', '웃는', '졸린', '빛나는', '포근한', '선선한', '고운', '야무진', '유쾌한']
const NOUN = ['바람', '구름', '거북', '다람쥐', '고래', '별빛', '나무', '노을', '파도', '감자', '호랑이', '참새', '달팽이', '햇살', '은행잎', '오리', '토끼', '여우', '곰', '솔방울', '도토리', '등대', '고양이', '두루미', '무지개', '조약돌', '반딧불', '민들레', '해바라기', '징검다리']

// ───── 위치 성격과 장애요소 유형 ─────
const TYPE_W: Record<string, number> = {
  '파손 노면': 22,
  '계단·턱': 20,
  '좁은 보도': 15,
  '급경사': 12,
  '불법 주정차': 12,
  '쓰레기': 8,
  '입간판·노점': 6, // 설계서의 "신호기 6%"는 reportTypes에 없는 유형이라 이 유형으로 대신함(구현 메모)
  '킥보드·자전거': 1.5,
  '공사 자재': 1.5,
  '경사로 없음': 2.5,
  '수동문': 1.2,
  '장애인화장실 없음': 0.6,
}
const TEMP_TYPES = ['쓰레기', '킥보드·자전거', '입간판·노점', '공사 자재', '불법 주정차']
const PUBLIC_FACILITY = ['대피소', '공중화장실', '보건소']

type Pair = { type: string; kind: string }

const SIDEWALK = '구·시 도로의 보도'
function pairsFor(c: Candidate): Pair[] {
  const list: Pair[] = []
  const add = (types: string[], kind: string) => types.forEach((type) => list.push({ type, kind }))
  if (c.kind === 'crosswalk') {
    add(['계단·턱', '좁은 보도', '급경사', '파손 노면', '불법 주정차'], '횡단보도·신호')
  } else if (c.kind === 'bus') {
    add(['파손 노면', '계단·턱', '경사로 없음', '불법 주정차'], '버스정류장')
  } else {
    const kind = PUBLIC_FACILITY.some((k) => (c.faclType ?? '').includes(k)) ? '공공건물 출입' : '민간 건물 출입'
    add(['계단·턱', '경사로 없음', '수동문', '장애인화장실 없음'], kind)
  }
  // 어느 지점이든 바로 앞 보도에서 생기는 불편은 "구·시 도로의 보도"로 접수한다(이미 같은 유형이 있으면 건너뜀)
  for (const type of ['쓰레기', '입간판·노점', '킥보드·자전거', '공사 자재', '좁은 보도', '급경사', '파손 노면']) if (!list.some((x) => x.type === type)) list.push({ type, kind: SIDEWALK })
  return list.filter((x) => findAgencies(x.type, x.kind).length > 0) // 소관 기관 후보가 없는 조합은 만들지 않는다
}

const ACTION_TEXT: Record<string, string> = {
  '파손 노면': '파손된 노면을 보수했습니다',
  '계단·턱': '턱을 낮추고 경사면을 정비했습니다',
  '좁은 보도': '보도 위 적치물을 정리해 통행 폭을 넓혔습니다',
  '급경사': '미끄럼 방지 포장과 손잡이를 보강했습니다',
  '불법 주정차': '단속과 안내 표지를 설치했습니다',
  '쓰레기': '쓰레기를 수거하고 정리했습니다',
  '입간판·노점': '보도 위 입간판을 철거했습니다',
  '킥보드·자전거': '방치된 킥보드를 수거했습니다',
  '공사 자재': '공사 자재를 치우도록 조치했습니다',
  '경사로 없음': '임시 경사판을 설치했습니다',
  '수동문': '출입문 개폐 보조 장치를 설치했습니다',
  '장애인화장실 없음': '이용 가능한 화장실 안내를 설치했습니다',
}
const DESC: Record<string, string[]> = {
  '파손 노면': ['노면이 깨져 바퀴가 걸려요', '보도블록이 들떠 있어 지나가기 불편해요', '움푹 패인 곳이 있어요'],
  '계단·턱': ['출입 쪽에 높은 턱이 있어요', '보도와 차도 사이 턱이 높아요', '계단뿐이라 휠체어로 오르기 어려워요'],
  '좁은 보도': ['보도 폭이 좁아 휠체어가 비켜 가기 어려워요', '전봇대 때문에 통행 폭이 줄었어요', '가로수와 담장 사이가 좁아요'],
  '급경사': ['경사가 가팔라 오르내리기 위험해요', '비 오면 미끄러운 비탈이에요', '경사로 기울기가 너무 커요'],
  '불법 주정차': ['차량이 보도를 막고 있어요', '횡단보도 앞에 차가 서 있어요', '정류장 승강장 앞에 주차된 차가 많아요'],
  '쓰레기': ['쓰레기가 쌓여 길을 막고 있어요', '적치물이 보도에 놓여 있어요', '종량제 봉투가 통로를 가려요'],
  '입간판·노점': ['입간판이 보도 한가운데 있어요', '노점 물건이 보도를 차지해요', '가게 앞 진열대가 통로를 좁혀요'],
  '킥보드·자전거': ['방치된 킥보드가 길을 막아요', '자전거가 보도에 쓰러져 있어요', '공유 킥보드가 점자블록을 가려요'],
  '공사 자재': ['공사 자재가 보도를 막고 있어요', '공사 장비 때문에 우회해야 해요', '자재 더미가 통로에 있어요'],
  '경사로 없음': ['출입구에 경사로가 없어요', '입구 계단 옆에 경사로가 없어요', '경사로가 있는 입구를 찾기 어려워요'],
  '수동문': ['손으로 열어야 하는 무거운 문이에요', '자동문이 아니라 혼자 열기 어려워요', '문이 무거워 휠체어로 열기 힘들어요'],
  '장애인화장실 없음': ['이용할 수 있는 장애인화장실이 없어요', '화장실 문턱 때문에 들어가기 어려워요', '장애인 화장실 표시만 있고 쓸 수 없어요'],
}

// ───── 결과 ─────
export type DemoUserEntry = { id: string; nickname: string }
export type LargeStats = { sites: number; reports: number; users: number; candidates: number; recurrenceSites: number }
export type LargeResult = { users: DemoUserEntry[]; reports: Report[]; stats: LargeStats }
export type LargeInput = { now: number; candidates: Candidate[]; avoid: AvoidPoint[]; seed?: number; targetReports?: number }

// ───── 내부 구조 ─────
type Site = { c: Candidate; pairs: Pair[]; count: number }
type Group = { site: Site; pair: Pair; members: number; anchor: number; chain: number } // chain 0이면 일반, 2·3이면 재발 사슬
type FinalStatus = 'pending' | 'verified' | 'filed' | 'assigned' | 'in_progress' | 'resolved' | 'rechecked' | 'recheckFail'
type Plan = {
  group: Group
  createdMs: number
  kind: 'live' | 'merged' | 'rejected'
  status: FinalStatus
  v: number // 검증 시각(없으면 0)
  f: number
  s: number
  p: number
  z: number
  q: number
  mergedAt: number
  rejectedAt: number
  viaVerifier: boolean
  rated: Rating | null
  targetIdx: number // 합쳐진 건이 가리키는 plan 위치
  // 사용자 배정 결과
  reporter: string
  voters: string[]
  rechecker: string
  receiptNo: string
  idx: number
}

const dayKey = (ms: number) => new Date(ms).toLocaleDateString('sv-SE')

export function buildLargeDemo(input: LargeInput): LargeResult {
  const { now, candidates, avoid } = input
  const rand = mulberry32(input.seed ?? LARGE_SEED)
  const U = (a: number, b: number) => a + (b - a) * rand()
  const pickOne = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  const wpick = <T,>(arr: T[], w: (x: T) => number): T => {
    let tot = 0
    for (const x of arr) tot += w(x)
    let r = rand() * tot
    for (const x of arr) {
      r -= w(x)
      if (r <= 0) return x
    }
    return arr[arr.length - 1]
  }

  // 1) 사용자 300명과 가상 닉네임
  const combos = shuffle(ADJ.flatMap((a) => NOUN.map((n) => a.replace(/ /g, '') + n)))
  const users: DemoUserEntry[] = Array.from({ length: LARGE_USER_COUNT }, (_, i) => ({
    id: `crowd-${String(i + 1).padStart(3, '0')}`,
    nickname: `${combos[i]}${10 + Math.floor(rand() * 90)}`,
  }))
  const nickSet = new Set<string>()
  users.forEach((u, i) => {
    let n = u.nickname
    while (nickSet.has(n)) n = `${combos[i]}${100 + Math.floor(rand() * 900)}`
    u.nickname = n
    nickSet.add(n)
  })
  const REPORTER_POOL = Math.round(LARGE_USER_COUNT * 0.87) // 나머지는 확인 투표·재확인만 하는 사람
  const popRep = users.map((_, i) => (i < REPORTER_POOL ? 1 / (i + 1) ** 0.75 : 0))
  const popVote = users.map((_, i) => 1 / (i + 1) ** 0.45)
  const cumOf = (w: number[]) => {
    let s = 0
    return w.map((x) => (s += x))
  }
  const cumRep = cumOf(popRep)
  const cumVote = cumOf(popVote)
  const drawIdx = (cum: number[]) => {
    const r = rand() * cum[cum.length - 1]
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] >= r) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  // 2) 지점 고르기: 기존 지점과 거리를 두고, 가상 지점끼리도 간격을 둔다
  const free = shuffle(candidates).filter((c) => !avoid.some((a) => distanceM(c.lat, c.lng, a.lat, a.lng) < a.r))
  const chosen: Candidate[] = []
  for (const c of free) if (!chosen.some((s) => distanceM(c.lat, c.lng, s.lat, s.lng) < SITE_GAP_M)) chosen.push(c)
  const target = input.targetReports ?? LARGE_TARGET_REPORTS
  const sites: Site[] = chosen.map((c) => ({ c, pairs: pairsFor(c), count: 0 })).filter((s) => s.pairs.length > 0)
  if (sites.length === 0) return { users, reports: [], stats: { sites: 0, reports: 0, users: users.length, candidates: candidates.length, recurrenceSites: 0 } }

  // 3) 지점별 제보 수(몰리는 분포) 배분
  const sw = sites.map(() => Math.exp(0.75 * gauss()))
  const swSum = sw.reduce((a, b) => a + b, 0)
  let assigned = 0
  sites.forEach((s, i) => {
    s.count = Math.max(1, Math.floor((target * sw[i]) / swSum))
    assigned += s.count
  })
  while (assigned < target) {
    sites[Math.floor(rand() * sites.length)].count++
    assigned++
  }

  // 4) 지점마다 유형 묶음(group) 만들기. 이웃 지점이 쓴 유형은 피해 재발 판정이 지점 사이로 번지지 않게 한다.
  const usedTypes = new Map<Site, Set<string>>()
  const groups: Group[] = []
  const anchorAge = () => 88 * rand() ** 2
  for (const s of sites) {
    const neighborTypes = new Set<string>()
    for (const [o, set] of usedTypes) if (distanceM(o.c.lat, o.c.lng, s.c.lat, s.c.lng) < NEIGHBOR_M) set.forEach((t) => neighborTypes.add(t))
    let cands = s.pairs.filter((p) => !neighborTypes.has(p.type))
    if (cands.length === 0) cands = s.pairs
    const want = Math.max(1, Math.min(cands.length, s.count, Math.round(s.count / 2.4)))
    const picked: Pair[] = []
    const rest = cands.slice()
    while (picked.length < want && rest.length > 0) {
      const p = wpick(rest, (x) => TYPE_W[x.type] ?? 1)
      picked.push(p)
      rest.splice(rest.indexOf(p), 1)
    }
    usedTypes.set(s, new Set(picked.map((p) => p.type)))
    const counts = picked.map(() => 1)
    for (let k = picked.length; k < s.count; k++) counts[picked.indexOf(wpick(picked, (x) => TYPE_W[x.type] ?? 1))]++
    picked.forEach((p, i) => groups.push({ site: s, pair: p, members: counts[i], anchor: anchorAge(), chain: 0 }))
  }

  // 5) 재발 지점(전체 지점의 약 9%): 지점마다 한 묶음을 "조치 뒤 다시 접수"되는 사슬로 바꾼다
  const recurTarget = Math.max(1, Math.round(sites.length * 0.09))
  const recurSites = shuffle(sites.filter((s) => s.count >= 3)).slice(0, recurTarget)
  let surplus = 0
  recurSites.forEach((s, i) => {
    const mine = groups.filter((g) => g.site === s)
    const g = mine.reduce((a, b) => (b.members > a.members ? b : a))
    g.chain = i < 2 ? 3 : 2
    surplus += g.members - g.chain
    g.members = g.chain
  })
  const normal = groups.filter((g) => g.chain === 0)
  while (surplus !== 0 && normal.length > 0) {
    const g = pickOne(normal)
    if (surplus > 0) {
      g.members++
      surplus--
    } else if (g.members > 1) {
      g.members--
      surplus++
    }
  }

  // 6) 사례(plan) 만들기 ─ 단계 시각과 최종 상태
  const plans: Plan[] = []
  const ms = (ageDays: number) => now - ageDays * DAY
  type TL = { v: number; f: number; s: number; p: number; z: number; q: number }
  const timeline = (c: number, fast = false): TL => {
    const vd = fast ? U(0.1, 2) : rand() < 0.8 ? U(0.05, 1.2) : U(1.2, 8)
    const v = c + vd * DAY
    const f = v + (fast ? U(0.2, 1.5) : U(0.2, 4)) * DAY
    const s = f + (fast ? U(1, 2) : U(1, 3)) * DAY
    const p = s + (fast ? U(2, 5) : U(2, 10)) * DAY
    const z = p + (fast ? U(3, 10) : 3 + 27 * rand() ** 1.5) * DAY
    const q = z + (fast ? U(1, 3) : U(1, 7)) * DAY
    return { v, f, s, p, z, q }
  }
  const ageOf = (c: number) => (now - c) / DAY
  // 나이(접수 후 일수)에 따라 상태 가중치를 바꿔 처리율·기한 경과가 목표 근처가 되게 한다.
  const statusWeights = (A: number): Record<FinalStatus, number> =>
    A < 17
      ? { pending: A < 3 ? 1.6 : 0.4, verified: A < 8 ? 1.2 : 0.4, filed: 0.7, assigned: 1.1, in_progress: 1, resolved: 0.6, rechecked: 0.25, recheckFail: 0 }
      : { pending: 0.02, verified: 0.1, filed: 0.11, assigned: 0.2, in_progress: 0.18, resolved: 1.15, rechecked: 0.75, recheckFail: 0.1 }
  const blank = (g: Group, createdMs: number): Plan => ({
    group: g, createdMs, kind: 'live', status: 'pending', v: 0, f: 0, s: 0, p: 0, z: 0, q: 0, mergedAt: 0, rejectedAt: 0,
    viaVerifier: false, rated: null, targetIdx: -1, reporter: '', voters: [], rechecker: '', receiptNo: '', idx: -1,
  })
  // 최종 상태 고르기. minAction: 조치 시각의 하한(같은 묶음의 다른 건이 모두 먼저 접수된 뒤여야 재발로 번지지 않는다)
  const decide = (pl: Plan, minAction: number, force?: 'R' | 'free'): void => {
    const tl = timeline(pl.createdMs, force === 'R')
    const z = Math.max(tl.z, minAction)
    const q = z + (tl.q - tl.z)
    const feas: Record<FinalStatus, boolean> = {
      pending: true,
      verified: tl.v <= now,
      filed: tl.f <= now,
      assigned: tl.s <= now,
      in_progress: tl.p <= now,
      resolved: z <= now,
      rechecked: q <= now,
      recheckFail: q + 3600000 <= now,
    }
    const w = statusWeights(ageOf(pl.createdMs))
    // 시각이 아직 그 단계에 이르지 않은 건이 대부분이고, 이미 지난 건이 그 단계에 머무는 일은 드물게 둔다
    if (tl.v <= now) w.pending *= 0.12
    if (tl.f <= now) w.verified *= 0.15
    const keys = (Object.keys(w) as FinalStatus[]).filter((k) => feas[k] && w[k] > 0 && (force !== 'R' || k === 'resolved' || k === 'rechecked'))
    const ks = keys.length > 0 ? keys : (['pending'] as FinalStatus[])
    const st = wpick(ks, (k) => (force === 'R' && k === 'rechecked' ? 2.4 : w[k] || 0.01))
    pl.status = st
    Object.assign(pl, { v: tl.v, f: tl.f, s: tl.s, p: tl.p, z, q })
    pl.viaVerifier = rand() < 0.3
  }

  for (const g of groups) {
    if (g.chain > 0) {
      // 재발 사슬: 앞선 건이 조치(해결)된 뒤에 같은 곳·같은 유형으로 다시 접수된다.
      let c = ms(U(72, 88))
      for (let i = 0; i < g.chain; i++) {
        const pl = blank(g, c)
        const last = i === g.chain - 1
        decide(pl, 0, last ? 'free' : 'R')
        if (!last && pl.status !== 'resolved' && pl.status !== 'rechecked') {
          Object.assign(pl, { status: 'resolved', v: c + DAY, f: c + 2 * DAY, s: c + 3 * DAY, p: c + 5 * DAY, z: c + 12 * DAY, q: c + 14 * DAY })
        }
        plans.push(pl)
        if (last) break
        const next = pl.z + U(2, 18) * DAY // 다음 건은 이 건의 조치 뒤에 접수
        if (next > now - 1.5 * DAY) break
        c = next
      }
      continue
    }
    const a = g.anchor
    const mem: Plan[] = []
    for (let i = 0; i < g.members; i++) {
      const off = i === 0 ? 0 : U(0, Math.min(8, a * 0.9))
      mem.push(blank(g, ms(Math.max(0.05, a - off))))
    }
    mem.sort((x, y) => x.createdMs - y.createdMs)
    // 합침·반려 먼저 정하고, 나머지 산 건의 마지막 접수 시각을 구한다
    mem.forEach((pl, i) => {
      if (rand() < 0.045) {
        pl.kind = 'rejected'
        pl.rejectedAt = pl.createdMs + U(0.2, 4) * DAY
        if (pl.rejectedAt > now) pl.kind = 'live'
      }
      if (pl.kind === 'live' && i > 0 && rand() < 0.1) {
        const tIdx = mem.findIndex((o, k) => k < i && o.kind === 'live')
        if (tIdx >= 0) {
          pl.kind = 'merged'
          pl.targetIdx = tIdx
          pl.mergedAt = Math.min(now, pl.createdMs + U(0.05, 1.5) * DAY)
        }
      }
    })
    const liveMems = mem.filter((m) => m.kind === 'live')
    const latest = Math.max(...liveMems.map((m) => m.createdMs), 0)
    for (const pl of liveMems) decide(pl, latest + DAY * U(1, 3))
    plans.push(...mem)
    // 합쳐진 건의 targetIdx를 plans 위치로 바꾼다
    const base = plans.length - mem.length
    mem.forEach((pl) => {
      if (pl.kind === 'merged') pl.targetIdx = base + pl.targetIdx
    })
  }

  // 정렬해 번호 붙이기(합침 대상 위치도 따라간다)
  const order = plans.map((p, i) => ({ p, i })).sort((x, y) => x.p.createdMs - y.p.createdMs || x.i - y.i)
  const newIdx = new Map<number, number>()
  order.forEach((o, k) => newIdx.set(o.i, k))
  const P: Plan[] = order.map((o) => o.p)
  P.forEach((p, k) => {
    p.idx = k
    if (p.kind === 'merged') p.targetIdx = newIdx.get(p.targetIdx) ?? -1
  })
  // 합침 대상이 반려된 경우는 합침을 풀고 일반 건으로 둔다(대상은 항상 live)
  P.forEach((p) => {
    if (p.kind === 'merged' && (p.targetIdx < 0 || P[p.targetIdx].kind !== 'live')) {
      p.kind = 'live'
      decide(p, 0)
    }
  })
  P.forEach((p, k) => {
    p.receiptNo = `DEMO-LRG-${String(k + 1).padStart(4, '0')}`
  })

  // ○△X 판정: 재확인을 통과한 건은 ○, 나머지는 △ 53% · X 47%
  for (const p of P) {
    if (p.kind !== 'live' || p.status === 'pending') continue
    if (p.status === 'rechecked') p.rated = 'O'
    else if (p.status === 'verified' && rand() < 0.3) p.rated = null
    else p.rated = rand() < 0.53 ? 'TRIANGLE' : 'X'
  }

  // 7) 사용자 배정 ─ 하루 점수 상한(안전 여유 포함)을 넘지 않게 한다
  const LIMIT = REWARD_DAILY_CAP - 6
  const used = new Map<string, number>()
  type Need = { at: number; pts: number }
  const fits = (uid: string, needs: Need[]) => {
    const add = new Map<string, number>()
    for (const n of needs) {
      const k = uid + '|' + dayKey(n.at)
      add.set(k, (add.get(k) ?? 0) + n.pts)
    }
    for (const [k, v] of add) if ((used.get(k) ?? 0) + v > LIMIT) return false
    return true
  }
  const take = (uid: string, needs: Need[]) => {
    for (const n of needs) {
      const k = uid + '|' + dayKey(n.at)
      used.set(k, (used.get(k) ?? 0) + n.pts)
    }
  }
  const choose = (cum: number[], needs: Need[], exclude: string[]): string => {
    for (let t = 0; t < 40; t++) {
      const u = users[drawIdx(cum)].id
      if (!exclude.includes(u) && fits(u, needs)) {
        take(u, needs)
        return u
      }
    }
    const start = Math.floor(rand() * users.length)
    for (let k = 0; k < users.length; k++) {
      const u = users[(start + k) % users.length].id
      if (!exclude.includes(u) && fits(u, needs)) {
        take(u, needs)
        return u
      }
    }
    const u = users[start].id
    take(u, needs)
    return u
  }
  const verifiedOf = (p: Plan) => p.kind === 'live' && p.status !== 'pending'
  for (const p of shuffle(P)) {
    const needs: Need[] = []
    if (verifiedOf(p)) needs.push({ at: p.v, pts: 10 })
    if (p.status === 'rechecked') needs.push({ at: p.q, pts: 20 })
    if (p.kind === 'merged') {
      const t = P[p.targetIdx]
      if (verifiedOf(t)) needs.push({ at: Math.max(p.mergedAt, t.v), pts: 2 })
    }
    p.reporter = choose(cumRep, needs, [])
  }
  for (const p of shuffle(P)) {
    if (p.kind !== 'live') continue
    if (p.status === 'pending') {
      const k = rand() < 0.4 ? 1 : 0 // 검증 대기 중 이미 1명이 확인한 건
      for (let i = 0; i < k; i++) p.voters.push(choose(cumVote, [], [p.reporter, ...p.voters]))
      continue
    }
    if (!p.viaVerifier) {
      p.voters.push(choose(cumVote, [{ at: p.v, pts: 2 }], [p.reporter]))
      p.voters.push(choose(cumVote, [{ at: p.v, pts: 2 }], [p.reporter, ...p.voters]))
    }
    if (p.status === 'rechecked' || p.status === 'recheckFail') p.rechecker = choose(cumVote, [{ at: p.q, pts: 5 }], [p.reporter])
  }

  // 8) Report 조립
  const iso = (t: number) => new Date(t).toISOString()
  const agencyPool = listAgencies()
  const reports: Report[] = []
  for (const p of P) {
    const g = p.group
    const type = g.pair.type
    const kind = g.pair.kind
    const jlat = U(-JITTER_M, JITTER_M) / 111320
    const jlng = U(-JITTER_M, JITTER_M) / (111320 * Math.cos((g.site.c.lat * Math.PI) / 180))
    const id = `r-lrg-${String(p.idx + 1).padStart(4, '0')}`
    const desc = `(시연) ${pickOne(DESC[type] ?? ['불편한 곳이에요'])}`
    const at0 = iso(p.createdMs)
    const hist: Report['history'] = [{ status: 'submitted', at: at0, by: p.reporter }]
    const base = {
      id,
      demo: true as const,
      demoSet: 'large' as const,
      userId: p.reporter,
      createdAt: at0,
      lat: g.site.c.lat + jlat,
      lng: g.site.c.lng + jlng,
      type,
      category: TEMP_TYPES.includes(type) ? ('temporary' as const) : ('fixed' as const),
      photos: [] as string[],
      description: desc,
      locationKind: kind,
    }
    if (p.kind === 'merged') {
      const t = P[p.targetIdx]
      hist.push({ status: 'merged', at: iso(p.mergedAt), by: p.reporter, memo: `(시연) 기존 건 r-lrg-${String(t.idx + 1).padStart(4, '0')}에 합침` })
      reports.push({ ...base, barrierId: `r-lrg-${String(t.idx + 1).padStart(4, '0')}`, status: 'merged', verification: { votes: 0, voterIds: [] }, history: hist })
      continue
    }
    if (p.kind === 'rejected') {
      const reason = pickOne([...REJECT_REASONS])
      hist.push({ status: 'pending', at: at0, by: p.reporter, memo: '검증 대기' })
      hist.push({ status: 'rejected', at: iso(p.rejectedAt), by: 'verifier', memo: `(시연) ${reason}` })
      reports.push({ ...base, status: 'rejected', verification: { votes: 0, voterIds: [], verifierId: 'verifier', result: 'rejected', reason }, history: hist })
      continue
    }
    hist.push({ status: 'pending', at: at0, by: p.reporter, memo: '검증 대기' })
    if (p.status === 'pending') {
      reports.push({ ...base, status: 'pending', verification: { votes: p.voters.length, voterIds: p.voters }, history: hist })
      continue
    }
    // 검증
    const verification: Report['verification'] = { votes: 0, voterIds: [], result: 'confirmed' }
    if (p.viaVerifier) {
      verification.verifierId = 'verifier'
      if (p.rated) verification.rating = p.rated
      hist.push({ status: 'verified', at: iso(p.v), by: 'verifier', memo: '(시연) 검증자 현장 확인·판정' })
    } else {
      verification.votes = p.voters.length
      verification.voterIds = p.voters
      hist.push({ status: 'verified', at: iso(p.v), by: p.voters[1], memo: `(시연) 시민 확인 ${p.voters.length}명` })
      if (p.rated) {
        verification.verifierId = 'verifier'
        verification.rating = p.rated
        hist.push({ status: 'verified', at: iso(Math.min(now, p.v + U(0.2, 0.9) * Math.min(8 * 3600000, p.f - p.v))), by: 'verifier', memo: '(시연) 검증자 판정 추가' })
      }
    }
    let status: ReportStatus = 'verified'
    let complaint: Report['complaint']
    let action: Report['action']
    let lastCheckedAt: string | undefined
    if (p.status !== 'verified') {
      const matches = findAgencies(type, kind)
      const agencyIds = matches.map((m) => m.agency.id)
      const dl = deadlineFor(matches.map((m) => m.agency))
      complaint = { channel: rand() < 0.7 ? '안전신문고' : '국민신문고', receiptNo: p.receiptNo, submittedAt: iso(p.f), mode: 'mock', agencyIds, deadlineDays: dl.days }
      hist.push({ status: 'filed', at: iso(p.f), by: p.reporter, memo: `(시연) ${complaint.channel} 접수번호 ${p.receiptNo} (시연용 모의 접수)` })
      status = 'filed'
      const steps: ReportStatus[] = ['assigned', 'in_progress', 'resolved', 'rechecked']
      const upto = p.status === 'filed' || p.status === 'recheckFail' ? 0 : p.status === 'assigned' ? 1 : p.status === 'in_progress' ? 2 : p.status === 'resolved' ? 3 : 4
      for (let i = 0; i < upto; i++) {
        const st = steps[i]
        if (st === 'assigned') {
          hist.push({ status: 'assigned', at: iso(p.s), by: 'officer', memo: '(시연) 기관 배정 확인' })
          complaint.assignedAgencyId = agencyIds[0]
        } else if (st === 'in_progress') hist.push({ status: 'in_progress', at: iso(p.p), by: 'officer', memo: '(시연) 현장 확인·조치 시작' })
        else if (st === 'resolved') {
          const text = `(시연) ${ACTION_TEXT[type] ?? '조치했습니다'}`
          hist.push({ status: 'resolved', at: iso(p.z), by: 'officer', memo: text })
          action = { description: text, beforePhotos: [], afterPhotos: [], doneAt: iso(p.z) }
          lastCheckedAt = iso(p.z)
        } else {
          hist.push({ status: 'rechecked', at: iso(p.q), by: p.rechecker, memo: '(시연) 재확인: 실제로 통과 가능', passable: true })
          if (action) action = { ...action, recheck: { passable: true, at: iso(p.q), by: p.rechecker } }
          lastCheckedAt = iso(p.q)
        }
        status = st
      }
      if (p.status === 'recheckFail') {
        const text = `(시연) ${ACTION_TEXT[type] ?? '조치했습니다'}`
        hist.push({ status: 'assigned', at: iso(p.s), by: 'officer', memo: '(시연) 기관 배정 확인' })
        complaint.assignedAgencyId = agencyIds[0]
        hist.push({ status: 'in_progress', at: iso(p.p), by: 'officer', memo: '(시연) 현장 확인·조치 시작' })
        hist.push({ status: 'resolved', at: iso(p.z), by: 'officer', memo: text })
        hist.push({ status: 'rechecked', at: iso(p.q), by: p.rechecker, memo: '(시연) 재확인: 아직 지나가기 어려움', passable: false })
        hist.push({ status: 'in_progress', at: iso(p.q + 3600000), by: 'officer', memo: '⑤ 조치 중으로 되돌림' })
        action = { description: text, beforePhotos: [], afterPhotos: [], doneAt: iso(p.z), recheck: { passable: false, at: iso(p.q), by: p.rechecker } }
        status = 'in_progress'
      }
    }
    const r: Report = { ...base, status, verification, history: hist, ...(complaint ? { complaint } : {}), ...(action ? { action } : {}), ...(lastCheckedAt ? { lastCheckedAt } : {}) }
    // 이관: 처리 전·처리 중인 건 일부(요청 3.5% · 수락 2% · 반려 1%)
    if (complaint && (status === 'filed' || status === 'assigned' || status === 'in_progress') && complaint.agencyIds[0]) {
      const roll = rand()
      if (roll < 0.065) {
        const lastAt = new Date(hist[hist.length - 1].at).getTime()
        const tAt = lastAt + U(0.5, 5) * DAY
        const toId = pickOne(agencyPool.filter((a) => a.id !== complaint.agencyIds[0] && a.id !== 'bukgu-yongbong-dong')).id
        if (tAt < now) {
          const decision: 'requested' | 'accepted' | 'rejected' = roll < 0.035 ? 'requested' : roll < 0.055 ? 'accepted' : 'rejected'
          const dAt = tAt + U(0.2, 2) * DAY
          const decided = decision !== 'requested' && dAt < now
          const reason = '(시연) 소관이 다른 것으로 보여 이관을 요청합니다'
          r.transfers = [
            { fromAgencyId: complaint.agencyIds[0], toAgencyId: toId, reason, at: iso(tAt), by: 'officer', status: decided ? decision : 'requested', ...(decided ? { decidedAt: iso(dAt), decidedBy: 'officer' } : {}) },
          ]
          r.history.push({ status, at: iso(tAt), by: 'officer', memo: `(시연) 이관 요청: ${reason}` })
          if (decided) {
            r.history.push({ status, at: iso(dAt), by: 'officer', memo: decision === 'accepted' ? '(시연) 이관 수락' : '(시연) 이관 반려' })
            if (decision === 'accepted') complaint.assignedAgencyId = toId
          }
        }
      }
    }
    reports.push(r)
  }

  return { users, reports, stats: { sites: sites.length, reports: reports.length, users: users.length, candidates: candidates.length, recurrenceSites: recurSites.length } }
}

// ───── 파일 형식(내보내기·가져오기) ─────
export type DemoFile = {
  format: typeof FILE_FORMAT
  version: typeof FILE_VERSION
  synthetic: true
  generatedAt: string
  seed: number
  users: DemoUserEntry[]
  reports: Report[]
}

export function makeDemoFile(users: DemoUserEntry[], reports: Report[], generatedAt: string, seed = LARGE_SEED): DemoFile {
  return { format: FILE_FORMAT, version: FILE_VERSION, synthetic: true, generatedAt, seed, users, reports }
}

const STATUSES: ReportStatus[] = ['submitted', 'pending', 'merged', 'verified', 'rejected', 'assigned', 'filed', 'in_progress', 'resolved', 'rechecked']
const ISO_FULL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isIso = (v: unknown) => typeof v === 'string' && ISO_FULL.test(v) && !Number.isNaN(new Date(v).getTime())

function checkReport(x: unknown, i: number): string | null {
  const w = `제보 ${i + 1}번째`
  if (!isObj(x)) return `${w}: 형식이 올바르지 않아요.`
  if (typeof x.id !== 'string' || x.id.length === 0 || x.id.length > 80) return `${w}: id가 올바르지 않아요.`
  if (typeof x.userId !== 'string' || x.userId.length > 80) return `${w}: 사용자 id가 올바르지 않아요.`
  if (!isIso(x.createdAt)) return `${w}: 날짜가 올바르지 않아요.`
  if (typeof x.lat !== 'number' || typeof x.lng !== 'number' || !Number.isFinite(x.lat) || !Number.isFinite(x.lng) || Math.abs(x.lat) > 90 || Math.abs(x.lng) > 180) return `${w}: 좌표가 올바르지 않아요.`
  if (typeof x.type !== 'string' || (x.category !== 'fixed' && x.category !== 'temporary')) return `${w}: 유형이 올바르지 않아요.`
  if (typeof x.status !== 'string' || !STATUSES.includes(x.status as ReportStatus)) return `${w}: 상태가 올바르지 않아요.`
  if (typeof x.description !== 'string' || x.description.length > 2000) return `${w}: 설명이 올바르지 않아요.`
  if (x.demo !== true) return `${w}: 시연 데이터가 아닌 제보가 섞여 있어요. 시연 데이터 파일만 가져올 수 있어요.`
  if (!Array.isArray(x.photos) || x.photos.length > 0) return `${w}: 사진이 들어 있어요. 사진은 가져올 수 없어요.`
  if (!isObj(x.verification) || !Array.isArray(x.verification.voterIds)) return `${w}: 검증 정보가 올바르지 않아요.`
  if (!Array.isArray(x.history) || x.history.length === 0 || x.history.length > 60) return `${w}: 처리 기록이 올바르지 않아요.`
  for (const h of x.history) {
    if (!isObj(h) || typeof h.status !== 'string' || !STATUSES.includes(h.status as ReportStatus) || !isIso(h.at) || typeof h.by !== 'string') return `${w}: 처리 기록 항목이 올바르지 않아요.`
  }
  if (x.complaint !== undefined && (!isObj(x.complaint) || !isIso(x.complaint.submittedAt) || typeof x.complaint.deadlineDays !== 'number' || !Array.isArray(x.complaint.agencyIds))) return `${w}: 민원 정보가 올바르지 않아요.`
  return null
}

export type ParsedDemo = { ok: true; file: DemoFile } | { ok: false; message: string }

// 파일 내용(문자열)을 검사한다. 크기 상한·형식·버전·각 제보의 모양을 확인하고, 하나라도 어긋나면 통째로 거부한다.
export function parseDemoFile(text: string): ParsedDemo {
  if (text.length > FILE_MAX_BYTES) return { ok: false, message: `파일이 너무 커요(${Math.round(FILE_MAX_BYTES / 1048576)}MB까지).` }
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return { ok: false, message: 'JSON 파일이 아니에요.' }
  }
  if (!isObj(v) || v.format !== FILE_FORMAT) return { ok: false, message: '북구동행지도 시연 데이터 파일이 아니에요.' }
  if (v.version !== FILE_VERSION) return { ok: false, message: `지원하지 않는 버전이에요(${String(v.version)}).` }
  if (v.synthetic !== true) return { ok: false, message: '가상 데이터 표시(synthetic)가 없는 파일이에요.' }
  if (!isIso(v.generatedAt)) return { ok: false, message: '만든 날짜(generatedAt)가 올바르지 않아요.' }
  if (!Array.isArray(v.users) || v.users.length > 2000) return { ok: false, message: '사용자 목록이 올바르지 않아요.' }
  for (const u of v.users) {
    if (!isObj(u) || typeof u.id !== 'string' || typeof u.nickname !== 'string' || u.id.length > 40 || u.nickname.length > 40) return { ok: false, message: '사용자 항목이 올바르지 않아요.' }
  }
  if (!Array.isArray(v.reports) || v.reports.length > 5000) return { ok: false, message: '제보 목록이 올바르지 않아요(5000건까지).' }
  const ids = new Set<string>()
  for (let i = 0; i < v.reports.length; i++) {
    const bad = checkReport(v.reports[i], i)
    if (bad) return { ok: false, message: bad }
    const id = (v.reports[i] as { id: string }).id
    if (ids.has(id)) return { ok: false, message: `제보 id가 겹쳐요: ${id}` }
    ids.add(id)
  }
  return { ok: true, file: v as unknown as DemoFile }
}

// 모든 날짜(ISO 문자열)를 deltaMs만큼 평행 이동한다. 파일을 만든 날과 가져오는 날의 차이를 메워 "며칠 전" 구성을 그대로 살린다.
export function shiftDates<T>(value: T, deltaMs: number): T {
  if (typeof value === 'string') return (ISO_FULL.test(value) ? new Date(new Date(value).getTime() + deltaMs).toISOString() : value) as unknown as T
  if (Array.isArray(value)) return value.map((x) => shiftDates(x, deltaMs)) as unknown as T
  if (isObj(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) out[k] = shiftDates(value[k], deltaMs)
    return out as T
  }
  return value
}
