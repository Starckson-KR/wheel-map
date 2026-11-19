// 움직임 값 모음(motion 라이브러리용). 스프링은 모두 거의 임계 감쇠(오버슈트 없음)라 sheetMotion.ts(임계 감쇠 스프링)와 느낌이 같다.
// 감쇠비 = damping / (2 * sqrt(stiffness * mass)) 가 1 안팎이 되게 맞췄다. 값은 여기서만 정한다.
import type { Transition } from 'motion/react'

export const SPRING = {
  /** 화면·시트가 들어오고 나가는 큰 움직임. 약 0.3초에 멈춘다. */
  screen: { type: 'spring', stiffness: 520, damping: 46 },
  /** sheetMotion.ts(SPRING_OMEGA 26)와 같은 세기. 바닥 시트·확인창. */
  sheet: { type: 'spring', stiffness: 680, damping: 52 },
  /** 작은 요소(선택 표시, 점, 칩 체크). */
  quick: { type: 'spring', stiffness: 900, damping: 60 },
  /** 눌림 반응. 손을 떼면 바로 돌아온다. */
  press: { type: 'spring', stiffness: 1100, damping: 66 },
  /** 튕김(오버슈트 약 15%). 축하·도장·유형 선택에만 쓴다. 다른 스프링은 모두 튕기지 않는다. */
  pop: { type: 'spring', stiffness: 700, damping: 28 },
} as const satisfies Record<string, Transition>

const EASE_OUT = [0.23, 1, 0.32, 1] as const
/** 페이드 시간(초). 나올 때는 조금 길게, 사라질 때는 짧게. */
export const FADE = { duration: 0.18, ease: EASE_OUT } as const satisfies Transition
export const FADE_OUT = { duration: 0.12, ease: EASE_OUT } as const satisfies Transition

/** 하단 탭 순서(화면 전환 방향을 정한다). lib/tabs.ts의 TAB_ITEMS 순서와 같다. */
export const TAB_ORDER: readonly string[] = ['home', 'map', 'report', 'alerts', 'me']
/** 탭 전환에서 새 화면이 옆에서 들어오는 거리(px). 방향감만 준다. */
export const PAGE_SHIFT = 18
/** 카드·목록 첫 등장: 아래에서 올라오는 거리(px), 항목 사이 간격(초), 최대 몇 번째까지만 늦출지 */
export const RISE_Y = 8
export const STAGGER = 0.035
export const STAGGER_MAX = 10
/** 누름 크기 */
export const TAP = 0.97
export const TAP_KEY = 0.94

/** 길게 누르기 기준 시간(ms). 진행 표시는 PROGRESS_FROM부터 차오른다. */
export const LONG_PRESS_MS = 450
export const LONG_PRESS_PROGRESS_FROM = 150
/** 길게 누르는 동안 이만큼(px) 넘게 움직이면 길게 누르기가 아니라 끌기·스크롤로 보고 취소한다. */
export const LONG_PRESS_SLOP = 10
/** 당겨서 새로고침 기준 거리(px, 실기기에서 조정) */
export const REFRESH_PULL = 72
/** 끌어서 확정하는 기준: 폭의 비율, 또는 속도(px/s) */
export const COMMIT_RATIO = 0.35
export const COMMIT_VELOCITY = 500
/** 가로·세로 방향을 정하는 처음 이동 거리(px) */
export const AXIS_LOCK_PX = 8
