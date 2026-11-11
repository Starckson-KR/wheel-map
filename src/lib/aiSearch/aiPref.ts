// AI 검색 켜기/끄기 스위치(발표 안전장치). 기본은 켜짐이고, 끄면 키워드만 쓴다. localStorage 키 하나만 쓴다.
const KEY = 'wheelmap.aiSearch'
export const AI_PREF_EVENT = 'wheelmap:aipref'

export function getAiEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}
export function setAiEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, 'off')
  } catch {
    /* 저장이 막혀도 이번 화면에는 적용된다 */
  }
  window.dispatchEvent(new Event(AI_PREF_EVENT))
}
