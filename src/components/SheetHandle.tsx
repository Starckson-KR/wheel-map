import { useRef } from 'react'

type Props = {
  /** 위로 밀거나 빠르게 튕기면 부른다(없으면 위로는 저항만 준다) */
  onUp?: () => void
  /** 아래로 밀거나 빠르게 튕기면 부른다(없으면 아래로는 저항만 준다) */
  onDown?: () => void
  /** 끌기 대신 누르거나 키보드로 펼치고 접는 버튼(위·아래 둘 다 되는 시트용) */
  expanded?: boolean
  onToggle?: () => void
}

// 바텀시트 손잡이. 잡고 끌면 시트가 손가락을 따라가고, 놓을 때 멀리 갔거나 빠르면 위·아래 동작을 부른다.
// 시트는 가장 가까운 [data-sheet] 요소다. 움직임은 transform만 바꿔 그래픽 가속을 쓴다.
export default function SheetHandle({ onUp, onDown, expanded, onToggle }: Props) {
  const drag = useRef<{ id: number; y0: number; t0: number; base: number; el: HTMLElement } | null>(null)

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) return // 두 번째 손가락은 무시
    const el = e.currentTarget.closest<HTMLElement>('[data-sheet]')
    if (!el) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const m = new DOMMatrix(getComputedStyle(el).transform)
    drag.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), base: m.m42, el }
    el.style.transition = 'none'
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    let dy = e.clientY - d.y0
    // 갈 수 없는 쪽은 끌수록 덜 움직이게 한다
    if (dy < 0 && !onUp) dy *= 0.15
    if (dy > 0 && !onDown) dy *= 0.15
    d.el.style.transform = `translateY(${d.base + dy}px)`
  }

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const dy = e.clientY - d.y0
    const v = dy / Math.max(1, performance.now() - d.t0) // px/ms
    d.el.style.transition = ''
    d.el.style.transform = ''
    if ((dy > 60 || v > 0.5) && onDown) onDown()
    else if ((dy < -60 || v < -0.5) && onUp) onUp()
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
