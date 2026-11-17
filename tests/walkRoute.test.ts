import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WALK_CFG, ROUTE_CFG } from '../src/lib/config.ts'
import { analyze, type Obstacle, type Pt } from '../src/lib/routing/engine.ts'
import { searchOwn } from '../src/lib/routing/ownSearch.ts'
import { buildWalkGraph, loadWalkGraph, M, NK, parseIncline, wayMask, type OsmEl } from '../src/lib/routing/walkGraph.ts'
import { findWalkRoute } from '../src/lib/routing/walkRoute.ts'

// 시험용 작은 보행망: 남쪽 줄 A(보도)와 북쪽 줄 B가 나란히(약 33m 떨어짐), 양 끝에서만 이어진다.
//   B: 11 -- 12 -- 13 -- 14 -- 15
//      |                       |
//   A:  1 --  2 --  3 --  4 --  5
const LAT_A = 35.17
const LAT_B = 35.1703
const LNG = (i: number) => 126.9 + (i - 1) * 0.0005 // 약 45.6m 간격
function el(extra: OsmEl[] = [], tagsOf: Record<number, Record<string, string>> = {}): OsmEl[] {
  const out: OsmEl[] = []
  for (let i = 1; i <= 5; i++) {
    out.push({ type: 'node', id: i, lat: LAT_A, lon: LNG(i), ...(tagsOf[i] ? { tags: tagsOf[i] } : {}) })
    out.push({ type: 'node', id: 10 + i, lat: LAT_B, lon: LNG(i), ...(tagsOf[10 + i] ? { tags: tagsOf[10 + i] } : {}) })
  }
  out.push({ type: 'way', id: 100, nodes: [1, 2, 3, 4, 5], tags: { highway: 'footway', footway: 'sidewalk' } })
  out.push({ type: 'way', id: 101, nodes: [11, 12, 13, 14, 15], tags: { highway: 'footway', footway: 'sidewalk' } })
  out.push({ type: 'way', id: 102, nodes: [1, 11], tags: { highway: 'footway' } })
  out.push({ type: 'way', id: 103, nodes: [5, 15], tags: { highway: 'footway' } })
  return [...out, ...extra]
}
const BBOX: [number, number, number, number] = [35.1695, 126.8995, 35.1708, 126.9025]
const graphOf = (elements: OsmEl[]) => loadWalkGraph(buildWalkGraph(elements, BBOX, { source: 'test', fetchedAt: '2026-01-01' }))

const ob = (id: string, rating: Obstacle['rating'], at: Pt, impact: Obstacle['impact'] = 'passage'): Obstacle => ({ id, name: id, kind: 'point', impact, rating, path: [at], origin: 'seed' })
const A: Pt = [LAT_A, LNG(1)]
const B5: Pt = [LAT_A, LNG(5)]

test('OSM 태그 → 길 성질·경사·턱 읽기', () => {
  assert.ok(wayMask({ highway: 'steps' }) & M.STEPS)
  assert.ok(wayMask({ highway: 'footway', footway: 'crossing' }) & M.CROSSING)
  assert.ok(wayMask({ highway: 'primary' }) & M.MAJOR)
  assert.ok(wayMask({ highway: 'footway', wheelchair: 'no' }) & M.WC_NO)
  assert.ok(wayMask({ highway: 'path', surface: 'dirt' }) & M.ROUGH)
  assert.equal(parseIncline('-8%'), -8)
  assert.equal(parseIncline('up'), 0)
  const g = buildWalkGraph(el([], { 12: { kerb: 'raised' }, 14: { kerb: 'lowered' } }), BBOX, { source: 't', fetchedAt: 'x' })
  const bits = Object.values(g.nk)
  assert.ok(bits.includes(NK.KERB_HIGH) && bits.includes(NK.KERB_LOW))
})

test('보행망 만들기: 교차점·끝점에서 토막, 가운데 점은 모양으로', () => {
  const g = buildWalkGraph(el(), BBOX, { source: 't', fetchedAt: 'x' })
  // 점: 1,5,11,15 (끝점·교차점). 중간 점 2,3,4와 12,13,14는 모양
  assert.equal(g.n.length / 2, 4)
  assert.equal(g.e.length, 4)
  const gr = loadWalkGraph(g)
  const total = gr.edges.reduce((s, e) => s + e.len, 0)
  assert.ok(total > 2 * 180 && total < 2 * 190 + 80, `총 길이 ${total}`)
})

test('foot=no·access=private 길은 뺀다', () => {
  const g = buildWalkGraph(el([{ type: 'way', id: 200, nodes: [3, 13], tags: { highway: 'footway', foot: 'no' } }]), BBOX, { source: 't', fetchedAt: 'x' })
  assert.equal(g.e.length, 4)
})

test('장애요소가 없으면 가장 짧은 길(보도 A)을 간다', () => {
  const g = graphOf(el())
  const r = findWalkRoute(g, A, B5, WALK_CFG, { avoid: false })
  assert.ok(r.route)
  assert.ok(Math.abs(r.route.distance - 4 * 45.6) < 6, `거리 ${r.route.distance}`)
})

test('X(어려움)를 피해 반대 줄 보도로 돌아간다', () => {
  const g = graphOf(el())
  const obstacles = [ob('X1', 'X', [LAT_A, LNG(3)])]
  const own = searchOwn(g, A, B5, obstacles, ROUTE_CFG, WALK_CFG)
  assert.ok(own.base && own.detour, '피해 가는 길이 있어야 한다')
  assert.equal(analyze(own.base.coords, obstacles, ROUTE_CFG.radiusM).filter((h) => h.role === 'X').length, 1)
  assert.equal(own.res.detourHits.filter((h) => h.role === 'X').length, 0)
  assert.equal(own.res.unresolved.length, 0)
  assert.ok(own.detour.distance > own.base.distance + 50, '북쪽 줄을 돌아가므로 약 66m 더 길다')
  assert.deepEqual(own.avoided.map((h) => h.o.id), ['X1'])
})

test('△(주의)는 돌아가는 길이 150m 이하일 때만 피한다', () => {
  const g = graphOf(el())
  const own = searchOwn(g, A, B5, [ob('T1', 'TRIANGLE', [LAT_A, LNG(3)])], ROUTE_CFG, WALK_CFG)
  assert.ok(own.detour, '66m 돌아가면 되니 피한다')
  const cheap = searchOwn(g, A, B5, [ob('T1', 'TRIANGLE', [LAT_A, LNG(3)])], ROUTE_CFG, { ...WALK_CFG, penaltyT: 30 })
  assert.equal(cheap.detour, null, '벌점이 돌아가는 거리보다 작으면 그대로 지난다')
})

test('양쪽이 다 막히면 대안 없음: 지나가고 unresolved에 남는다', () => {
  const g = graphOf(el())
  const obstacles = [ob('X1', 'X', [LAT_A, LNG(3)]), ob('X2', 'X', [LAT_B, LNG(3)])]
  const own = searchOwn(g, A, B5, obstacles, ROUTE_CFG, WALK_CFG)
  assert.ok(own.base)
  assert.ok(own.res.unresolved.length >= 1)
})

test('버스 타기·건물 출입(boarding·entry)·구역(zone)은 길을 막지 않는다', () => {
  const g = graphOf(el())
  const obstacles = [ob('S1', 'X', [LAT_A, LNG(3)], 'boarding'), ob('E1', 'X', [LAT_A, LNG(2)], 'entry'), ob('Z1', 'X', [LAT_A, LNG(4)], 'zone')]
  const own = searchOwn(g, A, B5, obstacles, ROUTE_CFG, WALK_CFG)
  assert.equal(own.detour, null)
})

test('출발 지점 자체의 X는 벌점에서 뺀다(피할 수 없다)', () => {
  const g = graphOf(el())
  const own = searchOwn(g, A, B5, [ob('X0', 'X', A)], ROUTE_CFG, WALK_CFG)
  assert.equal(own.detour, null)
  assert.equal(own.res.endpoint.length, 1)
  assert.equal(own.res.unresolved.length, 0)
})

test('계단은 큰 벌점: 다른 길이 있으면 돌아간다', () => {
  // A줄의 2-3 사이를 계단으로 바꾼다(2-3 토막). 북쪽 줄로 돌아가는 길이 있다.
  const base = el().filter((e) => e.id !== 100)
  const stairs: OsmEl[] = [
    { type: 'way', id: 110, nodes: [1, 2], tags: { highway: 'footway' } },
    { type: 'way', id: 111, nodes: [2, 3], tags: { highway: 'steps' } },
    { type: 'way', id: 112, nodes: [3, 4, 5], tags: { highway: 'footway' } },
  ]
  const g = graphOf([...base, ...stairs])
  const r = findWalkRoute(g, A, B5, WALK_CFG, { avoid: false })
  assert.ok(r.route)
  assert.equal(r.route.stepsM, 0, '계단을 지나지 않는다')
  assert.ok(r.route.distance > 4 * 45.6 + 50)
  // 돌아갈 길이 없으면 계단을 지나되 stepsM으로 알린다
  const only = graphOf([...stairs, ...el().filter((e) => e.type === 'node')])
  const r2 = findWalkRoute(only, A, B5, WALK_CFG, { avoid: false })
  assert.ok(r2.route && r2.route.stepsM > 40)
})

test('높은 턱 지점은 벌점: 낮춘 턱(lowered)이 있는 쪽을 고른다', () => {
  const g = graphOf(el([], { 3: { kerb: 'raised' } }))
  const r = findWalkRoute(g, A, B5, { ...WALK_CFG, penaltyKerbM: 500 }, { avoid: false })
  assert.ok(r.route)
  assert.ok(r.route.distance > 4 * 45.6 + 50, '턱 3번을 피해 북쪽 줄로 간다')
  const r2 = findWalkRoute(g, A, B5, WALK_CFG, { avoid: false })
  assert.ok(r2.route && r2.route.kerbCount >= 0)
})

test('보행망에서 너무 먼 출발·도착은 outside', () => {
  const g = graphOf(el())
  const far = findWalkRoute(g, [35.2, 127.0], B5, WALK_CFG, { avoid: false })
  assert.equal(far.route, null)
  assert.equal(far.error, 'outside')
})

test('길 가운데에서 출발·도착해도 길을 잘라 붙는다', () => {
  const g = graphOf(el())
  const mid: Pt = [LAT_A + 0.000008, LNG(2) + 0.0001]
  const mid2: Pt = [LAT_A + 0.000008, LNG(4) - 0.0001]
  const r = findWalkRoute(g, mid, mid2, WALK_CFG, { avoid: false })
  assert.ok(r.route)
  assert.ok(Math.abs(r.route.distance - (2 * 45.6 - 2 * 8.8)) < 8, `거리 ${r.route.distance}`)
})
