// 길찾기 화면의 도착지 검색 규칙(화면 코드가 없는 순수 함수).

/** 입력칸이 비어 있을 때만 추천 경로(시연 경로)를 보여 주고, 입력을 시작하면 검색 결과로 바뀐다 */
export function showRecommended(query: string): boolean {
  return query.trim() === ''
}

/** 입력할 때마다 바로 찾되, 글자를 치는 사이에는 잠시 기다린다. 비어 있으면 찾지 않는다(null) */
export function searchDelay(query: string, first: boolean): number | null {
  if (query.trim() === '') return null
  return first ? 0 : 350
}
