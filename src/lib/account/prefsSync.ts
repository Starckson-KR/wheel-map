import { apiCall, getSession, useAccount } from './api'
import { SYNCED_PREF_KEYS } from './keys'

// 개인 설정 동기화(본인만). 다른 모듈의 코드는 건드리지 않고 localStorage 키 단위로 맞춘다.
//  - 로그인(또는 앱 시작) 때 서버 값을 받아 이 기기에 복원. 값이 달라졌으면 화면을 한 번 새로고침해 각 화면이 새 값을 읽게 한다.
//  - 서버에 값이 없던 키는 이 기기의 값을 올린다.
//  - 로그인 중에는 4초마다 키 값을 비교해 바뀌었으면 1.5초 모아서 올린다(같은 탭의 localStorage 변경은 이벤트가 없어 확인 방식).
const POLL_MS = 4000
const DEBOUNCE_MS = 1500
const RELOAD_FLAG = 'wheelmap.prefsApplied'

type Snapshot = Record<string, string>

function snapshot(): Snapshot {
  const out: Snapshot = {}
  try {
    for (const k of SYNCED_PREF_KEYS) {
      const v = localStorage.getItem(k)
      if (v !== null) out[k] = v
    }
  } catch {
    /* 저장소를 못 읽으면 빈 값 */
  }
  return out
}

let last: Snapshot = {}
let timer: ReturnType<typeof setInterval> | undefined
let debounce: ReturnType<typeof setTimeout> | undefined
const queued: Record<string, string | null> = {}
let running = 0 // 로그인 세대(바뀌면 이전 비동기 작업은 멈춘다)

async function push(diff: Record<string, string | null>) {
  if (Object.keys(diff).length === 0) return
  await apiCall('/prefs', { method: 'PUT', json: { data: diff } })
}

async function begin(gen: number) {
  const s = getSession()
  if (!s) return
  const r = await apiCall('/prefs')
  const b = r.body as { ok?: boolean; data?: Record<string, string> | null; updatedAt?: number } | null
  if (gen !== running || r.status !== 200 || !b?.ok) {
    last = snapshot()
    return
  }
  const remote = b.data ?? {}
  const local = snapshot()
  const toPush: Record<string, string | null> = {}
  let changed = false
  for (const k of SYNCED_PREF_KEYS) {
    if (k in remote) {
      if (local[k] !== remote[k]) {
        try {
          localStorage.setItem(k, remote[k])
          changed = true
        } catch {
          /* 무시 */
        }
      }
    } else if (k in local) toPush[k] = local[k]
  }
  last = snapshot()
  await push(toPush)
  if (changed) {
    const flag = `${s.user.id}:${b.updatedAt ?? 0}`
    try {
      if (sessionStorage.getItem(RELOAD_FLAG) !== flag) {
        sessionStorage.setItem(RELOAD_FLAG, flag)
        location.reload()
      }
    } catch {
      /* 새로고침을 못 해도 다음 실행 때 반영된다 */
    }
  }
}

function poll() {
  if (!getSession() || document.visibilityState === 'hidden') return
  const now = snapshot()
  const diff: Record<string, string | null> = {}
  for (const k of SYNCED_PREF_KEYS) {
    if (now[k] !== last[k]) diff[k] = k in now ? now[k] : null
  }
  if (Object.keys(diff).length === 0) return
  last = now
  Object.assign(queued, diff)
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    const d = { ...queued }
    for (const k of Object.keys(queued)) delete queued[k]
    void push(d)
  }, DEBOUNCE_MS)
}

function start() {
  stop()
  const gen = ++running
  void begin(gen)
  timer = setInterval(poll, POLL_MS)
}
function stop() {
  running++
  clearInterval(timer)
  clearTimeout(debounce)
  timer = undefined
}

export function initPrefsSync() {
  useAccount.subscribe((s, prev) => {
    if (s.user?.id === prev.user?.id) return
    if (s.user) start()
    else stop()
  })
  if (getSession()) start()
}
