import type { Report } from '../../types'
import { apiCall, getSession, useAccount } from './api'
import { SYNC_CURSOR_KEY, SYNC_HASHES_KEY, SYNC_PENDING_KEY } from './keys'
import { hashText } from './merge'
import { isPhotoDone, markPhotoSkipped, markPhotoUploaded, resetPhotoLedger } from './photoLedger'
import { shrinkForUpload } from './photoUpload'
import { loadLocalPhoto } from '../photoStore'
import { initPrefsSync } from './prefsSync'

// 공유 제보 동기화. 로그인 상태에서만 동작한다.
//  - 받기: 앱 시작·화면이 다시 보일 때·30초마다(화면이 보일 때만) GET /reports?since= 로 변경분을 받아 제보 목록에 합친다.
//  - 보내기: 내가 만든·바꾼 제보(시연 데이터 제외)를 1.5초 모아서 PUT. 못 보내면 대기열(pending)에 두었다가 다음 기회에 다시 보낸다.
// reportStore와는 SyncHost로만 이어져(순환 import 없음), 이 파일은 reportStore를 import하지 않는다.

export type SyncHost = {
  getReports(): Report[]
  subscribe(fn: () => void): void
  /** 서버에서 받은 제보를 합친다. pending에 든 id는 내 쪽 값을 우선. finals=합친 뒤 제보, dirty=합치며 새로 생긴 변경(다시 올려야 함) */
  applyRemote(list: Report[], pending: Set<string>): { finals: Report[]; dirty: string[] }
  setNames(names: Record<string, string>): void
}

const PULL_MS = 30000
const DEBOUNCE_MS = 1500

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
let hashes: Record<string, string> = {}
let cursor = 0
let applying = false
let pulling = false
let flushing = false
let pulledOnce = false
let interval: ReturnType<typeof setInterval> | undefined
let debounce: ReturnType<typeof setTimeout> | undefined

function loadState() {
  const p = readJson<unknown>(SYNC_PENDING_KEY, [])
  pending = new Set(Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [])
  const h = readJson<unknown>(SYNC_HASHES_KEY, {})
  hashes = typeof h === 'object' && h !== null && !Array.isArray(h) ? (h as Record<string, string>) : {}
  cursor = Number(localStorage.getItem(SYNC_CURSOR_KEY)) || 0
}
const savePending = () => writeJson(SYNC_PENDING_KEY, [...pending])
const saveHashes = () => writeJson(SYNC_HASHES_KEY, hashes)
const hashOf = (r: Report) => hashText(JSON.stringify(r))

// 초기화 버튼(reportStore.resetAll)에서 부른다. 서버에 있는 제보는 다음 받기 때 다시 내려온다.
export function resetSyncState() {
  pending = new Set()
  hashes = {}
  cursor = 0
  pulledOnce = false
  resetPhotoLedger()
  try {
    for (const k of [SYNC_PENDING_KEY, SYNC_HASHES_KEY, SYNC_CURSOR_KEY]) localStorage.removeItem(k)
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

function applyList(list: Report[]) {
  if (!host || list.length === 0) return
  applying = true
  let res: { finals: Report[]; dirty: string[] }
  try {
    res = host.applyRemote(list, pending)
  } finally {
    applying = false
  }
  for (const f of res.finals) if (!pending.has(f.id) && !res.dirty.includes(f.id)) hashes[f.id] = hashOf(f)
  for (const id of res.dirty) pending.add(id)
  saveHashes()
  savePending()
}

async function pull(): Promise<boolean> {
  if (!getSession() || !host || pulling) return false
  pulling = true
  try {
    for (let page = 0; page < 20; page++) {
      const r = await apiCall(`/reports?since=${cursor}`)
      const b = r.body as { ok?: boolean; serverTime?: number; cursor?: number; more?: boolean; reports?: Report[]; users?: Record<string, string> } | null
      if (r.status !== 200 || !b?.ok || typeof b.serverTime !== 'number') return false
      applyList(Array.isArray(b.reports) ? b.reports : [])
      if (b.users) host.setNames(b.users)
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
      return true
    }
    return false
  } finally {
    pulling = false
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

async function flush() {
  if (!getSession() || !host || flushing || !pulledOnce || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  flushing = true
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
        pending.delete(id)
        const cur = host.getReports().find((x) => x.id === id)
        if (!cur || hashOf(cur) !== sent) pending.add(id) // 보내는 사이 또 바뀌었다 → 내 쪽 값을 우선해 다시 보낸다
        applyList([b.report])
      } else if (res.status === 0 || res.status >= 500 || res.status === 429 || res.status === 401) {
        break // 오프라인·서버 문제·하루 상한·로그아웃: 대기열에 둔 채 다음 기회에
      } else {
        pending.delete(id) // 서버가 거절한 제보(형식·크기 등)는 되풀이하지 않는다
        hashes[id] = sent
        saveHashes()
      }
      savePending()
    }
  } finally {
    flushing = false
  }
}

async function tick() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  await pull()
  await flush()
}

function schedule() {
  if (!getSession()) return
  clearTimeout(debounce)
  debounce = setTimeout(() => void (pulledOnce ? flush() : tick()), DEBOUNCE_MS)
}

function start() {
  stop()
  loadState()
  void tick()
  interval = setInterval(() => void tick(), PULL_MS)
}
function stop() {
  clearInterval(interval)
  clearTimeout(debounce)
  interval = undefined
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
    if (document.visibilityState === 'visible' && getSession()) void tick()
  })
  window.addEventListener('online', () => void tick())
  if (getSession()) start()
  initPrefsSync()
}
