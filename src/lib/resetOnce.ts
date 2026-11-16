// 배포 후 브라우저마다 딱 한 번, 로그인·초기 설정 상태를 지워 첫 화면부터 다시 시작하게 한다.
// main.tsx의 맨 첫 import(부수 효과만)로 다른 모듈보다 먼저 실행된다. 무거운 모듈은 가져오지 않고, 네트워크 요청도 없다.
// 신고·사진·캐시 같은 사용자 데이터는 지우지 않는다. 다시 로그인하면 서버의 계정 설정이 돌아온다.
import { SESSION_KEY, SYNCED_PREF_KEYS } from './account/keys'

/** 이번 업데이트 값. 다음에 또 한 번 초기화해야 할 때만 바꾼다. */
export const RESET_VERSION = '2026-11-16'
export const RESET_VERSION_KEY = 'wheelmap.resetV'

/** 지울 키: 로그인 세션, 동기화되는 설정(초기 설정 완료 표시 포함), 사용법 슬라이드 본 표시, 시연용 사용자 선택 */
export const RESET_KEYS: readonly string[] = [SESSION_KEY, ...SYNCED_PREF_KEYS, 'wheelmap.guideSeen', 'wheelmap.demoUser']

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 처음이면 true(지우고 버전 저장), 이미 같은 버전이면 false(아무것도 안 함). 저장소 접근이 막히면 false. */
export function resetOnce(store: Store, version: string = RESET_VERSION): boolean {
  try {
    if (store.getItem(RESET_VERSION_KEY) === version) return false
    for (const k of RESET_KEYS) {
      try {
        store.removeItem(k)
      } catch {
        /* 한 키가 막혀도 나머지는 계속 */
      }
    }
    store.setItem(RESET_VERSION_KEY, version)
    return true
  } catch {
    return false
  }
}

try {
  if (typeof localStorage !== 'undefined') resetOnce(localStorage)
} catch {
  /* 저장소를 쓸 수 없으면 그대로 시작 */
}
