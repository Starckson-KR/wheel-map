import { startTransition, useEffect, useLayoutEffect, useRef } from 'react'
import { prefersCalm } from '../lib/viewPrefs'
import { resist, releaseVelocity, springTo, type Sample, type SpringRun } from '../lib/sheetMotion'

// 3단계 스냅 시트 끌기: 0 최소 · 1 기본 · 2 펼침.
// 끌 때는 손가락을 1:1로 따라가고(범위 밖은 최대 8px의 약한 저항), 놓으면 놓은 순간의 속도를 이어받는 임계 감쇠 스프링으로 단계에 멈춘다.
// 움직이는 중에 다시 잡으면 그 자리·그 속도에서 바로 이어받는다. transform만 바꾸고, will-change는 움직이는 동안에만 둔다.
// 단계가 바뀔 때 안의 내용(핵심 3칸·목록)은 시트가 드러나는 정도에 맞춰 함께 나타난다(별도 타이머 없이 위치에 묶여 끊김이 없다).
export type Snap = 0 | 1 | 2

type Ctl = { id: number; y0: number; base: number; start: Snap; samples: Sample[]; ty: number }
type Nodes = { el: HTMLElement; mid: HTMLElement | null; more: HTMLElement | null }

const px = (el: HTMLElement, name: string) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
/** 내용이 나타날 때 올라오는 거리(px) */
const RISE_MID = 8
const RISE_MORE = 10

/** 단계별 translateY(px): [최소, 기본, 펼침] */
function stops(el: HTMLElement): [number, number, number] {
  const h = el.offsetHeight
  return [Math.max(0, h - px(el, '--vis-min')), Math.max(0, h - px(el, '--vis-mid')), 0]
}

export function useSheetSnap(sheetRef: React.RefObject<HTMLElement | null>, snap: Snap, setSnap: (s: Snap) => void, mountKey: unknown, onSettled?: () => void) {
  const ctl = useRef<Ctl | null>(null)
  const run = useRef<SpringRun | null>(null)
  const nodes = useRef<Nodes | null>(null)
  const cache = useRef<[number, number, number]>([0, 0, 0]) // 움직이는 동안 쓰는 단계 위치(프레임마다 다시 재지 않는다)
  const pending = useRef<Snap | null>(null) // 끌기로 정해 이미 움직이는 중인 단계
  const prev = useRef<{ el: HTMLElement | null; snap: Snap }>({ el: null, snap })
  const snapRef = useRef(snap)
  snapRef.current = snap
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled

  const nodesOf = (el: HTMLElement): Nodes => {
    if (nodes.current?.el !== el) nodes.current = { el, mid: el.querySelector<HTMLElement>('.hm-s-mid'), more: el.querySelector<HTMLElement>('.hm-more') }
    return nodes.current
  }

  /** 시트와 안의 내용을 위치 y에 맞춰 그린다 */
  const paint = (el: HTMLElement, y: number) => {
    el.style.transform = `translateY(${y}px)`
    const st = cache.current
    const n = nodesOf(el)
    if (n.mid) {
      const p = st[0] > st[1] ? clamp01((st[0] - y) / (st[0] - st[1])) : 1
      n.mid.style.opacity = String(p)
      n.mid.style.transform = `translateY(${(1 - p) * RISE_MID}px)`
    }
    if (n.more) {
      const p = st[1] > 0 ? clamp01((st[1] - y) / st[1]) : 1
      n.more.style.opacity = String(p)
      n.more.style.transform = `translateY(${(1 - p) * RISE_MORE}px)`
    }
  }

  /** 끝났을 때: 인라인 값을 모두 걷어 CSS(data-snap)가 같은 자리를 잡게 한다 */
  const settle = (el: HTMLElement) => {
    run.current = null
    if (ctl.current || pending.current !== null) return // 손으로 잡고 있거나, 새 단계가 아직 화면에 반영되기 전이면 그 자리를 유지한다(반영되면 아래 효과에서 마무리)
    el.style.transition = 'none'
    el.style.transform = ''
    el.style.willChange = ''
    const n = nodesOf(el)
    for (const c of [n.mid, n.more]) if (c) c.style.opacity = c.style.transform = ''
    void el.offsetHeight // 이 상태를 먼저 확정해서 CSS 전환이 시작되지 않게 한다
    el.style.transition = ''
    settledRef.current?.() // 스냅이 끝난 뒤 한 번만 알린다(지도 재맞춤 등)
  }

  const animateTo = (el: HTMLElement, from: number, to: number, v: number) => {
    run.current?.cancel()
    cache.current = stops(el)
    el.style.transition = 'none'
    el.style.willChange = 'transform'
    if (prefersCalm()) {
      // 움직임 줄이기: 스프링 없이 바로 이동
      paint(el, to)
      run.current = null
      requestAnimationFrame(() => settle(el))
      return
    }
    run.current = springTo(from, to, v, (y) => paint(el, y), () => settle(el))
  }

  const begin = (id: number, y: number): boolean => {
    const el = sheetRef.current
    if (!el || getComputedStyle(el).transform === 'none') return false // 큰 화면의 왼쪽 패널은 끌지 않는다
    const base = run.current ? run.current.cancel().y : new DOMMatrix(getComputedStyle(el).transform).m42
    run.current = null
    const st = (cache.current = stops(el))
    const start = ([0, 1, 2] as Snap[]).reduce((a, b) => (Math.abs(st[b] - base) < Math.abs(st[a] - base) ? b : a), snapRef.current)
    ctl.current = { id, y0: y, base, start, samples: [{ t: performance.now(), y: base }], ty: base }
    el.style.transition = 'none'
    el.style.willChange = 'transform'
    paint(el, base)
    return true
  }

  const move = (id: number, y: number, t = performance.now()) => {
    const c = ctl.current
    const el = sheetRef.current
    if (!c || !el || c.id !== id) return
    const st = cache.current
    c.ty = resist(c.base + (y - c.y0), 0, st[0])
    paint(el, c.ty)
    c.samples.push({ t, y: c.ty })
    while (c.samples.length > 2 && t - c.samples[0].t > 120) c.samples.shift()
  }

  const end = (id: number) => {
    const c = ctl.current
    const el = sheetRef.current
    if (!c || !el || c.id !== id) return
    ctl.current = null
    const st = stops(el)
    const vy = releaseVelocity(c.samples, performance.now()) // px/s, 아래쪽이 +
    const v = vy / 1000 // px/ms
    const moved = c.ty - st[c.start] // 아래로 내려간 만큼 +
    let target: Snap = c.start
    if (c.start > 0 && (moved > 0.25 * (st[c.start - 1] - st[c.start]) || (v > 0.5 && moved > 4))) target = (c.start - 1) as Snap
    else if (c.start < 2 && (moved < -0.25 * (st[c.start] - st[c.start + 1]) || (v < -0.5 && moved < -4))) target = (c.start + 1) as Snap
    if (target !== snapRef.current) pending.current = target
    prev.current.snap = target
    animateTo(el, c.ty, st[target], vy)
    // 화면 전체를 다시 그리는 일이 놓는 순간의 프레임을 막지 않도록 낮은 우선순위로 반영한다
    startTransition(() => setSnap(target))
  }

  // 버튼·키보드·"더 보기" 등으로 단계가 바뀔 때도 같은 스프링으로 움직인다(손을 떼고 정해진 경우는 위에서 이미 움직이는 중).
  useLayoutEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const was = prev.current
    prev.current = { el, snap }
    if (pending.current !== null) {
      pending.current = null
      if (!run.current && !ctl.current) settle(el)
      return
    }
    if (was.el !== el || was.snap === snap) return // 새로 열렸거나 그대로
    el.style.transition = 'none' // 읽기 전에 막아 CSS 전환이 시작되지 않게 한다
    if (getComputedStyle(el).transform === 'none') {
      el.style.transition = '' // 큰 화면의 왼쪽 패널
      return
    }
    const st = stops(el)
    const from = run.current ? run.current.cancel().y : st[was.snap]
    animateTo(el, from, st[snap], 0)
  }, [snap, mountKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
      move(-7, y, e.timeStamp)
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

  useEffect(() => () => void run.current?.cancel(), [])

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
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      // 한 프레임 안에 들어온 중간 위치도 속도 계산에 쓴다
      const co = e.nativeEvent.getCoalescedEvents?.() ?? []
      for (let i = 0; i < co.length - 1; i++) move(e.pointerId, co[i].clientY, co[i].timeStamp)
      move(e.pointerId, e.clientY, e.nativeEvent.timeStamp)
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => end(e.pointerId),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => end(e.pointerId),
  }
  return { gripProps }
}
