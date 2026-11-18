// 길 안내 따라가기에 쓰는 순수 계산: 나침반 방향, 각도 부드럽게, 내 위치를 보이는 영역 가운데로, 단계 자동 넘김.
// 브라우저 API(지도·센서)는 부르지 않아 Node 테스트로 확인한다.
import type { Step } from './guide.ts'
import { stepIndexAt } from './guide.ts'

export const norm360 = (d: number) => ((d % 360) + 360) % 360
/** from에서 to로 가는 가장 짧은 각도 차이(-180~180, 시계 방향이 +) */
export const angleDelta = (from: number, to: number) => {
  const d = norm360(to - from)
  return d > 180 ? d - 360 : d
}
/** 이전 방향에서 새 방향으로 k만큼만 따라간다(0~1). 0/360 경계를 짧은 쪽으로 건넌다. 센서 떨림을 줄인다. */
export function smoothHeading(prev: number | null, next: number, k = 0.25): number {
  if (prev === null) return norm360(next)
  return norm360(prev + angleDelta(prev, next) * k)
}

export type OrientationLike = { alpha: number | null; beta: number | null; gamma: number | null; webkitCompassHeading?: number | null }
const RAD = Math.PI / 180

/**
 * 센서 값 → 폰이 향한 방향(북=0, 시계 방향 0~360). 못 구하면 null.
 *  - iOS: webkitCompassHeading(북 기준 시계 방향, WebKit)을 그대로 쓴다.
 *  - 그 밖: deviceorientationabsolute의 alpha·beta·gamma로 W3C 명세의 compass heading 예제 식을 쓴다
 *    (화면을 세워 든 자세에서 폰 뒷면이 향한 방향 = 걸어가는 방향). 폰을 눕혀 든 자세(beta·gamma 모두 작음)는 식이 0으로 나뉘므로 360-alpha를 쓴다.
 */
export function compassHeading(e: OrientationLike): number | null {
  const w = e.webkitCompassHeading
  if (typeof w === 'number' && Number.isFinite(w)) return norm360(w)
  if (e.alpha === null || e.alpha === undefined || !Number.isFinite(e.alpha)) return null
  const beta = e.beta ?? 0
  const gamma = e.gamma ?? 0
  if (Math.abs(beta) < 25 && Math.abs(gamma) < 25) return norm360(360 - e.alpha)
  const a = e.alpha * RAD
  const b = beta * RAD
  const g = gamma * RAD
  const cZ = Math.cos(a)
  const sZ = Math.sin(a)
  const sX = Math.sin(b)
  const cY = Math.cos(g)
  const sY = Math.sin(g)
  const vx = -cZ * sY - sZ * sX * cY
  const vy = -sZ * sY + cZ * sX * cY
  if (vx === 0 && vy === 0) return norm360(360 - e.alpha)
  let h = Math.atan(vx / vy)
  if (vy < 0) h += Math.PI
  else if (vx < 0) h += 2 * Math.PI
  return norm360(h / RAD)
}

/** 두 점 사이를 t(0~1)만큼 옮긴 위치(수 m 안의 짧은 거리라 위경도를 그대로 섞는다) */
export const lerpLatLng = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
/** 0~1 → 0~1, 처음 빠르고 끝에 천천히(위치 점 이동용) */
export const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

/**
 * 내 위치(화면 픽셀 pt)를 "보이는 영역"의 가운데로 보내려면 지도 중심을 얼마나 옮겨야 하는가(panBy에 넣는 값).
 * 보이는 영역 = 지도 높이에서 위쪽 가림(top)과 아래 안내 카드(bottom)를 뺀 부분. 지도 중심을 (dx, dy)만큼 옮기면 지도 내용은 반대로 움직이므로 pt - 목표점이다.
 */
export function centerDelta(pt: { x: number; y: number }, view: { w: number; h: number; top: number; bottom: number }): { dx: number; dy: number } {
  const tx = view.w / 2
  const ty = view.top + (view.h - view.top - view.bottom) / 2
  return { dx: pt.x - tx, dy: pt.y - ty }
}
/** 이만큼(px) 안이면 다시 맞추지 않는다(작은 흔들림에 지도가 떠는 것을 막는다) */
export const CENTER_DEADBAND_PX = 6

/**
 * 내 위치의 경로 진행 거리(along)로 지금 단계 번호를 정한다.
 * 다음 단계 시작 지점 ADVANCE_M 안으로 들어오면 미리 넘기고, GPS 흔들림으로 되돌아가는 것은 BACK_M 넘게 물러났을 때만 따른다.
 */
export const ADVANCE_M = 15
export const BACK_M = 25
export function autoStep(steps: Step[], along: number, cur: number): number {
  if (steps.length === 0) return 0
  const ahead = stepIndexAt(steps, along + ADVANCE_M)
  if (ahead > cur) return ahead
  const exact = stepIndexAt(steps, along)
  if (exact < cur && along < steps[cur].startM - BACK_M) return exact
  return cur
}

/** 내 위치가 지금 단계 지점에서 nearM 안이면 true(단계 화살표 원을 작고 흐리게 할지 정한다). 위치나 지점이 없으면 false. */
export function isStepNear(me: [number, number] | null, at: [number, number] | null, nearM: number): boolean {
  if (!me || !at) return false
  const dy = (me[0] - at[0]) * 111320
  const dx = (me[1] - at[1]) * 111320 * Math.cos((at[0] * Math.PI) / 180)
  return Math.hypot(dx, dy) <= nearM
}
