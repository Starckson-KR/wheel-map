import type { CSSProperties } from 'react'

// 격자 열 수 고르기: 마지막 줄에 칸 하나만 외톨이로 남지 않게 개수에 맞춰 열 수를 정한다.
// 한 줄에 다 들어가면(개수 <= max) 한 줄, 아니면 나누어떨어지는 가장 큰 열 수, 없으면 마지막 줄이 2칸 이상 남는 열 수를 쓴다.
// 예) max 4: 2→2, 3→3, 4→4, 5→3(3+2), 6→3(3×2), 7→4(4+3), 8→4, 9→3, 10→5 아님(최대 4라서 2×5)
export function balancedCols(n: number, max = 4): number {
  const m = Math.max(1, Math.floor(max))
  if (n <= 1) return 1
  if (n <= m) return n
  for (let c = m; c >= 2; c--) if (n % c === 0) return c
  for (let c = m; c >= 2; c--) if (n % c >= 2) return c
  return m
}

/** CSS 변수 --cols(보통 폭)와 --cols-sm(340px 미만)을 개수에 맞춰 돌려준다. 격자 쪽은 .bal-grid 규칙(base.css)이 읽는다. */
export function colsStyle(n: number, max = 4, maxSmall = max): CSSProperties {
  return { '--cols': balancedCols(n, max), '--cols-sm': balancedCols(n, maxSmall) } as CSSProperties
}
