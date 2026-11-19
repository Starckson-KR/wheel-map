import { useEffect, useRef } from 'react'
import { m } from 'motion/react'
import Celebration from './Celebration'
import RewardEmblem from './RewardEmblem'
import { haptic } from '../lib/haptic'
import { FADE, FADE_OUT, SPRING } from '../lib/motionTokens'
import { prefersCalm } from '../lib/viewPrefs'
import type { EmblemDef } from '../lib/rewards'
import '../styles/interact-verify.css'

/**
 * 새 칭호를 받는 순간의 전체 화면 장면. 배경이 어두워지고, 엠블럼이 튕기며 나타나 빛이 한 바퀴 돌고, 색종이·진동이 따른다.
 * 저절로 닫히지 않고, 「확인」·바깥 배경·Esc로 닫는다. 움직임 줄이기에서는 빛·색종이·튕김 없이 투명도만 바뀐다.
 */
export default function RewardCelebrate({ def, mine, name, onClose }: { def: EmblemDef; mine: boolean; name: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const calm = prefersCalm()
  useEffect(() => {
    haptic('success')
    closeRef.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  const title = mine ? `'${def.name}' 칭호를 받았어요` : `${name}님이 '${def.name}' 칭호를 받았어요`
  return (
    <m.div
      className="rwp"
      role="dialog"
      aria-modal="true"
      aria-label="칭호 승급"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2 } }}
      exit={{ opacity: 0, transition: FADE_OUT }}
    >
      <div className="rwp-card" role="status" onClick={(e) => e.stopPropagation()}>
        <m.span
          className="rwp-emb"
          initial={calm ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, transition: calm ? FADE : SPRING.pop }}
        >
          <span className="rwp-glow" aria-hidden="true" />
          <RewardEmblem def={def} size="lg" />
          <Celebration seed={def.grade ?? 5} />
        </m.span>
        <m.strong className="rwp-t" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { ...FADE, delay: calm ? 0 : 0.18 } }}>
          {title}
        </m.strong>
        <span className="rwp-s">{def.how}</span>
        <button
          ref={closeRef}
          type="button"
          className="rwp-x"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          확인
        </button>
      </div>
    </m.div>
  )
}
