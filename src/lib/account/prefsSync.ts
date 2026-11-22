import { apiCall, getSession, useAccount } from './api'
import { reapplyPrefs } from '../viewPrefs'
import { isTouchDevice, syncedKeysFor } from './keys'

// 개인 설정 동기화(본인만). 다른 모듈의 코드는 건드리지 않고 localStorage 키 단위로 맞춘다.
//  - 로그인(또는 앱 시작) 때 서버 값을 받아 이 기기에 복원. 값이 달라졌으면 화면을 한 번 새로고침해 각 화면이 새 값을 읽게 한다.
//  - 서버에 값이 없던 키는 이 기기의 값을 올린다.
//  - 이 기기에서 바꾼 값: 1초마다 키 값을 비교해(같은 탭의 localStorage 변경은 이벤트가 없어 확인 방식) 0.4초 모아서 올린다. 못 올리면 대기열에 두고 다시 시도한다.
//  - 다른 기기에서 바꾼 값: 공유 제보 확인(sync.ts)의 응답에 실려 오는 설정 변경 시각(prefsAt)이 내가 아는 것보다 새로우면 그때 설정만 내려받는다(별도 반복 요청 없음).
//    글자 크기·화면 색·보기 방식은 바로 반영하고, 나머지는 쓰는 중이 아닐 때(몇 초 입력이 없을 때) 한 번 새로고침해 반영한다.
//  - 충돌 규칙: 키 단위로 마지막으로 서버에 도착한 값이 이긴다. 이 기기에서 아직 못 올린 키는 내려받을 때 덮어쓰지 않는다(내 쪽 우선, 곧 올라간다).
const LOCAL_POLL_MS = 1000
const DEBOUNCE_MS = 400
const RETRY_MS = 5000
const RELOAD_FLAG = 'wheelmap.prefsApplied'
const LIVE_KEYS = new Set(['wheelmap.theme', 'wheelmap.textSize', 'wheelmap.view']) // 새로고침 없이 바로 반영되는 키
const RELOAD_IDLE_MS = 6000

type Snapshot = Record<string, string>
type Diff = Record<string, string | null>

function snapshot(): Snapshot {
  const out: Snapshot = {}
  try {
    for (const k of syncedKeysFor(isTouchDevice())) {
      const v = localStorage.getItem(k)
      if (v !== null) out[k] = v
    }
  } catch {
    /* 저장소를 못 읽으면 빈 값 */
  }
  return out
}

// 로그인 뒤 서버 설정을 한 번 받아 온 계정 id(받기 전·실패·로그아웃이면 null). 동의 카드가 「다른 기기에서 이미 답했는지」 알려고 쓴다.
let pulledFor: string | null = null
const pulledListeners = new Set<() => void>()
const setPulled = (id: string | null) => {
  if (pulledFor === id) return
  pulledFor = id
  for (const f of [...pulledListeners]) f()
}
export const getPulledFor = () => pulledFor
export function subscribePulled(f: () => void): () => void {
  pulledListeners.add(f)
  return () => void pulledListeners.delete(f)
}

let last: Snapshot = {} // 마지막으로 서버와 맞춘(또는 올린) 이 기기의 값
let remoteKeys = new Set<string>() // 서버에 있다고 마지막으로 확인한 키
let knownAt = 0 // 내가 반영한 서버 설정 변경 시각
let timer: ReturnType<typeof setInterval> | undefined
let debounce: ReturnType<typeof setTimeout> | undefined
let retry: ReturnType<typeof setTimeout> | undefined
let fetching = false
let running = 0 // 로그인 세대(바뀌면 이전 비동기 작업은 멈춘다)
const queued: Diff = {}
let lastActive = Date.now()
let reloadTimer: ReturnType<typeof setTimeout> | undefined

async function flushQueued(gen: number) {
  clearTimeout(retry)
  const sent: Diff = { ...queued }
  if (Object.keys(sent).length === 0 || gen !== running) return
  const r = await apiCall('/prefs', { method: 'PUT', json: { data: sent } })
  if (gen !== running) return
  const b = r.body as { ok?: boolean; updatedAt?: number } | null
  if (r.status === 200 && b?.ok) {
    for (const [k, v] of Object.entries(sent)) {
      if (queued[k] === v) delete queued[k]
      if (v === null) remoteKeys.delete(k)
      else remoteKeys.add(k)
    }
    if (typeof b.updatedAt === 'number') knownAt = Math.max(knownAt, b.updatedAt)
  } else if (r.status === 0 || r.status >= 500 || r.status === 429) {
    retry = setTimeout(() => void flushQueued(gen), RETRY_MS) // 오프라인·서버 문제: 대기열에 둔 채 다시
  } else {
    for (const k of Object.keys(sent)) if (queued[k] === sent[k]) delete queued[k] // 서버가 거절한 값은 되풀이하지 않는다
  }
}

function schedulePush(gen: number) {
  clearTimeout(debounce)
  debounce = setTimeout(() => void flushQueued(gen), DEBOUNCE_MS)
}

function applyRemote(remote: Record<string, string>, updatedAt: number, userId: string) {
  let changed = false
  let needsReload = false
  for (const k of syncedKeysFor(isTouchDevice())) {
    if (k in queued) continue // 이 기기에서 방금 바꾼 값은 덮어쓰지 않는다(곧 올라간다)
    try {
      const cur = localStorage.getItem(k)
      if (k in remote) {
        if (cur !== remote[k]) {
          localStorage.setItem(k, remote[k])
          changed = true
          if (!LIVE_KEYS.has(k)) needsReload = true
        }
      } else if (remoteKeys.has(k) && cur !== null) {
        localStorage.removeItem(k) // 다른 기기에서 지운 값
        changed = true
        if (!LIVE_KEYS.has(k)) needsReload = true
      }
    } catch {
      /* 무시 */
    }
  }
  remoteKeys = new Set(Object.keys(remote))
  knownAt = Math.max(knownAt, updatedAt)
  last = { ...snapshot() }
  if (!changed) return
  reapplyPrefs() // 글자 크기·화면 색·보기 방식과 설정 시트는 바로 서버 값과 같아진다
  if (needsReload) scheduleReload(userId, updatedAt)
}

// 새로고침이 필요한 값은 쓰는 중이 아닐 때 한 번만 반영한다(입력 중이거나 방금 만졌으면 몇 초 뒤 다시 본다).
function scheduleReload(userId: string, updatedAt: number) {
  clearTimeout(reloadTimer)
  const flag = `${userId}:${updatedAt}`
  const attempt = () => {
    const el = typeof document !== 'undefined' ? document.activeElement : null
    const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    if (hidden || typing || Date.now() - lastActive < RELOAD_IDLE_MS || Object.keys(queued).length > 0) {
      reloadTimer = setTimeout(attempt, 2000)
      return
    }
    try {
      if (sessionStorage.getItem(RELOAD_FLAG) === flag) return
      sessionStorage.setItem(RELOAD_FLAG, flag)
      location.reload()
    } catch {
      /* 새로고침을 못 해도 다음 실행 때 반영된다 */
    }
  }
  reloadTimer = setTimeout(attempt, 2000)
}

async function fetchRemote(gen: number) {
  const s = getSession()
  if (!s || fetching) return
  fetching = true
  try {
    const r = await apiCall(knownAt > 0 ? `/prefs?since=${knownAt}` : '/prefs')
    const b = r.body as { ok?: boolean; unchanged?: boolean; data?: Record<string, string> | null; updatedAt?: number } | null
    if (gen !== running || r.status !== 200 || !b?.ok) return
    if (b.unchanged) {
      if (typeof b.updatedAt === 'number') knownAt = Math.max(knownAt, b.updatedAt)
      return
    }
    applyRemote(b.data ?? {}, b.updatedAt ?? 0, s.user.id)
  } finally {
    fetching = false
  }
}

// 로그인(또는 앱 시작) 직후 한 번: 서버 값을 복원하고, 서버에 없던 키는 올린다.
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
  const toPush: Diff = {}
  let changed = false
  for (const k of syncedKeysFor(isTouchDevice())) {
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
  remoteKeys = new Set(Object.keys(remote))
  knownAt = b.updatedAt ?? 0
  last = snapshot()
  setPulled(s.user.id) // 서버 값이 이 기기에 반영됐다
  Object.assign(queued, toPush)
  await flushQueued(gen)
  if (changed) {
    reapplyPrefs() // 새로고침 전에도 화면 속성·설정 시트가 서버 값과 같아지게 한다
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

function pollLocal(gen: number) {
  if (!getSession() || document.visibilityState === 'hidden') return
  const now = snapshot()
  const diff: Diff = {}
  for (const k of syncedKeysFor(isTouchDevice())) {
    if (now[k] !== last[k]) diff[k] = k in now ? now[k] : null
  }
  if (Object.keys(diff).length === 0) return
  last = now
  Object.assign(queued, diff)
  schedulePush(gen)
}

// sync.ts가 제보 확인 응답의 prefsAt을 넘겨 준다. 내가 아는 것보다 새로우면(다른 기기에서 바꿈) 설정을 내려받는다.
export function notifyPrefsAt(at: unknown) {
  if (typeof at !== 'number' || at <= knownAt || running === 0) return
  void fetchRemote(running)
}

function start() {
  stop()
  const gen = ++running
  void begin(gen)
  timer = setInterval(() => pollLocal(gen), LOCAL_POLL_MS)
}
function stop() {
  running++
  setPulled(null)
  clearInterval(timer)
  clearTimeout(debounce)
  clearTimeout(retry)
  clearTimeout(reloadTimer)
  timer = undefined
  for (const k of Object.keys(queued)) delete queued[k]
  remoteKeys = new Set()
  knownAt = 0
}

export function initPrefsSync() {
  useAccount.subscribe((s, prev) => {
    if (s.user?.id === prev.user?.id) return
    if (s.user) start()
    else stop()
  })
  const touch = () => {
    lastActive = Date.now()
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(ev, touch, { passive: true })
  window.addEventListener('online', () => {
    if (Object.keys(queued).length > 0) void flushQueued(running)
  })
  if (getSession()) start()
}
