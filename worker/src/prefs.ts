// 서버에 올릴 수 있는 개인 설정 키(src/lib/account/keys.ts의 SYNCED_PREF_KEYS와 같은 목록).
export const PREF_KEYS = [
  'wheelmap.benefitPrefs',
  'wheelmap.textSize',
  'wheelmap.motionReduce',
  'wheelmap.theme',
  'wheelmap.view',
  'wheelmap.layers',
  'wheelmap.aiSearch',
  'wheelmap.sheetSnap',
  'wheelmap.profile',
  'wheelmap.lang',
  'wheelmap.onboarded',
  'wheelmap.cityConsent', // 접속 지역(도시) 기록 동의: 'yes' / 'no'. 'yes'가 아니게 되면 저장된 지역을 지운다(account.ts)
]
export const MAX_PREFS_BYTES = 16 * 1024

// 허용된 키의 문자열 값만 남긴다. null은 "지우기"로 그대로 둔다.
export function cleanPrefs(input: unknown): Record<string, string | null> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(input)) {
    if (!PREF_KEYS.includes(k)) continue
    if (v === null || typeof v === 'string') out[k] = v
  }
  return out
}
