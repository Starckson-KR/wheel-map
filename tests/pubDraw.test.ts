import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickNearestTotal } from '../src/lib/pubDraw.ts'

const c = { lat: 35.17, lng: 126.9 }
const pt = (dLat: number, dLng = 0) => ({ lat: c.lat + dLat, lng: c.lng + dLng })

test('합계가 상한 이하면 그대로 돌려준다', () => {
  const g = [{ layer: 'a', items: [pt(0.001), pt(0.002)] }, { layer: 'b', items: [pt(0.003)] }]
  const r = pickNearestTotal(g, c, 3)
  assert.deepEqual(r.map((x) => x.items.length), [2, 1])
})

test('레이어를 합쳐 합계 상한까지, 중심에 가까운 것부터 남긴다', () => {
  const a = [pt(0.01), pt(0.001), pt(0.05)]
  const b = [pt(0.002), pt(0.04)]
  const r = pickNearestTotal([{ layer: 'a', items: a }, { layer: 'b', items: b }], c, 3)
  assert.equal(r[0].items.length + r[1].items.length, 3)
  assert.deepEqual(r[0].items, [a[0], a[1]]) // 0.01과 0.001 (입력 순서 유지)
  assert.deepEqual(r[1].items, [b[0]])
})

test('경도 방향 거리도 가깝고 먼 순서에 반영한다', () => {
  const near = pt(0, 0.0005)
  const far = pt(0, 0.02)
  const r = pickNearestTotal([{ layer: 'a', items: [far, near] }], c, 1)
  assert.deepEqual(r[0].items, [near])
})

test('상한 0이면 아무것도 남기지 않고, 큰 입력도 합계를 지킨다', () => {
  assert.equal(pickNearestTotal([{ layer: 'a', items: [pt(0.1), pt(0.2)] }], c, 0)[0].items.length, 0)
  const many = Array.from({ length: 2000 }, (_, i) => pt(i * 1e-5))
  const r = pickNearestTotal([{ layer: 'a', items: many }, { layer: 'b', items: many }], c)
  assert.equal(r[0].items.length + r[1].items.length, 800)
})
