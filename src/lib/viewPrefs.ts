// 화면 설정: 보기 방식(자동/모바일/PC)과 화면 색(시스템/라이트/다크). localStorage에 저장하고 <html>에 반영한다.
// data-view: 'mobile' | 'desktop' (자동이면 속성 없음 → 창 너비 미디어쿼리)
// data-theme: 'light' | 'dark' (시스템이면 OS 설정을 따라 둘 중 하나로 바뀐다)
export type ViewMode = 'auto' | 'mobile' | 'desktop'
export type ThemeMode = 'system' | 'light' | 'dark'

const VIEW_KEY = 'wheelmap.view'
const THEME_KEY = 'wheelmap.theme'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* 저장이 막혀도 이번 화면에는 적용된다 */
  }
}

export function getView(): ViewMode {
  const v = read(VIEW_KEY)
  return v === 'mobile' || v === 'desktop' ? v : 'auto'
}
export function getTheme(): ThemeMode {
  const v = read(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function applyView(v: ViewMode) {
  const el = document.documentElement
  if (v === 'auto') el.removeAttribute('data-view')
  else el.setAttribute('data-view', v)
}

const dark = () => window.matchMedia('(prefers-color-scheme: dark)')
export function applyTheme(t: ThemeMode) {
  document.documentElement.setAttribute('data-theme', t === 'system' ? (dark().matches ? 'dark' : 'light') : t)
}

export function setView(v: ViewMode) {
  write(VIEW_KEY, v)
  applyView(v)
  window.dispatchEvent(new Event('wheelmap:viewchange'))
}
export function setTheme(t: ThemeMode) {
  write(THEME_KEY, t)
  applyTheme(t)
}

export function initPrefs() {
  applyView(getView())
  applyTheme(getTheme())
  dark().addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system')
  })
}

// 지금 PC(넓은) 레이아웃인지: 강제 보기가 있으면 그것을, 아니면 창 너비(768px 이상)를 본다.
export function isDesktopLayout(): boolean {
  const v = document.documentElement.getAttribute('data-view')
  return v ? v === 'desktop' : window.innerWidth >= 768
}
