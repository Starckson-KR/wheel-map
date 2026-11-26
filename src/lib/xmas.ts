// 크리스마스 이스터에그(환영 화면 썰매·홈 첫눈·지도 「메리 크리스마스」)의 켜짐 판단.
// 켜짐 = 끄기 설정이 아님 && (기기 시각이 12월 || 시연 도구에서 강제로 켬).
// 값은 이 기기에만 둔다(계정 간 설정 동기화 대상이 아니다 — keys.ts의 SYNCED_PREF_KEYS에 넣지 않는다).
export const XMAS_KEY = 'wheelmap.xmas' // 'off'이면 끔
export const XMAS_DEMO_KEY = 'wheelmap.xmasDemo' // 'on'이면 12월이 아니어도 켬(시연용)
export const XMAS_CAST_KEY = 'wheelmap.xmasCast' // 발표용 「크리스마스 모드」(관리자가 모든 기기에 켬). JSON {on, at, intro, gift}
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
    saved = false
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
let saved = true // 마지막 쓰기가 localStorage에 남았는지
const get = (k: string) => (mem.has(k) ? (mem.get(k) ?? null) : read(k))

export const getXmasOff = (): boolean => get(XMAS_KEY) === 'off'
export const setXmasOff = (off: boolean) => write(XMAS_KEY, off ? 'off' : null)
export const getXmasDemo = (): boolean => get(XMAS_DEMO_KEY) === 'on'
export const setXmasDemo = (on: boolean) => write(XMAS_DEMO_KEY, on ? 'on' : null)

// ───── 크리스마스 모드(발표용): 관리자가 켜면 모든 기기가 새로 고쳐지며 첫 화면 연출 → 눈 내리는 홈 → 크리스마스 색으로 바뀐다 ─────
// at: 서버가 마지막으로 바꾼 시각(이 기기가 이미 따른 값). intro: 첫 화면 연출을 아직 안 봤는지. gift: 홈의 선물 상자를 아직 안 열었는지.
export type XmasCast = { on: boolean; at: number; intro: boolean; gift: boolean }
export const CAST_NONE: XmasCast = { on: false, at: 0, intro: false, gift: false }

/** 저장된 글자를 값으로(순수 함수). 깨졌으면 꺼짐. */
export function parseCast(raw: string | null): XmasCast {
  if (!raw) return CAST_NONE
  try {
    const v = JSON.parse(raw) as Partial<XmasCast> | null
    if (!v || typeof v !== 'object') return CAST_NONE
    const at = typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0 ? v.at : 0
    return { on: v.on === true, at, intro: v.on === true && v.intro === true, gift: v.on === true && v.gift === true }
  } catch {
    return CAST_NONE
  }
}

/** 서버 값(remote)을 받았을 때 이 기기가 할 일(순수 함수). 서버의 at이 이 기기가 따른 at과 다를 때만 바뀐다.
 *  changed면 next를 저장하고, 켜짐·꺼짐이 실제로 달라졌을 때(또는 켜진 채 다시 눌렸을 때)만 새로 고친다. */
export function castStep(local: XmasCast, remote: { on: unknown; at: unknown }): { next: XmasCast; changed: boolean; reload: boolean } {
  const at = typeof remote.at === 'number' && Number.isFinite(remote.at) && remote.at > 0 ? remote.at : 0
  if (typeof remote.on !== 'boolean' || at === local.at) return { next: local, changed: false, reload: false }
  const next: XmasCast = { on: remote.on, at, intro: remote.on, gift: remote.on }
  return { next, changed: true, reload: remote.on || local.on }
}

export const getXmasCast = (): XmasCast => parseCast(get(XMAS_CAST_KEY))
const putCast = (c: XmasCast): boolean => {
  saved = true
  write(XMAS_CAST_KEY, c.on || c.at ? JSON.stringify(c) : null)
  return saved
}
/** 서버 값을 따른다. 켜질 때는 「장식 끄기」 설정도 푼다. 돌려주는 reload가 true면 부른 쪽이 새로 고친다(저장이 안 되는 기기는 되풀이를 막으려고 false). */
export function applyRemoteCast(remote: { on: unknown; at: unknown }): { changed: boolean; reload: boolean } {
  const r = castStep(getXmasCast(), remote)
  if (!r.changed) return { changed: false, reload: false }
  if (r.next.on && getXmasOff()) write(XMAS_KEY, null)
  const ok = putCast(r.next)
  return { changed: true, reload: r.reload && ok }
}
/** 이 기기에서만 켜고 끈다(시연 도구). 서버 값(at)은 건드리지 않는다. */
export function setXmasCastLocal(on: boolean) {
  if (on && getXmasOff()) write(XMAS_KEY, null)
  putCast({ on, at: getXmasCast().at, intro: on, gift: on })
}
/** 첫 화면 연출을 닫았다. */
export function dismissXmasIntro() {
  const c = getXmasCast()
  if (c.intro) putCast({ ...c, intro: false })
}

/** 홈의 선물 상자를 열었다(또는 닫았다). */
export function dismissXmasGift() {
  const c = getXmasCast()
  if (c.gift) putCast({ ...c, gift: false })
}

// 12월 자동 켜짐. 발표 전에 장식이 먼저 보이지 않게 꺼 둔다(11/26 사용자 결정). 발표 뒤 true로 되돌리면 예전처럼 12월에 켜진다.
export const AUTO_DECEMBER: boolean = false
/** 켜짐 기간인지: 12월이거나 시연 도구에서 켰거나 크리스마스 모드일 때. 끄기 스위치는 이 기간에만 보인다. */
export function isXmasSeason(now: Date = new Date(), demo: boolean = getXmasDemo() || getXmasCast().on): boolean {
  return demo || (AUTO_DECEMBER && now.getMonth() === 11)
}
/** 장식을 실제로 보일지: 켜짐 기간이고 끄기 설정이 아닐 때. */
export function isXmasOn(now: Date = new Date(), opts: { off?: boolean; demo?: boolean } = {}): boolean {
  const off = opts.off ?? getXmasOff()
  return !off && isXmasSeason(now, opts.demo ?? (getXmasDemo() || getXmasCast().on))
}

/** mode: 크리스마스 모드(색·눈 내리는 홈)가 켜졌는지. intro: 첫 화면 연출을 보여 줄 차례인지. gift: 홈에 선물 상자를 띄울 차례인지. */
export type XmasState = { season: boolean; on: boolean; mode: boolean; intro: boolean; gift: boolean }
let snap: XmasState | null = null
/** 지금 상태(구독용, 값이 바뀔 때만 새 객체). */
export function xmasSnapshot(): XmasState {
  const season = isXmasSeason()
  const on = isXmasOn()
  const cast = getXmasCast()
  const mode = on && cast.on
  const intro = mode && cast.intro
  const gift = mode && !intro && cast.gift
  if (!snap || snap.season !== season || snap.on !== on || snap.mode !== mode || snap.intro !== intro || snap.gift !== gift) snap = { season, on, mode, intro, gift }
  return snap
}
export function subscribeXmas(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === XMAS_KEY || e.key === XMAS_DEMO_KEY || e.key === XMAS_CAST_KEY || e.key === null) {
      mem.clear()
      snap = null
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
