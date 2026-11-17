import test from 'node:test'
import assert from 'node:assert/strict'
import { pickVisible } from '../src/lib/sheetHost.ts'

// 뒤로가기로 홈에 돌아올 때: 지도 틀이 아직 보이는 순간(숨기기 전)과 숨긴 뒤의 선택이 달라야 한다
test('숨겨지지 않은 첫 틀을 고른다', () => {
  const map = { name: 'map', hidden: false }
  const other = { name: 'other', hidden: false }
  assert.equal(pickVisible([map, other], (e) => e.hidden), map)
  map.hidden = true // 홈으로 돌아와 지도가 숨겨진 뒤
  assert.equal(pickVisible([map, other], (e) => e.hidden), other)
})

test('모두 숨겨졌으면 고르지 않는다(호출한 쪽이 body로 대신한다)', () => {
  assert.equal(pickVisible([{ hidden: true }], (e) => e.hidden), undefined)
  assert.equal(pickVisible([], () => false), undefined)
})
