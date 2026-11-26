// 크리스마스 모드 신호 받기: 관리자가 켜거나 끄면 앱을 연 모든 기기가 따라 바뀌며 새로 고쳐진다.
//  - 로그인한 기기: 실시간 연결(WebSocket)로 {"t":"xmas"} 신호가 오면 바로 서버 값을 읽는다.
//  - 로그인 전 기기·실시간이 끊긴 기기: 화면이 보이는 동안 POLL_MS마다 GET /xmas를 읽는다(개인 자료 없음, 로그인 불필요).
//  - 앱을 열 때·화면이 다시 보일 때·연결이 돌아올 때도 한 번 읽는다.
// 판단(castStep)과 저장은 xmas.ts에 있다. 서버가 옛 버전(404)이거나 연결이 안 되면 아무 일도 하지 않는다.
import { apiCall } from './account/api'
import { isRealtimeUp, onRealtime } from './account/realtime'
import { applyRemoteCast } from './xmas'

export const POLL_MS = 15_000

let busy = false
async function check() {
  if (busy || document.visibilityState !== 'visible') return
  busy = true
  try {
    const r = await apiCall('/xmas', { auth: false })
    const b = r.body as { ok?: unknown; on?: unknown; at?: unknown } | null
    if (r.status !== 200 || !b || b.ok !== true) return
    if (applyRemoteCast({ on: b.on, at: b.at }).reload) location.reload()
  } finally {
    busy = false
  }
}

export function startXmasCast() {
  if (typeof window === 'undefined') return
  void check()
  document.addEventListener('visibilitychange', () => void check())
  window.addEventListener('online', () => void check())
  onRealtime({ signal: (t) => t === 'xmas' && void check(), state: (up) => up && void check() })
  window.setInterval(() => {
    if (!isRealtimeUp()) void check()
  }, POLL_MS)
}

/** 관리자: 모든 기기에 켜거나 끈다. 성공하면 서버 값을, 실패하면 안내 문장을 돌려준다. */
export async function castXmasToAll(on: boolean): Promise<{ ok: true; on: boolean; at: number } | { ok: false; message: string }> {
  const r = await apiCall('/admin/xmas', { method: 'POST', json: { on } })
  const b = r.body as { ok?: unknown; on?: unknown; at?: unknown } | null
  if (r.status === 200 && b?.ok === true && typeof b.on === 'boolean' && typeof b.at === 'number') return { ok: true, on: b.on, at: b.at }
  if (r.status === 403) return { ok: false, message: '권한이 없어요.' }
  return { ok: false, message: '바꾸지 못했어요. 잠시 뒤에 다시 해 주세요.' }
}
/** 관리자: 지금 서버 값. 읽지 못하면 null. */
export async function loadXmasCast(): Promise<{ on: boolean; at: number } | null> {
  const r = await apiCall('/xmas', { auth: false })
  const b = r.body as { ok?: unknown; on?: unknown; at?: unknown } | null
  return r.status === 200 && b?.ok === true && typeof b.on === 'boolean' && typeof b.at === 'number' ? { on: b.on, at: b.at } : null
}
