// 시트 움직임의 공용 부품: 임계 감쇠 스프링, 경계 저항, 놓는 순간의 속도.
// 라이브러리 없이 직접 만들었다. 움직임 값은 한곳(아래 상수)에서만 정한다.

/** 스프링 고유 진동수(rad/s). 클수록 빠르다. 26이면 약 0.3초 안에 0.4px 이내로 멈춘다. 감쇠비는 1(임계 감쇠)이라 튕기지 않는다. */
export const SPRING_OMEGA = 26
/** 스프링이 목표를 지나쳐 가는 최대 거리(px). 이보다 크게 넘어갈 속도는 줄여서 넘는다. */
export const OVERSHOOT_CAP = 3
/** 범위 밖으로 끌 때 시트가 따라가는 최대 거리(px). 놓으면 스프링으로 돌아온다. */
export const RUBBER_MAX = 8
/** 멈췄다고 보는 기준: 목표까지 거리(px)와 속도(px/s) */
const REST_PX = 0.35
const REST_V = 12
/** 끌기 속도는 마지막 이 시간(ms) 안의 움직임으로 잰다. 손을 멈춘 지 이만큼 지나 놓으면 속도 0 */
const V_WINDOW = 100
const V_STALE = 80

export type Sample = { t: number; y: number }

/** 경계 밖으로 끈 거리(over, px)를 시트가 실제로 움직이는 거리로 바꾼다. 처음에는 절반쯤 따라가다 RUBBER_MAX에 가까워진다. */
export function rubber(over: number): number {
  return RUBBER_MAX * Math.tanh(over / (RUBBER_MAX * 2))
}

/** 범위 [lo, hi] 밖이면 약한 저항을 준 위치를 돌려준다. */
export function resist(raw: number, lo: number, hi: number): number {
  if (raw < lo) return lo - rubber(lo - raw)
  if (raw > hi) return hi + rubber(raw - hi)
  return raw
}

/** 놓는 순간의 속도(px/s, 아래쪽이 +). 샘플은 {시각 ms, 위치 px}. */
export function releaseVelocity(samples: Sample[], now: number): number {
  const last = samples[samples.length - 1]
  if (!last || now - last.t > V_STALE) return 0
  let first = last
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > V_WINDOW) break
    first = samples[i]
  }
  const dt = Math.max(16, last.t - first.t)
  return ((last.y - first.y) / dt) * 1000
}

/** 스프링이 벗어나는 최대 거리(px): 목표를 지나치는 거리, 또는 시작 때 목표 반대쪽으로 더 가는 거리 */
function overshootOf(x0: number, v0: number): number {
  const w = SPRING_OMEGA
  if (Math.abs(x0) < 1e-6) return Math.abs(v0) / (w * Math.E)
  const c2 = v0 + w * x0
  if (c2 === 0) return 0
  const tp = 1 / w - x0 / c2 // x(t)의 극값 시각
  if (tp <= 0) return 0
  const ext = (c2 / w) * Math.exp(-w * tp)
  return ext * x0 < 0 ? Math.abs(ext) : Math.max(0, Math.abs(ext) - Math.abs(x0))
}

export type SpringRun = {
  /** 처음 프레임에 쓴 속도(px/s). 너무 빨라 지나침이 OVERSHOOT_CAP을 넘을 때만 줄어든다 */
  v0: number
  /** 지금 위치·속도를 얻고 멈춘다(다시 잡을 때) */
  cancel: () => { y: number; v: number }
}

/** from → to 로 임계 감쇠 스프링 이동. v는 시작 속도(px/s). 프레임마다 onFrame(y), 끝나면 onDone(). */
export function springTo(from: number, to: number, v: number, onFrame: (y: number) => void, onDone: () => void): SpringRun {
  const w = SPRING_OMEGA
  const x0 = from - to
  let v0 = v
  for (let i = 0; i < 80 && overshootOf(x0, v0) > OVERSHOOT_CAP; i++) v0 *= 0.85
  const c2 = v0 + w * x0
  const t0 = performance.now()
  let raf = 0
  let last = { y: from, v: v0 }
  const at = (t: number) => {
    const e = Math.exp(-w * t)
    return { y: to + (x0 + c2 * t) * e, v: (c2 - w * (x0 + c2 * t)) * e }
  }
  const tick = () => {
    const t = (performance.now() - t0) / 1000
    const s = at(t)
    last = s
    if ((Math.abs(s.y - to) < REST_PX && Math.abs(s.v) < REST_V) || t > 1.5) {
      raf = 0
      onFrame(to)
      onDone()
      return
    }
    onFrame(s.y)
    raf = requestAnimationFrame(tick)
  }
  onFrame(from)
  raf = requestAnimationFrame(tick)
  return {
    v0,
    cancel: () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      last = at((performance.now() - t0) / 1000)
      return last
    },
  }
}
