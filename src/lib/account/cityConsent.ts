import { CITY_CONSENT_KEY } from './keys'

// 접속 지역(도시) 기록 동의(선택). 'yes'일 때만 접속 기록에 cityOk를 실어 보내고, 서버가 그때만 지역을 저장한다(worker/src/activity.ts).
export type CityConsent = 'yes' | 'no' | null
export const parseCityConsent = (v: unknown): CityConsent => (v === 'yes' || v === 'no' ? v : null)

export function readCityConsent(): CityConsent {
  try {
    return parseCityConsent(localStorage.getItem(CITY_CONSENT_KEY))
  } catch {
    return null
  }
}
export function writeCityConsent(v: 'yes' | 'no'): void {
  try {
    localStorage.setItem(CITY_CONSENT_KEY, v)
  } catch {
    /* 저장이 막혀도 이번 화면에는 영향이 없다 */
  }
}

/** 동의 카드를 띄울지: 로그인했고, 초기 설정이 끝났고, 로그인 뒤 서버 설정을 한 번 받아 왔고, 아직 답이 없을 때만(한 번만). */
export const shouldAskCityConsent = (s: { loggedIn: boolean; onboarded: boolean; pulled: boolean; value: CityConsent }): boolean => s.loggedIn && s.onboarded && s.pulled && s.value === null

export const CITY_CONSENT_BODY = '접속 확인을 위해 접속 시각과 대략적인 지역(도시)⁠을 기록해요. 30일(기기 요약은 90일) 뒤 자동으로 지워지고, IP 주소와 GPS 위치는 저장하지 않아요. 동의하지 않아도 앱을 쓸 수 있어요.'
