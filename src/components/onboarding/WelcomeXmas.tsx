// 12월 환영 화면 「썰매 배달」: 썰매가 길을 앞장서 달리며 그리고, 지나간 길에 전구가 켜진다.
// 길 끝(아이콘)에 닿으면 아이콘에 산타 모자가 떨어지고, 이름 끝 「!」 점이 금색 별로 바뀐다. 눈은 조용히 내린다.
// 「시작하기」는 처음부터 눌리고, 화면을 누르면 끝 장면으로 넘어간다. 움직임 줄이기에서는 끝 장면만 보인다.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { PressButton } from '../motionKit'
import { Sentences } from '../Sentences'
import { WelcomeTown } from './WelcomeMap'
import { prefersCalm } from '../../lib/viewPrefs'
import '../../styles/wordmark.css'
import '../../styles/xmas.css'

const NS = 'http://www.w3.org/2000/svg'
const BULB_COLORS = ['#e0463c', '#f2b632', '#1f9d6b']
// 연출 시간표(ms). 끝 장면은 3.45초.
const T = { sled0: 250, sled1: 1950, icon0: 1880, icon1: 2440, name0: 2050, name1: 2430, about0: 2300, about1: 2680, hat0: 2350, hat1: 3000, star0: 2850, star1: 3350, end: 3450 }
const STARS: [number, number, number][] = [[38, 60, 1.6], [96, 128, 1.1], [150, 44, 1.3], [214, 96, 1], [268, 38, 1.7], [330, 84, 1.2], [352, 168, 1], [62, 196, 1.2], [300, 150, 1.4], [176, 170, 0.9], [24, 132, 1], [238, 204, 1.1]]

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const outCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const inOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const outBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2)
const bounce = (t: number) => {
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
  return n * (t -= 2.625 / d) * t + 0.984375
}
const rand = (a: number, b: number) => a + Math.random() * (b - a)

type Dust = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; rot: number; c: string }

export default function WelcomeXmas({ onStart }: { onStart: () => void }) {
  const bgRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const routeRef = useRef<SVGPathElement>(null)
  const bulbsRef = useRef<SVGGElement>(null)
  const sledRef = useRef<SVGGElement>(null)
  const artRef = useRef<SVGGElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const iconRef = useRef<HTMLImageElement>(null)
  const hatRef = useRef<SVGSVGElement>(null)
  const nameRef = useRef<HTMLHeadingElement>(null)
  const aboutWrap = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<SVGCircleElement>(null)
  const starRef = useRef<SVGPathElement>(null)

  // 첫 그림 전에 숨겨 두어(끝 장면이 먼저 번쩍이지 않게) 연출이 처음부터 보이게 한다
  useLayoutEffect(() => {
    if (prefersCalm()) return
    for (const el of [iconRef.current, hatRef.current, nameRef.current, aboutWrap.current, footRef.current]) if (el) el.style.opacity = '0'
  }, [])

  useEffect(() => {
    const bg = bgRef.current
    const svg = svgRef.current
    const route = routeRef.current
    const bulbsG = bulbsRef.current
    const sled = sledRef.current
    const art = artRef.current
    const canvas = fxRef.current
    const icon = iconRef.current
    const hat = hatRef.current
    const name = nameRef.current
    const about = aboutWrap.current
    const foot = footRef.current
    const dot = dotRef.current
    const star = starRef.current
    const ctx = canvas?.getContext('2d')
    if (!bg || !svg || !route || !bulbsG || !sled || !art || !canvas || !ctx || !icon || !hat || !name || !about || !foot || !dot || !star) return
    const town = svg.querySelector<SVGGElement>('.ob-w-town')
    const calm = prefersCalm()

    // 길: 화면 오른쪽 밖에서 들어와 이름 아래를 지나 왼쪽에서 꺾어 아이콘으로. 썰매가 화면 가장자리에 걸치지 않게 폭에 맞춘다.
    const startX = Math.round(Math.min(bg.clientWidth / 2 + 56, 560))
    route.setAttribute('d', `M ${startX} 190 L -90 190 Q -110 190 -110 170 L -110 20 Q -110 0 -90 0 L 0 0`)
    const L = route.getTotalLength()
    // 전구: 길을 따라 같은 간격으로. 아이콘에 가려지는 끝부분은 달지 않는다.
    const bulbs: { l: number; el: SVGGElement; on: boolean }[] = []
    bulbsG.textContent = ''
    for (let l = 20, i = 0; l < L - 104; l += 27, i++) {
      const p = route.getPointAtLength(l)
      const c = BULB_COLORS[i % 3]
      const g = document.createElementNS(NS, 'g')
      g.setAttribute('class', 'ob-x-bulb')
      g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
      const d = (-Math.random() * 1.5).toFixed(2)
      g.innerHTML = `<g class="ob-x-b-in"><circle class="ob-x-b-halo" r="12" fill="${c}" style="animation-delay:${d}s"/><rect class="ob-x-b-cap" x="-2.5" y="-9" width="5" height="4.5" rx="1"/><g class="ob-x-b-core" style="animation-delay:${d}s"><ellipse rx="5.4" ry="6.2" fill="${c}"/><circle cx="-1.7" cy="-2.2" r="1.6" fill="#fff" opacity="0.85"/></g></g>`
      bulbsG.appendChild(g)
      bulbs.push({ l, el: g, on: false })
    }

    // 효과 캔버스(눈 + 썰매 반짝이 가루). 화면 좌표(CSS px)로 그린다.
    let W = 0
    let H = 0
    const size = () => {
      const k = Math.min(2, window.devicePixelRatio || 1)
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = Math.round(W * k)
      canvas.height = Math.round(H * k)
      ctx.setTransform(k, 0, 0, k, 0, 0)
    }
    size()
    const snow = Array.from({ length: 54 }, () => ({ x: Math.random(), y: rand(-1, 1), r: rand(1, 3.1), v: rand(18, 46), ph: rand(0, 6.28), sw: rand(6, 20) }))
    let dust: Dust[] = []
    const dark = () => document.documentElement.dataset.theme === 'dark'
    const star4 = (x: number, y: number, r: number, rot: number) => {
      ctx.beginPath()
      for (let i = 0; i < 8; i++) {
        const a = rot + (i * Math.PI) / 4
        const rr = i % 2 ? r * 0.36 : r
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
      }
      ctx.closePath()
      ctx.fill()
    }
    const emit = (x: number, y: number, n: number, spread: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const a = rand(0, 6.28)
        const s = rand(speed * 0.2, speed)
        dust.push({ x: x + rand(-spread, spread), y: y + rand(-spread, spread), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 12, life: 0, max: rand(0.5, 1.15), r: rand(1.6, 4.6), rot: rand(0, 3.14), c: Math.random() < 0.72 ? (Math.random() < 0.5 ? '#f2b632' : '#ffd978') : '#ffffff' })
      }
    }
    const drawFx = (dt: number, time: number) => {
      ctx.clearRect(0, 0, W, H)
      const dk = dark()
      for (const f of snow) {
        f.y += (f.v * dt) / H
        if (f.y > 1.01) {
          f.y = -0.01
          f.x = Math.random()
        }
        const x = f.x * W + Math.sin(time * 0.0011 + f.ph) * f.sw
        ctx.globalAlpha = dk ? 0.55 + f.r * 0.12 : 0.9
        ctx.fillStyle = dk || f.y < 0.39 ? '#ffffff' : '#b3c3e6'
        ctx.beginPath()
        ctx.arc(x, f.y * H, f.r, 0, 6.2832)
        ctx.fill()
      }
      dust = dust.filter((d) => (d.life += dt) < d.max)
      for (const d of dust) {
        d.x += d.vx * dt
        d.y += d.vy * dt
        d.vy += 46 * dt
        d.vx *= 0.985
        const k = 1 - d.life / d.max
        ctx.globalAlpha = Math.min(1, k * 1.6)
        ctx.fillStyle = d.c === '#ffffff' && !dk ? '#ffe7a3' : d.c
        star4(d.x, d.y, d.r * (0.5 + k * 0.7), d.rot + d.life * 3)
      }
      ctx.globalAlpha = 1
    }

    let start = performance.now()
    let last = start
    let face = -1
    let burst = false
    let sledAt: { x: number; y: number } | null = null
    let raf = 0

    const render = (t: number, live: boolean) => {
      if (town) town.style.opacity = (seg(t, 0, 300) * (1 - 0.42 * inOut(seg(t, 1900, 2700)))).toFixed(3)
      foot.style.opacity = String(seg(t, 0, 300))
      const p = inOut(seg(t, T.sled0, T.sled1))
      route.style.strokeDashoffset = String(1 - p)
      route.style.opacity = String(1 - 0.45 * seg(t, 1950, 2650))
      const l = p * L
      for (const b of bulbs) {
        const on = l >= b.l + 8
        if (on !== b.on) {
          b.on = on
          b.el.classList.toggle('on', on)
        }
      }
      // 썰매: 옆모습을 세운 채 가는 방향으로 돌아보고, 오르막에서는 앞을 살짝 든다
      const a = route.getPointAtLength(Math.max(0, l - 1))
      const b = route.getPointAtLength(Math.min(L, l + 1))
      const hx = b.x - a.x
      const hy = b.y - a.y
      const pt = route.getPointAtLength(l)
      const want = hx > 0.5 ? 1 : hx < -0.5 ? -1 : face >= 0 ? 1 : -1
      face += (want - face) * (live ? 0.28 : 1)
      const tilt = hy < -0.5 ? 13 : 0
      const sOp = seg(t, T.sled0 - 120, T.sled0 + 60) * (1 - seg(t, 1900, 2060))
      sled.style.opacity = String(sOp)
      sled.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${(pt.y - 6 + Math.sin(t / 70) * 1.4).toFixed(1)}) scale(${(1.12 - 0.4 * seg(t, 1860, 2060)).toFixed(3)})`)
      art.setAttribute('transform', `scale(${(Math.abs(face) < 0.12 ? 0.12 * (face < 0 ? -1 : 1) : face).toFixed(3)} 1) rotate(${-tilt})`)
      sledAt = sOp > 0.5 && p > 0 && p < 1 ? { x: pt.x - Math.sign(hx) * 22, y: pt.y + (hy < -0.5 ? 20 : 0) } : null

      icon.style.opacity = String(seg(t, T.icon0, T.icon0 + 140))
      icon.style.transform = `scale(${(0.35 + 0.65 * outBack(seg(t, T.icon0, T.icon1))).toFixed(4)})`
      const nk = outCubic(seg(t, T.name0, T.name1))
      name.style.opacity = String(nk)
      name.style.transform = `translateY(${((1 - nk) * 14).toFixed(2)}px)`
      const ak = outCubic(seg(t, T.about0, T.about1))
      about.style.opacity = String(ak)
      about.style.transform = `translateY(${((1 - ak) * 14).toFixed(2)}px)`
      // 산타 모자: 위에서 떨어져 아이콘 모서리에 톡, 두 번 튕긴다
      const hk = seg(t, T.hat0, T.hat1)
      hat.style.opacity = String(seg(t, T.hat0, T.hat0 + 90))
      hat.style.transform = `translateY(${(-190 * (1 - bounce(hk))).toFixed(2)}px) rotate(${(-15 - 22 * (1 - outCubic(hk))).toFixed(2)}deg)`
      // 「!」 점 → 금색 별
      const sk = seg(t, T.star0, T.star1)
      dot.style.opacity = String(1 - seg(t, T.star0, T.star0 + 140))
      star.style.transform = `scale(${Math.max(0, outBack(sk)).toFixed(4)}) rotate(${((1 - outCubic(sk)) * -140).toFixed(1)}deg)`
      if (live && !burst && t >= T.star0 + 160) {
        burst = true
        const c = canvas.getBoundingClientRect()
        const r = star.getBoundingClientRect()
        emit(r.left - c.left + r.width / 2, r.top - c.top + r.height / 2, 26, 4, 130)
      }
    }

    const tick = (now: number) => {
      raf = 0
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = now - start
      render(Math.min(t, T.end), t < T.end)
      if (sledAt && t < T.sled1) {
        const c = canvas.getBoundingClientRect()
        const s = svg.getBoundingClientRect() // 지도 (0,0) = 아이콘 중심 = SVG 한가운데
        emit(s.left - c.left + s.width / 2 + sledAt.x, s.top - c.top + s.height / 2 + sledAt.y, 2, 5, 34)
      }
      drawFx(dt, now)
      if (!document.hidden) raf = requestAnimationFrame(tick)
    }
    const onVis = () => {
      if (calm || document.hidden || raf) return
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
    // 화면 아무 곳이나 누르면 끝 장면으로(「시작하기」는 처음부터 눌린다)
    const rootEl = bg.parentElement
    const skip = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('button')) return
      if (performance.now() - start < T.end) {
        start = performance.now() - T.end
        burst = true
      }
    }
    const onResize = () => {
      size()
      if (calm) drawFx(0, 0)
    }
    rootEl?.addEventListener('click', skip)
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVis)

    let cancelled = false
    if (calm) {
      // 움직임 줄이기: 끝 장면(모자·별·전구)만, 눈송이는 멈춘 채로
      face = 1
      render(T.end, false)
      drawFx(0, 0)
    } else {
      render(0, false)
      // 글꼴이 준비되면 시작(최대 0.7초만 기다림)
      const fonts = document.fonts ? document.fonts.ready.catch(() => undefined) : Promise.resolve()
      void Promise.race([fonts, new Promise((r) => setTimeout(r, 700))]).then(() => {
        if (cancelled) return
        start = performance.now()
        last = start
        if (!document.hidden) raf = requestAnimationFrame(tick)
      })
    }
    return () => {
      cancelled = true
      if (raf) cancelAnimationFrame(raf)
      rootEl?.removeEventListener('click', skip)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return (
    <>
      <div className="ob-welcome-bg ob-x-bg" ref={bgRef} aria-hidden="true">
        <div className="ob-x-sky" />
        <svg className="ob-x-stars" viewBox="0 0 390 240" preserveAspectRatio="xMidYMin slice" focusable="false">
          {STARS.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} style={{ animationDelay: `${-i * 0.37}s` }} />
          ))}
        </svg>
        <svg className="ob-w-map" ref={svgRef} viewBox="-1200 -1000 2400 2000" focusable="false">
          <WelcomeTown />
          <path className="ob-x-route" ref={routeRef} pathLength={1} d="M 250 190 L -90 190 Q -110 190 -110 170 L -110 20 Q -110 0 -90 0 L 0 0" />
          <g ref={bulbsRef} />
          <g className="ob-x-sled" ref={sledRef}>
            <g ref={artRef}>
              <path d="M-23 -11c-4-10 2-21 12-21s15 9 12 19c-1 4-4 6-8 6h-10c-3 0-5-1-6-4Z" fill="#8a5a2b" />
              <path d="M-21 -14c2 4 6 6 11 6" fill="none" stroke="#6d4520" strokeWidth={2} strokeLinecap="round" />
              <path d="M-14 -31c2-3 6-3 8 0" fill="none" stroke="#f2b632" strokeWidth={2.4} strokeLinecap="round" />
              <rect x={-3} y={-25} width={12} height={12} rx={1.5} fill="#0f7f55" />
              <path d="M3 -25v12M-3 -19h12" stroke="#f2b632" strokeWidth={2} />
              <path d="M-26 -4C-26 -12 -20 -13 -14 -12L8 -12C14 -12 17 -16 18 -22C19 -27 25 -27 25 -21C25 -8 18 2 8 2L-18 2C-23 2 -26 0 -26 -4Z" fill="#d0342c" />
              <path d="M-25 -5.5H21" stroke="#f2b632" strokeWidth={2} strokeLinecap="round" />
              <path d="M-16 2v8M8 2v8" stroke="#f2b632" strokeWidth={2.5} />
              <path d="M-29 10H16C24 10 28 5 28 -1" fill="none" stroke="#f2b632" strokeWidth={3} strokeLinecap="round" />
            </g>
          </g>
        </svg>
      </div>
      <div className="ob-body ob-welcome ob-x">
        <span className="ob-x-iconbox">
          <img className="ob-welcome-icon" ref={iconRef} src={`${import.meta.env.BASE_URL}icons/icon-512.png`} alt="" width={160} height={160} />
          <svg className="ob-x-hat" ref={hatRef} viewBox="0 0 100 80" aria-hidden="true" focusable="false">
            <path fill="#d8392f" d="M16 60C18 34 38 10 58 12c16 2 28 18 30 36-8-8-14-12-20-12 4 8 8 16 10 24Z" />
            <path fill="#a9241c" d="M58 12c16 2 28 18 30 36-8-8-14-12-20-12-2-10-6-18-10-24Z" />
            <rect fill="#fff" x={8} y={54} width={78} height={20} rx={10} />
            <path fill="#dfe6f0" d="M12 68a10 10 0 0 0 6 6h58a10 10 0 0 0 6-6c-4 3-66 3-70 0Z" />
            <circle fill="#fff" cx={88} cy={52} r={9} />
          </svg>
        </span>
        <h1 className="ob-welcome-name" ref={nameRef} aria-label="이의있음!">
          <span className="wordmark" aria-hidden="true">
            <span>이의있음</span>
            <svg className="wordmark-bang" viewBox="0 0 76 200" focusable="false">
              <path d="M38 152C38 152 0 98.47 0 46a38 38 0 0 1 76 0C76 98.47 38 152 38 152Z" />
              <circle ref={dotRef} cx={38} cy={183} r={17} />
              <g transform="translate(38 183) scale(1.9) translate(-38 -183)">
                <path className="ob-x-star" ref={starRef} d="M38 151l9.4 20.6 22.5 2.6-16.7 15.3 4.5 22.2L38 200.6 18.3 211.7l4.5-22.2L6.1 174.2l22.5-2.6Z" />
              </g>
            </svg>
          </span>
        </h1>
        {/* 이름 아래 소개: 전구 줄(길)에 겹치지 않게 조금 내려 둔다 */}
        <div className="ob-x-about" ref={aboutWrap}>
          <Sentences as="p" className="ob-welcome-about">휠체어·유모차 길 찾기와 불편 제보</Sentences>
        </div>
      </div>
      <div className="ob-foot ob-welcome-foot ob-x-foot" ref={footRef}>
        <PressButton type="button" className="ob-btn ob-btn-primary" onClick={onStart}>
          시작하기
        </PressButton>
      </div>
      <canvas className="ob-x-fx" ref={fxRef} aria-hidden="true" />
    </>
  )
}
