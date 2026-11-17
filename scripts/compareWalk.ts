// 자체 보행망 경로와 기존 TMAP 방식 비교표 만들기(읽기 전용: TMAP은 저장된 캐시·시연 경로만 쓰고 새로 호출하지 않는다).
// 사용: node scripts/compareWalk.ts
// 1) 시연 쌍(data/routes/pairs.json) 3개: 저장된 TMAP 경로와 자체 경로 비교
// 2) TMAP 캐시(data/routes/.cache)에 남은 시험 경로: 같은 출발·도착끼리 묶어, 경유지를 바꿔 가며 받은 TMAP 경로 중 지나가기 X를 그대로 지나는 것(still-blocked 증거)이 몇 개인지와 자체 경로 결과
import fs from 'node:fs'
import path from 'node:path'
import { ROUTE_CFG, WALK_CFG } from '../src/lib/config.ts'
import { analyze, searchRoute, viaKey, type Pt, type RouteData } from '../src/lib/routing/engine.ts'
import { buildObstacles } from '../src/lib/routing/obstacles.ts'
import { searchOwn } from '../src/lib/routing/ownSearch.ts'
import { loadWalkGraph, type WalkGraphFile } from '../src/lib/routing/walkGraph.ts'
import { loadBarriers } from '../src/lib/seed.ts'
import { cacheKey } from './tmapClient.ts'
import demo from '../data/routes/demo.json' with { type: 'json' }
import pairsData from '../data/routes/pairs.json' with { type: 'json' }

const ROOT = path.resolve(import.meta.dirname, '..')
const g = loadWalkGraph(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/routes/walk-graph.json'), 'utf8')) as WalkGraphFile)
const barriers = loadBarriers()
const obstacles = buildObstacles(barriers, new Map(), [])
const pt = (id: string): Pt | null => {
  const b = barriers.find((x) => x.id === id)
  return b?.geometry?.kind === 'point' ? (b.geometry.at as Pt) : null
}
const STORED = (demo as unknown as { pairs: Record<string, { routes: Record<string, RouteData> }> }).pairs
const CACHE = path.join(ROOT, 'data/routes/.cache')

type Pair = { label: string; from: Pt; to: Pt; pid?: string }
const pairs: Pair[] = []
for (const p of pairsData as { id: string; fromId: string; toId: string }[]) {
  const f = pt(p.fromId)
  const t = pt(p.toId)
  if (f && t) pairs.push({ label: `${p.id} ${p.fromId}→${p.toId}`, from: f, to: t, pid: p.id })
}
const nX = (hits: { role: string }[]) => hits.filter((h) => h.role === 'X').length
const nT = (hits: { role: string }[]) => hits.filter((h) => h.role === 'T').length
const rows: string[] = ['| 쌍 | TMAP 기본 | TMAP X·△ | TMAP 우회 결과 | 자체 기본 | 자체 X·△ | 자체 피해 가는 길 | X·△ 후 | 늘어난 거리 | 피해 간 곳 |', '|---|---|---|---|---|---|---|---|---|---|']
for (const p of pairs) {
  const stored = async (via: Pt[], opt?: number): Promise<RouteData | null | 'not-stored'> => {
    const s = p.pid ? STORED[p.pid]?.routes[viaKey(via, opt)] : undefined
    if (s) return s
    try {
      return JSON.parse(fs.readFileSync(path.join(CACHE, cacheKey({ from: p.from, to: p.to, via, ...(opt ? { searchOption: opt } : {}) }) + '.json'), 'utf8')) as RouteData
    } catch {
      return 'not-stored'
    }
  }
  const old = await searchRoute({ obstacles, cfg: ROUTE_CFG, fetchRoute: stored })
  const own = searchOwn(g, p.from, p.to, obstacles, ROUTE_CFG, WALK_CFG)
  const tm = old.base ? `${old.base.distance}m` : '(저장본 없음)'
  const tmHits = old.base ? `X ${nX(old.baseHits)} · △ ${nT(old.baseHits)}` : '-'
  const still = old.attempts.filter((a) => a.result === 'still-blocked').length
  const tmRes = !old.base ? '-' : old.detour ? `우회 ${old.detour.distance}m, 남은 X ${old.unresolved.length}` : old.unresolved.length > 0 ? `우회 실패(still-blocked ${still}회)` : '우회 불필요'
  if (!own.base) {
    rows.push(`| ${p.label} | ${tm} | ${tmHits} | ${tmRes} | 실패(${own.error}) | | | | | |`)
    continue
  }
  const fin = own.detour ?? own.base
  const finHits = own.detour ? own.res.detourHits : own.res.baseHits
  const extra = own.detour ? `+${own.detour.distance - own.base.distance}m (${(((own.detour.distance - own.base.distance) / own.base.distance) * 100).toFixed(1)}%)` : '0'
  rows.push(
    `| ${p.label} | ${tm} | ${tmHits} | ${tmRes} | ${own.base.distance}m | X ${nX(own.res.baseHits)} · △ ${nT(own.res.baseHits)} | ${own.detour ? own.detour.distance + 'm' : '같은 길'} | X ${nX(finHits)} · △ ${nT(finHits)} | ${extra} | ${own.avoided.map((h) => h.o.id).join(',') || '-'} |`,
  )
  void fin
}
console.log(rows.join('\n'))
console.log(`\n보행망 점 ${g.nx.length}, 길 토막 ${g.edges.length}; 장애요소 ${obstacles.length}개 (passage X ${obstacles.filter((o) => o.impact === 'passage' && o.rating === 'X').map((o) => o.id).join(',')}; △ ${obstacles.filter((o) => o.impact === 'passage' && o.rating === 'TRIANGLE').map((o) => o.id).join(',')})`)

// ---- 2) 캐시에 남은 시험 경로 ----
type Grp = { from: Pt; to: Pt; n: number; stillX: number; ids: Set<string> }
const groups = new Map<string, Grp>()
for (const f of fs.readdirSync(CACHE)) {
  if (!f.endsWith('.json') || f === 'calls.json' || f.startsWith('osm-')) continue
  const r = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')) as RouteData
  if (!r.coords) continue
  const a = r.coords[0]
  const b = r.coords[r.coords.length - 1]
  const key = [a[0].toFixed(3), a[1].toFixed(3), b[0].toFixed(3), b[1].toFixed(3)].join(',')
  const gr = groups.get(key) ?? { from: a, to: b, n: 0, stillX: 0, ids: new Set<string>() }
  gr.n++
  const xs = analyze(r.coords, obstacles, ROUTE_CFG.radiusM).filter((h) => h.role === 'X' && h.o.impact === 'passage')
  if (xs.length) {
    gr.stillX++
    xs.forEach((h) => gr.ids.add(h.o.id))
  }
  groups.set(key, gr)
}
console.log('\n캐시 시험 경로(TMAP, 경유지·옵션을 바꿔 받은 것 포함)')
console.log('| 출발→도착(대략) | TMAP 경로 수 | 지나가기 X를 지나는 것 | 그 X | 자체 기본 | 자체 피해 가는 길 | X 남음 | 늘어난 거리 |')
console.log('|---|---|---|---|---|---|---|---|')
for (const [key, gr] of groups) {
  if (gr.n < 2) continue
  const own = searchOwn(g, gr.from, gr.to, obstacles, ROUTE_CFG, WALK_CFG)
  if (!own.base) {
    console.log(`| ${key} | ${gr.n} | ${gr.stillX} | ${[...gr.ids].join(',')} | 실패(${own.error}) | | | |`)
    continue
  }
  const fh = own.detour ? own.res.detourHits : own.res.baseHits
  console.log(
    `| ${key} | ${gr.n} | ${gr.stillX} | ${[...gr.ids].join(',') || '-'} | ${own.base.distance}m (X ${nX(own.res.baseHits)}) | ${own.detour ? own.detour.distance + 'm' : '같은 길'} | ${nX(fh)} | ${own.detour ? '+' + (own.detour.distance - own.base.distance) + 'm' : '0'} |`,
  )
}

// ---- 3) 많은 쌍에서 피해 가는 정도: 팀 조사 점 + 시범 지역 안 버스정류장(이름이 다른 것) 사이 모든 순서쌍 ----
const stopsFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/public/bus-stops.json'), 'utf8')) as { items?: { name: string; lat: number; lng: number }[] } | { name: string; lat: number; lng: number }[]
const stopList = Array.isArray(stopsFile) ? stopsFile : (stopsFile.items ?? [])
const pool: { id: string; p: Pt }[] = barriers.filter((b) => b.geometry?.kind === 'point').map((b) => ({ id: b.id, p: (b.geometry as { at: Pt }).at }))
const seenName = new Set<string>()
for (const s of stopList) {
  if (s.lat > 35.166 && s.lat < 35.183 && s.lng > 126.895 && s.lng < 126.921 && !seenName.has(s.name)) {
    seenName.add(s.name)
    pool.push({ id: s.name, p: [s.lat, s.lng] })
  }
}
let pairsN = 0
let needN = 0
let solved = 0
let unresolvedN = 0
let noPath = 0
const extras: number[] = []
for (const a of pool)
  for (const b of pool) {
    if (a.id === b.id) continue
    pairsN++
    const r = searchOwn(g, a.p, b.p, obstacles, ROUTE_CFG, WALK_CFG)
    if (!r.base) {
      noPath++
      continue
    }
    const hit = r.res.baseHits.some((h) => h.role === 'X' && !r.res.endpoint.includes(h))
    if (!hit) continue
    needN++
    if (r.detour && r.res.unresolved.length === 0) {
      solved++
      extras.push(r.detour.distance - r.base.distance)
    } else unresolvedN++
  }
extras.sort((x, y) => x - y)
const med = extras.length ? extras[Math.floor(extras.length / 2)] : 0
console.log(`\n3) 쌍 ${pairsN}개(장소 ${pool.length}곳 사이 모든 순서쌍): 경로 없음 ${noPath}, 기본 길이 X를 지나는 쌍 ${needN}, 피해서 X 0이 된 쌍 ${solved}, 못 피한 쌍 ${unresolvedN}; 늘어난 거리 중앙값 ${med}m, 최대 ${extras[extras.length - 1] ?? 0}m, 평균 ${extras.length ? Math.round(extras.reduce((s, v) => s + v, 0) / extras.length) : 0}m`)
