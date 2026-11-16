import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncedKeysFor } from '../src/lib/account/keys.ts'
import { nextDelay, POLL_ACTIVE_MS, POLL_IDLE_MS, BACKOFF_MAX_MS } from '../src/lib/account/pollPlan.ts'
import { isMockReport, realFirst } from '../src/lib/realFirst.ts'
import { mergeReport } from '../src/lib/account/merge.ts'

test('터치 기기는 보기 방식(wheelmap.view)을 서버와 맞추지 않고, PC는 맞춘다', () => {
  assert.ok(!syncedKeysFor(true).includes('wheelmap.view'))
  assert.ok(syncedKeysFor(true).includes('wheelmap.theme'))
  assert.ok(syncedKeysFor(false).includes('wheelmap.view'))
})

test('확인 주기: 쓰는 중 4초, 한참 쉬면 15초, 실패하면 두 배씩 늘어 60초까지', () => {
  assert.equal(nextDelay(0, 0, 0.5), POLL_ACTIVE_MS)
  assert.equal(nextDelay(0, 120000, 0.5), POLL_IDLE_MS)
  assert.equal(nextDelay(1, 0, 0.5), POLL_ACTIVE_MS * 2)
  assert.equal(nextDelay(2, 0, 0.5), POLL_ACTIVE_MS * 4)
  assert.ok(nextDelay(9, 0, 1) <= BACKOFF_MAX_MS * 1.1)
})

test('실제 제보가 모의·체험 제보보다 먼저, 각 묶음 안의 순서는 유지', () => {
  const list = [{ id: 'a', demo: true }, { id: 'b' }, { id: 'c', sample: true }, { id: 'd', demoSet: 'large' as const }, { id: 'e' }]
  assert.deepEqual(realFirst(list, isMockReport).map((x) => x.id), ['b', 'e', 'a', 'c', 'd'])
})

test('두 기기 동시 수정: 기록·투표는 합집합, 나머지 필드는 incoming(나중 도착)이 이긴다', () => {
  const base: any = { id: 'r', userId: 'u', createdAt: 't0', status: 'pending', description: '원본', verification: { votes: 0, voterIds: [] }, history: [{ status: 'pending', at: '1', by: 'u' }] }
  const a = { ...base, description: 'A', history: [...base.history, { status: 'pending', at: '2', by: 'u', memo: 'A' }] }
  const b = { ...base, description: 'B', verification: { votes: 1, voterIds: ['v'] }, history: [...base.history, { status: 'pending', at: '3', by: 'v', memo: 'B' }] }
  const m = mergeReport(a, b)
  assert.equal(m.description, 'B')
  assert.deepEqual(m.verification.voterIds, ['v'])
  assert.deepEqual(m.history.map((h: any) => h.memo).filter(Boolean), ['A', 'B'])
})
