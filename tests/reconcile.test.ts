import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanIds, pickGone } from '../src/lib/account/reconcile.ts'

const set = (...v: string[]) => new Set(v)
const base = { local: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e', demo: true }, { id: 'f', demoSet: 'large' }, { id: 'g' }], localOnly: set(), pending: set() }

test('서버와 맞춘 적 있고 서버 목록에 없는 제보만 지운다', () => {
  const ids = pickGone({ ...base, synced: set('a', 'b', 'c'), serverIds: set('b') })
  assert.deepEqual(ids, ['a', 'c'])
})

test('서버와 맞춘 적 없는 로컬 제보(d, g)·시연 데이터·샘플은 서버에 없어도 지우지 않는다', () => {
  const ids = pickGone({ ...base, synced: set('e', 'f'), serverIds: set() })
  assert.deepEqual(ids, [])
  assert.deepEqual(pickGone({ ...base, synced: set(), serverIds: set() }), [])
})

test('서버가 거절해 로컬에만 남긴 제보와 아직 못 올린 변경이 있는 제보는 지우지 않는다', () => {
  const ids = pickGone({ ...base, synced: set('a', 'b', 'c'), localOnly: set('a'), pending: set('b'), serverIds: set() })
  assert.deepEqual(ids, ['c'])
})

test('삭제 id 목록은 문자열만 남긴다', () => {
  assert.deepEqual(cleanIds(['a', '', 3, null, 'b']), ['a', 'b'])
  assert.deepEqual(cleanIds(undefined), [])
  assert.deepEqual(cleanIds({}), [])
})
