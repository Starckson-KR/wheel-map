import { ACCOUNT_URL } from '../config'
import { apiCall, getSession, useAccount } from './api'
import { PING_MS, PONG_WAIT_MS, UNAVAILABLE_RETRY_MS, parseSignal, reconnectDelay, wsUrl } from './realtimePlan'
import type { RtSignal } from './realtimePlan'

// 서버에서 앱으로 바로 알리는 쌍방 연결(WebSocket). 메시지에는 내용이 없고 「바뀌었다」 신호만 온다.
// 앱은 신호를 받으면 기존 당겨오기(sync.ts의 /reports?since)를 바로 실행한다. 데이터 경로는 그대로다.
//  - 로그인 상태이고 화면이 보일 때만 연결한다(숨겨지면 닫는다). 끊기면 1초→2초→…→30초로 다시 연결한다.
//  - 오래 쓰는 토큰은 주소에 넣지 않는다: POST /rt/ticket으로 30초 1회용 티켓을 받아 그 티켓으로 연결한다.
//  - 연결돼 있는 동안 sync.ts는 안전망으로 30초마다만 확인한다. 연결이 없으면(실패·미지원) 지금처럼 4초/15초 확인이다.
//  - WebSocket이 실패해도 앱은 그대로 돈다(이 파일의 어떤 실패도 밖으로 던지지 않는다).
export type RealtimeHandlers = {
  onSignal(t: RtSignal): void
  /** 연결이 생기거나 끊겼을 때(확인 주기를 다시 정하고, 놓친 변경을 한 번 확인한다) */
  onState(): void
}

let handlers: RealtimeHandlers | null = null
let ws: WebSocket | null = null
let up = false
let connecting = false
let attempt = 0
let gen = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
let pingTimer: ReturnType<typeof setInterval> | undefined
let pongTimer: ReturnType<typeof setTimeout> | undefined

export const isRealtimeUp = () => up

// 개발자 관리 화면처럼 sync와 상관없는 구독자(접속 현황 신호·연결 상태). 해제 함수를 돌려준다.
type Listener = { signal?: (t: RtSignal) => void; state?: (up: boolean) => void }
const listeners = new Set<Listener>()
export function onRealtime(fn: Listener): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
const each = (f: (l: Listener) => void) => {
  for (const l of [...listeners]) {
    try {
      f(l)
    } catch {
      /* 구독자의 실패가 연결에 영향을 주지 않게 */
    }
  }
}

const canRun = () => typeof WebSocket !== 'undefined' && !!getSession() && typeof document !== 'undefined' && document.visibilityState === 'visible'

function clearTimers() {
  clearTimeout(retryTimer)
  clearInterval(pingTimer)
  clearTimeout(pongTimer)
  retryTimer = undefined
  pingTimer = undefined
  pongTimer = undefined
}

function setUp(v: boolean) {
  if (up === v) return
  up = v
  handlers?.onState()
  each((l) => l.state?.(v))
}

function closeNow() {
  gen++
  clearTimers()
  const s = ws
  ws = null
  if (s) {
    s.onopen = s.onmessage = s.onclose = s.onerror = null
    try {
      s.close(1000)
    } catch {
      /* 이미 닫힘 */
    }
  }
  setUp(false)
}

function scheduleReconnect(ms: number) {
  clearTimeout(retryTimer)
  if (!canRun()) return
  retryTimer = setTimeout(() => void connect(), ms)
}

async function connect() {
  if (ws || connecting || !canRun()) return
  connecting = true
  const my = ++gen
  let ticket: string | null = null
  let status = 0
  try {
    const r = await apiCall('/rt/ticket', { method: 'POST' })
    status = r.status
    const t = (r.body as { ticket?: unknown } | null)?.ticket
    if (r.status === 200 && typeof t === 'string') ticket = t
  } finally {
    connecting = false
  }
  if (my !== gen || ws || !canRun()) return
  if (!ticket) {
    if (status === 404 || status === 503) scheduleReconnect(UNAVAILABLE_RETRY_MS) // 서버에 실시간 기능이 없다
    else if (status !== 401) scheduleReconnect(reconnectDelay(attempt++, Math.random())) // 401은 로그아웃: 다시 로그인하면 연결한다
    return
  }
  let sock: WebSocket
  try {
    sock = new WebSocket(wsUrl(ACCOUNT_URL, ticket))
  } catch {
    scheduleReconnect(reconnectDelay(attempt++, Math.random()))
    return
  }
  ws = sock
  sock.onopen = () => {
    if (ws !== sock) return
    attempt = 0
    clearInterval(pingTimer)
    pingTimer = setInterval(() => {
      if (ws !== sock || sock.readyState !== WebSocket.OPEN) return
      try {
        sock.send('ping')
      } catch {
        return
      }
      clearTimeout(pongTimer)
      pongTimer = setTimeout(() => {
        if (ws === sock) sock.close() // 응답이 없다 → 끊긴 것으로 보고 다시 연결(onclose가 처리)
      }, PONG_WAIT_MS)
    }, PING_MS)
    setUp(true)
  }
  sock.onmessage = (ev) => {
    if (ws !== sock) return
    clearTimeout(pongTimer) // 무엇이든 받았으면 살아 있다
    const t = parseSignal(ev.data)
    if (t === 'presence' || t === 'xmas') each((l) => l.signal?.(t)) // 접속 현황·크리스마스 모드 신호는 sync로 보내지 않는다
    else if (t) {
      handlers?.onSignal(t)
      each((l) => l.signal?.(t))
    }
  }
  sock.onclose = () => {
    if (ws !== sock) return
    ws = null
    clearInterval(pingTimer)
    clearTimeout(pongTimer)
    setUp(false)
    scheduleReconnect(reconnectDelay(attempt++, Math.random()))
  }
  sock.onerror = () => {
    /* 곧 onclose가 온다 */
  }
}

function refresh() {
  if (canRun()) void connect()
  else closeNow()
}

export function initRealtime(h: RealtimeHandlers) {
  if (typeof window === 'undefined') return
  handlers = h
  useAccount.subscribe((s, prev) => {
    if (s.user?.id !== prev.user?.id) {
      closeNow()
      attempt = 0
      refresh()
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      attempt = 0
      refresh()
    } else closeNow() // 화면이 숨겨지면 연결을 닫아 서버 자원을 아낀다
  })
  window.addEventListener('online', () => {
    attempt = 0
    if (!ws) refresh()
  })
  refresh()
}
