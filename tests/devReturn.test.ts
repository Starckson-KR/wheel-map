import test from 'node:test'
import assert from 'node:assert/strict'
import { clearDevReturn, markDevReturn, readDevReturn } from '../src/lib/devReturn.ts'

const fake = (state: unknown = null) => {
  const h = {
    state,
    replaceState(s: unknown) {
      h.state = s
    },
  }
  return h
}

test('표시가 없으면 되돌아갈 곳이 없다', () => {
  assert.equal(readDevReturn(fake()), null)
  assert.equal(readDevReturn(fake({ other: 1 })), null)
})

test('표시하면 읽히고, 다른 기록 상태는 그대로 둔다', () => {
  const h = fake({ other: 1 })
  markDevReturn('reports', h)
  assert.equal(readDevReturn(h), 'reports')
  assert.deepEqual((h.state as Record<string, unknown>).other, 1)
})

test('지우면 표시만 사라진다', () => {
  const h = fake({ other: 1 })
  markDevReturn('users', h)
  clearDevReturn(h)
  assert.equal(readDevReturn(h), null)
  assert.deepEqual(h.state, { other: 1 })
  const g = fake()
  markDevReturn('reports', g)
  clearDevReturn(g)
  assert.equal(g.state, null)
})

test('알 수 없는 값은 무시한다', () => {
  assert.equal(readDevReturn(fake({ wmDevAdminReturn: 'x' })), null)
})
