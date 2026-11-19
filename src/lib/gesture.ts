// 제스처 판정 순수 함수(화면·DOM 없음). 길게 누르기·방향 잠금·끌어서 확정·부채꼴 배치.
// 기준값은 lib/motionTokens.ts에서만 정한다.
import { AXIS_LOCK_PX, COMMIT_RATIO, COMMIT_VELOCITY, LONG_PRESS_MS, LONG_PRESS_PROGRESS_FROM, LONG_PRESS_SLOP } from './motionTokens'

export type LongPressState = 'wait' | 'fire' | 'cancel'

/** 누른 지 elapsed(ms), 처음 자리에서 moved(px) 움직였을 때의 상태 */
export function longPressState(elapsed: number, moved: number, ms = LONG_PRESS_MS, slop = LONG_PRESS_SLOP): LongPressState {
  if (moved > slop) return 'cancel'
  return elapsed >= ms ? 'fire' : 'wait'
}

/** 진행 표시 값 0~1. from(ms)까지는 0, 그 뒤 ms까지 차오른다. */
export function longPressProgress(elapsed: number, ms = LONG_PRESS_MS, from = LONG_PRESS_PROGRESS_FROM): number {
  if (elapsed <= from) return 0
  if (elapsed >= ms) return 1
  return (elapsed - from) / (ms - from)
}

export type Axis = 'x' | 'y' | null

/** 처음 움직임으로 가로·세로를 정한다. 아직 lock(px)에 못 미치면 null. */
export function lockAxis(dx: number, dy: number, lock = AXIS_LOCK_PX): Axis {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < lock) return null
  return ax > ay ? 'x' : 'y'
}

/** 가로로 끈 거리 dx(px)·속도 vx(px/s)가 확정 기준을 넘었는지. 돌려주는 값은 방향(-1 왼쪽, 1 오른쪽), 못 넘으면 0. */
export function commitDir(dx: number, vx: number, width: number, ratio = COMMIT_RATIO, velocity = COMMIT_VELOCITY): -1 | 0 | 1 {
  if (width <= 0) return 0
  const far = Math.abs(dx) >= width * ratio
  const fast = Math.abs(vx) >= velocity && Math.sign(vx) === Math.sign(dx) && dx !== 0
  if (!far && !fast) return 0
  return dx < 0 ? -1 : 1
}

export type Pt = { x: number; y: number }

/**
 * 부채꼴 배치: 중심에서 반지름 radius, 가운데 방향(up이면 위쪽)을 기준으로 좌우 ±spreadDeg에 n개를 고르게 둔다.
 * 돌려주는 값은 중심에서의 상대 좌표(오른쪽 +x, 아래 +y).
 */
export function fanOffsets(n: number, radius: number, spreadDeg: number, dir: 'up' | 'down' = 'up'): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? 0 : (-spreadDeg + (2 * spreadDeg * i) / (n - 1)) * (Math.PI / 180) // 가운데 방향에서 벗어난 각
    const x = Math.sin(a) * radius
    const up = Math.cos(a) * radius
    out.push({ x: Math.round(x * 10) / 10, y: Math.round((dir === 'up' ? -up : up) * 10) / 10 })
  }
  return out
}

/** 화면 폭 안에 들어오도록 가로로 옮겨야 하는 거리. 중심 cx 기준 상대 좌표 offsets, 항목 반폭 half, 여백 margin. */
export function fanShiftX(cx: number, offsets: Pt[], half: number, viewW: number, margin = 8): number {
  let minX = Infinity
  let maxX = -Infinity
  for (const o of offsets) {
    minX = Math.min(minX, cx + o.x - half)
    maxX = Math.max(maxX, cx + o.x + half)
  }
  if (minX < margin) return margin - minX
  if (maxX > viewW - margin) return viewW - margin - maxX
  return 0
}

/** 손가락 위치(중심 기준 상대 dx, dy)가 닿은 항목의 번호. 없으면 -1. 겹치면 가까운 쪽. */
export function fanHit(dx: number, dy: number, offsets: Pt[], hitRadius: number): number {
  let best = -1
  let bestD = Infinity
  offsets.forEach((o, i) => {
    const d = Math.hypot(dx - o.x, dy - o.y)
    if (d <= hitRadius && d < bestD) {
      best = i
      bestD = d
    }
  })
  return best
}
