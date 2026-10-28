// 사용자 화면에 보여 주는 이름·영향 종류 규칙(표시 계층). 내부 ID(R19, I-a, W-C…)는 여기서 이름으로 바꾼다.
// ID는 행정 화면·#/verify·시연 도구에서만 쓴다.
import type { Barrier, Rating } from '../types'
import { RATING_STYLE } from './rating'

// 지도 핀·시트 제목에 쓰는 짧은 이름(자료의 이름을 줄인 것)
const SHORT: Record<string, string> = {
  'W-C': '용봉로 보도 구간',
  N01: '후문 상가·원룸 골목',
  N02: '신축 아파트 주차장',
  R15: '한화꿈에그린 정류장',
  R16: '북구청 옆 정류장',
  R17: '북구청 앞 횡단보도',
  R18: '후문 일대 보도',
  R19: '학교 쪽문',
  B02: '용봉휴먼시아 정류장',
  B03: '용봉초교 정류장',
  'I-a': '전대치과병원',
  B07: '치과병원 정류장',
  C03: '치과병원 앞 횡단보도',
  'W-B': '용봉로 초입',
}

export function shortName(id: string, fallback: string): string {
  return SHORT[id] ?? SHORT[id.split('-')[0]] ?? stripId(fallback)
}

// "R19 · 이름", "학교 쪽문(R19)" 같은 문자열에서 내부 ID를 지운다.
export function stripId(text: string): string {
  return text.replace(/^[A-Za-z]+\d*(?:-[A-Za-z0-9]+)? · /, '').replace(/\s*\((?:[A-Z]{1,2}\d{1,3}(?:-\d+)?|[A-Z]-[a-zA-Z])\)/g, '')
}

// 길찾기 장애요소(id + 이름) 표시용 이름
export function obstacleName(o: { id: string; name: string }): string {
  return SHORT[o.id] ?? stripId(o.name)
}

export type ImpactKey = 'passage' | 'boarding' | 'entry' | 'zone'

export const IMPACT_INFO: Record<ImpactKey, { glyph: string; label: string; short: string }> = {
  passage: { glyph: '길', label: '지나가기', short: '지나가기' },
  boarding: { glyph: '승', label: '버스 타기', short: '버스 타기' },
  entry: { glyph: '입', label: '들어가기', short: '들어가기' },
  zone: { glyph: '◆', label: '주의 구역', short: '주의 구역' },
}

export function impactOf(b: Barrier, parent?: Barrier | null): ImpactKey {
  const own = (b as { impact?: ImpactKey }).impact
  const up = parent ? (parent as { impact?: ImpactKey }).impact : undefined
  return own ?? up ?? (b.kind === 'area' ? 'zone' : 'passage')
}

// 영역(주의 구역)은 ○△X 색 대신 보라 ◆로 보여 준다(○일 때만 평소 색).
const ZONE_STYLE = { color: '#6a3d9a', ink: '#ffffff', soft: '#f1eaf8', text: '#53307a', glyph: '◆', label: '◆ 주의 구역' }
export function styleOf(impact: ImpactKey, rating: Rating | 'none') {
  return impact === 'zone' && rating !== 'O' ? ZONE_STYLE : RATING_STYLE[rating]
}

export type Category = 'hard' | 'caution' | 'boarding' | 'entry' | 'zone' | 'ok' | 'none'

// 영향 종류 + 정도(○△X)로 묶는 홈 요약 분류
export function categoryOf(impact: ImpactKey, rating: Rating | 'none'): Category {
  if (impact === 'zone') return rating === 'O' ? 'ok' : 'zone'
  if (rating === 'O') return 'ok'
  if (rating === 'none') return 'none'
  if (impact === 'boarding') return 'boarding'
  if (impact === 'entry') return 'entry'
  return rating === 'X' ? 'hard' : 'caution'
}

export const CATEGORY_INFO: Record<Category, { glyph: string; label: string }> = {
  hard: { glyph: '길', label: '지나가기 어려운 곳' },
  caution: { glyph: '△', label: '지날 때 주의할 곳' },
  boarding: { glyph: '승', label: '버스 타기 불편 정류장' },
  entry: { glyph: '입', label: '들어가기 불편한 곳' },
  zone: { glyph: '◆', label: '주의 구역' },
  ok: { glyph: '○', label: '괜찮은 곳' },
  none: { glyph: '?', label: '평가 없는 곳' },
}

export const CATEGORY_ORDER: Category[] = ['hard', 'boarding', 'entry', 'zone', 'caution', 'ok', 'none']

// 상세 패널 한 줄: 영향 종류 + 정도
export function impactLine(impact: ImpactKey, rating: Rating | 'none'): string {
  const bad = rating === 'X' || rating === 'TRIANGLE'
  switch (impact) {
    case 'passage':
      return rating === 'X' ? '지나가기 어려워요' : rating === 'TRIANGLE' ? '지나갈 때 주의해야 해요' : rating === 'O' ? '지나가기 괜찮아요' : '지나가는 길이에요 (평가 없음)'
    case 'boarding':
      return bad ? '버스 타기 불편해요' : rating === 'O' ? '버스 타기 괜찮아요' : '정류장이에요 (평가 없음)'
    case 'entry':
      return bad ? '들어가기 불편해요' : rating === 'O' ? '들어가기 괜찮아요' : '건물 출입이에요 (평가 없음)'
    default:
      return rating === 'O' ? '주의 구역이에요 (지금은 괜찮아요)' : '주의가 필요한 구역이에요'
  }
}
