// 색종이 조각 값 만들기(순수 함수). 같은 seed면 같은 결과라 화면이 렌더마다 흔들리지 않는다.
export type Piece = {
  /** 가로로 퍼지는 거리(px, 좌우) */
  dx: number
  /** 위로 솟는 높이(px) */
  up: number
  /** 떨어지는 거리(px, 시작점 기준 아래) */
  fall: number
  /** 도는 각도(deg) */
  rot: number
  /** 시작 지연(ms) */
  delay: number
  /** 걸리는 시간(ms) */
  dur: number
  /** 색 번호(0~colors-1) */
  color: number
  /** 조각 크기(px) */
  w: number
  h: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const CONFETTI_COLORS = 4
export const CONFETTI_MIN_MS = 900
export const CONFETTI_MAX_MS = 1200

export function makePieces(count: number, seed = 1): Piece[] {
  const rnd = mulberry32(seed)
  const out: Piece[] = []
  for (let i = 0; i < count; i++) {
    const side = (i / Math.max(1, count - 1)) * 2 - 1 // -1~1로 고르게 퍼뜨린 뒤 흔든다
    out.push({
      dx: Math.round(side * (70 + rnd() * 90) + (rnd() - 0.5) * 30),
      up: Math.round(70 + rnd() * 110),
      fall: Math.round(40 + rnd() * 90),
      rot: Math.round((rnd() - 0.5) * 900),
      delay: Math.round(rnd() * 120),
      dur: Math.round(CONFETTI_MIN_MS + rnd() * (CONFETTI_MAX_MS - CONFETTI_MIN_MS - 120)),
      color: i % CONFETTI_COLORS,
      w: Math.round(6 + rnd() * 4),
      h: Math.round(9 + rnd() * 6),
    })
  }
  return out
}

/** 마지막 조각이 끝나는 시각(ms) */
export function confettiTotalMs(pieces: Piece[]): number {
  return pieces.reduce((m, p) => Math.max(m, p.delay + p.dur), 0)
}
