// 계정·동기화가 쓰는 localStorage 키와 동기화 대상 설정 키(화이트리스트). 서버(worker/src/prefs.ts)에도 같은 목록이 있다.
export const SESSION_KEY = 'wheelmap.session'
export const SYNC_CURSOR_KEY = 'wheelmap.sync.since' // 마지막으로 받은 서버 시각(ms)
export const SYNC_PENDING_KEY = 'wheelmap.sync.pending' // 아직 못 올린 제보 id 목록
export const SYNC_HASHES_KEY = 'wheelmap.sync.hashes' // 제보 id → 마지막으로 서버와 맞춘 내용의 해시
export const SYNC_NAMES_KEY = 'wheelmap.sync.names' // 다른 사용자 id → 이름
export const SYNC_PHOTOS_KEY = 'wheelmap.sync.photosUp' // 서버에 올린 사진 키

export const SYNCED_PREF_KEYS = [
  'wheelmap.benefitPrefs',
  'wheelmap.textSize',
  'wheelmap.theme',
  'wheelmap.view',
  'wheelmap.layers',
  'wheelmap.aiSearch',
  'wheelmap.sheetSnap',
  'wheelmap.profile',
  'wheelmap.lang',
  'wheelmap.onboarded',
] as const
