import test from 'node:test'
import assert from 'node:assert/strict'
import { clusterByScreen } from '../src/lib/routing/markerCluster.ts'

test('가까운 딱지는 한 묶음, 먼 딱지는 따로 — 입력 순서·개수가 보존된다', () => {
  const pts = [
    { x: 100, y: 100 },
    { x: 120, y: 105 }, // 첫 점과 가까움
    { x: 300, y: 100 }, // 멂
    { x: 105, y: 130 }, // 세로로 멂(22px 이상)
    { x: 110, y: 95 }, // 첫 점과 가까움
  ]
  const g = clusterByScreen(pts)
  assert.deepEqual(g, [[0, 1, 4], [2], [3]])
  assert.equal(g.flat().length, pts.length)
  assert.deepEqual(clusterByScreen([]), [])
})
