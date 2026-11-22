// 크리스마스 이스터에그(환영 화면 썰매·홈 첫눈·지도 「메리 크리스마스」)의 켜짐 판단.
// 켜짐 = 끄기 설정이 아님 && (기기 시각이 12월 || 시연 도구에서 강제로 켬).
// 값은 이 기기에만 둔다(계정 간 설정 동기화 대상이 아니다 — keys.ts의 SYNCED_PREF_KEYS에 넣지 않는다).
export const XMAS_KEY = 'wheelmap.xmas' // 'off'이면 끔
export const XMAS_DEMO_KEY = 'wheelmap.xmasDemo' // 'on'이면 12월이 아니어도 켬(시연용)
export const XMAS_EVENT = 'wheelmap:xmaschange'

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
    mem.delete(k)
  } catch {
    mem.set(k, v) // 저장하지 못해도 이번 방문 동안은 바뀐다
  }
  snap = null
  try {
    window.dispatchEvent(new Event(XMAS_EVENT))
  } catch {
    /* 브라우저 밖(시험) */
  }
}
// localStorage에 쓰지 못한 값만 여기에 둔다(이번 방문 동안 유지)
const mem = new Map<string, string | null>()
const get = (k: string) => (mem.has(k) ? (mem.get(k) ?? null) : read(k))

export const getXmasOff = (): boolean => get(XMAS_KEY) === 'off'
export const setXmasOff = (off: boolean) => write(XMAS_KEY, off ? 'off' : null)
export const getXmasDemo = (): boolean => get(XMAS_DEMO_KEY) === 'on'
export const setXmasDemo = (on: boolean) => write(XMAS_DEMO_KEY, on ? 'on' : null)

/** 켜짐 기간인지: 12월이거나 시연 도구에서 켰을 때. 끄기 스위치는 이 기간에만 보인다. */
export function isXmasSeason(now: Date = new Date(), demo: boolean = getXmasDemo()): boolean {
  return demo || now.getMonth() === 11
}
/** 장식을 실제로 보일지: 켜짐 기간이고 끄기 설정이 아닐 때. */
export function isXmasOn(now: Date = new Date(), opts: { off?: boolean; demo?: boolean } = {}): boolean {
  const off = opts.off ?? getXmasOff()
  return !off && isXmasSeason(now, opts.demo ?? getXmasDemo())
}

export type XmasState = { season: boolean; on: boolean }
let snap: XmasState | null = null
/** 지금 상태(구독용, 값이 바뀔 때만 새 객체). */
export function xmasSnapshot(): XmasState {
  const season = isXmasSeason()
  const on = isXmasOn()
  if (!snap || snap.season !== season || snap.on !== on) snap = { season, on }
  return snap
}
export function subscribeXmas(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === XMAS_KEY || e.key === XMAS_DEMO_KEY || e.key === null) {
      mem.clear()
      fn()
    }
  }
  window.addEventListener(XMAS_EVENT, fn)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(XMAS_EVENT, fn)
    window.removeEventListener('storage', onStorage)
  }
}

/** 지도 검색어가 「메리 크리스마스」인지. 띄어쓰기·대소문자는 보지 않는다. 한글 조합 중(composing)에는 판정하지 않는다. */
export function isMerryQuery(text: string, composing = false): boolean {
  if (composing) return false
  const v = text.replace(/\s+/g, '').toLowerCase()
  return v === '메리크리스마스' || v === 'merrychristmas'
}

/** 로고 연속 탭 세기: gapMs 안에 이어 누르면 하나씩 늘고, need번째에 fire. 늦으면 1부터 다시 센다. */
export type TapState = { n: number; t: number }
export const TAP_GAP_MS = 1500
export const TAP_NEED = 5
export function tapStep(prev: TapState, now: number, gapMs = TAP_GAP_MS, need = TAP_NEED): TapState & { fire: boolean } {
  const n = prev.n > 0 && now - prev.t <= gapMs ? prev.n + 1 : 1
  return n >= need ? { n: 0, t: now, fire: true } : { n, t: now, fire: false }
}
