// 언어 설정의 최소 구조. 지금은 한국어만 번역돼 있고, 영어는 "준비 중"이다(사용자 결정: 언어 선택 화면만 만든다).
// 이후 번역을 늘릴 때: messages.en 에 문구를 채우면 t()가 그것을 읽는다.
export type Lang = 'ko' | 'en'
export const LANG_KEY = 'wheelmap.lang'
/** 화면 문구가 실제로 번역돼 있는 언어 */
export const TRANSLATED: Lang[] = ['ko']

export function parseLang(raw: string | null): Lang | null {
  return raw === 'ko' || raw === 'en' ? raw : null
}

export function getLang(): Lang | null {
  try {
    return parseLang(localStorage.getItem(LANG_KEY))
  } catch {
    return null
  }
}

export function setLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l)
  } catch {
    /* 저장이 막혀도 이번 화면에는 적용된다 */
  }
}

/** 지금 화면에 실제로 쓰는 언어: 번역이 없는 언어면 한국어 */
export function effectiveLang(l: Lang | null = getLang()): Lang {
  return l && TRANSLATED.includes(l) ? l : 'ko'
}

// 번역 확장 자리: 키 → 문구. 지금은 비어 있고 t(key, fallback)이 fallback(한국어)을 돌려준다.
export const messages: Record<Lang, Record<string, string>> = { ko: {}, en: {} }
export function t(key: string, fallback: string): string {
  return messages[effectiveLang()][key] ?? fallback
}
