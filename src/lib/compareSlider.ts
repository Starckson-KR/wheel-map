// 조치 전·후 비교 슬라이더(D2)의 순수 판정. pos = 왼쪽부터 「조치 전」이 보이는 비율(0~100).
export const POS_MIN = 0
export const POS_MAX = 100
export const POS_KEY_STEP = 5
export const POS_KEY_BIG = 20
/** 처음 보일 때 한 번 보여 주는 시범 위치(0.8초 안쪽) */
export const DEMO_SWEEP: readonly number[] = [18, 82, 50]

export const clampPos = (p: number): number => Math.max(POS_MIN, Math.min(POS_MAX, Math.round(p * 10) / 10))

/** 화면 좌표 x를 상자(left, width) 안의 비율로 */
export function posFromX(x: number, left: number, width: number): number {
  if (width <= 0) return 50
  return clampPos(((x - left) / width) * 100)
}

/** 키보드: 다음 위치. 해당하지 않는 키면 null. */
export function stepPos(pos: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampPos(pos - POS_KEY_STEP)
    case 'ArrowRight':
    case 'ArrowUp':
      return clampPos(pos + POS_KEY_STEP)
    case 'PageDown':
      return clampPos(pos - POS_KEY_BIG)
    case 'PageUp':
      return clampPos(pos + POS_KEY_BIG)
    case 'Home':
      return POS_MIN
    case 'End':
      return POS_MAX
    default:
      return null
  }
}

/** a에서 b로 옮기며 가운데(at)를 지났는지 */
export const crossed = (a: number, b: number, at = 50): boolean => (a < at && b >= at) || (a > at && b <= at)

/** 화면 읽기용 문구 */
export function posText(pos: number): string {
  if (pos >= 99) return '조치 전 사진만 보여요'
  if (pos <= 1) return '조치 후 사진만 보여요'
  return `조치 전 ${Math.round(pos)}%, 조치 후 ${100 - Math.round(pos)}%`
}

/** 가까운 쪽(「전」 버튼 강조용) */
export const nearerSide = (pos: number): 'before' | 'after' => (pos > 50 ? 'before' : 'after')
