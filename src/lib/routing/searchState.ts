// 위쪽 검색바에서 장소를 찾는 화면의 상태 규칙(화면 코드가 없는 순수 함수).
import { showRecommended } from './searchUi.ts'

export type SearchStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'error'
export type SearchView = 'recommend' | 'loading' | 'results' | 'empty' | 'error'

/** 지금 목록에 무엇을 보일까: 입력이 비면 추천 경로, 아니면 검색 진행·결과 */
export function searchView(query: string, status: SearchStatus, count: number): SearchView {
  if (showRecommended(query)) return 'recommend'
  if (status === 'ok' && count > 0) return 'results'
  if (status === 'empty' || (status === 'ok' && count === 0)) return 'empty'
  if (status === 'error') return 'error'
  return 'loading'
}

/** 옛 응답 버리기: 새로 찾을 때마다 번호를 올리고, 돌아온 응답은 자기 번호가 아직 최신일 때만 쓴다 */
export function makeLatest() {
  let n = 0
  return {
    next: () => ++n,
    isCurrent: (id: number) => id === n,
    cancel: () => void ++n,
  }
}
