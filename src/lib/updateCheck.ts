// 새 빌드가 배포되면 열려 있는 앱(홈 화면 앱 포함)에 조용히 새 버전을 적용한다.
// 배포마다 만들어지는 version.json의 build 값이 이 번들에 박힌 값과 다르면 새로고침한다. 데이터(localStorage)는 건드리지 않는다.
declare const __BUILD_HASH__: string

const TRY_KEY = 'wheelmap.updateTry'
export const RETRY_MS = 10 * 60 * 1000
const POLL_MS = 5 * 60 * 1000

export type UpdateTry = { build: string; at: number }

// 개발판(dev·+dirty)은 비교하지 않는다.
export const isDevBuild = (b: string) => b === 'dev' || b.includes('+dirty')

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
  const a = doc.activeElement as HTMLElement | null
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)
}

const readTry = (): UpdateTry | null => {
  try {
    const v = JSON.parse(localStorage.getItem(TRY_KEY) ?? 'null')
    return v && typeof v.build === 'string' && typeof v.at === 'number' ? v : null
  } catch {
    return null
  }
}

async function check() {
  if (isDevBuild(__BUILD_HASH__) || document.visibilityState !== 'visible') return
  try {
    const base = import.meta.env.BASE_URL
    const res = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const remote = (await res.json())?.build
    const now = Date.now()
    if (!shouldReload(__BUILD_HASH__, remote, readTry(), now)) return
    if (isBusy(document, location.hash)) return // 끝난 뒤 다음 확인 때 적용
    try {
      localStorage.setItem(TRY_KEY, JSON.stringify({ build: remote, at: now }))
    } catch { /* 기록 실패 시에도 새로고침은 한다 */ }
    // HTTP 캐시에 남은 옛 index.html을 먼저 새로 받아 둔 뒤 새로고침한다.
    await fetch(location.pathname, { cache: 'reload' }).catch(() => undefined)
    location.reload()
  } catch { /* 오프라인 등은 조용히 넘어간다 */ }
}

export function startUpdateCheck() {
  if (isDevBuild(__BUILD_HASH__)) return
  void check()
  document.addEventListener('visibilitychange', () => void check())
  window.addEventListener('online', () => void check())
  window.setInterval(() => void check(), POLL_MS)
}
