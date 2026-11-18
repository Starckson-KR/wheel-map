import test from 'node:test'
import assert from 'node:assert/strict'
import { searchDelay, showRecommended } from '../src/lib/routing/searchUi.ts'

test('입력칸이 비어 있거나 공백뿐이면 추천 경로를 보여 준다', () => {
  assert.equal(showRecommended(''), true)
  assert.equal(showRecommended('   '), true)
})

test('한 글자라도 입력하면 추천 경로 대신 검색 결과로 바뀐다', () => {
  assert.equal(showRecommended('전'), false)
  assert.equal(showRecommended(' 전남대 '), false)
})

test('입력이 비면 찾지 않고, 처음 한 번은 바로, 이후에는 잠시 기다렸다 찾는다', () => {
  assert.equal(searchDelay('', false), null)
  assert.equal(searchDelay('  ', true), null)
  assert.equal(searchDelay('전남대', true), 0)
  assert.equal(searchDelay('전남대', false), 350)
})
