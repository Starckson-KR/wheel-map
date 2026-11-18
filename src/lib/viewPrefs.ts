// 화면 설정: 보기 방식(자동/모바일/PC)과 화면 색(시스템/라이트/다크). localStorage에 저장하고 <html>에 반영한다.
// data-view: 'mobile' | 'desktop' (자동이면 속성 없음 → 창 너비 미디어쿼리)
// data-theme: 'light' | 'dark' (시스템이면 OS 설정을 따라 둘 중 하나로 바뀐다)
export type ViewMode = 'auto' | 'mobile' | 'desktop'
export type ThemeMode = 'system' | 'light' | 'dark'
export type TextSize = 'normal' | 'large'

const VIEW_KEY = 'wheelmap.view'
const THEME_KEY = 'wheelmap.theme'
export const MOTION_REDUCE_KEY = 'wheelmap.motionReduce'
const TEXT_KEY = 'wheelmap.textSize'

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
  return v === 'system' || v === 'dark' ? v : 'light' // 기본값은 라이트(사용자 결정 11/16)
}

// 휴대폰인데 폭이 768px 이상으로 잡히는 경우(브라우저의 '데스크톱 사이트' 보기, 일부 삼성 인터넷 등)에도 '자동'이 모바일 화면이 되게 한다.
// 터치 기기이면서 화면(screen) 짧은 변이 600px 미만이면 휴대폰으로 본다. 폭이 좁아 원래 모바일인 경우는 건드리지 않는다.
function isWidePhone(): boolean {
  try {
    return window.innerWidth >= 768 && window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600
  } catch {
    return false
  }
}

export function applyView(v: ViewMode) {
  const el = document.documentElement
  if (v === 'auto') {
    if (isWidePhone()) {
      el.setAttribute('data-view', 'mobile')
      el.setAttribute('data-autophone', '1')
    } else {
      el.removeAttribute('data-view')
      el.removeAttribute('data-autophone')
    }
  } else {
    el.removeAttribute('data-autophone')
    el.setAttribute('data-view', v)
  }
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

// 움직임은 기본으로 켜져 있다(기기의 움직임 줄이기 설정과 상관없이). 앱 설정에서 「움직임 줄이기」를 켠 사람만 줄인다. <html class="motion-reduce">
// 순수 함수: 기기 설정(osReduce)은 일부러 보지 않는다(사용자 결정 11/18, 기본값은 화려함).
export function shouldReduceMotion(_osReduce: boolean, appReduce: boolean): boolean {
  return appReduce
}
export function getMotionReduce(): boolean {
  return read(MOTION_REDUCE_KEY) === '1'
}
export function applyMotionReduce(on: boolean) {
  document.documentElement.classList.toggle('motion-reduce', on)
}
export function setMotionReduce(on: boolean) {
  write(MOTION_REDUCE_KEY, on ? '1' : '0')
  applyMotionReduce(on)
}
// 지금 움직임을 줄여야 하는지: 앱 설정이 켜진 경우만.
export function prefersCalm(): boolean {
  return document.documentElement.classList.contains('motion-reduce')
}

// 글자 크기: 보통/크게. <html data-text="large">면 rem 기준이 커져 화면 전체가 따라온다.
export function getTextSize(): TextSize {
  return read(TEXT_KEY) === 'large' ? 'large' : 'normal'
}
export function applyTextSize(t: TextSize) {
  const el = document.documentElement
  if (t === 'large') el.setAttribute('data-text', 'large')
  else el.removeAttribute('data-text')
}
export function setTextSize(t: TextSize) {
  write(TEXT_KEY, t)
  applyTextSize(t)
}

// 저장소(localStorage) 값이 바뀐 뒤(로그아웃·계정 전환·서버 설정 동기화) 화면 속성과 설정 시트가 같은 값을 보게 한다.
export const PREFS_CHANGE_EVENT = 'wheelmap:prefschange'
export function reapplyPrefs() {
  applyTextSize(getTextSize())
  applyView(getView())
  applyTheme(getTheme())
  applyMotionReduce(getMotionReduce())
  window.dispatchEvent(new Event('wheelmap:viewchange'))
  window.dispatchEvent(new Event(PREFS_CHANGE_EVENT))
}

export function initPrefs() {
  applyTextSize(getTextSize())
  applyView(getView())
  applyMotionReduce(getMotionReduce())
  applyTheme(getTheme())
  // 자동일 때 화면 폭이 바뀌면(회전 등) 휴대폰 판정을 다시 한다
  window.addEventListener('resize', () => {
    if (getView() !== 'auto') return
    const el = document.documentElement
    const before = el.getAttribute('data-view')
    applyView('auto')
    if (before !== el.getAttribute('data-view')) window.dispatchEvent(new Event('wheelmap:viewchange'))
  })
  dark().addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system')
  })
}

// 지금 PC(넓은) 레이아웃인지: 강제 보기가 있으면 그것을, 아니면 창 너비(768px 이상)를 본다.
export function isDesktopLayout(): boolean {
  const v = document.documentElement.getAttribute('data-view')
  return v ? v === 'desktop' : window.innerWidth >= 768
}
