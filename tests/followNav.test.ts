import { test } from 'node:test'
import assert from 'node:assert/strict'
import { angleDelta, autoStep, centerDelta, compassHeading, easeOut, lerpLatLng, norm360, smoothHeading } from '../src/lib/routing/followNav.ts'
import { buildSteps } from '../src/lib/routing/guide.ts'
import type { Pt } from '../src/lib/routing/engine.ts'

const near = (a: number, b: number, e = 0.5) => assert.ok(Math.abs(a - b) <= e, `${a} ≈ ${b}`)

test('각도: 0/360 경계를 짧은 쪽으로 건넌다', () => {
  assert.equal(norm360(-10), 350)
  assert.equal(angleDelta(350, 10), 20)
  assert.equal(angleDelta(10, 350), -20)
  near(smoothHeading(350, 10, 0.5), 0)
  near(smoothHeading(null, 123), 123)
  near(smoothHeading(90, 90), 90)
})

test('나침반: iOS webkitCompassHeading는 그대로, 세워 든 자세는 명세 식, 눕힌 자세는 360-alpha', () => {
  near(compassHeading({ alpha: null, beta: null, gamma: null, webkitCompassHeading: 123 }) as number, 123)
  near(compassHeading({ alpha: 0, beta: 90, gamma: 0 }) as number, 0) // 세워 들고 북쪽
  near(compassHeading({ alpha: 90, beta: 90, gamma: 0 }) as number, 270) // 왼쪽으로 90° 돌면 서쪽
  near(compassHeading({ alpha: 180, beta: 90, gamma: 0 }) as number, 180)
  near(compassHeading({ alpha: 90, beta: 2, gamma: 1 }) as number, 270) // 눕힌 자세
  assert.equal(compassHeading({ alpha: null, beta: 90, gamma: 0 }), null)
})

test('내 위치를 보이는 영역(아래 카드 제외) 가운데로: 이동량', () => {
  // 지도 375x700, 위 가림 60, 아래 카드 240 → 보이는 영역 가운데는 y=60+200=260
  const d = centerDelta({ x: 187.5, y: 260 }, { w: 375, h: 700, top: 60, bottom: 240 })
  assert.deepEqual(d, { dx: 0, dy: 0 })
  const e = centerDelta({ x: 300, y: 500 }, { w: 375, h: 700, top: 60, bottom: 240 })
  near(e.dx, 112.5)
  near(e.dy, 240)
})

test('위치 점 부드럽게 옮기기 보간', () => {
  assert.deepEqual(lerpLatLng([0, 0], [10, 20], 0.5), [5, 10])
  assert.equal(easeOut(0), 0)
  assert.equal(easeOut(1), 1)
  assert.ok(easeOut(0.5) > 0.5)
})

test('단계 자동 넘김: 다음 지점 15m 앞에서 넘기고, 작은 되돌림은 무시', () => {
  const M_LAT = 111320
  const KX = M_LAT * Math.cos((35.17 * Math.PI) / 180)
  const P = (x: number, y: number): Pt => [35.17 + y / M_LAT, 126.9 + x / KX]
  const steps = buildSteps([P(0, 0), P(0, 50), P(0, 100), P(50, 100), P(100, 100)], undefined, [])
  assert.equal(steps.length, 3)
  assert.equal(autoStep(steps, 10, 0), 0)
  assert.equal(autoStep(steps, 90, 0), 1, '꺾는 곳 10m 앞이면 다음 단계')
  assert.equal(autoStep(steps, 95, 1), 1, 'GPS가 조금 되돌아가도 그대로')
  assert.equal(autoStep(steps, 40, 1), 0, '많이 물러나면 이전 단계로')
  assert.equal(autoStep([], 5, 3), 0)
})
