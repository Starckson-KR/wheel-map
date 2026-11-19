// 줄자 끌기 순수 로직(화면·DOM 없음). 판정 기준은 ReportDetail의 ○△X 안내에 이미 있는 값만 쓴다.
//  폭: 1.2m 미만 X(어려움) / 1.2~2m 미만 △(주의) / 2m 이상 ○(괜찮음)
//  턱: 2cm 이하 ○(괜찮음) / 2cm 초과 △ 이상(혼자 넘기 가능 여부는 글로 확인 — 숫자 기준이 없어 어려움으로 단정하지 않는다)

export type RulerTier = 'o' | 't' | 'x'

export type RulerSpec = {
  key: 'width' | 'curb'
  unit: string
  min: number
  max: number
  /** 한 번 누르기(−/+)·방향키 한 칸 */
  step: number
  /** 값을 잘라 담는 자리(소수점 아래) */
  digits: number
  /** 판정 선 위치와 그 선 위쪽(값이 같거나 큰 쪽) 구간의 판정 */
  tierOf: (v: number) => RulerTier
  lines: { at: number; label: string }[]
}

export const WIDTH_RULER: RulerSpec = {
  key: 'width',
  unit: 'm',
  min: 0,
  max: 3,
  step: 0.1,
  digits: 2,
  tierOf: (v) => (v < 1.2 ? 'x' : v < 2 ? 't' : 'o'),
  lines: [
    { at: 1.2, label: '1.2m' },
    { at: 2, label: '2m' },
  ],
}

export const CURB_RULER: RulerSpec = {
  key: 'curb',
  unit: 'cm',
  min: 0,
  max: 10,
  step: 0.5,
  digits: 1,
  tierOf: (v) => (v <= 2 ? 'o' : 't'),
  lines: [{ at: 2, label: '2cm' }],
}

export const TIER_TEXT: Record<RulerTier, string> = { o: '○ 괜찮음', t: '△ 주의', x: 'X 어려움' }

export function clampTo(spec: RulerSpec, v: number): number {
  const c = Math.min(spec.max, Math.max(spec.min, v))
  const f = 10 ** spec.digits
  return Math.round(c * f) / f
}

/** 막대 안의 가로 위치(0~width px) → 값. 한 칸(step) 단위로 맞춘다. */
export function valueFromX(spec: RulerSpec, x: number, width: number): number {
  if (width <= 0) return spec.min
  const r = Math.min(1, Math.max(0, x / width))
  const raw = spec.min + r * (spec.max - spec.min)
  const stepped = Math.round(raw / spec.step) * spec.step
  return clampTo(spec, stepped)
}

/** 값 → 막대 안의 비율 0~1 (범위 밖은 끝에 붙인다) */
export function ratioOf(spec: RulerSpec, v: number): number {
  return Math.min(1, Math.max(0, (v - spec.min) / (spec.max - spec.min)))
}

/** 값이 바뀌며 판정 선(구간 경계)을 넘었는지. 넘었으면 true → 진동·표시 반응. */
export function crossedLine(spec: RulerSpec, from: number, to: number): boolean {
  return spec.tierOf(from) !== spec.tierOf(to)
}

/** 한 칸 더하기/빼기. 방향키·−/+ 버튼이 같이 쓴다. */
export function stepValue(spec: RulerSpec, v: number | undefined, dir: -1 | 1, big = false): number {
  const base = v === undefined ? (dir > 0 ? spec.min : spec.max) : v
  return clampTo(spec, base + dir * spec.step * (big ? 5 : 1))
}

/** 입력칸 문자열 → 숫자(비었거나 숫자가 아니면 undefined) */
export function parseValue(s: string): number | undefined {
  const t = s.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** 값 → 입력칸 문자열(불필요한 0 없이) */
export function formatValue(spec: RulerSpec, v: number): string {
  return String(clampTo(spec, v))
}
