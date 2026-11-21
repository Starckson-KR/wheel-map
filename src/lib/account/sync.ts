import type { Report } from '../../types'
import { apiCall, getSession, useAccount } from './api'
import { SYNC_CURSOR_KEY, SYNC_HASHES_KEY, SYNC_LOCALONLY_KEY, SYNC_PENDING_KEY, SYNC_RECONCILED_KEY } from './keys'
import { cleanIds, pickGone } from './reconcile'
import { hashText } from './merge'
import { isPhotoDone, markPhotoSkipped, markPhotoUploaded, resetPhotoLedger } from './photoLedger'
import { shrinkForUpload } from './photoUpload'
import { loadLocalPhoto } from '../photoStore'
import { initPrefsSync, notifyPrefsAt } from './prefsSync'
import { IDLE_AFTER_MS, nextDelay } from './pollPlan'
import { initRealtime, isRealtimeUp } from './realtime'

// 공유 제보 동기화. 로그인 상태에서만 동작한다.
//  - 받기: 화면이 보일 때만 4초마다(1분 넘게 만지지 않으면 15초) GET /reports?since= 로 바뀐 것만 받아 제보 목록에 합친다.
//    앱 시작·화면이 다시 보일 때·창을 다시 누를 때·인터넷이 돌아올 때·내가 올린 직후에는 기다리지 않고 바로 한 번 더 확인한다.
//    실패하면 8초→16초→…→최대 60초로 늘려 가며 다시 시도하고, 성공하면 바로 4초로 돌아온다. 탭이 숨겨지면 멈춘다.
//    같은 응답에 내 설정 변경 시각(prefsAt)이 실려 와 설정 동기화(prefsSync.ts)가 다른 기기의 설정 변경도 알아챈다.
//    실시간 연결(realtime.ts, WebSocket)이 살아 있으면 서버가 「바뀌었다」 신호를 보내는 즉시 같은 당겨오기를 실행하고, 이때 4초 확인은 30초 안전망으로 늦춘다.
//  - 보내기: 내가 만든·바꾼 제보(시연 데이터 제외)를 기다리지 않고 바로(같은 순간의 변경만 묶어서) PUT. 화면에는 먼저 반영돼 있고(낙관적), 못 보내면 대기열(pending)에 두었다가 다음 기회에 다시 보낸다.
//    서버가 형식 문제로 거절하면(4xx) 마지막으로 서버와 맞춘 모습으로 되돌린다(서버에 올라간 적 없는 제보는 이 기기에 그대로 둔다).
//  - 삭제: 관리자가 서버에서 지운 제보는 서버가 삭제 표시(report_deletions)로 남겨, 받기 응답의 deleted로 내려온다 → 이 기기에서도 지운다.
//    삭제 표시가 생기기 전에 지워진 제보는 계정마다 처음 한 번 서버의 제보 id 전체(/reports?ids=1)와 맞춰, 「서버와 맞춘 적 있는」 제보 중 서버에 없는 것만 지운다(reconcile.ts).
//  - 충돌: 같은 제보를 두 기기가 동시에 고치면 기록(history)·확인 투표자는 합집합, 나머지 필드는 서버에 나중에 도착한 쪽이 이긴다(account/merge.ts, worker/src/merge.ts).
//    아직 못 올린 내 변경이 있는 제보는 서버에서 받은 값보다 내 쪽 필드를 우선해 합쳐 다시 올린다.
// reportStore와는 SyncHost로만 이어져(순환 import 없음), 이 파일은 reportStore를 import하지 않는다.

export type SyncHost = {
  getReports(): Report[]
  subscribe(fn: () => void): void
  /** 서버에서 받은 제보를 합친다. pending에 든 id는 내 쪽 값을 우선. finals=합친 뒤 제보, dirty=합치며 새로 생긴 변경(다시 올려야 함) */
  applyRemote(list: Report[], pending: Set<string>): { finals: Report[]; dirty: string[] }
  setNames(names: Record<string, string>): void
  /** 이 id의 이름을 이미 아는가(모르는 사람이 나오면 이름표를 새로 받는다) */
  hasName(id: string): boolean
  /** 서버가 거절한 제보를 마지막으로 서버와 맞춘 모습으로 되돌린다(병합 없이 교체) */
  restore(r: Report): void
  /** 서버에서 지워진 제보를 이 기기에서도 지운다(시연 데이터는 건드리지 않는다) */
  removeIds(ids: string[]): void
}

const DEBOUNCE_MS = 0 // 사용자가 누른 쓰기는 기다리지 않고 바로 보낸다(같은 순간의 여러 변경만 한 번에)
const NAMES_REFRESH_MS = 5 * 60 * 1000
const QUOTA_HOLD_MS = 5 * 60 * 1000

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 저장 실패는 다음 동기화 때 다시 맞춘다 */
  }
}

let host: SyncHost | null = null
let pending = new Set<string>()
let localOnly = new Set<string>()
let hashes: Record<string, string> = {}
let cursor = 0
let applying = false
let pulling = false
let flushing = false
let flushAgain = false // 올리는 중에 새 변경이 생겼다 → 끝나고 다시 올린다
let pullAgain = false // 받는 중에 신호가 왔다 → 끝나고 다시 받는다
let pulledOnce = false
let timer: ReturnType<typeof setTimeout> | undefined
let debounce: ReturnType<typeof setTimeout> | undefined
let running = false
let fails = 0
let lastActive = Date.now()
let needNames = true
let namesAt = 0
let holdUntil = 0 // 하루 저장 횟수를 다 썼을 때(429) 이 시각까지 올리기를 쉰다
const serverCopy = new Map<string, Report>() // 마지막으로 서버와 맞춘 제보(거절당했을 때 되돌릴 모습, 메모리에만)

function loadState() {
  const p = readJson<unknown>(SYNC_PENDING_KEY, [])
  pending = new Set(Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [])
  const h = readJson<unknown>(SYNC_HASHES_KEY, {})
  hashes = typeof h === 'object' && h !== null && !Array.isArray(h) ? (h as Record<string, string>) : {}
  try {
    cursor = Number(localStorage.getItem(SYNC_CURSOR_KEY)) || 0
  } catch {
    cursor = 0
  }
  const lo = readJson<unknown>(SYNC_LOCALONLY_KEY, [])
  localOnly = new Set(Array.isArray(lo) ? lo.filter((x): x is string => typeof x === 'string') : [])
}
const savePending = () => writeJson(SYNC_PENDING_KEY, [...pending])
const saveHashes = () => writeJson(SYNC_HASHES_KEY, hashes)
const saveLocalOnly = () => writeJson(SYNC_LOCALONLY_KEY, [...localOnly])
const hashOf = (r: Report) => hashText(JSON.stringify(r))

// 초기화 버튼(reportStore.resetAll)에서 부른다. 서버에 있는 제보는 다음 받기 때 다시 내려온다.
export function resetSyncState() {
  pending = new Set()
  localOnly = new Set()
  hashes = {}
  cursor = 0
  pulledOnce = false
  serverCopy.clear()
  resetPhotoLedger()
  try {
    for (const k of [SYNC_PENDING_KEY, SYNC_HASHES_KEY, SYNC_CURSOR_KEY, SYNC_LOCALONLY_KEY, SYNC_RECONCILED_KEY]) localStorage.removeItem(k)
  } catch {
    /* 무시 */
  }
}

// 올릴 후보: 시연 데이터가 아니고, 내가 만들었거나 이미 서버에 있는(해시가 있는) 제보
function scan() {
  const s = getSession()
  if (!s || !host) return
  let changed = false
  for (const r of host.getReports()) {
    if (r.demo || r.demoSet) continue
    if (r.userId !== s.user.id && !(r.id in hashes)) continue
    if (hashes[r.id] !== hashOf(r) && !pending.has(r.id)) {
      pending.add(r.id)
      changed = true
    }
  }
  if (changed) savePending()
}

// 제보에 나오는 사람(올린 사람·확인한 사람·기록 작성자)의 이름을 모두 아는가
function knownAll(r: Report): boolean {
  if (!host) return true
  const ids = [r.userId, ...(r.verification?.voterIds ?? []), ...(r.history ?? []).map((h) => h.by)]
  return ids.every((id) => typeof id !== 'string' || host?.hasName(id))
}

function applyList(list: Report[]) {
  if (!host || list.length === 0) return
  applying = true
  let res: { finals: Report[]; dirty: string[] }
  try {
    res = host.applyRemote(list, pending)
  } finally {
    applying = false
  }
  for (const f of res.finals) {
    if (!pending.has(f.id) && !res.dirty.includes(f.id)) {
      hashes[f.id] = hashOf(f)
      serverCopy.set(f.id, f)
    }
    if (!needNames && !knownAll(f)) needNames = true
  }
  for (const id of res.dirty) pending.add(id)
  saveHashes()
  savePending()
}

// 서버에서 지워진 제보를 이 기기에서 지우고, 동기화 기록(대기열·해시·서버 사본)도 함께 비운다
function removeLocal(ids: string[]) {
  if (!host || ids.length === 0) return
  applying = true
  try {
    host.removeIds(ids)
  } finally {
    applying = false
  }
  for (const id of ids) {
    pending.delete(id)
    localOnly.delete(id)
    delete hashes[id]
    serverCopy.delete(id)
  }
  saveHashes()
  savePending()
  saveLocalOnly()
}

// 삭제 표시가 없던 시절에 지워진 제보 정리: 계정마다 처음 한 번만, 서버의 제보 id 전체와 맞춘다.
// 요청 전에 「서버와 맞춘 적 있는 id」를 찍어 두므로, 맞추는 사이 새로 올린 제보는 후보가 아니다.
async function reconcileOnce() {
  const s = getSession()
  if (!s || !host) return
  try {
    if (localStorage.getItem(SYNC_RECONCILED_KEY) === s.user.id) return
  } catch {
    return
  }
  const synced = new Set(Object.keys(hashes))
  const r = await apiCall('/reports?ids=1')
  const b = r.body as { ok?: boolean; complete?: boolean; ids?: unknown } | null
  if (r.status !== 200 || !b?.ok || b.complete !== true || !Array.isArray(b.ids) || getSession()?.user.id !== s.user.id) return
  const gone = pickGone({ local: host.getReports(), synced, localOnly, pending, serverIds: new Set(cleanIds(b.ids)) })
  removeLocal(gone)
  try {
    localStorage.setItem(SYNC_RECONCILED_KEY, s.user.id)
  } catch {
    /* 다음에 다시 맞춘다 */
  }
}

async function pull(): Promise<boolean> {
  if (!getSession() || !host) return false
  if (pulling) {
    pullAgain = true
    return true
  }
  pulling = true
  try {
    for (let page = 0; page < 20; page++) {
      // 이름표는 처음·모르는 사람이 나왔을 때·5분마다만 받는다(매번 받으면 서버 읽기 한도를 낭비한다)
      const names = needNames || Date.now() - namesAt > NAMES_REFRESH_MS
      const r = await apiCall(`/reports?since=${cursor}${names ? '&names=1' : ''}`)
      const b = r.body as { ok?: boolean; serverTime?: number; cursor?: number; more?: boolean; reports?: Report[]; deleted?: unknown; users?: Record<string, string>; prefsAt?: number } | null
      if (r.status !== 200 || !b?.ok || typeof b.serverTime !== 'number') return false
      applyList(Array.isArray(b.reports) ? b.reports : [])
      removeLocal(cleanIds(b.deleted))
      if (b.users) {
        host.setNames(b.users)
        needNames = false
        namesAt = Date.now()
      }
      if (b.more && typeof b.cursor === 'number') {
        cursor = b.cursor
        continue
      }
      cursor = Math.max(cursor, b.serverTime - 5000) // 5초 겹쳐 받아 시각 차이로 빠지는 것을 막는다(병합은 같은 내용을 두 번 받아도 안전)
      try {
        localStorage.setItem(SYNC_CURSOR_KEY, String(cursor))
      } catch {
        /* 무시 */
      }
      pulledOnce = true
      notifyPrefsAt(b.prefsAt)
      try {
        await reconcileOnce()
      } catch {
        /* 맞추기는 다음 기회에 */
      }
      return true
    }
    return false
  } finally {
    pulling = false
    if (pullAgain) {
      pullAgain = false
      queueMicrotask(() => pokeNow(0))
    }
  }
}

async function uploadPhotos(r: Report) {
  const keys = [...r.photos, ...(r.action?.beforePhotos ?? []), ...(r.action?.afterPhotos ?? [])]
  for (const key of keys) {
    if (isPhotoDone(key)) continue
    let blob: Blob | undefined
    try {
      blob = await loadLocalPhoto(key)
    } catch {
      continue
    }
    if (!blob) continue // 이 기기에 없는 사진은 올린 기기에서만 보인다
    const small = await shrinkForUpload(blob)
    if (!small) {
      markPhotoSkipped(key) // 400KB 이하로 못 줄이면 올리지 않는다(제보는 올라간다)
      continue
    }
    const res = await apiCall(`/photos/${encodeURIComponent(key)}`, { method: 'PUT', body: small })
    if (res.status === 200) markPhotoUploaded(key)
    else if (res.status === 400 || res.status === 403 || res.status === 413) markPhotoSkipped(key)
    else return // 네트워크·서버 문제: 다음에 다시
  }
}

// 대기열의 제보를 올린다. 하나라도 올렸으면 true.
async function flush(): Promise<boolean> {
  if (flushing && getSession() && host) flushAgain = true
  if (!getSession() || !host || flushing || !pulledOnce || Date.now() < holdUntil || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false
  flushing = true
  let sentAny = false
  try {
    scan()
    for (const id of [...pending]) {
      const r = host.getReports().find((x) => x.id === id)
      if (!r || r.demo || r.demoSet) {
        pending.delete(id)
        savePending()
        continue
      }
      await uploadPhotos(r)
      const sent = hashOf(r)
      const res = await apiCall(`/reports/${encodeURIComponent(id)}`, { method: 'PUT', json: r })
      const b = res.body as { ok?: boolean; report?: Report } | null
      if (res.status === 200 && b?.ok && b.report) {
        sentAny = true
        pending.delete(id)
        const cur = host.getReports().find((x) => x.id === id)
        if (!cur || hashOf(cur) !== sent) pending.add(id) // 보내는 사이 또 바뀌었다 → 내 쪽 값을 우선해 다시 보낸다
        applyList([b.report])
      } else if (res.status === 410) {
        pending.delete(id) // 서버에서 이미 지워진 제보: 다시 올리지 않고 이 기기에서도 지운다
        removeLocal([id])
      } else if (res.status === 429) {
        holdUntil = Date.now() + QUOTA_HOLD_MS // 하루 저장 횟수를 다 썼다: 계속 두드리지 않고 쉰다
        break
      } else if (res.status === 0 || res.status >= 500 || res.status === 401) {
        break // 오프라인·서버 문제·로그아웃: 대기열에 둔 채 다음 기회에
      } else {
        pending.delete(id) // 서버가 거절한 제보(형식·크기 등)는 되풀이하지 않는다
        const back = serverCopy.get(id)
        if (back) {
          // 낙관적으로 화면에 먼저 반영했던 변경을 되돌린다
          applying = true
          try {
            host.restore(back)
          } finally {
            applying = false
          }
          hashes[id] = hashOf(back)
        } else {
          hashes[id] = sent // 서버에 올라간 적 없는 제보는 이 기기에 그대로 두고 다시 보내지 않는다
          localOnly.add(id) // 서버 목록과 맞출 때도 지우지 않는다
          saveLocalOnly()
        }
        saveHashes()
      }
      savePending()
    }
  } finally {
    flushing = false
    if (flushAgain) {
      flushAgain = false
      schedule()
    }
  }
  return sentAny
}

// 한 번 확인: 받고 → 올린다. 받기에 성공했는가를 돌려준다(실패하면 주기를 늘린다).
async function tick(): Promise<boolean> {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  const ok = await pull()
  if (ok) await flush()
  return ok
}

function arm(delay?: number) {
  clearTimeout(timer)
  timer = undefined
  if (!running || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return // 숨겨진 탭은 멈춘다. 다시 보이면 바로 시작한다.
  timer = setTimeout(() => void loop(), delay ?? nextDelay(fails, Date.now() - lastActive, Math.random(), isRealtimeUp()))
}

async function loop() {
  if (!running) return
  const ok = await tick()
  fails = ok ? 0 : fails + 1
  arm()
}

// 기다리지 않고 지금 한 번 확인(앱 시작·화면 복귀·창 포커스·온라인 복귀·올린 직후)
function pokeNow(delay = 0) {
  if (!running || !getSession()) return
  fails = 0
  arm(delay)
}

function schedule() {
  if (!getSession()) return
  clearTimeout(debounce)
  debounce = setTimeout(async () => {
    if (!pulledOnce) return void pokeNow()
    if ((await flush()) && !isRealtimeUp()) pokeNow(300) // 올린 직후 다른 사람의 변경도 바로 확인(실시간 연결이 있으면 서버가 알려 준다)
  }, DEBOUNCE_MS)
}

function start() {
  stop()
  loadState()
  running = true
  needNames = true
  fails = 0
  pokeNow()
}
function stop() {
  running = false
  clearTimeout(timer)
  clearTimeout(debounce)
  timer = undefined
  pulledOnce = false
}

export function initSync(h: SyncHost) {
  if (typeof window === 'undefined') return
  host = h
  h.subscribe(() => {
    if (applying) return
    scan()
    schedule()
  })
  useAccount.subscribe((s, prev) => {
    if (s.user?.id === prev.user?.id) return
    if (s.user) start()
    else stop()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pokeNow()
    else clearTimeout(timer)
  })
  window.addEventListener('focus', () => pokeNow())
  window.addEventListener('online', () => pokeNow())
  const touch = () => {
    const wasIdle = Date.now() - lastActive >= IDLE_AFTER_MS
    lastActive = Date.now()
    if (wasIdle) pokeNow() // 한참 쉬다 다시 만지면 바로 확인
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, touch, { passive: true })
  if (getSession()) start()
  initPrefsSync()
  initRealtime({ onSignal: () => pokeNow(0), onState: () => pokeNow(0) })
}
