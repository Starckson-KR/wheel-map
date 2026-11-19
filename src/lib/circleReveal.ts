// B2 원형 확장 전환: 눌린 버튼 중심에서 새 화면이 원으로 퍼진다(View Transitions API).
// 지원하지 않거나 움직임 줄이기가 켜져 있으면 그냥 화면만 바꾼다.
import { go } from './nav'
import { prefersCalm } from './viewPrefs'

/** 전환 시간(ms). CSS(.vt-circle)와 같은 값 */
export const CIRCLE_MS = 380
/** 화면이 안 바뀌어도 전환을 끝내는 시간(ms) */
const CIRCLE_GIVE_UP_MS = 600

/** 중심 (x, y)에서 가장 먼 모서리까지의 거리(px). 이 반지름이면 원이 화면 전체를 덮는다. */
export function farthestCorner(x: number, y: number, w: number, h: number): number {
  return Math.ceil(Math.hypot(Math.max(x, w - x), Math.max(y, h - y)))
}

type VtDoc = { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<unknown> } }

/** 이 브라우저가 원형 전환을 그릴 수 있는지 */
export function canCircleReveal(): boolean {
  if (typeof document === 'undefined') return false
  return typeof (document as unknown as VtDoc).startViewTransition === 'function' && !prefersCalm()
}

/** to 주소로 가면서 (x, y)에서 원으로 퍼지게 한다. 이미 그 주소면 아무 것도 안 한다. */
export function goCircle(to: string, x: number, y: number): void {
  if (location.hash === to || (to === '#/' && (location.hash === '' || location.hash === '#'))) return
  if (!canCircleReveal()) {
    go(to)
    return
  }
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${Math.round(x)}px`)
  root.style.setProperty('--vt-y', `${Math.round(y)}px`)
  root.style.setProperty('--vt-r', `${farthestCorner(x, y, innerWidth, innerHeight)}px`)
  root.classList.add('vt-circle')
  const vt = (document as unknown as VtDoc).startViewTransition!(
    () =>
      new Promise<void>((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          window.removeEventListener('hashchange', onChange)
          resolve()
        }
        // 해시가 바뀐 뒤 화면이 그려지도록 두 프레임을 기다린다
        const onChange = () => requestAnimationFrame(() => requestAnimationFrame(finish))
        window.addEventListener('hashchange', onChange)
        setTimeout(finish, CIRCLE_GIVE_UP_MS)
        go(to)
      }),
  )
  const clear = () => root.classList.remove('vt-circle')
  vt.finished.then(clear, clear)
}
