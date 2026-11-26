// 실행: node --import ./scripts/registerTs.mjs --test tests/alertOrder.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergePairedAlerts, sortAlerts } from '../src/lib/alertOrder.ts'

test('알림 순서: 최신이 위로 온다(시간대 표기가 섞여도 실제 시각으로)', () => {
  const list = [
    { key: 'old', at: '2026-11-17T03:00:00.000Z' },
    { key: 'new', at: '2026-11-25T01:00:00.000Z' },
    { key: 'mid', at: '2026-11-23T09:00:00+09:00' }, // = 11-23 00:00Z
    { key: 'mid2', at: '2026-11-23T02:00:00.000Z' },
  ]
  assert.deepEqual(sortAlerts(list).map((x) => x.key), ['new', 'mid2', 'mid', 'old'])
})

test('알림 순서: 실제·체험을 가르지 않고 최신순', () => {
  const list = [
    { key: 'mock-new', at: '2026-11-25T01:00:00.000Z', mock: true },
    { key: 'real-old', at: '2026-11-17T03:00:00.000Z' },
    { key: 'mock-old', at: '2026-11-20T03:00:00.000Z', mock: true },
    { key: 'real-new', at: '2026-11-23T03:00:00.000Z' },
  ]
  assert.deepEqual(sortAlerts(list).map((x) => x.key), ['mock-new', 'real-new', 'mock-old', 'real-old'])
  assert.deepEqual(sortAlerts([]), [])
})

test('알림 합치기: 같은 짝 표지의 상태 알림과 점수 알림은 한 줄, 점수는 상태 줄에 붙는다', () => {
  const list = [
    { key: 's-1', kind: 'report' as const, pair: 'r1:verified:T' },
    { key: 'p-1', kind: 'points' as const, points: 10, pair: 'r1:verified:T' },
    { key: 'p-2', kind: 'points' as const, points: 5 },
    { key: 's-2', kind: 'report' as const },
  ]
  const out = mergePairedAlerts(list)
  assert.deepEqual(out.map((x) => x.key), ['s-1', 'p-2', 's-2'])
  assert.equal(out[0].points, 10)
})

test('알림 합치기: 짝이 다르거나 한쪽뿐이면 그대로 둔다', () => {
  const list = [
    { key: 's-1', kind: 'report' as const, pair: 'r1:verified:A' },
    { key: 'p-1', kind: 'points' as const, points: 10, pair: 'r1:verified:B' },
    { key: 'p-3', kind: 'points' as const, points: 10, pair: 'r9:verified:A' },
  ]
  assert.deepEqual(mergePairedAlerts(list).map((x) => x.key), ['s-1', 'p-1', 'p-3'])
  assert.deepEqual(mergePairedAlerts([]), [])
})
