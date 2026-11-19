// 사용법 슬라이드의 순수 로직: 본 적 있는지 저장, 다시 열기 이벤트, 닫은 뒤 이동할 곳.
import { parseHash } from './nav'

export const GUIDE_SEEN_KEY = 'wheelmap.guideSeen'
/** 초기 설정을 마친 직후(가입·로그인 포함) 게이트가 보내는 이벤트 */
export const ONBOARDED_EVENT = 'wheelmap:onboarded'
/** 홈의 「이용 안내」 같은 곳에서 슬라이드를 다시 열 때 보내는 이벤트 */
export const GUIDE_OPEN_EVENT = 'wheelmap:guide-open'

export const GUIDE_SLIDES: { icon: string; text: string }[] = [
  { icon: 'map', text: '다니기 불편한 곳을 지도에서 확인해요' },
  { icon: 'route', text: '휠체어로 갈 수 있는 길을 찾아 드려요' },
  { icon: 'report', text: '불편한 곳을 사진 한 장으로 제보해요' },
  { icon: 'bell', text: '내 제보가 어떻게 처리되는지 알려 드려요' },
]

export const guideSeen = (): boolean => {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === '1'
  } catch {
    return false
  }
}
export const markGuideSeen = () => {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, '1')
  } catch {
    /* 저장이 막혀도 이번 화면에는 영향이 없다 */
  }
}
export const openGuide = () => window.dispatchEvent(new Event(GUIDE_OPEN_EVENT))

/** 슬라이드를 닫은 뒤 보낼 곳. 주소에 명시된 링크(쿼리가 있는 주소·행정·검증)는 그대로 두고(null), 나머지는 홈. */
export function homeAfterClose(hash: string): string | null {
  const { page, query } = parseHash(hash)
  if (query || page === 'admin' || page === 'verify') return null
  return '#/'
}

/** 슬라이드 번호를 범위 안으로 */
export const clampSlide = (i: number, n = GUIDE_SLIDES.length) => Math.max(0, Math.min(n - 1, i))
