import { useEffect, useState, type ReactNode } from 'react'
import { LazyMotion, MotionConfig } from 'motion/react'
import { prefersCalm } from '../lib/viewPrefs'

// 앱 맨 위에 한 번. m.* 컴포넌트가 쓰는 기능을 따로 받아 오고, 움직임 줄이기를 기존 규칙(prefersCalm)과 맞춘다.
//  - 기기에서 움직임 줄이기 + 시연 스위치(motion-force) 꺼짐 → "always": 이동·크기 변화는 즉시, 투명도만 바뀐다.
//  - 시연 스위치 켜짐, 또는 줄이기 설정 없음 → "never": 모든 움직임 재생.
const loadFeatures = () => import('../lib/motionFeatures').then((m) => m.default)
void loadFeatures() // 첫 화면과 동시에 받기 시작

const mode = () => (prefersCalm() ? 'always' : 'never')

export default function MotionRoot({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState<'always' | 'never'>(mode)
  useEffect(() => {
    const update = () => setReduced(mode())
    // 시연 스위치는 <html class="motion-force">로 바뀐다
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    mq.addEventListener('change', update)
    update()
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [])
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion={reduced}>{children}</MotionConfig>
    </LazyMotion>
  )
}
