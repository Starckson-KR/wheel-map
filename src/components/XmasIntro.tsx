// 크리스마스 모드의 첫 화면 연출: 밤하늘이 내려앉고 → 별·달·눈 언덕 → 트리가 자라고 → 전구가 차례로 켜지고 → 별이 얹히며 눈이 내린다.
// 화면 어디든 누르면 불꽃이 터지고(눈송이는 밀려난다), 트리의 장식·별·선물을 누르면 따로 반응한다. 기울이면 눈이 쏠린다(권한을 묻지 않는 기기만).
// 「메리 크리스마스」 문구는 홈의 선물 상자(XmasGift)가 맡는다: 여기는 분위기와 도입이다.
// 움직임 줄이기에서는 다 켜진 끝 장면 한 장만 보이고 소리·진동도 없다. 오른쪽 위 X로 닫으면 눈 내리는 홈으로 간다.
import { useEffect, useRef, useState } from 'react'
import { prefersCalm } from '../lib/viewPrefs'
import { haptic } from '../lib/haptic'
import { autoSong, ding, fanfare } from '../lib/xmasAudio'
import { createFx, onTilt, type Fx } from './xmasFx'
import { XMAS_HINT, XMAS_TITLE } from '../lib/xmasFont'
import '../styles/xmas.css'

const CX = 187.5
// 트리 층(아래부터): 꼭짓점 높이, 밑변 높이, 밑변 반폭
const TIERS = [
  { top: 430, base: 622, half: 116 },
  { top: 350, base: 524, half: 92 },
  { top: 282, base: 428, half: 68 },
  { top: 224, base: 336, half: 45 },
]
// 전구 줄: 왼쪽 끝 → 오른쪽 끝, 처짐, 전구 수
const GARLANDS = [
  { x0: 158, y0: 296, x1: 222, y1: 312, sag: 9, n: 4 },
  { x0: 136, y0: 380, x1: 246, y1: 400, sag: 13, n: 5 },
  { x0: 112, y0: 468, x1: 268, y1: 494, sag: 16, n: 6 },
  { x0: 90, y0: 562, x1: 290, y1: 590, sag: 20, n: 7 },
]
const BULB_COLORS = ['#ff5a4f', '#ffd062', '#8fd3ff', '#ff8fa3', '#fff3c4']
const BULBS = GARLANDS.flatMap((g) => {
  const mx = (g.x0 + g.x1) / 2
  const my = (g.y0 + g.y1) / 2 + g.sag * 2
  return Array.from({ length: g.n }, (_, i) => {
    const t = (i + 0.5) / g.n
    const u = 1 - t
    return { x: u * u * g.x0 + 2 * u * t * mx + t * t * g.x1, y: u * u * g.y0 + 2 * u * t * my + t * t * g.y1 + 5 }
  })
})
const ORN_COLORS = ['#e23b30', '#f2b632', '#4aa8ff', '#ff7fa0', '#f6f1e7']
const ORNS = [
  { x: 188, y: 270 },
  { x: 166, y: 346 },
  { x: 214, y: 438 },
  { x: 150, y: 436 },
  { x: 236, y: 540 },
  { x: 124, y: 536 },
  { x: 184, y: 520 },
]
const GIFTS = [
  { x: 62, y: 628, w: 58, h: 46, c: '#e23b30', r: '#ffd062' },
  { x: 258, y: 620, w: 66, h: 54, c: '#2f7fe0', r: '#ffffff' },
  { x: 226, y: 646, w: 40, h: 32, c: '#f2b632', r: '#e23b30' },
]
const STAR = (() => {
  const p: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 11 : 26
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    p.push(`${(CX + Math.cos(a) * r).toFixed(1)},${(214 + Math.sin(a) * r).toFixed(1)}`)
  }
  return p.join(' ')
})()
const TITLE = XMAS_TITLE
const STEPS = [900, 1700, 2900, 4000, 5200, 6600] // 장면이 넘어가는 때(ms)

export default function XmasIntro({ onClose }: { onClose: () => void }) {
  const [calm] = useState(prefersCalm)
  const [step, setStep] = useState(calm ? 6 : 0)
  const [leaving, setLeaving] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const xRef = useRef<HTMLButtonElement>(null)
  const fxRef = useRef<Fx | null>(null)

  // 장면 좌표(SVG) → 화면 좌표
  const toScreen = (x: number, y: number) => {
    const svg = svgRef.current
    const c = canvasRef.current?.getBoundingClientRect()
    const m = svg?.getScreenCTM()
    if (!svg || !m || !c) return { x: 0, y: 0 }
    const p = new DOMPoint(x, y).matrixTransform(m)
    return { x: p.x - c.left, y: p.y - c.top }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const fx = createFx(canvas)
    fxRef.current = fx
    if (!fx) return
    if (calm) {
      fx.still()
      return () => fx.destroy()
    }
    fx.stars(true)
    const timers: number[] = STEPS.map((ms, i) => window.setTimeout(() => setStep(i + 1), ms))
    const at = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms))
    const W = () => canvas.clientWidth
    const H = () => canvas.clientHeight
    at(1300, () => fx.shoot())
    at(STEPS[3], () => {
      const s = toScreen(CX, 214)
      fx.ring(s.x, s.y, '#fff3c4', 120)
      fx.sparkle(s.x, s.y, 24)
      fx.snow(true)
      haptic('success')
    })
    at(STEPS[3] + 260, () => fx.firework(W() * 0.2, H() * 0.2))
    at(STEPS[3] + 560, () => fx.firework(W() * 0.82, H() * 0.16, true))
    at(STEPS[3] + 900, () => fx.firework(W() * 0.55, H() * 0.1))
    // 가만히 두어도 멈춘 그림처럼 보이지 않게: 이따금 불꽃·별똥별
    let n = 0
    const idle = window.setInterval(() => {
      if (document.hidden) return
      if (++n % 3 === 0) fx.shoot()
      else fx.firework(W() * (0.12 + Math.random() * 0.76), H() * (0.08 + Math.random() * 0.2), n % 4 === 1)
    }, 2600)
    const offTilt = onTilt((v) => fx.wind(v))
    return () => {
      timers.forEach(clearTimeout)
      clearInterval(idle)
      offTilt()
      fx.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calm])

  useEffect(() => {
    xRef.current?.focus({ preventScroll: true })
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => {
    if (leaving) return
    setLeaving(true)
    window.setTimeout(onClose, calm ? 0 : 320)
  }

  const replay = (el: Element, cls: string) => {
    el.classList.remove(cls)
    void (el as HTMLElement).getBoundingClientRect()
    el.classList.add(cls)
  }
  const lastTrail = useRef(0)
  const onDown = (e: React.PointerEvent) => {
    const target = e.target as Element
    if (calm || target.closest('.xi-x')) return
    const fx = fxRef.current
    const c = canvasRef.current?.getBoundingClientRect()
    if (!fx || !c) return
    const x = e.clientX - c.left
    const y = e.clientY - c.top
    autoSong() // 첫 터치에서 캐럴이 한 번 시작된다(브라우저가 터치 전 소리를 막기 때문)
    const hit = target.closest<SVGElement>('[data-hit]')
    const kind = hit?.dataset.hit
    if (hit && kind === 'orn') {
      const dot = hit.querySelector<SVGElement>('.xi-orn-ball')
      const next = (Number(hit.dataset.c ?? '0') + 1) % ORN_COLORS.length
      hit.dataset.c = String(next)
      if (dot) dot.style.fill = ORN_COLORS[next]
      replay(hit, 'swing')
      fx.sparkle(x, y, 12)
      ding()
      haptic('tick')
    } else if (hit && kind === 'star') {
      replay(hit, 'spin')
      if (rootRef.current) replay(rootRef.current, 'flash')
      fx.firework(x, y, true)
      fx.ring(x, y, '#fff3c4', 160)
      fx.sparkle(x, y, 26)
      fanfare()
      haptic('success')
    } else if (hit && kind === 'gift') {
      replay(hit, 'hop')
      fx.confetti(x, y, 36)
      ding()
      haptic('tick')
    } else if (hit && kind === 'tree') {
      const tree = svgRef.current?.querySelector('.xi-tree')
      if (tree) replay(tree, 'shake')
      for (let i = 0; i < 4; i++) fx.sparkle(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 80, 5)
      fx.push(x, y)
      ding()
      haptic('tick')
    } else {
      fx.firework(x, y)
      fx.push(x, y)
      ding()
      haptic('tick')
    }
  }
  const onMove = (e: React.PointerEvent) => {
    if (calm || e.buttons === 0 && e.pointerType === 'mouse') return
    const now = performance.now()
    if (now - lastTrail.current < 45) return
    lastTrail.current = now
    const c = canvasRef.current?.getBoundingClientRect()
    if (c) fxRef.current?.sparkle(e.clientX - c.left, e.clientY - c.top, 2)
  }

  const cls = ['xi', ...Array.from({ length: step }, (_, i) => `s${i + 1}`), calm ? 'calm' : '', leaving ? 'leaving' : ''].filter(Boolean).join(' ')
  return (
    <div className={cls} ref={rootRef} role="dialog" aria-modal="true" aria-label="크리스마스" onPointerDown={onDown} onPointerMove={onMove}>
      <div className="xi-glow" aria-hidden="true" />
      <svg className="xi-scene" ref={svgRef} viewBox="0 0 375 700" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="xi-g-tree" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1fa870" />
            <stop offset="1" stopColor="#0a5a3c" />
          </linearGradient>
          <radialGradient id="xi-g-moon" cx="0.4" cy="0.4" r="0.7">
            <stop offset="0" stopColor="#fffbe8" />
            <stop offset="1" stopColor="#f3e3a4" />
          </radialGradient>
          <radialGradient id="xi-g-halo">
            <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.85" />
            <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g className="xi-moon">
          <circle cx={306} cy={86} r={54} fill="url(#xi-g-halo)" opacity={0.5} />
          <circle cx={306} cy={86} r={26} fill="url(#xi-g-moon)" />
          <circle cx={298} cy={80} r={5} fill="#e9d68e" opacity={0.6} />
          <circle cx={314} cy={96} r={3.5} fill="#e9d68e" opacity={0.6} />
        </g>
        <g className="xi-hills">
          <ellipse cx={70} cy={700} rx={230} ry={96} fill="#c9d8f3" />
          <ellipse cx={330} cy={706} rx={240} ry={92} fill="#dbe6f8" />
          {[[28, 612, 0.8], [62, 622, 0.55], [330, 610, 0.7], [356, 624, 0.5]].map(([x, y, s], i) => (
            <path key={i} d={`M${x} ${y - 46 * s}l${16 * s} ${46 * s}h${-32 * s}Z`} fill="#3d6b72" opacity={0.55} />
          ))}
          <ellipse cx={CX} cy={716} rx={300} ry={78} fill="#ffffff" />
        </g>
        <g className="xi-tree">
          <rect className="xi-trunk" x={174} y={608} width={27} height={44} rx={4} fill="#7a4a24" />
          {TIERS.map((t, i) => (
            <g key={i} className="xi-tier" style={{ transitionDelay: `${i * 150}ms` }} data-hit="tree">
              <path d={`M${CX} ${t.top}L${CX + t.half} ${t.base}H${CX - t.half}Z`} fill="url(#xi-g-tree)" stroke="#0e7a52" strokeWidth={14} strokeLinejoin="round" />
              <path d={`M${CX - t.half + 6} ${t.base - 1}Q${CX - t.half * 0.5} ${t.base + 9} ${CX} ${t.base - 1}T${CX + t.half - 6} ${t.base - 1}`} fill="none" stroke="#ffffff" strokeWidth={9} strokeLinecap="round" opacity={0.92} />
            </g>
          ))}
          <path className="xi-cap" d={`M${CX} 214l22 50q-8 -9 -15 0t-14 0q-7 -9 -15 0Z`} fill="#ffffff" />
          {GARLANDS.map((g, i) => (
            <path key={i} className="xi-wire" d={`M${g.x0} ${g.y0}Q${(g.x0 + g.x1) / 2} ${(g.y0 + g.y1) / 2 + g.sag * 2} ${g.x1} ${g.y1}`} fill="none" stroke="#f6d77a" strokeWidth={1.6} opacity={0.75} />
          ))}
          {BULBS.map((b, i) => (
            <g key={i} className="xi-bulb" style={{ transitionDelay: `${i * 48}ms` }}>
              <circle className="xi-bulb-halo" cx={b.x} cy={b.y} r={11} fill={BULB_COLORS[i % BULB_COLORS.length]} style={{ animationDelay: `${(i * 370) % 1700}ms` }} />
              <circle cx={b.x} cy={b.y} r={4.6} fill={BULB_COLORS[i % BULB_COLORS.length]} />
              <circle cx={b.x - 1.4} cy={b.y - 1.6} r={1.4} fill="#ffffff" opacity={0.85} />
            </g>
          ))}
          {ORNS.map((o, i) => (
            <g key={i} className="xi-orn" data-hit="orn" data-c={i % ORN_COLORS.length} style={{ transitionDelay: `${200 + i * 90}ms`, transformOrigin: `${o.x}px ${o.y - 16}px` }}>
              <circle cx={o.x} cy={o.y} r={24} fill="transparent" />
              <path d={`M${o.x} ${o.y - 16}v6`} stroke="#f6d77a" strokeWidth={1.6} />
              <rect x={o.x - 3} y={o.y - 12.5} width={6} height={4} rx={1} fill="#f6d77a" />
              <circle className="xi-orn-ball" cx={o.x} cy={o.y} r={10.5} fill={ORN_COLORS[i % ORN_COLORS.length]} />
              <circle cx={o.x - 3.4} cy={o.y - 3.6} r={3} fill="#ffffff" opacity={0.6} />
            </g>
          ))}
          <g className="xi-star" data-hit="star">
            <circle cx={CX} cy={214} r={36} fill="transparent" />
            <g className="xi-rays">
              {Array.from({ length: 8 }, (_, i) => (
                <path key={i} d={`M${CX} ${214 - 34}v-${i % 2 ? 12 : 22}`} stroke="#ffe9a8" strokeWidth={3} strokeLinecap="round" transform={`rotate(${i * 45} ${CX} 214)`} />
              ))}
            </g>
            <circle cx={CX} cy={214} r={44} fill="url(#xi-g-halo)" />
            <polygon points={STAR} fill="#ffd24a" stroke="#ffb400" strokeWidth={3} strokeLinejoin="round" />
            <polygon points={STAR} fill="#fff3c4" opacity={0.55} transform={`translate(${CX} 214) scale(0.5) translate(${-CX} -214)`} />
          </g>
        </g>
        {GIFTS.map((g, i) => (
          <g key={i} className="xi-gift" data-hit="gift" style={{ transitionDelay: `${i * 160}ms`, transformOrigin: `${g.x + g.w / 2}px ${g.y + g.h}px` }}>
            <g className="xi-gift-in">
              <rect x={g.x} y={g.y + 10} width={g.w} height={g.h - 10} rx={4} fill={g.c} />
              <rect x={g.x - 3} y={g.y} width={g.w + 6} height={13} rx={4} fill={g.c} />
              <rect x={g.x - 3} y={g.y + 9} width={g.w + 6} height={4} fill="#000" opacity={0.14} />
              <rect x={g.x + g.w / 2 - 5} y={g.y} width={10} height={g.h} fill={g.r} />
              <path d={`M${g.x + g.w / 2} ${g.y}c-8 -14 -22 -12 -19 -4c2 5 12 5 19 4Zm0 0c8 -14 22 -12 19 -4c-2 5 -12 5 -19 4Z`} fill={g.r} />
            </g>
          </g>
        ))}
      </svg>
      <canvas className="xi-canvas" ref={canvasRef} aria-hidden="true" />
      <div className="xi-text">
        <h1 className="xi-title" aria-label={TITLE}>
          {[...TITLE].map((ch, i) => (
            <span key={i} aria-hidden="true" style={{ transitionDelay: `${i * 70}ms` }}>
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </h1>
        <p className="xi-hint">{XMAS_HINT}</p>
      </div>
      <button type="button" className="xi-x" ref={xRef} aria-label="닫기" onClick={close}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
