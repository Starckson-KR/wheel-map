import { useLayoutEffect, useRef } from 'react'
import { prefersCalm } from '../lib/viewPrefs'

// 숫자가 0(또는 이전 값)에서 새 값까지 0.6초 안에 올라간다. 움직임 줄이기에서는 바로 최종 값을 보여 준다.
// 글자는 DOM에 직접 써서 매 프레임 리렌더하지 않고, 스크린리더에는 최종 값만 읽어 준다.
export default function CountUp({ value, ms = 600 }: { value: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const start = shown.current
    if (prefersCalm() || start === value || ms <= 0) {
      el.textContent = String(value)
      shown.current = value
      return
    }
    el.textContent = String(start)
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      shown.current = Math.round(start + (value - start) * eased)
      el.textContent = String(shown.current)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])

  return (
    <>
      <span ref={ref} aria-hidden="true" />
      <span className="sr-only">{value}</span>
    </>
  )
}

// 문장 속 숫자를 모두 카운트 업으로 바꿔 보여 준다(예: "처리 중인 내 민원이 3건 있어요").
export function CountText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((part, i) => (i % 2 === 1 ? <CountUp key={i} value={Number(part)} /> : part))}
    </>
  )
}
