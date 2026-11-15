// 화면 전환 무대: 아이폰식 가로 밀기. 새 화면이 오른쪽에서(뒤로 가기는 왼쪽에서) 들어오고, 이전 화면은 28%만 따라 물러난다.
// motion의 AnimatePresence(popLayout)가 들어오고 나가는 화면을 함께 움직이고, 스프링은 lib/motionTokens.ts의 값(오버슈트 거의 없음)을 쓴다.
// 움직임 줄이기면 MotionConfig가 이동을 즉시로 바꿔 짧은 페이드만 남는다. 나가는 화면은 inert·aria-hidden이라 포커스·스크린리더에 남지 않는다.
import type { ReactNode } from 'react'
import { AnimatePresence, m, useIsPresent } from 'motion/react'
import { FADE, FADE_OUT, SPRING } from '../../lib/motionTokens'
import type { Screen } from './flow'

type Dir = 1 | -1

const variants = {
  enter: (dir: Dir) => ({ x: `${dir * 100}%`, opacity: 1 }),
  center: { x: '0%', opacity: 1 },
  exit: (dir: Dir) => ({ x: `${-dir * 28}%`, opacity: 0 }),
}

function Layer({ dir, children }: { dir: Dir; children: ReactNode }) {
  const present = useIsPresent()
  return (
    <m.div
      className="ob-layer"
      custom={dir}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ x: SPRING.screen, opacity: present ? FADE : { ...FADE_OUT, duration: 0.22 } }}
      inert={!present}
      aria-hidden={!present || undefined}
    >
      {children}
    </m.div>
  )
}

export default function Stage({ screen, dir, render }: { screen: Screen; dir: Dir; render: (s: Screen) => ReactNode }) {
  return (
    <div className="ob-stage">
      <AnimatePresence initial={false} custom={dir} mode="popLayout">
        <Layer key={screen} dir={dir}>
          {render(screen)}
        </Layer>
      </AnimatePresence>
    </div>
  )
}
