// 홈 「첫눈」: 화면 전체에 눈이 내리고 카드 윗변에 소복이 쌓인다(canvas, pointer-events 없음).
// 손가락(마우스)으로 쓸면 근처 눈이 흩날리고 쌓인 눈이 털린다. 그치면 쌓인 눈이 스르르 녹는다.
// 움직임 줄이기에서는 쌓인 눈과 멈춘 눈송이만 그린다. 화면이 숨겨지면 멈춘다.
import { useEffect, useImperativeHandle, useRef, type Ref, type RefObject } from 'react'
import { prefersCalm } from '../lib/viewPrefs'
import '../styles/xmas.css'

export type SnowHandle = { hint: (clientX: number, clientY: number) => void }

type Flake = { x: number; y: number; z: number; r: number; vy: number; sw: number; ph: number; ex: number; ey: number; a: number; loop: boolean; once?: boolean; big?: boolean }
type Cap = { el: Element; x: number; y: number; w: number; r: number; max: number; n: number; h: Float32Array; noise: Float32Array }

const CW = 3 // 쌓인 눈 한 칸 너비(px)
const TARGETS = '.hp-trial, .hp-ask, .hp-mine-go, .hp-tile'
const rand = (a: number, b: number) => a + Math.random() * (b - a)

export default function XmasSnow({ on, host, ref }: { on: boolean; host: RefObject<HTMLElement | null>; ref?: Ref<SnowHandle> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const api = useRef<{ start: () => void; stop: () => void; hint: (x: number, y: number) => void } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const root = host.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !root || !ctx) return
    let W = 0
    let H = 0
    let flakes: Flake[] = []
    let caps: Cap[] = []
    const kept = new Map<Element, { h: Float32Array; noise: Float32Array }>()
    let snowing = false
    let frozen = false // 움직임 줄이기: 한 장면만
    let fade = 0
    let raf = 0
    let last = 0
    let frame = 0
    const dark = () => document.documentElement.dataset.theme === 'dark'

    const size = () => {
      const k = Math.min(2, window.devicePixelRatio || 1)
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = Math.round(W * k)
      canvas.height = Math.round(H * k)
      ctx.setTransform(k, 0, 0, k, 0, 0)
    }
    // 눈이 쌓일 윗변: 검색창, 「내 제보」 면, 타일. 스크롤·등장 움직임을 따라가도록 자주 다시 잰다(쌓인 두께는 유지).
    const measure = () => {
      const c0 = canvas.getBoundingClientRect()
      caps = []
      root.querySelectorAll(TARGETS).forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width < 24) return
        const n = Math.max(2, Math.floor(r.width / CW))
        let k = kept.get(el)
        if (!k || k.h.length !== n) {
          const noise = new Float32Array(n)
          const a = rand(0, 6.28)
          const b = rand(0, 6.28)
          for (let i = 0; i < n; i++) noise[i] = 0.85 + 0.1 * Math.sin(a + i * 0.11) + 0.06 * Math.sin(b + i * 0.37)
          k = { h: new Float32Array(n), noise }
          kept.set(el, k)
        }
        const pill = el.classList.contains('hp-ask')
        caps.push({ el, x: r.left - c0.left, y: r.top - c0.top, w: r.width, r: pill ? Math.min(34, r.height / 2) : 16, max: pill ? 15 : el.classList.contains('hp-mine-go') ? 20 : 18, n, h: k.h, noise: k.noise })
      })
    }
    const edgeY = (c: Cap, lx: number) => {
      const d = lx < c.r ? c.r - lx : lx > c.w - c.r ? lx - (c.w - c.r) : 0
      return d ? c.y + c.r - Math.sqrt(Math.max(0, c.r * c.r - d * d)) : c.y
    }
    const taper = (c: Cap, lx: number) => {
      const pad = c.r * 0.6
      const t = Math.min(lx - pad, c.w - pad - lx) / 14
      return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
    }
    const mk = (first: boolean): Flake => {
      const big = Math.random() < 0.06
      const z = big ? 1 : Math.pow(Math.random(), 1.15)
      return { big, x: rand(-10, W + 10), y: first ? rand(-H * 0.4, H * 0.62) : rand(-40, -6), z, r: big ? rand(5.5, 8.5) : 1.1 + z * 2.5, vy: 52 + z * 112 + rand(-8, 8), sw: 6 + (1 - z) * 16, ph: rand(0, 6.28), ex: 0, ey: 0, a: 0, loop: true }
    }
    const bump = (c: Cap, lx: number, amt: number, sig: number) => {
      const i0 = Math.round(lx / CW)
      const span = Math.ceil((sig * 2.5) / CW)
      for (let i = Math.max(0, i0 - span); i <= Math.min(c.n - 1, i0 + span); i++) {
        const d = (i - i0) * CW
        c.h[i] = Math.min(c.max * c.noise[i] + 2, c.h[i] + amt * Math.exp(-(d * d) / (2 * sig * sig)))
      }
    }

    // 한 프레임: 움직이고(dt>0일 때) 그린다. 더 그릴 것이 남았으면 true.
    const step = (dt: number, time: number) => {
      ctx.clearRect(0, 0, W, H)
      const dk = dark()
      if (!snowing && fade > 0 && dt > 0) fade = Math.max(0, fade - dt / 1.5)
      let piled = false
      for (const c of caps) {
        for (let i = 0; i < c.n; i++) {
          if (dt > 0) {
            if (snowing) {
              if (c.h[i] < c.max * c.noise[i]) c.h[i] += dt * 1.9 * c.noise[i]
            } else if (c.h[i] > 0) c.h[i] = Math.max(0, c.h[i] * Math.exp(-dt * 1.7) - dt * 1.4)
            if (i > 0 && i < c.n - 1) c.h[i] += ((c.h[i - 1] + c.h[i + 1]) / 2 - c.h[i]) * 0.14
          }
          if (c.h[i] > 0.05) piled = true
        }
      }
      const next: Flake[] = []
      for (const f of flakes) {
        const py = f.y
        if (dt > 0) {
          f.a = Math.min(1, f.a + dt * 1.8)
          f.ex *= Math.exp(-dt * 2.6)
          f.ey *= Math.exp(-dt * 2.6)
          f.x += (Math.cos(time * 0.0012 + f.ph) * f.sw * 0.9 + f.ex) * dt
          f.y += (f.vy + f.ey) * dt
        }
        let landed = false
        if (f.z > 0.3 && !f.big && f.y > py) {
          for (const c of caps) {
            const lx = f.x - c.x
            if (lx < 4 || lx > c.w - 4) continue
            const top = edgeY(c, lx) - c.h[Math.min(c.n - 1, Math.max(0, Math.round(lx / CW)))] * taper(c, lx)
            if (py <= top && f.y > top && (f.once || Math.random() < 0.4)) {
              bump(c, lx, f.once ? 1.6 : 0.3 + f.r * 0.16, 7 + f.r)
              landed = true
              break
            }
          }
        }
        if (landed || f.y > H + 8 || f.x < -40 || f.x > W + 40) {
          if (f.loop && snowing) next.push(mk(false))
          continue
        }
        next.push(f)
        const al = f.a * (f.once ? 1 : fade) * (0.55 + f.z * 0.45)
        if (al <= 0.01) continue
        if (f.big) {
          // 앞쪽의 크고 살짝 흐릿한 눈송이
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 1.5)
          g.addColorStop(0, 'rgb(255 255 255 / 0.95)')
          g.addColorStop(0.45, 'rgb(255 255 255 / 0.7)')
          g.addColorStop(1, 'rgb(255 255 255 / 0)')
          ctx.globalAlpha = al * (dk ? 0.6 : 0.9)
          if (!dk) {
            ctx.shadowColor = 'rgb(40 70 130 / 0.3)'
            ctx.shadowBlur = 5
          }
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.r * 1.5, 0, 6.2832)
          ctx.fill()
          ctx.shadowBlur = 0
          continue
        }
        ctx.globalAlpha = dk ? al : Math.min(1, al + 0.25)
        if (!dk) {
          // 밝은 배경에서도 흰 눈이 보이게 옅은 회청색 그림자와 테두리
          ctx.shadowColor = 'rgb(40 70 130 / 0.45)'
          ctx.shadowBlur = 3
          ctx.shadowOffsetY = 0.6
        }
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.r, 0, 6.2832)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.shadowOffsetY = 0
        if (!dk) {
          ctx.strokeStyle = 'rgb(92 122 184 / 0.5)'
          ctx.lineWidth = 0.8
          ctx.stroke()
        }
      }
      flakes = !snowing && fade <= 0 ? next.filter((f) => f.once) : next
      ctx.globalAlpha = 1
      for (const c of caps) {
        if (c.y < -30 || c.y > H + 30) continue
        const i0 = Math.ceil((c.r * 0.6) / CW)
        const i1 = c.n - 1 - i0
        let any = false
        ctx.beginPath()
        for (let i = i0; i <= i1; i++) {
          const lx = i * CW
          const hh = c.h[i] * taper(c, lx)
          if (hh > 0.05) any = true
          const y = edgeY(c, lx) - hh
          if (i > i0) ctx.lineTo(c.x + lx, y)
          else ctx.moveTo(c.x + lx, y + 1.5)
        }
        if (!any) continue
        for (let i = i1; i >= i0; i--) ctx.lineTo(c.x + i * CW, edgeY(c, i * CW) + 1.5)
        ctx.closePath()
        ctx.shadowColor = dk ? 'rgb(0 0 0 / 0.45)' : 'rgb(40 70 130 / 0.38)'
        ctx.shadowBlur = 5
        ctx.shadowOffsetY = 2.5
        ctx.fillStyle = dk ? '#f1f5fb' : '#ffffff'
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.shadowOffsetY = 0
        if (!dk) {
          ctx.strokeStyle = 'rgb(124 150 200 / 0.55)'
          ctx.lineWidth = 1
          ctx.stroke()
        }
      }
      return snowing || flakes.length > 0 || piled
    }
    const loop = (now: number) => {
      raf = 0
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (++frame % 20 === 0) measure()
      if (!step(dt, now)) {
        ctx.clearRect(0, 0, W, H)
        return
      }
      if (!document.hidden) raf = requestAnimationFrame(loop)
    }
    const run = () => {
      if (raf || frozen || document.hidden) return
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }
    const count = () => Math.max(110, Math.min(220, Math.round((W * H) / 2200)))
    const start = () => {
      size()
      measure()
      snowing = true
      fade = 1
      flakes = flakes.filter((f) => f.once)
      for (let i = 0, n = count(); i < n; i++) flakes.push(mk(true))
      frozen = prefersCalm()
      if (frozen) {
        // 끝 장면만: 다 쌓인 눈과 멈춘 눈송이
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        for (const c of caps) for (let i = 0; i < c.n; i++) c.h[i] = c.max * c.noise[i]
        for (const f of flakes) {
          f.a = 1
          f.y = rand(0, H)
        }
        step(0, 0)
      } else run()
    }
    const stop = () => {
      snowing = false
      if (frozen) {
        frozen = false
        flakes = []
        fade = 0
        kept.forEach((k) => k.h.fill(0))
        ctx.clearRect(0, 0, W, H)
      }
    }
    // 로고를 누를 때마다 떨어지는 눈송이 하나(힌트)
    const hint = (clientX: number, clientY: number) => {
      if (prefersCalm()) return
      if (!W) size()
      if (!caps.length) measure()
      const c0 = canvas.getBoundingClientRect()
      flakes.push({ x: clientX - c0.left + rand(-3, 3), y: clientY - c0.top, z: 1, r: rand(2.6, 3.8), vy: 64, sw: 9, ph: rand(0, 6.28), ex: rand(-14, 14), ey: 0, a: 0.4, loop: false, once: true })
      run()
    }
    api.current = { start, stop, hint }

    // 손가락(마우스)으로 쓸면 근처 눈송이가 흩날리고, 쌓인 눈이 털린다
    let pp: { x: number; y: number; t: number } | null = null
    const onMove = (e: PointerEvent) => {
      if (!raf) {
        pp = null
        return
      }
      const c0 = canvas.getBoundingClientRect()
      const p = { x: e.clientX - c0.left, y: e.clientY - c0.top }
      const now = performance.now()
      if (pp && now - pp.t < 120) {
        const k = 1000 / Math.max(8, now - pp.t)
        const vx = Math.max(-900, Math.min(900, (p.x - pp.x) * k))
        const vy = Math.max(-900, Math.min(900, (p.y - pp.y) * k))
        if (Math.hypot(vx, vy) > 40) {
          for (const f of flakes) {
            const dx = f.x - p.x
            const dy = f.y - p.y
            const d = Math.hypot(dx, dy)
            if (d > 74) continue
            const g = 1 - d / 74
            f.ex += (vx * 0.34 + (dx / (d || 1)) * 90) * g
            f.ey += (vy * 0.34 + (dy / (d || 1)) * 90 - 50) * g
          }
          for (const c of caps) {
            const lx = p.x - c.x
            if (lx < 0 || lx > c.w || Math.abs(p.y - c.y) > 22) continue
            const i0 = Math.round(lx / CW)
            let off = 0
            for (let i = Math.max(0, i0 - 6); i <= Math.min(c.n - 1, i0 + 6); i++) {
              off += c.h[i] * 0.5
              c.h[i] *= 0.5
            }
            const n = flakes.length < 400 ? Math.min(7, Math.round(off / 4)) : 0
            for (let j = 0; j < n; j++) flakes.push({ x: p.x + rand(-14, 14), y: c.y - rand(2, 10), z: 0.2, r: rand(1.2, 2.6), vy: 70, sw: 8, ph: rand(0, 6.28), ex: vx * 0.3 + rand(-90, 90), ey: -rand(120, 260), a: 1, loop: false })
          }
        }
      }
      pp = { x: p.x, y: p.y, t: now }
    }
    const onLayout = () => {
      size()
      measure()
      if (frozen) step(0, 0)
    }
    const onScroll = () => {
      if (!snowing && !raf) return
      measure()
      if (frozen) step(0, 0)
    }
    const onVis = () => {
      if (!document.hidden && (snowing || flakes.length > 0)) run()
    }
    const ro = new ResizeObserver(onLayout)
    ro.observe(canvas)
    root.addEventListener('pointermove', onMove, { passive: true })
    root.addEventListener('scroll', onScroll, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVis)
    return () => {
      api.current = null
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('scroll', onScroll, { capture: true })
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [host])

  useEffect(() => {
    if (on) api.current?.start()
    else api.current?.stop()
  }, [on])

  useImperativeHandle(ref, () => ({ hint: (x, y) => api.current?.hint(x, y) }), [])

  return <canvas className="xs-canvas" ref={canvasRef} aria-hidden="true" />
}
