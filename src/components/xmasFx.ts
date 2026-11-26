// 크리스마스 모드의 입자 효과(별·눈·불꽃·색종이·반짝이)를 캔버스 한 장에 그린다. 첫 화면 연출(XmasIntro)과 선물 상자(XmasGift)가 같이 쓴다.
// 캔버스는 pointer-events가 없어 누르는 것을 막지 않는다. 입자 수에는 상한이 있고, 화면이 숨겨지면 멈춘다.
export const FX_COLORS = ['#ff5a4f', '#3ecf8e', '#ffd062', '#ffffff', '#ff8fa3', '#8fd3ff']
const MAX_SPARKS = 360
const MAX_BITS = 220
const MAX_DUST = 90
const rand = (a: number, b: number) => a + Math.random() * (b - a)

type Star = { x: number; y: number; r: number; ph: number; sp: number }
type Flake = { x: number; y: number; r: number; vy: number; sw: number; ph: number; ex: number; ey: number }
type Spark = { x: number; y: number; vx: number; vy: number; c: string; life: number; max: number; w: number }
type Bit = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; fl: number; vf: number; c: string; life: number; max: number }
type Dust = { x: number; y: number; vx: number; vy: number; r: number; c: string; life: number; max: number }
type Ring = { x: number; y: number; life: number; max: number; c: string; r: number }
type Shoot = { x: number; y: number; vx: number; vy: number; life: number }

export type Fx = {
  /** 별이 뜬다(0→1로 서서히) */
  stars(on: boolean): void
  snow(on: boolean): void
  /** 불꽃 한 발 */
  firework(x: number, y: number, big?: boolean): void
  /** 색종이: 위로 솟았다 떨어진다 */
  confetti(x: number, y: number, n: number): void
  /** 작은 반짝이 가루 */
  sparkle(x: number, y: number, n?: number): void
  /** 퍼지는 빛 고리 */
  ring(x: number, y: number, c?: string, r?: number): void
  shoot(): void
  /** 눈송이를 밀어낸다 */
  push(x: number, y: number): void
  /** 눈이 쏠리는 바람(-1~1) */
  wind(v: number): void
  /** 움직임 줄이기: 별과 멈춘 눈만 한 장 그린다 */
  still(): void
  destroy(): void
}

export function createFx(canvas: HTMLCanvasElement, opts: { starArea?: number } = {}): Fx | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  let W = 0
  let H = 0
  let k = 1
  let stars: Star[] = []
  let flakes: Flake[] = []
  let sparks: Spark[] = []
  let bits: Bit[] = []
  let dust: Dust[] = []
  let rings: Ring[] = []
  let shoots: Shoot[] = []
  let starOn = false
  let starA = 0
  let snowOn = false
  let snowA = 0
  let windV = 0
  let raf = 0
  let last = 0
  let dead = false
  let frozen = false

  const size = () => {
    k = Math.min(2, window.devicePixelRatio || 1)
    W = canvas.clientWidth
    H = canvas.clientHeight
    canvas.width = Math.round(W * k)
    canvas.height = Math.round(H * k)
    const n = Math.max(30, Math.min(70, Math.round((W * H) / 5200)))
    stars = Array.from({ length: n }, () => ({ x: rand(0, W), y: rand(0, H * (opts.starArea ?? 0.62)), r: rand(0.5, 1.7), ph: rand(0, 6.28), sp: rand(0.6, 2.2) }))
    const m = Math.max(40, Math.min(80, Math.round((W * H) / 4800)))
    flakes = Array.from({ length: m }, () => mkFlake(true))
  }
  const mkFlake = (first: boolean): Flake => {
    const z = Math.random()
    return { x: rand(-10, W + 10), y: first ? rand(-H, H) : rand(-30, -6), r: 1 + z * 2.6, vy: 34 + z * 70, sw: 8 + (1 - z) * 16, ph: rand(0, 6.28), ex: 0, ey: 0 }
  }

  const draw = (dt: number, time: number) => {
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.clearRect(0, 0, W, H)
    if (dt > 0) {
      starA += ((starOn ? 1 : 0) - starA) * Math.min(1, dt * 1.6)
      snowA += ((snowOn ? 1 : 0) - snowA) * Math.min(1, dt * 1.2)
    }
    // 별
    if (starA > 0.01) {
      ctx.fillStyle = '#ffffff'
      for (const s of stars) {
        ctx.globalAlpha = starA * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 0.001 * s.sp + s.ph)))
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, 6.2832)
        ctx.fill()
      }
    }
    // 별똥별
    shoots = shoots.filter((s) => (s.life += dt) < 0.9)
    for (const s of shoots) {
      s.x += s.vx * dt
      s.y += s.vy * dt
      const q = 1 - s.life / 0.9
      const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.16, s.y - s.vy * 0.16)
      g.addColorStop(0, 'rgb(255 255 255 / 0.95)')
      g.addColorStop(1, 'rgb(255 255 255 / 0)')
      ctx.globalAlpha = q
      ctx.strokeStyle = g
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(s.x - s.vx * 0.16, s.y - s.vy * 0.16)
      ctx.stroke()
    }
    // 빛 고리
    rings = rings.filter((r) => (r.life += dt) < r.max)
    for (const r of rings) {
      const q = r.life / r.max
      ctx.globalAlpha = (1 - q) * 0.7
      ctx.strokeStyle = r.c
      ctx.lineWidth = 3 * (1 - q) + 0.5
      ctx.beginPath()
      ctx.arc(r.x, r.y, 6 + r.r * (1 - (1 - q) * (1 - q)), 0, 6.2832)
      ctx.stroke()
    }
    // 불꽃
    ctx.lineCap = 'round'
    sparks = sparks.filter((s) => (s.life += dt) < s.max)
    for (const s of sparks) {
      const px = s.x - s.vx * 0.05
      const py = s.y - s.vy * 0.05
      s.vx *= Math.exp(-dt * 2.6)
      s.vy = s.vy * Math.exp(-dt * 2.6) + 110 * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      const q = 1 - s.life / s.max
      ctx.globalAlpha = q < 0.3 ? q / 0.3 : 1
      ctx.strokeStyle = s.c
      ctx.lineWidth = s.w * (0.4 + q * 0.6)
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(s.x, s.y)
      ctx.stroke()
    }
    // 반짝이 가루
    dust = dust.filter((d) => (d.life += dt) < d.max)
    for (const d of dust) {
      d.vx *= Math.exp(-dt * 2)
      d.vy = d.vy * Math.exp(-dt * 2) + 60 * dt
      d.x += d.vx * dt
      d.y += d.vy * dt
      const q = 1 - d.life / d.max
      const tw = 0.5 + 0.5 * Math.sin(d.life * 22 + d.x)
      ctx.globalAlpha = q * (0.4 + 0.6 * tw)
      ctx.fillStyle = d.c
      const r = d.r * (0.6 + q * 0.6)
      ctx.beginPath()
      ctx.moveTo(d.x, d.y - r * 2)
      ctx.quadraticCurveTo(d.x, d.y, d.x + r * 2, d.y)
      ctx.quadraticCurveTo(d.x, d.y, d.x, d.y + r * 2)
      ctx.quadraticCurveTo(d.x, d.y, d.x - r * 2, d.y)
      ctx.quadraticCurveTo(d.x, d.y, d.x, d.y - r * 2)
      ctx.fill()
    }
    // 눈
    if (snowA > 0.01) {
      ctx.fillStyle = '#ffffff'
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i]
        if (dt > 0) {
          f.ex *= Math.exp(-dt * 2.4)
          f.ey *= Math.exp(-dt * 2.4)
          f.x += (Math.cos(time * 0.0011 + f.ph) * f.sw + windV * 90 + f.ex) * dt
          f.y += (f.vy + f.ey) * dt
          if (f.y > H + 8) flakes[i] = mkFlake(false)
          else if (f.x < -30) f.x = W + 20
          else if (f.x > W + 30) f.x = -20
        }
        ctx.globalAlpha = snowA * (0.45 + (f.r / 3.6) * 0.5)
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.r, 0, 6.2832)
        ctx.fill()
      }
    }
    // 색종이
    bits = bits.filter((b) => (b.life += dt) < b.max && b.y < H + 30)
    for (const b of bits) {
      b.vx *= Math.exp(-dt * 1.5)
      b.vy = b.vy * Math.exp(-dt * 1.5) + 640 * dt
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
    ctx.globalAlpha = 1
  }
  const busy = () => starOn || snowOn || starA > 0.02 || snowA > 0.02 || sparks.length + bits.length + dust.length + rings.length + shoots.length > 0
  const loop = (now: number) => {
    raf = 0
    if (dead) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    draw(dt, now)
    if (busy() && !document.hidden) raf = requestAnimationFrame(loop)
    else if (!busy()) ctx.clearRect(0, 0, W, H)
  }
  const run = () => {
    if (raf || dead || frozen || document.hidden) return
    last = performance.now()
    raf = requestAnimationFrame(loop)
  }
  const onVis = () => {
    if (!document.hidden) run()
  }
  const ro = new ResizeObserver(() => {
    size()
    if (frozen) draw(0, 0)
    else run()
  })
  ro.observe(canvas)
  size()
  document.addEventListener('visibilitychange', onVis)

  return {
    stars(on) {
      starOn = on
      run()
    },
    snow(on) {
      snowOn = on
      run()
    },
    firework(x, y, big = false) {
      const c = FX_COLORS[Math.floor(rand(0, 3))]
      const n = big ? 44 : 26
      if (sparks.length + n > MAX_SPARKS) sparks.splice(0, sparks.length + n - MAX_SPARKS)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.2832 + rand(-0.12, 0.12)
        const s = rand(big ? 200 : 140, big ? 430 : 300) * (i % 4 === 0 ? 0.55 : 1)
        sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, c: i % 3 ? c : '#ffd978', life: 0, max: rand(0.7, big ? 1.25 : 1), w: big ? 3 : 2.4 })
      }
      rings.push({ x, y, life: 0, max: 0.45, c: '#ffe9a8', r: big ? 70 : 44 })
      run()
    },
    confetti(x, y, n) {
      n = Math.min(n, MAX_BITS - bits.length)
      for (let i = 0; i < n; i++) {
        const a = i % 4 ? rand(-Math.PI * 0.92, -Math.PI * 0.08) : rand(0, 6.2832)
        const s = rand(260, 880)
        bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, w: rand(6, 11), h: rand(4, 8), rot: rand(0, 6.28), vr: rand(-9, 9), fl: rand(0, 6.28), vf: rand(6, 14), c: FX_COLORS[i % FX_COLORS.length], life: 0, max: rand(1.5, 2.3) })
      }
      run()
    },
    sparkle(x, y, n = 8) {
      n = Math.min(n, MAX_DUST - dust.length)
      for (let i = 0; i < n; i++) {
        const a = rand(0, 6.2832)
        const s = rand(30, 170)
        dust.push({ x: x + rand(-4, 4), y: y + rand(-4, 4), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, r: rand(1.4, 3.2), c: i % 2 ? '#ffe9a8' : '#ffffff', life: 0, max: rand(0.5, 1.1) })
      }
      run()
    },
    ring(x, y, c = '#ffe9a8', r = 60) {
      if (rings.length < 12) rings.push({ x, y, life: 0, max: 0.6, c, r })
      run()
    },
    shoot() {
      if (shoots.length < 2) shoots.push({ x: rand(W * 0.1, W * 0.6), y: rand(10, H * 0.2), vx: rand(380, 520), vy: rand(150, 230), life: 0 })
      run()
    },
    push(x, y) {
      for (const f of flakes) {
        const dx = f.x - x
        const dy = f.y - y
        const d = Math.hypot(dx, dy)
        if (d > 110) continue
        const g = (1 - d / 110) * 420
        f.ex += (dx / (d || 1)) * g
        f.ey += (dy / (d || 1)) * g - 60
      }
    },
    wind(v) {
      windV = Math.max(-1, Math.min(1, v))
    },
    still() {
      starOn = snowOn = true
      starA = snowA = 1
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      draw(0, 0)
      frozen = true // 다시 움직이지 않는다
    },
    destroy() {
      dead = true
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    },
  }
}

/** 기기를 기울이면 눈이 쏠리게: 권한을 묻지 않는 기기(안드로이드 등)에서만 듣는다. 해제 함수를 돌려준다. */
export function onTilt(fn: (v: number) => void): () => void {
  try {
    const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent
    if (!D || typeof D.requestPermission === 'function') return () => {} // 아이폰은 권한 요청이 필요해 쓰지 않는다
    const h = (e: DeviceOrientationEvent) => {
      if (typeof e.gamma === 'number') fn(Math.max(-1, Math.min(1, e.gamma / 35)))
    }
    window.addEventListener('deviceorientation', h, { passive: true })
    return () => window.removeEventListener('deviceorientation', h)
  } catch {
    return () => {}
  }
}
