import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveStart, startPlan } from '../src/lib/routing/startPlace.ts'
import { nearWalkNet } from '../src/lib/routing/walkRoute.ts'
import { WALK_CFG } from '../src/lib/config.ts'
import { buildWalkGraph, loadWalkGraph, type OsmEl } from '../src/lib/routing/walkGraph.ts'

const base = { hasPreset: false, hasFrom: false, hasGeo: true }

test('권한 상태별 출발지 채우는 방식', () => {
  assert.equal(startPlan('granted', base), 'silent')
  assert.equal(startPlan('prompt', base), 'onPick')
  assert.equal(startPlan('unknown', base), 'onPick')
  assert.equal(startPlan('denied', base), 'none')
})

test('홈 검색에서 출발지를 가져왔거나 이미 정했거나 위치 기능이 없으면 채우지 않는다', () => {
  assert.equal(startPlan('granted', { ...base, hasPreset: true }), 'none')
  assert.equal(startPlan('prompt', { ...base, hasFrom: true }), 'none')
  assert.equal(startPlan('granted', { ...base, hasGeo: false }), 'none')
})

test('시범 지역 안이면 내 위치, 밖이거나 못 얻었으면 비운다', () => {
  const r = resolveStart({ lat: 35.17, lng: 126.9 }, true)
  assert.ok(r.ok && r.place.name === '내 위치' && r.place.lat === 35.17)
  assert.equal(resolveStart({ lat: 35.17, lng: 126.9 }, false).ok, false)
  assert.equal(resolveStart(null, true).ok, false)
  assert.equal(resolveStart({ lat: NaN, lng: 126.9 }, true).ok, false)
})

test('보행망 150m 안인지 판정한다(길찾기의 밖 판정과 같은 조건)', () => {
  const els: OsmEl[] = [
    { type: 'node', id: 1, lat: 35.17, lon: 126.9 },
    { type: 'node', id: 2, lat: 35.17, lon: 126.9005 },
    { type: 'way', id: 100, nodes: [1, 2], tags: { highway: 'footway', footway: 'sidewalk' } },
  ]
  const g = loadWalkGraph(buildWalkGraph(els, [35.168, 126.898, 35.172, 126.903], { source: 'test', fetchedAt: '2026-01-01' }))
  assert.equal(nearWalkNet(g, [35.1701, 126.90025], WALK_CFG.snapMaxM), true)
  assert.equal(nearWalkNet(g, [35.1712, 126.90025], WALK_CFG.snapMaxM), true) // 약 145m
  assert.equal(nearWalkNet(g, [35.1740, 126.90025], WALK_CFG.snapMaxM), false) // 약 445m
})
