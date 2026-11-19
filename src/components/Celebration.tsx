import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { confettiTotalMs, makePieces } from '../lib/confetti'
import { prefersCalm } from '../lib/viewPrefs'

type Props = {
  /** 조각 수(24~32 권장) */
  count?: number
  seed?: number
  /** 끝나고 DOM을 지운 뒤 한 번 부른다 */
  onDone?: () => void
}

/**
 * 축하 색종이. 놓인 자리(부모 안의 가운데)에서 터져 올라갔다 떨어진다. transform·opacity만 쓰고 끝나면 DOM을 지운다.
 * 움직임 줄이기가 켜져 있으면 아무것도 그리지 않는다. 장식이라 스크린리더에는 읽히지 않는다.
 * 부모에 position: relative 가 있어야 하며, 터치는 막지 않는다.
 */
export default function Celebration({ count = 28, seed = 7, onDone }: Props) {
  const [calm] = useState(() => prefersCalm())
  const pieces = useMemo(() => makePieces(count, seed), [count, seed])
  const [alive, setAlive] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(
      () => {
        setAlive(false)
        onDone?.()
      },
      calm ? 0 : confettiTotalMs(pieces) + 80,
    )
    return () => clearTimeout(t)
  }, [calm, pieces, onDone])
  if (calm || !alive) return null
  return (
    <span className="cf" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          className={`cf-p cf-c${p.color}`}
          style={{ '--dx': `${p.dx}px`, '--up': `${p.up}px`, '--fall': `${p.fall}px`, '--rot': `${p.rot}deg`, animationDelay: `${p.delay}ms`, animationDuration: `${p.dur}ms`, width: p.w, height: p.h } as CSSProperties}
        />
      ))}
    </span>
  )
}
