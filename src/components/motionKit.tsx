// 여러 화면이 같이 쓰는 움직임 부품. 값은 lib/motionTokens.ts에서만 가져온다.
import type { ComponentProps } from 'react'
import { m } from 'motion/react'
import { FADE, RISE_Y, SPRING, STAGGER, STAGGER_MAX, TAP, TAP_KEY } from '../lib/motionTokens'

/** 세그먼트 탭의 선택 배경. 선택된 버튼 안에 두면 다른 버튼으로 미끄러진다(group은 화면마다 다르게). 스타일은 .seg-bg */
export function SegBg({ group }: { group: string }) {
  return <m.span layoutId={group} className="seg-bg" transition={SPRING.quick} aria-hidden="true" />
}

type RiseProps = { first: boolean; i: number }
function riseProps({ first, i }: RiseProps) {
  return {
    initial: first ? { opacity: 0, y: RISE_Y } : false,
    animate: { opacity: 1, y: 0 },
    transition: { y: SPRING.screen, opacity: FADE, delay: Math.min(i, STAGGER_MAX) * STAGGER },
  } as const
}
/** 처음 한 번만 순차로 올라오는 <li> */
export function RiseLi({ first, i, ...rest }: RiseProps & Omit<ComponentProps<typeof m.li>, 'initial' | 'animate' | 'transition'>) {
  return <m.li {...riseProps({ first, i })} {...rest} />
}

/** 살짝 눌리는 버튼(whileTap). k를 켜면 키패드처럼 더 깊게 눌린다. CSS의 transform 전환·:active 크기는 .mt가 꺼 준다. */
export function PressButton({ k, className, ...rest }: { k?: boolean } & ComponentProps<typeof m.button>) {
  return <m.button whileTap={{ scale: k ? TAP_KEY : TAP }} transition={SPRING.press} className={className ? className + ' mt' : 'mt'} {...rest} />
}
