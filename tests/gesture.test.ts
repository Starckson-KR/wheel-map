import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commitDir, fanHit, fanOffsets, fanShiftX, lockAxis, longPressProgress, longPressState } from '../src/lib/gesture.ts'
import { makePieces, confettiTotalMs, CONFETTI_COLORS, CONFETTI_MAX_MS, CONFETTI_MIN_MS } from '../src/lib/confetti.ts'
import { HAPTIC_PATTERN, haptic } from '../src/lib/haptic.ts'
import { COMMIT_RATIO, LONG_PRESS_MS, SPRING } from '../src/lib/motionTokens.ts'
import { FAN_ITEMS, fanTarget } from '../src/lib/tabs.ts'
import { REPORT_TYPES } from '../src/lib/reportTypes.ts'
import { typeFromQuery } from '../src/lib/aiSearch/handoff.ts'

test('길게 누르기: 450ms 전에는 기다리고, 넘으면 실행, 움직이면 취소', () => {
  assert.equal(LONG_PRESS_MS, 450)
  assert.equal(longPressState(0, 0), 'wait')
  assert.equal(longPressState(449, 3), 'wait')
  assert.equal(longPressState(450, 3), 'fire')
  assert.equal(longPressState(900, 10), 'fire') // 10px는 허용
  assert.equal(longPressState(200, 11), 'cancel') // 스크롤·끌기로 본다
  assert.equal(longPressState(600, 30), 'cancel')
})

test('길게 누르기 진행값: 150ms까지 0, 450ms에 1', () => {
  assert.equal(longPressProgress(0), 0)
  assert.equal(longPressProgress(150), 0)
  assert.equal(longPressProgress(300), 0.5)
  assert.equal(longPressProgress(450), 1)
  assert.equal(longPressProgress(2000), 1)
})

test('방향 잠금: 8px 전에는 미정, 이후 큰 쪽', () => {
  assert.equal(lockAxis(5, 5), null)
  assert.equal(lockAxis(9, 2), 'x')
  assert.equal(lockAxis(-3, -12), 'y')
  assert.equal(lockAxis(-9, 8), 'x')
})

test('끌어서 확정: 폭의 35% 또는 빠르게 밀기', () => {
  assert.equal(COMMIT_RATIO, 0.35)
  assert.equal(commitDir(100, 0, 300), 0) // 33%
  assert.equal(commitDir(106, 0, 300), 1)
  assert.equal(commitDir(-120, 0, 300), -1)
  assert.equal(commitDir(40, 600, 300), 1) // 짧아도 빠르면
  assert.equal(commitDir(40, -600, 300), 0) // 속도가 반대 방향이면 안 됨
  assert.equal(commitDir(10, 100, 0), 0)
})

test('부채꼴 배치: 5개가 좌우 대칭, 가운데는 바로 위, 반지름이 같다', () => {
  const o = fanOffsets(5, 140, 72, 'up')
  assert.equal(o.length, 5)
  assert.ok(Math.abs(o[2].x) < 0.01)
  assert.ok(Math.abs(o[2].y + 140) < 0.01)
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs(o[i].x + o[4 - i].x) < 0.2) // 좌우 대칭
    assert.ok(Math.abs(o[i].y - o[4 - i].y) < 0.2)
  }
  for (const p of o) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 140) < 0.3)
  assert.ok(o[0].x < o[1].x && o[1].x < o[2].x && o[3].x < o[4].x) // 왼쪽→오른쪽
  assert.ok(o.every((p) => p.y < 0)) // 모두 위쪽
  const down = fanOffsets(5, 140, 72, 'down')
  assert.ok(down.every((p) => p.y > 0))
  // 이웃 항목 간격이 64px 정사각형끼리 겹치지 않을 만큼(대각선이 아니라 가로·세로 중 하나는 64 이상)
  for (let i = 0; i < 4; i++) {
    const dx = Math.abs(o[i + 1].x - o[i].x)
    const dy = Math.abs(o[i + 1].y - o[i].y)
    assert.ok(Math.max(dx, dy) >= 68, `항목 ${i}와 ${i + 1}이 겹침`)
  }
})

test('부채꼴이 화면 밖으로 나가면 안쪽으로 민다', () => {
  const o = fanOffsets(5, 140, 72, 'up')
  assert.equal(fanShiftX(195, o, 32, 390), 0)
  const shifted = fanShiftX(60, o, 32, 390) // 왼쪽 가장자리 근처
  assert.ok(shifted > 0)
  assert.ok(60 + o[0].x + shifted - 32 >= 8 - 0.01)
  assert.ok(fanShiftX(350, o, 32, 390) < 0)
})

test('부채꼴 닿음: 항목 위면 번호, 밖이면 -1', () => {
  const o = fanOffsets(5, 140, 72, 'up')
  assert.equal(fanHit(0, 0, o, 38), -1) // 중심(원 위)
  assert.equal(fanHit(o[0].x, o[0].y, o, 38), 0)
  assert.equal(fanHit(o[4].x + 5, o[4].y - 5, o, 38), 4)
  assert.equal(fanHit(0, -140, o, 38), 2)
  assert.equal(fanHit(300, 300, o, 38), -1)
})

test('부채꼴 항목: 5개, 유형은 실제 제보 유형, 더보기는 유형 없이 목록으로', () => {
  assert.equal(FAN_ITEMS.length, 5)
  assert.deepEqual(FAN_ITEMS.map((i) => i.label), ['계단·턱', '불법 주정차', '파손 노면', '쓰레기', '더보기'])
  const known = REPORT_TYPES.map((t) => t.type)
  for (const it of FAN_ITEMS) if (it.type) assert.ok(known.includes(it.type), it.type)
  assert.equal(FAN_ITEMS[4].type, undefined)
  // 주소로 넘긴 유형이 받는 쪽 검증을 통과해야 한다
  for (const it of FAN_ITEMS) {
    const t = fanTarget(it)
    assert.ok(t.startsWith('#/map?go=report'))
    const q = new URLSearchParams(t.split('?')[1])
    assert.equal(typeFromQuery(q.get('type')), it.type ?? null)
    assert.equal(q.get('step'), it.type ? 'where' : null) // 유형을 이미 골랐으면 2단계부터, 더보기는 1단계
  }
  assert.equal(fanTarget(FAN_ITEMS[4]), '#/map?go=report')
})

test('색종이: 개수·범위·같은 seed는 같은 결과', () => {
  const a = makePieces(28, 7)
  assert.equal(a.length, 28)
  assert.deepEqual(a, makePieces(28, 7))
  assert.notDeepEqual(a, makePieces(28, 8))
  for (const p of a) {
    assert.ok(p.dur >= CONFETTI_MIN_MS && p.dur <= CONFETTI_MAX_MS)
    assert.ok(p.color >= 0 && p.color < CONFETTI_COLORS)
    assert.ok(p.up > 0 && p.fall > 0)
  }
  assert.ok(confettiTotalMs(a) <= CONFETTI_MAX_MS + 120)
  assert.equal(new Set(a.map((p) => p.color)).size, CONFETTI_COLORS)
})

test('진동: 지원하지 않는 환경(노드)에서는 조용히 넘어간다, 패턴 값', () => {
  assert.doesNotThrow(() => haptic('tick'))
  assert.doesNotThrow(() => haptic('success'))
  assert.equal(HAPTIC_PATTERN.tick, 8)
  assert.deepEqual(HAPTIC_PATTERN.success, [12, 40, 12])
  assert.deepEqual(HAPTIC_PATTERN.warn, [20])
})

test('SPRING.pop은 튕기는 값(감쇠비 1 미만), 나머지는 튕기지 않는다', () => {
  const zeta = (s: { stiffness: number; damping: number }) => s.damping / (2 * Math.sqrt(s.stiffness))
  assert.ok(zeta(SPRING.pop) < 0.6)
  assert.ok(zeta(SPRING.pop) > 0.4)
  for (const k of ['screen', 'sheet', 'quick', 'press'] as const) assert.ok(zeta(SPRING[k]) > 0.95, k)
})
