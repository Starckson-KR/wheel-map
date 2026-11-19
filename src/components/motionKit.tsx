// 여러 화면이 같이 쓰는 움직임 부품. 값은 lib/motionTokens.ts에서만 가져온다.
import type { ComponentProps, ReactNode } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { FADE, FADE_OUT, RISE_Y, SPRING, STAGGER, STAGGER_MAX, TAP, TAP_KEY } from '../lib/motionTokens'

/** 세그먼트 탭의 선택 배경. 선택된 버튼 안에 두면 다른 버튼으로 미끄러진다(group은 화면마다 다르게). 스타일은 .seg-bg */
export function SegBg({ group }: { group: string }) {
  return <m.span layoutId={group} className="seg-bg" transition={SPRING.quick} aria-hidden="true" />
}

/** 같은 자리에서 글자·아이콘이 바뀔 때의 교차 페이드. k가 바뀌면 이전 것은 흐려지고 새 것이 나타난다. pop이면 살짝 커지며 나타난다(아이콘용). 스타일은 .fx-swap */
export function Swap({ k, pop, children }: { k: string; pop?: boolean; children: ReactNode }) {
  return (
    <span className="fx-swap">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span key={k} className="fx-swap-in" initial={{ opacity: 0, scale: pop ? 0.8 : 1 }} animate={{ opacity: 1, scale: 1, transition: FADE }} exit={{ opacity: 0, transition: FADE_OUT }}>
          {children}
        </m.span>
      </AnimatePresence>
    </span>
  )
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
