import { m } from 'motion/react'
import { SPRING } from '../lib/motionTokens'

/** 지도 한가운데 고정된 제보 핀. 지도를 끌면 떠오르고 그림자가 작아지며, 놓으면 통 하고 내려앉는다. 핀 끝이 지도 중앙이다. */
export default function CenterPin({ lifted, landed }: { lifted: boolean; landed: number }) {
  return (
    <div className="cp" aria-hidden="true" data-lifted={lifted ? '1' : '0'}>
      <span className="cp-shadow" />
      {landed > 0 && <span key={landed} className="cp-ring" />}
      <m.span
        className="cp-pin"
        animate={{ y: lifted ? -14 : 0 }}
        transition={lifted ? { duration: 0.12, ease: [0.23, 1, 0.32, 1] } : SPRING.pop}
      >
        <svg viewBox="0 0 32 44" width="32" height="44" focusable="false">
          <path d="M16 1C7.7 1 1 7.5 1 15.6 1 26.6 16 43 16 43s15-16.4 15-27.4C31 7.5 24.3 1 16 1z" />
          <circle cx="16" cy="15.5" r="5.5" />
        </svg>
      </m.span>
    </div>
  )
}
