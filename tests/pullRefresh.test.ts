import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canStartPull, PULL_LABEL, pullOffset, pullPhase, pullProgress, pullReady, PULL_RESIST } from '../src/lib/pullRefresh.ts'
import { canCircleReveal, farthestCorner } from '../src/lib/circleReveal.ts'
import { REFRESH_PULL } from '../src/lib/motionTokens.ts'

test('당기기: 저항을 곱해 따라오고 기준 거리에서 멈춘다', () => {
  assert.equal(pullOffset(0), 0)
  assert.equal(pullOffset(-30), 0)
  assert.equal(pullOffset(50), 50 * PULL_RESIST)
  assert.equal(pullOffset(1000), REFRESH_PULL)
  assert.equal(pullProgress(1000), 1)
  assert.equal(pullProgress(0), 0)
})

test('당기기: 기준 거리를 넘어야 놓으면 새로고침', () => {
  const need = REFRESH_PULL / PULL_RESIST
  assert.equal(pullReady(need - 1), false)
  assert.equal(pullReady(need), true)
  assert.equal(pullPhase(0, false), 'idle')
  assert.equal(pullPhase(20, false), 'pull')
  assert.equal(pullPhase(need, false), 'ready')
  assert.equal(pullPhase(need, true), 'busy')
  assert.equal(PULL_LABEL.idle, '')
  assert.ok(PULL_LABEL.ready.length > 0)
})

test('당기기 시작: 모든 스크롤 영역이 맨 위일 때만, 새로고침 중이 아닐 때만', () => {
  assert.equal(canStartPull([0], false), true)
  assert.equal(canStartPull([0, 0], false), true)
  assert.equal(canStartPull([0, 12], false), false)
  assert.equal(canStartPull([5], false), false)
  assert.equal(canStartPull([0], true), false)
})

test('원형 전환: 가장 먼 모서리까지의 거리, 미지원이면 쓰지 않는다', () => {
  assert.equal(farthestCorner(0, 0, 300, 400), 500)
  assert.equal(farthestCorner(300, 400, 300, 400), 500)
  assert.equal(farthestCorner(150, 200, 300, 400), 250)
  assert.equal(canCircleReveal(), false) // 시험 환경에는 document가 없다
})
