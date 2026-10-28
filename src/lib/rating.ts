import type { Rating } from '../types'

// ○△X 색·글자. 색만으로 구분하지 않도록 글자(glyph)를 같이 쓴다.
// 색값은 src/styles/tokens.css의 --r-* 와 같은 값이다(지도 선·면은 CSS 변수를 못 써서 여기에 둔다).
// ink: 색 위에 올리는 글자색(대비 4.5 이상). soft/text: 연한 배지 배경과 그 위의 글자색.
export const RATING_STYLE: Record<Rating | 'none', { color: string; ink: string; soft: string; text: string; glyph: string; label: string }> = {
  O: { color: '#0f7f55', ink: '#ffffff', soft: '#e6f6ee', text: '#0b6845', glyph: '○', label: '○ 괜찮음' },
  TRIANGLE: { color: '#f2a900', ink: '#3d2400', soft: '#fff3d6', text: '#7a5000', glyph: '△', label: '△ 주의' },
  X: { color: '#d0342c', ink: '#ffffff', soft: '#fdeceb', text: '#b3261e', glyph: 'X', label: 'X 어려움' },
  none: { color: '#6b7684', ink: '#ffffff', soft: '#f2f4f6', text: '#4e5968', glyph: '?', label: '평가 없음' },
}
