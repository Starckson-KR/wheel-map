import test from 'node:test'
import assert from 'node:assert/strict'
import { photoKeysOfRemoved } from '../src/lib/photoStore.ts'

test('지워지는 제보의 사진 키만 고른다', () => {
  const reports = [
    { id: 'a', photos: ['a1', 'a2'] },
    { id: 'b', photos: ['b1'] },
    { id: 'c' },
  ]
  assert.deepEqual(photoKeysOfRemoved(reports, new Set(['a', 'c'])).sort(), ['a1', 'a2'])
})

test('시연 데모 제보의 사진은 지우지 않는다', () => {
  const reports = [
    { id: 'd', demo: true, photos: ['d1'] },
    { id: 'e', demoSet: 'large', photos: ['e1'] },
    { id: 'f', photos: ['f1'] },
  ]
  assert.deepEqual(photoKeysOfRemoved(reports, new Set(['d', 'e', 'f'])), ['f1'])
})
