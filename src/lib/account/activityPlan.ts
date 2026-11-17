// 접속·오류 기록의 순수 규칙(브라우저·네트워크 없음). 보내는 쪽은 activity.ts.

/** 이 시간 넘게 숨겨졌다가 다시 보이면 「다시 접속」으로 한 번 기록한다 */
export const RESUME_AFTER_MS = 30 * 60 * 1000
/** 로그인 전에 잠깐 모아 두는 오류 개수 */
export const PRE_LOGIN_MAX = 10
export const MAX_MESSAGE = 300
export const MAX_STACK = 2000

export const shouldReportResume = (hiddenAt: number | null, now: number): boolean => hiddenAt !== null && now - hiddenAt >= RESUME_AFTER_MS

const clip = (s: string, n: number) => [...s].slice(0, n).join('')

/** location.hash에서 화면 경로만(쿼리·조각 제외). 예: "#/map?report=abc" → "/map" */
export function routeOf(hash: string): string {
  return clip(hash.replace(/^#/, '').split(/[?#]/)[0], 100)
}

/** 주소 안의 쿼리·해시 조각을 지운다(개인 정보가 실릴 수 있는 부분). 주소가 아닌 글의 물음표는 그대로 둔다. */
export function scrubUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, '$1')
}

export const cleanMessage = (m: string): string => clip(scrubUrls(m).trim(), MAX_MESSAGE)
export const cleanStack = (s: string): string => clip(scrubUrls(s), MAX_STACK)

/** 사용자에게 의미 없는 브라우저 알림(오류가 아님) */
export const isIgnorableError = (message: string): boolean => /^ResizeObserver loop/.test(message)

/** 같은 오류인지 가르는 값: 메시지+빌드 */
export const errorKey = (message: string, build: string): string => {
  let h = 5381
  for (const c of `${message}|${build}`) h = ((h * 33) ^ c.codePointAt(0)!) >>> 0
  return h.toString(36)
}

export const dayOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export type SeenMap = Record<string, string>

/** 오늘 처음 보는 오류면 true. seen을 오늘 값만 남기도록 돌려준다(저장은 부르는 쪽). */
export function takeError(seen: SeenMap, key: string, today: string): { send: boolean; seen: SeenMap } {
  const keep: SeenMap = {}
  for (const [k, d] of Object.entries(seen)) if (d === today) keep[k] = d
  if (keep[key]) return { send: false, seen: keep }
  keep[key] = today
  return { send: true, seen: keep }
}

/** 로그인 전 오류를 모아 두는 칸: 가득 차면 더 받지 않는다 */
export function pushPending<T>(list: T[], item: T, max: number = PRE_LOGIN_MAX): T[] {
  return list.length >= max ? list : [...list, item]
}
