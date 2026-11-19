// 당겨서 새로고침의 순수 계산(화면·DOM 없음). 기준 거리는 lib/motionTokens.ts의 REFRESH_PULL.
import { REFRESH_PULL } from './motionTokens'

/** 손가락이 움직인 거리 대비 화면이 따라오는 비율(저항) */
export const PULL_RESIST = 0.6
/** 새로고침 중 화면이 머무는 높이(px) */
export const REFRESH_HOLD = 56
/** 새로고침 중임을 보여 주는 시간(ms). 움직임 줄이기에서는 짧게 */
export const REFRESH_BUSY_MS = 700
export const REFRESH_BUSY_MS_CALM = 250

export type PullPhase = 'idle' | 'pull' | 'ready' | 'busy'

/** 손가락 이동 dy(px) → 화면이 내려오는 거리(px). 0 ~ REFRESH_PULL */
export function pullOffset(dy: number, max = REFRESH_PULL): number {
  return Math.min(max, Math.max(0, dy) * PULL_RESIST)
}

/** 0~1 진행도(아이콘 회전·투명도) */
export function pullProgress(dy: number, max = REFRESH_PULL): number {
  return max > 0 ? pullOffset(dy, max) / max : 0
}

/** 놓으면 새로고침이 되는 거리를 넘었는지 */
export function pullReady(dy: number, max = REFRESH_PULL): boolean {
  return pullOffset(dy, max) >= max
}

export function pullPhase(dy: number, busy: boolean): PullPhase {
  if (busy) return 'busy'
  if (dy <= 0) return 'idle'
  return pullReady(dy) ? 'ready' : 'pull'
}

export const PULL_LABEL: Record<PullPhase, string> = {
  idle: '',
  pull: '당겨서 새로고침',
  ready: '놓으면 새로고침',
  busy: '다시 계산하는 중',
}

/**
 * 당기기를 시작해도 되는지: 스크롤이 맨 위이고(안쪽 스크롤 영역도 맨 위), 새로고침 중이 아님.
 * tops는 터치한 요소에서 스크롤 영역까지 올라가며 모은 scrollTop 값들.
 */
export function canStartPull(tops: number[], busy: boolean): boolean {
  return !busy && tops.every((t) => t <= 0)
}
