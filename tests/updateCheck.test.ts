import test from 'node:test'
import assert from 'node:assert/strict'
import { EARLY_MS, RETRY_MS, canReloadNow, isTyping, isBusy, isDevBuild, isOldBuild, shouldReload } from '../src/lib/updateCheck.ts'

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

test('옛 버전 판정은 최신 배포 빌드 기준', () => {
  assert.equal(isOldBuild('new', 'new', 'old'), false) // 보는 기기가 옛 버전이어도 최신 기기는 옛 버전 아님
  assert.equal(isOldBuild('old', 'new', 'old'), true)
  assert.equal(isOldBuild('a', null, 'a'), false) // 읽기 실패 시 자기 빌드와 비교
  assert.equal(isOldBuild('b', null, 'a'), true)
  assert.equal(isOldBuild('b', 'c', 'dev'), false) // 개발판은 비교 끔
})

test('바쁨이 풀리면 바로 적용, 연 직후에는 바빠도 적용, 입력 중에는 미룸', () => {
  assert.equal(canReloadNow(false, true, EARLY_MS + 1), false) // 시트가 열려 있으면 미룸
  assert.equal(canReloadNow(false, false, EARLY_MS + 1), true) // 닫히면 바로
  assert.equal(canReloadNow(false, true, EARLY_MS - 1), true) // 연 직후엔 온보딩·시트가 떠 있어도
  assert.equal(canReloadNow(true, true, 0), false) // 입력 중에는 연 직후여도 미룸
  assert.equal(canReloadNow(true, false, EARLY_MS + 1), false)
})
test('입력 중 판정', () => {
  assert.equal(isTyping({ activeElement: { tagName: 'TEXTAREA' } } as unknown as Document), true)
  assert.equal(isTyping({ activeElement: { tagName: 'BUTTON' } } as unknown as Document), false)
  assert.equal(isTyping({ activeElement: null } as unknown as Document), false)
})
