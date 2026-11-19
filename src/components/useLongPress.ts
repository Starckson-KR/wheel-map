import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { longPressProgress, longPressState } from '../lib/gesture'
import { LONG_PRESS_MS, LONG_PRESS_PROGRESS_FROM, LONG_PRESS_SLOP } from '../lib/motionTokens'

type Opts = {
  /** 길게 눌린 순간. 이때 손가락 자리를 같이 준다. */
  onFire: (e: { x: number; y: number; pointerType: string }) => void
  /** 150ms부터 차오르는 진행값(0~1). 끝나거나 취소되면 0으로 한 번 더 부른다. */
  onProgress?: (p: number) => void
  ms?: number
  slop?: number
}

/**
 * 길게 누르기. 처음 자리에서 slop(px) 넘게 움직이거나 떼면 취소(스크롤·끌기와 구분).
 * 돌려주는 핸들러를 버튼에 펼쳐 쓰고, fired.current가 true면 그 뒤에 오는 click은 무시한다(길게 누른 뒤 짧게 누르기 동작이 같이 일어나지 않게).
 */
export function useLongPress({ onFire, onProgress, ms = LONG_PRESS_MS, slop = LONG_PRESS_SLOP }: Opts) {
  const fired = useRef(false)
  const st = useRef<{ id: number; x: number; y: number; t0: number; timer: number; raf: number; type: string } | null>(null)
  const fireRef = useRef(onFire)
  const progRef = useRef(onProgress)
  useEffect(() => {
    fireRef.current = onFire
    progRef.current = onProgress
  })

  const stop = useCallback(() => {
    const s = st.current
    if (!s) return
    clearTimeout(s.timer)
    cancelAnimationFrame(s.raf)
    st.current = null
    progRef.current?.(0)
  }, [])
  useEffect(() => stop, [stop])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      stop()
      fired.current = false
      const s = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), timer: 0, raf: 0, type: e.pointerType }
      st.current = s
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // 캡처를 못 해도 길게 누르기는 동작한다
      }
      const tick = () => {
        if (st.current !== s) return
        progRef.current?.(longPressProgress(performance.now() - s.t0, ms, Math.min(LONG_PRESS_PROGRESS_FROM, ms)))
        s.raf = requestAnimationFrame(tick)
      }
      s.raf = requestAnimationFrame(tick)
      s.timer = window.setTimeout(() => {
        if (st.current !== s) return
        fired.current = true
        clearTimeout(s.timer)
        cancelAnimationFrame(s.raf)
        st.current = null
        progRef.current?.(1)
        fireRef.current({ x: s.x, y: s.y, pointerType: s.type })
      }, ms)
    },
    [ms, stop],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = st.current
      if (!s || e.pointerId !== s.id) return
      if (longPressState(performance.now() - s.t0, Math.hypot(e.clientX - s.x, e.clientY - s.y), ms, slop) === 'cancel') stop()
    },
    [ms, slop, stop],
  )

  const end = useCallback(() => stop(), [stop])

  return {
    fired,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      // 길게 누를 때 뜨는 시스템 메뉴·글자 선택을 막는다
      onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    },
  }
}
