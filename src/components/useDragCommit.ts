import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { commitDir, lockAxis, type Axis } from '../lib/gesture'
import { releaseVelocity, type Sample } from '../lib/sheetMotion'

type Opts = {
  /** 가로로 끄는 동안 처음 자리에서 옮긴 거리(px). 화면에 반영하는 쪽이 한다. */
  onDrag: (dx: number) => void
  /** 기준을 넘겨 놓음: 방향 -1(왼쪽) / 1(오른쪽) */
  onCommit: (dir: -1 | 1) => void
  /** 기준 못 넘기고 놓음, 또는 세로로 판정됨 → 제자리로 */
  onCancel: () => void
  /** 끄는 대상의 폭(px) */
  getWidth: () => number
}

/**
 * 가로 끌어서 확정(카드 넘기기 등). 처음 8px으로 가로·세로를 정하고 세로면 손을 놓아 스크롤에 맡긴다.
 * 쓰는 요소에는 touch-action: pan-y 를 준다. 모든 끌기에는 같은 일을 하는 한 번 누르기 버튼을 함께 둔다.
 */
export function useDragCommit({ onDrag, onCommit, onCancel, getWidth }: Opts) {
  const st = useRef<{ id: number; x: number; y: number; axis: Axis; samples: Sample[] } | null>(null)
  const cb = useRef({ onDrag, onCommit, onCancel, getWidth })
  useEffect(() => {
    cb.current = { onDrag, onCommit, onCancel, getWidth }
  })

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    st.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, samples: [] }
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = st.current
    if (!s || e.pointerId !== s.id) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.axis) {
      s.axis = lockAxis(dx, dy)
      if (!s.axis) return
      if (s.axis === 'y') {
        st.current = null
        return
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // 무시
      }
    }
    s.samples.push({ t: performance.now(), y: dx }) // 속도 계산은 sheetMotion을 재사용(여기서는 y가 가로 위치)
    if (s.samples.length > 12) s.samples.shift()
    cb.current.onDrag(dx)
  }, [])

  const finish = useCallback((e: ReactPointerEvent<HTMLElement>, canceled: boolean) => {
    const s = st.current
    if (!s || e.pointerId !== s.id) return
    st.current = null
    if (s.axis !== 'x') return
    const dx = e.clientX - s.x
    const dir = canceled ? 0 : commitDir(dx, releaseVelocity(s.samples, performance.now()), cb.current.getWidth())
    if (dir === 0) cb.current.onCancel()
    else cb.current.onCommit(dir)
  }, [])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => finish(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
  }
}
