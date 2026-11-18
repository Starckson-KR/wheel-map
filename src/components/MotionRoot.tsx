import { useEffect, useState, type ReactNode } from 'react'
import { LazyMotion, MotionConfig } from 'motion/react'
import { prefersCalm } from '../lib/viewPrefs'

// 앱 맨 위에 한 번. m.* 컴포넌트가 쓰는 기능을 따로 받아 오고, 움직임 줄이기를 기존 규칙(prefersCalm)과 맞춘다.
//  - 앱 설정의 「움직임 줄이기」 켜짐(html.motion-reduce) → "always": 이동·크기 변화는 즉시, 투명도만 바뀐다.
//  - 그 밖에는(기기 설정과 상관없이) → "never": 모든 움직임 재생.
const loadFeatures = () => import('../lib/motionFeatures').then((m) => m.default)
void loadFeatures() // 첫 화면과 동시에 받기 시작

const mode = () => (prefersCalm() ? 'always' : 'never')

export default function MotionRoot({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState<'always' | 'never'>(mode)
  useEffect(() => {
    const update = () => setReduced(mode())
    // 앱 설정은 <html class="motion-reduce">로 바뀐다
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    update()
    return () => {
      mo.disconnect()
    }
  }, [])
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion={reduced}>{children}</MotionConfig>
    </LazyMotion>
  )
}
