// 진동: 지원하는 기기(주로 안드로이드)에서만 짧게 울린다. 미지원(아이폰 등)·움직임 줄이기 켜짐이면 조용히 아무 것도 안 한다.
// 진동은 보조일 뿐이라 같은 정보를 항상 화면 반응으로도 준다.
import { prefersCalm } from './viewPrefs'

export type HapticKind = 'tick' | 'success' | 'warn'

export const HAPTIC_PATTERN: Record<HapticKind, number | number[]> = {
  tick: 8,
  success: [12, 40, 12],
  warn: [20],
}

export function haptic(kind: HapticKind): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    if (prefersCalm()) return
    navigator.vibrate(HAPTIC_PATTERN[kind])
  } catch {
    // 지원하지 않거나 막힌 기기: 무시
  }
}
