// 지도 「메리 크리스마스」: 검색창에서 선물 상자가 튀어나와 뚜껑이 열리며 색종이와 작은 불꽃이 한 번 터진다.
// 화면 전체 위에 떠 있지만 누르는 것을 막지 않는다(pointer-events 없음). 약 2초 터진 뒤 onDone으로 DOM에서 빠진다.
import { useEffect, useRef, type CSSProperties } from 'react'
import '../styles/xmas.css'

const COLORS = ['#d0342c', '#0f7f55', '#f2b632', '#e0463c', '#1f9d6b', '#ffd062']
const POP_MS = 760 // 상자가 자리 잡고 뚜껑이 열리는 때
const END_MS = POP_MS + 2000
const rand = (a: number, b: number) => a + Math.random() * (b - a)

type Bit = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; fl: number; vf: number; c: string; life: number; max: number }
type Spark = { x: number; y: number; px: number; py: number; vx: number; vy: number; c: string; life: number; max: number }

export default function XmasBurst({ from, onDone }: { from: { x: number; y: number }; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  const W = window.innerWidth
  const H = window.innerHeight
  const cx = W / 2
  const cy = Math.round(H * 0.37)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const k = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(W * k)
    canvas.height = Math.round(H * k)
    ctx.setTransform(k, 0, 0, k, 0, 0)
    const sc = Math.max(1, Math.min(1.7, W / 390)) // 넓은 화면에서는 더 멀리 퍼지게
    let bits: Bit[] = []
    let sparks: Spark[] = []
    let flashes: { x: number; y: number; life: number }[] = []
    const confetti = (x: number, y: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = i % 3 ? rand(-Math.PI * 0.97, -Math.PI * 0.03) : rand(0, 6.2832)
        const s = rand(240, 900) * sc
        bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, w: rand(6, 11), h: rand(4, 8), rot: rand(0, 6.28), vr: rand(-9, 9), fl: rand(0, 6.28), vf: rand(6, 14), c: COLORS[i % COLORS.length], life: 0, max: rand(1.4, 1.95) })
      }
    }
    const rain = (n: number) => {
      for (let i = 0; i < n; i++) bits.push({ x: rand(0, W), y: rand(-160, -10), vx: rand(-40, 40), vy: rand(160, 340), w: rand(6, 11), h: rand(4, 8), rot: rand(0, 6.28), vr: rand(-8, 8), fl: rand(0, 6.28), vf: rand(6, 13), c: COLORS[i % COLORS.length], life: 0, max: rand(1.1, 1.5) })
    }
    const firework = (x: number, y: number) => {
      const c = COLORS[Math.floor(rand(0, 3))]
      flashes.push({ x, y, life: 0 })
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * 6.2832 + rand(-0.1, 0.1)
        const s = rand(150, 310)
        sparks.push({ x, y, px: x, py: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, c: i % 3 ? c : '#f2b632', life: 0, max: rand(0.55, 0.85) })
      }
    }
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      ctx.clearRect(0, 0, W, H)
      bits = bits.filter((b) => (b.life += dt) < b.max && b.y < H + 30)
      for (const b of bits) {
        b.vx *= Math.exp(-dt * 1.5)
        b.vy = b.vy * Math.exp(-dt * 1.5) + 620 * dt
        b.x += b.vx * dt + Math.sin(b.fl) * 26 * dt
        b.y += b.vy * dt
        b.rot += b.vr * dt
        b.fl += b.vf * dt
        const hh = b.h * (0.25 + 0.75 * Math.abs(Math.cos(b.fl)))
        const cs = Math.cos(b.rot)
        const sn = Math.sin(b.rot)
        ctx.setTransform(k * cs, k * sn, -k * sn, k * cs, k * b.x, k * b.y)
        ctx.globalAlpha = Math.min(1, (b.max - b.life) * 2.5)
        ctx.fillStyle = b.c
        ctx.fillRect(-b.w / 2, -hh / 2, b.w, hh)
      }
      ctx.setTransform(k, 0, 0, k, 0, 0)
      ctx.lineCap = 'round'
      sparks = sparks.filter((s) => (s.life += dt) < s.max)
      for (const s of sparks) {
        s.px = s.x - s.vx * 0.045
        s.py = s.y - s.vy * 0.045
        s.vx *= Math.exp(-dt * 3.2)
        s.vy = s.vy * Math.exp(-dt * 3.2) + 90 * dt
        s.x += s.vx * dt
        s.y += s.vy * dt
        const q = 1 - s.life / s.max
        ctx.globalAlpha = q
        ctx.strokeStyle = s.c
        ctx.lineWidth = 1.2 + q * 1.8
        ctx.beginPath()
        ctx.moveTo(s.px, s.py)
        ctx.lineTo(s.x, s.y)
        ctx.stroke()
      }
      flashes = flashes.filter((f) => (f.life += dt) < 0.28)
      for (const f of flashes) {
        const q = f.life / 0.28
        ctx.globalAlpha = (1 - q) * 0.8
        ctx.fillStyle = '#ffd978'
        ctx.beginPath()
        ctx.arc(f.x, f.y, 5 + q * 22, 0, 6.2832)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const timers = [
      window.setTimeout(() => {
        confetti(cx, cy, 180)
        firework(cx, cy - 8)
      }, POP_MS),
      window.setTimeout(() => {
        rain(40)
        firework(W * 0.25, cy - 90)
      }, POP_MS + 140),
      window.setTimeout(() => {
        rain(40)
        firework(W * 0.78, cy - 130)
      }, POP_MS + 390),
      window.setTimeout(() => {
        rain(30)
        firework(W * 0.56, cy + 190)
      }, POP_MS + 640),
      window.setTimeout(() => done.current(), END_MS),
    ]
    // 화면이 숨겨지면 남은 연출을 버리고 바로 끝낸다
    const onVis = () => document.hidden && done.current()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [W, H, cx, cy])

  return (
    <div className="xm-burst" aria-hidden="true">
      <div className="xm-gift" style={{ left: cx - 42, top: cy - 32, '--fx': `${Math.round(from.x - cx)}px`, '--fy': `${Math.round(from.y - cy)}px` } as CSSProperties}>
        <svg viewBox="0 0 84 84" focusable="false">
          <rect x={10} y={34} width={64} height={46} rx={5} fill="#d0342c" />
          <rect x={10} y={34} width={64} height={9} fill="#a9241c" opacity={0.55} />
          <rect x={36} y={34} width={12} height={46} fill="#f2b632" />
          <g className="xm-lid">
            <rect x={5} y={20} width={74} height={17} rx={5} fill="#e0463c" />
            <rect x={35} y={20} width={14} height={17} fill="#f2b632" />
            <path d="M42 20C34 6 18 6 20 14c1 6 14 7 22 6Zm0 0C50 6 66 6 64 14c-1 6-14 7-22 6Z" fill="#f2b632" />
            <circle cx={42} cy={19} r={4.5} fill="#d99a14" />
          </g>
        </svg>
      </div>
      <canvas className="xm-canvas" ref={canvasRef} />
    </div>
  )
}
