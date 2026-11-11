import { useEffect, useRef } from 'react'

// 3단계 스냅 시트 끌기: 0 최소 · 1 기본 · 2 펼침.
// 이동 중에는 손가락을 1:1로 따라가고(범위 밖으로는 나가지 않아 튕김이 없다), 놓을 때 거리·속도가 기준을 넘으면 한 단계 이동한다.
// 움직임은 transform만 바꾸고, 끌기를 시작하면 이동 중이던 애니메이션을 그 자리에서 이어받는다(인터럽트 가능).
export type Snap = 0 | 1 | 2

type Ctl = { id: number; y0: number; base: number; start: Snap; samples: { t: number; y: number }[]; ty: number }

const px = (el: HTMLElement, name: string) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0

/** 단계별 translateY(px): [최소, 기본, 펼침] */
function stops(el: HTMLElement): [number, number, number] {
  const h = el.offsetHeight
  return [Math.max(0, h - px(el, '--vis-min')), Math.max(0, h - px(el, '--vis-mid')), 0]
}

export function useSheetSnap(sheetRef: React.RefObject<HTMLElement | null>, snap: Snap, setSnap: (s: Snap) => void, mountKey: unknown) {
  const ctl = useRef<Ctl | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const snapRef = useRef(snap)
  snapRef.current = snap

  const begin = (id: number, y: number): boolean => {
    const el = sheetRef.current
    if (!el || getComputedStyle(el).transform === 'none') return false // 큰 화면의 왼쪽 패널은 끌지 않는다
    window.clearTimeout(timer.current)
    const base = new DOMMatrix(getComputedStyle(el).transform).m42
    const st = stops(el)
    const start = ([0, 1, 2] as Snap[]).reduce((a, b) => (Math.abs(st[b] - base) < Math.abs(st[a] - base) ? b : a), snapRef.current)
    ctl.current = { id, y0: y, base, start, samples: [{ t: performance.now(), y }], ty: base }
    el.style.transition = 'none'
    el.style.transform = `translateY(${base}px)`
    return true
  }

  const move = (id: number, y: number) => {
    const c = ctl.current
    const el = sheetRef.current
    if (!c || !el || c.id !== id) return
    const st = stops(el)
    c.ty = Math.min(st[0], Math.max(0, c.base + (y - c.y0))) // 범위 밖은 그대로 멈춘다
    el.style.transform = `translateY(${c.ty}px)`
    const t = performance.now()
    c.samples.push({ t, y })
    while (c.samples.length > 2 && t - c.samples[0].t > 120) c.samples.shift()
  }

  const end = (id: number) => {
    const c = ctl.current
    const el = sheetRef.current
    if (!c || !el || c.id !== id) return
    ctl.current = null
    const st = stops(el)
    const a = c.samples[0]
    const b = c.samples[c.samples.length - 1]
    const v = (b.y - a.y) / Math.max(1, b.t - a.t) // px/ms, 아래쪽이 +
    const moved = c.ty - st[c.start] // 아래로 내려간 만큼 +
    let target: Snap = c.start
    if (c.start > 0 && (moved > 0.25 * (st[c.start - 1] - st[c.start]) || (v > 0.5 && moved > 4))) target = (c.start - 1) as Snap
    else if (c.start < 2 && (moved < -0.25 * (st[c.start] - st[c.start + 1]) || (v < -0.5 && moved < -4))) target = (c.start + 1) as Snap
    el.style.transition = 'transform var(--t-sheet) var(--ease-drawer)'
    el.style.transform = `translateY(${st[target]}px)`
    setSnap(target)
    const done = () => {
      if (ctl.current) return
      el.style.transition = ''
      el.style.transform = ''
    }
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== el) return
      el.removeEventListener('transitionend', onEnd)
      done()
    }
    el.addEventListener('transitionend', onEnd)
    timer.current = window.setTimeout(() => {
      el.removeEventListener('transitionend', onEnd)
      done()
    }, 420)
  }

  // 목록 위에서의 끌기(터치): 펼침 상태에서는 목록 맨 위에서 아래로 당길 때만 시트가 내려가고, 그 밖에는 목록이 스크롤된다.
  // 접힌 상태에서는 목록 영역을 눌러 끌어도 시트가 움직인다.
  useEffect(() => {
    const list = sheetRef.current?.querySelector<HTMLElement>('.hm-more')
    if (!list) return
    let y0 = 0
    let top0 = 0
    let active = false
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      y0 = e.touches[0].clientY
      top0 = list.scrollTop
      active = false
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const y = e.touches[0].clientY
      if (!active) {
        const open = snapRef.current === 2
        const dy = y - y0
        const pull = open ? top0 <= 0 && list.scrollTop <= 0 && dy > 6 : Math.abs(dy) > 6
        if (!pull) return
        if (!begin(-7, y0)) return
        active = true
      }
      if (e.cancelable) e.preventDefault()
      move(-7, y)
    }
    const onEnd = () => {
      if (!active) return
      active = false
      end(-7)
    }
    list.addEventListener('touchstart', onStart, { passive: true })
    list.addEventListener('touchmove', onMove, { passive: false })
    list.addEventListener('touchend', onEnd)
    list.addEventListener('touchcancel', onEnd)
    return () => {
      list.removeEventListener('touchstart', onStart)
      list.removeEventListener('touchmove', onMove)
      list.removeEventListener('touchend', onEnd)
      list.removeEventListener('touchcancel', onEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountKey])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const gripProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (ctl.current || (e.target as HTMLElement).closest('button')) return
      if (!begin(e.pointerId, e.clientY)) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* 합성 입력 등 잡을 수 없는 포인터는 그냥 둔다 */
      }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => move(e.pointerId, e.clientY),
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => end(e.pointerId),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => end(e.pointerId),
  }
  return { gripProps }
}
