import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeGroup, rankPlaces, distanceM } from '../src/lib/placeRank.ts'

const C = { lat: 35.1765, lng: 126.9086 } // 가짜 기준점
const p = (name: string, addr: string, dLng: number) => ({ name, address_name: addr, road_address_name: '', y: String(C.lat), x: String(C.lng + dLng) })

test('묶음: 광주 북구 / 광주 다른 구 / 나머지', () => {
  assert.equal(placeGroup(p('a', '광주 북구 용봉동 300', 0)), 0)
  assert.equal(placeGroup(p('a', '전남광주통합특별시 북구 용봉동 300', 0)), 0)
  assert.equal(placeGroup({ x: '0', y: '0', address_name: '', road_address_name: '광주 북구 우치로 77' }), 0)
  assert.equal(placeGroup(p('a', '광주 동구 충장로', 0)), 1)
  assert.equal(placeGroup(p('a', '대구 북구 칠곡', 0)), 2)
  assert.equal(placeGroup(p('a', '경기 광주시 오포읍', 0)), 2)
  assert.equal(placeGroup(p('a', '', 0)), 2)
})

test('북구 → 광주 다른 구 → 전국, 같은 묶음은 거리순', () => {
  const items = [
    p('대구 가까움', '대구 북구 A', 0.0001),
    p('광주 서구 가까움', '광주 서구 B', 0.0002),
    p('북구 먼', '광주 북구 C', 0.02),
    p('북구 가까움', '광주 북구 D', 0.001),
    p('광주 동구 먼', '광주 동구 E', 0.05),
    p('경기 광주시', '경기 광주시 F', 0),
  ]
  const r = rankPlaces(items, C)
  assert.deepEqual(r.items.map((i) => i.name), ['북구 가까움', '북구 먼', '광주 서구 가까움', '광주 동구 먼', '경기 광주시', '대구 가까움'])
  assert.equal(r.hasBukgu, true)
})

test('북구 결과가 없으면 hasBukgu=false, 기준점이 없으면 원래 순서 유지', () => {
  const items = [p('대구', '대구 북구 A', 0.001), p('광주 서구', '광주 서구 B', 0.5), p('부산', '부산 북구 C', 0.0001)]
  const r = rankPlaces(items, null)
  assert.equal(r.hasBukgu, false)
  assert.deepEqual(r.items.map((i) => i.name), ['광주 서구', '대구', '부산'])
})

test('입력 배열을 바꾸지 않고, 거리 계산이 대략 맞다', () => {
  const items = [p('b', '대구 북구', 0), p('a', '광주 북구', 0)]
  rankPlaces(items, C)
  assert.equal(items[0].name, 'b')
  const d = distanceM(C, { lat: C.lat, lng: C.lng + 0.01 })
  assert.ok(d > 800 && d < 1000)
})
