import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WALK_CFG, ROUTE_CFG } from '../src/lib/config.ts'
import type { Pt } from '../src/lib/routing/engine.ts'
import { alongRoute, alongRows, cardNotes, floodSpots, overpassSpots, routeFacts, spotsNearRoute, FLOOD_MIN_COUNT, type LayerPool } from '../src/lib/routing/layerRoute.ts'
import { searchOwn } from '../src/lib/routing/ownSearch.ts'
import { buildWalkGraph, loadWalkGraph, type OsmEl } from '../src/lib/routing/walkGraph.ts'

const item = (id: string, lat: number, lng: number, fields: Record<string, unknown> = {}) => ({ id, name: id, lat, lng, fields })
// 동쪽으로 뻗은 약 410m 직선 경로(경도 0.0001 ≈ 9.1m)
const route: Pt[] = [[35.17, 126.9], [35.17, 126.9045]]
const LNG = (m: number) => 126.9 + m / 91000

test('침수는 피해 3건 이상 칸만 쓴다', () => {
  assert.equal(FLOOD_MIN_COUNT, 3)
  const spots = floodSpots([item('a', 35.17, 126.9, { 건수: 2 }), item('b', 35.17, 126.9, { 건수: 3 }), item('c', 35.17, 126.9, { 건수: 10 }), item('d', 35.17, 126.9, {})])
  assert.deepEqual(spots.map((s) => s.id), ['b', 'c'])
})

test('육교는 장애인편의시설(엘리베이터 등)이 있는 곳(Y)을 뺀다', () => {
  const spots = overpassSpots([item('n', 35.17, 126.9, { 장애인편의시설설치여부: 'N' }), item('y', 35.17, 126.9, { 장애인편의시설설치여부: 'Y' })])
  assert.deepEqual(spots.map((s) => s.id), ['n'])
})

test('경로가 지나는 지점: 반경 안만, 출발·도착 바로 옆은 뺀다', () => {
  const spots = overpassSpots([
    item('mid', 35.17, LNG(200), { 장애인편의시설설치여부: 'N' }), // 길 위
    item('side', 35.17 + 25 / 111320, LNG(250), { 장애인편의시설설치여부: 'N' }), // 25m 옆(30m 안)
    item('far', 35.17 + 60 / 111320, LNG(250), { 장애인편의시설설치여부: 'N' }), // 60m 옆
    item('start', 35.17, LNG(5), { 장애인편의시설설치여부: 'N' }), // 출발점 바로 옆
  ])
  assert.deepEqual(spotsNearRoute(route, spots).map((s) => s.id), ['mid', 'side'])
})

test('가는 길에 있어요: 경로 60m 안 개수와 가장 가까운 거리, 가까운 순', () => {
  const lat = (m: number) => 35.17 + m / 111320
  const a = alongRoute(route, [
    { id: '1', name: '1', lat: lat(50), lng: LNG(100) },
    { id: '2', name: '2', lat: lat(20), lng: LNG(300) },
    { id: '3', name: '3', lat: lat(61), lng: LNG(300) },
  ], 60)
  assert.equal(a.count, 2)
  assert.equal(a.nearestM, 20)
  assert.deepEqual(a.items.map((x) => x.item.id), ['2', '1'])
})

test('가는 길 줄 문구: 정류장은 「가까운 정류장」, 비 피할 정류장이라 쓰지 않는다', () => {
  const pool: LayerPool = {
    overpass: [],
    flood: [],
    toilets: [{ id: 't', name: 't', lat: 35.17 + 3 / 111320, lng: LNG(100) }],
    shades: [],
    stops: [{ id: 's', name: 's', lat: 35.17 + 40 / 111320, lng: LNG(100) }, { id: 's2', name: 's2', lat: 35.17 + 55 / 111320, lng: LNG(120) }],
    schools: [{ id: 'k', name: 'k', lat: 35.17 + 90 / 111320, lng: LNG(100) }],
  }
  const rows = alongRows(routeFacts(route, pool))
  assert.deepEqual(rows.map((r) => r.label), ['장애인화장실 1곳', '가까운 정류장 2곳', '어린이보호구역 근처 1곳'])
  assert.equal(rows[0].sub, '길 바로 옆')
  assert.equal(rows[1].sub, '길에서 40m')
  assert.equal(rows[2].sub, null)
  assert.ok(!rows.some((r) => r.label.includes('비 피')))
})

test('카드 배지: 가장 짧은 길이 지나고 이 길은 안 지나면 「피했어요」', () => {
  const sp = (id: string, kind: 'overpass' | 'flood') => ({ id, kind, lat: 0, lng: 0, radiusM: 30, penaltyM: 1 })
  const none = routeFacts(route, { overpass: [], flood: [], toilets: [], shades: [], stops: [], schools: [] })
  const base = { ...none, overpass: [sp('o', 'overpass')], flood: [sp('f1', 'flood'), sp('f2', 'flood')] }
  const det = { ...none, flood: [sp('f1', 'flood')] }
  assert.deepEqual(cardNotes(none, base, false), { avoided: ['overpass', 'flood'], passes: { overpass: 0, flood: 0 } })
  assert.deepEqual(cardNotes(det, base, false), { avoided: ['overpass'], passes: { overpass: 0, flood: 1 } }) // 침수는 일부만 피함: 「피했어요」 아님
  assert.deepEqual(cardNotes(base, base, true), { avoided: [], passes: { overpass: 1, flood: 2 } })
})

// ───── 경로 계산: 침수 지점·육교 벌점으로 우회 ─────
// 남쪽 줄 A와 북쪽 줄 B(약 33m 떨어짐)가 양 끝에서만 이어진 작은 보행망
const LAT_A = 35.17
const LAT_B = 35.1703
const GL = (i: number) => 126.9 + (i - 1) * 0.0005
function elements(): OsmEl[] {
  const out: OsmEl[] = []
  for (let i = 1; i <= 5; i++) {
    out.push({ type: 'node', id: i, lat: LAT_A, lon: GL(i) })
    out.push({ type: 'node', id: 10 + i, lat: LAT_B, lon: GL(i) })
  }
  out.push({ type: 'way', id: 100, nodes: [1, 2, 3, 4, 5], tags: { highway: 'footway', footway: 'sidewalk' } })
  out.push({ type: 'way', id: 101, nodes: [11, 12, 13, 14, 15], tags: { highway: 'footway', footway: 'sidewalk' } })
  out.push({ type: 'way', id: 102, nodes: [1, 11], tags: { highway: 'footway' } })
  out.push({ type: 'way', id: 103, nodes: [5, 15], tags: { highway: 'footway' } })
  return out
}
const g = loadWalkGraph(buildWalkGraph(elements(), [35.1695, 126.8995, 35.1708, 126.9025], { source: 'test', fetchedAt: '2026-01-01' }))
const A: Pt = [LAT_A, GL(1)]
const B5: Pt = [LAT_A, GL(5)]
const spotAt = (kind: 'flood' | 'overpass', lng: number) => floodSpots([item('f', LAT_A, lng, { 건수: 5 })]).concat(kind === 'overpass' ? overpassSpots([item('o', LAT_A, lng, { 장애인편의시설설치여부: 'N' })]) : []).filter((s) => s.kind === kind)

test('맑은 날(침수 지점 없음)에는 경로가 그대로다', () => {
  const own = searchOwn(g, A, B5, [], ROUTE_CFG, WALK_CFG, [])
  assert.equal(own.detour, null)
})

test('침수 3건 이상 칸이 길 위에 있으면 피해 가는 길이 생긴다', () => {
  const soft = spotAt('flood', GL(3)).map((s) => ({ ...s, radiusM: 20 })) // 시험 보행망은 두 줄이 33m 간격이라 반경을 줄인다
  const own = searchOwn(g, A, B5, [], ROUTE_CFG, WALK_CFG, soft)
  assert.ok(own.detour, '피해 가는 길이 있어야 한다')
  assert.equal(spotsNearRoute(own.base!.coords, soft).length, 1)
  assert.equal(spotsNearRoute(own.detour!.coords, soft).length, 0)
})

test('육교 지점도 같은 방식으로 피한다', () => {
  const soft = spotAt('overpass', GL(3))
  const own = searchOwn(g, A, B5, [], ROUTE_CFG, WALK_CFG, soft)
  assert.ok(own.detour)
  assert.equal(spotsNearRoute(own.detour!.coords, soft).length, 0)
})

test('출발점 바로 옆 침수 지점은 피할 수 없으니 우회하지 않는다', () => {
  const own = searchOwn(g, A, B5, [], ROUTE_CFG, WALK_CFG, spotAt('flood', GL(1) + 0.00005))
  assert.equal(own.detour, null)
})
