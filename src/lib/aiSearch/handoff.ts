import { REPORT_TYPES } from '../reportTypes'

// AI 검색 → 제보·길찾기 화면으로 넘기는 값. 주소(해시)의 쿼리로 전달하고, 받는 쪽에서 다시 검증한다(허용 밖 값은 버린다).
const TYPE_VALUES: readonly string[] = REPORT_TYPES.map((t) => t.type)
const PLACE_MAX = 20

/** 앱 제보 유형 목록에 있는 값만 돌려준다 */
export function typeFromQuery(v: string | null | undefined): string | null {
  return v && TYPE_VALUES.includes(v) ? v : null
}

/** 장소 말(2~20자, 한글·숫자·공백)만 돌려준다 */
export function placeFromQuery(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s.length >= 2 && s.length <= PLACE_MAX && /^[가-힣0-9 ]+$/.test(s) ? s : null
}

/** 기본 주소에 값이 있는 쿼리만 덧붙인다(없으면 기본 주소 그대로) */
export function withQuery(base: string, params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
  return parts.length ? `${base}${base.includes('?') ? '&' : '?'}${parts.join('&')}` : base
}
