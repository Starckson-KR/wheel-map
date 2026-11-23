import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bearingAhead, bearingOf, firstSymbolId, followPadding, glNavEnabled, koreanizeStyle, routeCollection, toLngLat } from '../src/lib/guideGl/core.ts'
import type { Pt } from '../src/lib/routing/engine.ts'

const near = (a: number | null, b: number, e = 1) => assert.ok(a !== null && Math.abs(a - b) <= e, `${a} ≈ ${b}`)

test('3D 지도 켜기: 기본 켜짐, navmap=off일 때만 끈다(주소 앞쪽·해시 안쪽 모두)', () => {
  assert.equal(glNavEnabled('', '#/map'), true)
  assert.equal(glNavEnabled('?navmap=gl', '#/map'), true)
  assert.equal(glNavEnabled('?navmap=x', ''), true)
  assert.equal(glNavEnabled('?navmap=off', '#/map'), false)
  assert.equal(glNavEnabled('', '#/map?navmap=off'), false)
})

test('경로선 자료: 구간이 있으면 구간마다 색을 달리, 없으면 전체 한 줄', () => {
  const colorOf = (l: { kind: string; route?: string }) => (l.kind === 'bus' ? '#2e9b4a' : '#2272eb')
  const w: Pt[] = [[35, 127], [35, 127.001]]
  const b: Pt[] = [[35, 127.001], [35.001, 127.001]]
  const two = routeCollection([...w, ...b], [{ coords: w, kind: 'walk' }, { coords: b, kind: 'bus', route: '지선:1' }], colorOf)
  assert.deepEqual(two.features.map((f) => f.properties.color), ['#2272eb', '#2e9b4a'])
  assert.deepEqual(two.features[0].geometry.coordinates[0], [127, 35]) // [lng,lat]
  const one = routeCollection(w, undefined, colorOf)
  assert.equal(one.features.length, 1)
  assert.equal(routeCollection(w, [{ coords: [[35, 127]], kind: 'walk' }], colorOf).features.length, 1) // 점 하나짜리 구간은 건너뛰고 전체로
})

test('한글 라벨: name:nonlatin 식을 name:ko → name 순서로 바꾸고, 도로 번호(ref)와 원본은 건드리지 않는다', () => {
  const style = {
    layers: [
      { id: 'a', type: 'symbol', layout: { 'text-field': ['case', ['has', 'name:nonlatin'], ['concat', ['get', 'name:latin'], ' ', ['get', 'name:nonlatin']], ['coalesce', ['get', 'name_en'], ['get', 'name']]] } },
      { id: 'b', type: 'symbol', layout: { 'text-field': ['to-string', ['get', 'ref']] } },
      { id: 'c', type: 'line', layout: {} },
    ],
  }
  const out = koreanizeStyle(style)
  assert.deepEqual(out.layers[0].layout['text-field'], ['coalesce', ['get', 'name:ko'], ['get', 'name']])
  assert.deepEqual(out.layers[1].layout['text-field'], ['to-string', ['get', 'ref']])
  assert.equal(JSON.stringify(style.layers[0].layout['text-field']).includes('name:ko'), false) // 원본 그대로
  assert.equal(firstSymbolId(out), 'a')
})

test('좌표 순서: [lat,lng] → [lng,lat]', () => {
  assert.deepEqual(toLngLat([35.17, 126.9]), [126.9, 35.17])
})

test('방위: 북·동·남·서', () => {
  near(bearingOf([35, 127], [35.001, 127]), 0)
  near(bearingOf([35, 127], [35, 127.001]), 90)
  near(bearingOf([35, 127], [34.999, 127]), 180)
  near(bearingOf([35, 127], [35, 126.999]), 270)
})

test('경로 방향: 내 위치에서 경로를 따라 앞쪽 방향을 돌려준다(꺾이는 길도)', () => {
  const east: Pt[] = [[35, 127], [35, 127.001], [35, 127.002]]
  near(bearingAhead(east, [35.00001, 127.0003]), 90)
  // ㄱ자: 동쪽 100m 뒤 북쪽으로 꺾임. 꺾이기 10m 전에서 25m 앞을 보면 북동쪽으로 기운다
  const L: Pt[] = [[35, 127], [35, 127 + 100 / (111320 * Math.cos((35 * Math.PI) / 180))], [35.001, 127 + 100 / (111320 * Math.cos((35 * Math.PI) / 180))]]
  const b = bearingAhead(L, [35, 127 + 90 / (111320 * Math.cos((35 * Math.PI) / 180))])
  assert.ok(b !== null && b > 20 && b < 70, `꺾이는 길 ${b}`)
  near(bearingAhead(east, [35, 127.002]), 90) // 끝에 닿으면 마지막 구간 방향
  assert.equal(bearingAhead([[35, 127]], [35, 127]), null)
})

test('내 위치 자리: 진행 방향 위 모드는 보이는 영역의 아래쪽 70%', () => {
  assert.deepEqual(followPadding(800, { top: 100, bottom: 200, left: 0 }, false), { top: 100, bottom: 200, left: 0, right: 0 })
  // 보이는 높이 500, 위 여백 100 + 200 = 300 → 중심 y = 300 + (800-300-200)/2 = 450 = 100 + 500*0.7
  assert.deepEqual(followPadding(800, { top: 100, bottom: 200, left: 460 }, true), { top: 300, bottom: 200, left: 460, right: 0 })
})
