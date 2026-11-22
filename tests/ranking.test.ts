import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignRanks } from '../src/lib/ranking.ts'

const mock = (id: string) => id.startsWith('m')

test('랭킹: 점수가 높은 사람이 실제·가상과 상관없이 위에 온다', () => {
  const rows = assignRanks(
    [
      { userId: 'r1', points: 5 },
      { userId: 'm1', points: 420 },
      { userId: 'm2', points: 80 },
      { userId: 'r2', points: 0 },
      { userId: 'r3', points: 100 },
    ],
    mock,
  )
  assert.deepEqual(rows.map((r) => r.userId), ['m1', 'r3', 'm2', 'r1', 'r2'])
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4, null])
})

test('랭킹: 점수는 숫자로 비교한다(99점이 100점 위로 가지 않는다)', () => {
  const rows = assignRanks([{ userId: 'a', points: 99 }, { userId: 'b', points: 100 }, { userId: 'c', points: 9 }], mock)
  assert.deepEqual(rows.map((r) => r.userId), ['b', 'a', 'c'])
})

test('랭킹: 동점은 같은 순위이고 실제 사용자가 먼저', () => {
  const rows = assignRanks([{ userId: 'm1', points: 30 }, { userId: 'r1', points: 30 }, { userId: 'r2', points: 10 }], mock)
  assert.deepEqual(rows.map((r) => [r.userId, r.rank]), [['r1', 1], ['m1', 1], ['r2', 3]])
})
