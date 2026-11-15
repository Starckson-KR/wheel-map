// 간편 계정: 이름·PIN 검증, PBKDF2 해시, 토큰. 순수 함수 + WebCrypto(Workers·Node 공통).
const enc = new TextEncoder()

export const NAME_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]+$/
export const PBKDF2_ITERATIONS = 100000 // Workers WebCrypto의 상한
export const SESSION_DAYS = 30
export const LOCK_FAILS = 5
export const LOCK_MS = 10 * 60 * 1000

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const n = raw.normalize('NFC').trim()
  if (n.length < 1 || n.length > 10 || !NAME_RE.test(n)) return null
  return n
}
// 같은 이름 중복 판정용(영문 대소문자·연속 공백 무시)
export const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, ' ')
export const validPin = (raw: unknown): raw is string => typeof raw === 'string' && /^\d{4}$/.test(raw)

const toHex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf instanceof Uint8Array ? buf : buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const randomHex = (bytes: number) => toHex(crypto.getRandomValues(new Uint8Array(bytes)))
export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(saltHex), iterations: PBKDF2_ITERATIONS }, key, 256)
  return toHex(bits)
}
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// 실패 횟수 기록 규칙(순수 함수). 창(window)은 잠금 시간과 같은 10분.
export type Throttle = { fails: number; windowStart: number; lockedUntil: number }
export const isLocked = (t: Throttle | null, now: number) => !!t && t.lockedUntil > now
export function afterFailure(t: Throttle | null, now: number, limit = LOCK_FAILS): Throttle {
  const fresh = !t || now - t.windowStart > LOCK_MS || (t.lockedUntil > 0 && t.lockedUntil <= now)
  const fails = (fresh ? 0 : (t as Throttle).fails) + 1
  const windowStart = fresh ? now : (t as Throttle).windowStart
  return { fails, windowStart, lockedUntil: fails >= limit ? now + LOCK_MS : 0 }
}
