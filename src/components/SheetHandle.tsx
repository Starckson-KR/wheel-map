import { useEffect, useRef } from 'react'
import { prefersCalm } from '../lib/viewPrefs'
import { releaseVelocity, resist, springTo, type Sample, type SpringRun } from '../lib/sheetMotion'

type Props = {
  /** 위로 밀거나 빠르게 튕기면 부른다(없으면 위로는 약한 저항만 준다) */
  onUp?: () => void
  /** 아래로 밀거나 빠르게 튕기면 부른다(없으면 아래로는 약한 저항만 준다) */
  onDown?: () => void
  /** 끌기 대신 누르거나 키보드로 펼치고 접는 버튼(위·아래 둘 다 되는 시트용) */
  expanded?: boolean
  onToggle?: () => void
  /** 아래로 밀어 닫는 시트라면 true(기본). 시트가 놓은 속도 그대로 화면 아래로 빠져나간 뒤 onDown을 부른다. 닫지 않고 모양만 바꾸는 경우는 false */
  exit?: boolean
}

type Drag = { id: number; y0: number; base: number; el: HTMLElement; samples: Sample[]; y: number }

// 바텀시트 손잡이. 잡고 끌면 시트가 손가락을 따라가고, 놓으면 놓은 순간의 속도를 이어받는 스프링(useSheetSnap과 같은 것)으로 움직인다.
// 시트는 가장 가까운 [data-sheet] 요소다. 움직임은 transform만 바꿔 그래픽 가속을 쓰고, will-change는 움직이는 동안에만 둔다.
export default function SheetHandle({ onUp, onDown, expanded, onToggle, exit = true }: Props) {
  const drag = useRef<Drag | null>(null)
  const run = useRef<SpringRun | null>(null)

  useEffect(() => () => void run.current?.cancel(), [])

  const settle = (el: HTMLElement) => {
    run.current = null
    if (drag.current || !el.isConnected) return
    el.style.transition = 'none'
    el.style.transform = ''
    el.style.willChange = ''
    void el.offsetHeight
    el.style.transition = ''
  }

  const glide = (el: HTMLElement, from: number, to: number, v: number, passed?: () => void) => {
    run.current?.cancel()
    if (prefersCalm()) {
      passed?.()
      settle(el)
      return
    }
    let fired = false
    run.current = springTo(
      from,
      to,
      v,
      (y) => {
        el.style.transform = `translateY(${y}px)`
        if (passed && !fired && to - y < 32) {
          fired = true
          passed()
        }
      },
      () => settle(el),
    )
  }

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) return // 두 번째 손가락은 무시
    const el = e.currentTarget.closest<HTMLElement>('[data-sheet]')
    if (!el) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 합성 입력 등 잡을 수 없는 포인터는 그냥 둔다 */
    }
    const base = run.current ? run.current.cancel().y : new DOMMatrix(getComputedStyle(el).transform).m42
    run.current = null
    drag.current = { id: e.pointerId, y0: e.clientY, base, el, samples: [{ t: performance.now(), y: base }], y: base }
    el.style.animation = 'none' // 나타나는 중이었다면 그 자리에서 손으로 이어받는다
    el.style.transition = 'none'
    el.style.willChange = 'transform'
    el.style.transform = `translateY(${base}px)`
  }

  const sample = (d: Drag, clientY: number, t: number) => {
    // 갈 수 없는 쪽은 최대 8px까지만 약하게 따라간다
    d.y = resist(d.base + (clientY - d.y0), onUp ? -Infinity : d.base, onDown ? Infinity : d.base)
    d.samples.push({ t, y: d.y })
    while (d.samples.length > 2 && t - d.samples[0].t > 120) d.samples.shift()
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const co = e.nativeEvent.getCoalescedEvents?.() ?? []
    for (let i = 0; i < co.length - 1; i++) sample(d, co[i].clientY, co[i].timeStamp)
    sample(d, e.clientY, e.nativeEvent.timeStamp)
    d.el.style.transform = `translateY(${d.y}px)`
  }

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const v = releaseVelocity(d.samples, performance.now()) // px/s, 아래쪽이 +
    const dy = d.y - d.base
    const goDown = onDown && dy > 8 && (dy > 60 || v > 500)
    const goUp = !goDown && onUp && dy < -8 && (dy < -60 || v < -500)
    if (goDown && exit) {
      // 놓은 속도 그대로 아래로 빠져나간 뒤 닫는다
      glide(d.el, d.y, d.el.offsetHeight + 16, Math.max(v, 0), onDown)
    } else if (goDown) {
      onDown?.()
      glide(d.el, d.y, d.base, v)
    } else if (goUp) {
      onUp?.()
      glide(d.el, d.y, d.base, v)
    } else {
      glide(d.el, d.y, d.base, v)
    }
  }

  return (
    <div
      className="sheet-handle"
      role={onToggle ? undefined : 'presentation'}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {onToggle && (
        <button
          type="button"
          className="sheet-handle-btn"
          aria-expanded={!!expanded}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggle}
        >
          {expanded ? '접기' : '펼치기'}
        </button>
      )}
    </div>
  )
}
