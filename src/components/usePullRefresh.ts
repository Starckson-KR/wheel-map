import { useCallback, useEffect, useRef } from 'react'
import { canStartPull, PULL_LABEL, pullOffset, pullPhase, pullProgress, REFRESH_BUSY_MS, REFRESH_BUSY_MS_CALM, REFRESH_HOLD, type PullPhase } from '../lib/pullRefresh'
import { lockAxis, type Axis } from '../lib/gesture'
import { haptic } from '../lib/haptic'
import { prefersCalm } from '../lib/viewPrefs'

type Opts = {
  /** 스크롤되는 영역(맨 위에서만 당길 수 있다) */
  scrollRef: React.RefObject<HTMLElement | null>
  /** 당길 때 같이 내려오는 내용 */
  bodyRef: React.RefObject<HTMLElement | null>
  /** 위에서 내려오는 표시(알약) */
  indRef: React.RefObject<HTMLElement | null>
  /** 새로고침이 하는 일 */
  onRefresh: () => void
}

const SETTLE = 'transform 280ms var(--ease-out)'

/**
 * 맨 위에서 아래로 당겨 새로고침(터치). 처음 8px으로 가로·세로를 정하고 가로면 손을 놓는다.
 * 움직임은 DOM에 직접 써서 매 프레임 리렌더하지 않는다. 같은 일을 하는 한 번 누르기 대안은 반환값 refresh().
 * 움직임 줄이기에서는 내용이 내려오지 않고 표시만 나타난다.
 */
export function usePullRefresh({ scrollRef, bodyRef, indRef, onRefresh }: Opts) {
  const cb = useRef(onRefresh)
  useEffect(() => {
    cb.current = onRefresh
  })
  const busy = useRef(false)
  const phase = useRef<PullPhase>('idle')
  const timer = useRef(0)

  const paint = useCallback(
    (offset: number, progress: number, ph: PullPhase, animate: boolean) => {
      const calm = prefersCalm()
      const body = bodyRef.current
      const ind = indRef.current
      if (body) {
        body.style.transition = animate && !calm ? SETTLE : 'none'
        body.style.transform = offset > 0 && !calm ? `translateY(${offset}px)` : ''
      }
      if (ind) {
        ind.style.transition = animate && !calm ? 'transform 280ms var(--ease-out), opacity 180ms var(--ease-out)' : 'none'
        ind.style.transform = `translate(-50%, ${calm ? 0 : offset - 48}px)`
        ind.style.opacity = ph === 'idle' ? '0' : ph === 'busy' ? '1' : String(Math.min(1, progress * 1.4))
        ind.style.setProperty('--pr-rot', `${Math.round(progress * 270)}deg`)
        ind.dataset.phase = ph
        const label = ind.querySelector('[data-pr-label]')
        const text = PULL_LABEL[ph]
        if (label && ph !== 'idle' && label.textContent !== text) label.textContent = text
      }
    },
    [bodyRef, indRef],
  )

  const settle = useCallback(() => {
    phase.current = 'idle'
    paint(0, 0, 'idle', true)
  }, [paint])

  /** 새로고침을 실제로 한다(당겨 놓았을 때, 또는 새로고침 버튼) */
  const refresh = useCallback(() => {
    if (busy.current) return
    busy.current = true
    phase.current = 'busy'
    paint(REFRESH_HOLD, 1, 'busy', true)
    haptic('success')
    cb.current()
    const calm = prefersCalm()
    timer.current = window.setTimeout(() => {
      busy.current = false
      settle()
    }, calm ? REFRESH_BUSY_MS_CALM : REFRESH_BUSY_MS)
  }, [paint, settle])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let st: { x: number; y: number; axis: Axis; on: boolean; dy: number } | null = null

    const tops = (t: EventTarget | null): number[] => {
      const out = [el.scrollTop]
      let n = t instanceof Element ? t : null
      while (n && n !== el) {
        if (n.scrollHeight > n.clientHeight + 1) out.push(n.scrollTop)
        n = n.parentElement
      }
      return out
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !canStartPull(tops(e.target), busy.current)) {
        st = null
        return
      }
      st = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null, on: false, dy: 0 }
    }
    const onMove = (e: TouchEvent) => {
      if (!st) return
      if (e.touches.length !== 1) {
        end(false)
        return
      }
      const dx = e.touches[0].clientX - st.x
      const dy = e.touches[0].clientY - st.y
      if (!st.axis) {
        st.axis = lockAxis(dx, dy)
        if (!st.axis) return
        if (st.axis === 'x' || dy <= 0) {
          st = null // 가로 끌기·위로 밀기는 원래 스크롤에 맡긴다
          return
        }
        st.on = true
      }
      if (!st.on) return
      if (el.scrollTop > 0) {
        end(false) // 도중에 스크롤이 시작됐다
        return
      }
      if (e.cancelable) e.preventDefault() // 브라우저 기본 당겨서 새로고침과 겹치지 않게
      st.dy = Math.max(0, dy)
      const ph = pullPhase(st.dy, false)
      if (ph !== phase.current) {
        if (ph === 'ready') haptic('tick')
        phase.current = ph
      }
      paint(pullOffset(st.dy), pullProgress(st.dy), ph, false)
    }
    const end = (allow: boolean) => {
      const s = st
      st = null
      if (!s || !s.on) return
      if (allow && pullPhase(s.dy, false) === 'ready') refresh()
      else settle()
    }
    const onEnd = () => end(true)
    const onCancel = () => end(false)

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onCancel)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
      clearTimeout(timer.current)
      busy.current = false
    }
  }, [scrollRef, paint, refresh, settle])

  return { refresh }
}
