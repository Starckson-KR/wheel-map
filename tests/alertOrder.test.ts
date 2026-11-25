// 실행: node --import ./scripts/registerTs.mjs --test tests/alertOrder.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { sortAlerts } from '../src/lib/alertOrder.ts'

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
