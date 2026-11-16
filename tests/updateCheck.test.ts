import test from 'node:test'
import assert from 'node:assert/strict'
import { RETRY_MS, isBusy, isDevBuild, shouldReload } from '../src/lib/updateCheck.ts'

test('다르면 새로고침, 같거나 잘못된 값이면 아님', () => {
  assert.equal(shouldReload('aaa', 'bbb', null, 0), true)
  assert.equal(shouldReload('aaa', 'aaa', null, 0), false)
  assert.equal(shouldReload('aaa', undefined, null, 0), false)
  assert.equal(shouldReload('aaa', '', null, 0), false)
})
test('개발판은 건너뜀', () => {
  assert.equal(isDevBuild('dev'), true)
  assert.equal(isDevBuild('55ee8be+dirty'), true)
  assert.equal(shouldReload('dev', 'bbb', null, 0), false)
  assert.equal(shouldReload('55ee8be+dirty', 'bbb', null, 0), false)
})
test('같은 새 빌드로 시도한 뒤 10분간은 재시도 안 함', () => {
  const last = { build: 'bbb', at: 1000 }
  assert.equal(shouldReload('aaa', 'bbb', last, 1000 + RETRY_MS - 1), false)
  assert.equal(shouldReload('aaa', 'bbb', last, 1000 + RETRY_MS), true)
  assert.equal(shouldReload('aaa', 'ccc', last, 2000), true)
})
test('작성 화면은 미룸', () => {
  const doc = { querySelector: () => null, activeElement: null } as unknown as Document
  assert.equal(isBusy(doc, '#/report?x=1'), true)
  assert.equal(isBusy(doc, '#/admin'), true)
  assert.equal(isBusy(doc, '#/'), false)
  assert.equal(isBusy({ querySelector: () => ({}), activeElement: null } as unknown as Document, '#/'), true)
  assert.equal(isBusy({ querySelector: () => null, activeElement: { tagName: 'INPUT' } } as unknown as Document, '#/me'), true)
})
