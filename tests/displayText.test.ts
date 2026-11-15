import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publicIssue } from '../src/lib/displayText.ts'

test('앞머리 표시를 뗀다', () => {
  assert.equal(publicIssue('미흡(서술): 진입 경사로 가파름, 호수공원 가는 길 계단뿐'), '진입 경사로 가파름, 호수공원 가는 길 계단뿐')
})
test('출처 괄호를 뗀다', () => {
  assert.equal(publicIssue('이용자와 차량이 만나는 데 시간이 걸림(새빛콜 인터뷰 진술)'), '이용자와 차량이 만나는 데 시간이 걸림')
})
test('확인 안 됨 항목을 뗀다', () => {
  assert.equal(publicIssue('1층 주 출입구 경사로 확인 안 됨, 계단 위주, 화장실 입구 수동 당김문'), '계단 위주, 화장실 입구 수동 당김문')
})
test('괄호 안 쉼표와 일반 문장은 그대로 둔다', () => {
  const s = '급한 고저차(수동 휠체어 오르내림 부담), 턱 낮춤은 기준만 겨우 충족해 1대만 통과'
  assert.equal(publicIssue(s), s)
})
test('남는 것이 없으면 null', () => {
  assert.equal(publicIssue('출입구 확인 안 됨'), null)
  assert.equal(publicIssue(undefined), null)
})
