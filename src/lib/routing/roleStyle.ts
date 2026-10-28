import { RATING_STYLE } from '../rating'
import type { HitRole } from './engine.ts'

// 경로상 장애요소 표시(○△X 색 + 글자). 영향 종류별로 글자·색을 달리 해 색만으로 구분하지 않는다.
export const ROLE_STYLE: Record<HitRole, { color: string; glyph: string; label: string }> = {
  X: { ...RATING_STYLE.X, label: 'X 지나가기 어려움' },
  T: { ...RATING_STYLE.TRIANGLE, label: '△ 주의' },
  Z: { color: '#6a3d9a', glyph: '◆', label: '◆ 주의 구역' },
  B: { color: '#1e6fb5', glyph: '승', label: '승 버스 타기 불편' },
  E: { color: '#6d4c41', glyph: '입', label: '입 출입 불편' },
  O: { ...RATING_STYLE.O, label: '○ 괜찮음' },
  N: { ...RATING_STYLE.none, label: '? 평가 없음' },
}
