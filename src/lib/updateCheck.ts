// 새 빌드가 배포되면 열려 있는 앱(홈 화면 앱 포함)에 조용히 새 버전을 적용한다.
// 배포마다 만들어지는 version.json의 build 값이 이 번들에 박힌 값과 다르면 새로고침한다. 데이터(localStorage)는 건드리지 않는다.
declare const __BUILD_HASH__: string

const TRY_KEY = 'wheelmap.updateTry'
export const RETRY_MS = 10 * 60 * 1000
const POLL_MS = 2 * 60 * 1000
export const EARLY_MS = 10 * 1000 // 앱을 연 직후 이 시간 안에는 온보딩·시트가 떠 있어도 바로 적용
const PENDING_MS = 2500 // 새 빌드를 발견했지만 바빠서 미룬 동안 이 간격으로 다시 살핀다

export type UpdateTry = { build: string; at: number }

// 개발판(dev·+dirty)은 비교하지 않는다.
export const isDevBuild = (b: string) => b === 'dev' || b.includes('+dirty')

// 지금 배포된 최신 빌드(version.json). 읽지 못하면 null.
export async function fetchLatestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const b = (await res.json())?.build
    return typeof b === 'string' && b ? b : null
  } catch {
    return null
  }
}

// 옛 버전 표시 판정: 기준은 최신 배포 빌드(없으면 자기 빌드). 개발판에서는 비교하지 않는다.
export function isOldBuild(build: string, latest: string | null, own: string): boolean {
  if (isDevBuild(own)) return false
  return build !== (latest || own)
}

// 새로고침해야 하는지: 서버 값이 다르고, 개발판이 아니고, 같은 새 빌드로 최근에 시도한 적이 없을 때.
export function shouldReload(own: string, remote: unknown, last: UpdateTry | null, now: number): boolean {
  if (typeof remote !== 'string' || !remote || isDevBuild(own) || remote === own) return false
  if (last && last.build === remote && now - last.at < RETRY_MS) return false
  return true
}

// 작성 중인 화면에서는 미룬다: 제보 작성·행정·확인 화면, 초기 설정·로그인, 열린 시트, 글자 입력 중.
export function isBusy(doc: Document, hash: string): boolean {
  const page = hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  if (page === 'report' || page === 'admin' || page === 'verify') return true
  if (doc.querySelector('.ob-body, .ob-foot, [role="dialog"][aria-modal="true"]')) return true
  return isTyping(doc)
}

// 글자 입력 중인지.
export function isTyping(doc: Document): boolean {
  const a = doc.activeElement as HTMLElement | null
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable === true)
}

// 지금 새로고침해도 되는지: 입력 중이면 안 되고, 연 직후(EARLY_MS 안)면 되고, 그 뒤에는 바쁘지 않을 때만.
export function canReloadNow(typing: boolean, busy: boolean, sinceOpenMs: number): boolean {
  if (typing) return false
  if (sinceOpenMs < EARLY_MS) return true
  return !busy
}

const OPENED_AT = Date.now()
let pending: string | null = null
let pendingTimer: number | undefined

const readTry = (): UpdateTry | null => {
  try {
    const v = JSON.parse(localStorage.getItem(TRY_KEY) ?? 'null')
    return v && typeof v.build === 'string' && typeof v.at === 'number' ? v : null
  } catch {
    return null
  }
}

async function applyUpdate(remote: string): Promise<boolean> {
  const now = Date.now()
  if (!shouldReload(__BUILD_HASH__, remote, readTry(), now)) return true
  if (!canReloadNow(isTyping(document), isBusy(document, location.hash), now - OPENED_AT)) return false // 바쁨이 풀리는 즉시 적용
  try {
    localStorage.setItem(TRY_KEY, JSON.stringify({ build: remote, at: now }))
  } catch { /* 기록 실패 시에도 새로고침은 한다 */ }
  // HTTP 캐시에 남은 옛 index.html을 먼저 새로 받아 둔 뒤 새로고침한다.
  await fetch(location.pathname, { cache: 'reload' }).catch(() => undefined)
  location.reload()
  return true
}

function waitForIdle(remote: string) {
  pending = remote
  if (pendingTimer !== undefined) return
  pendingTimer = window.setInterval(() => {
    if (pending === null || document.visibilityState !== 'visible') return
    void applyUpdate(pending).then((done) => {
      if (done && pendingTimer !== undefined) {
        window.clearInterval(pendingTimer)
        pendingTimer = undefined
        pending = null
      }
    })
  }, PENDING_MS)
}

async function check() {
  if (isDevBuild(__BUILD_HASH__) || document.visibilityState !== 'visible') return
  try {
    const base = import.meta.env.BASE_URL
    const res = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const remote = (await res.json())?.build
    if (!shouldReload(__BUILD_HASH__, remote, readTry(), Date.now())) return
    if (!(await applyUpdate(remote))) waitForIdle(remote)
  } catch { /* 오프라인 등은 조용히 넘어간다 */ }
}

export function startUpdateCheck() {
  if (isDevBuild(__BUILD_HASH__)) return
  void check()
  document.addEventListener('visibilitychange', () => void check())
  window.addEventListener('online', () => void check())
  window.setInterval(() => void check(), POLL_MS)
}
