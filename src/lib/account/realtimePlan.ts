// 실시간 연결(WebSocket)의 시간 규칙(순수 함수).
export const PING_MS = 25_000 // 서버는 깨어나지 않고 "pong"으로 자동 응답한다
export const PONG_WAIT_MS = 8_000 // 이 안에 아무 것도 못 받으면 끊긴 것으로 보고 다시 연결한다
export const RECONNECT_MAX_MS = 30_000
export const UNAVAILABLE_RETRY_MS = 5 * 60_000 // 서버에 실시간 기능이 없을 때(404·503)는 드물게만 다시 시도한다

/** attempt: 연속으로 연결에 실패한 횟수(0이면 1초 뒤). 1초→2초→…→최대 30초, ±20% 흔들기 */
export function reconnectDelay(attempt: number, rand = 0.5): number {
  const base = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** Math.min(attempt, 10))
  return Math.round(base * (0.8 + rand * 0.4))
}

/** http(s) 주소와 1회용 티켓으로 WebSocket 주소를 만든다. */
export function wsUrl(base: string, ticket: string): string {
  return `${base.replace(/^http/, 'ws').replace(/\/+$/, '')}/rt?ticket=${encodeURIComponent(ticket)}`
}

export type RtSignal = 'reports' | 'prefs'
/** 서버 메시지에서 신호를 읽는다. pong·모르는 메시지는 null. */
export function parseSignal(data: unknown): RtSignal | null {
  if (typeof data !== 'string' || data.length > 200) return null
  try {
    const t = (JSON.parse(data) as { t?: unknown }).t
    return t === 'reports' || t === 'prefs' ? t : null
  } catch {
    return null
  }
}
