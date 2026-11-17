// 홈 화면 추가 안내에 쓰는 순수 판정(화면 없음). 사용자 에이전트 문자열로 기기·브라우저를 어림한다.
export type Device = 'ios' | 'android'
export type AndroidBrowser = 'samsung' | 'chrome'

/** 아이폰·아이패드는 ios, 안드로이드(갤럭시 포함)는 android, 그 밖(PC 등)은 null */
export function guessDevice(ua: string): Device | null {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return null
}

/** 삼성 인터넷이면 samsung, 아니면 chrome(갤럭시에서 가장 흔한 두 가지) */
export function guessAndroidBrowser(ua: string): AndroidBrowser {
  return /SamsungBrowser/i.test(ua) ? 'samsung' : 'chrome'
}

/** 카카오톡·네이버·인스타그램·페이스북·라인 같은 앱 안 브라우저인지 */
export function isInAppBrowser(ua: string): boolean {
  return /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|\bLine\//i.test(ua)
}

/** 홈 화면 앱으로 열려 있는지(안드로이드 display-mode, 아이폰 navigator.standalone) */
export function isStandalone(env: { navStandalone?: boolean; matchMedia?: (q: string) => { matches: boolean } }): boolean {
  if (env.navStandalone === true) return true
  try {
    return Boolean(env.matchMedia?.('(display-mode: standalone)').matches)
  } catch {
    return false
  }
}
