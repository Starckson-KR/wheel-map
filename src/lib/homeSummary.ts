// 홈의 「오늘 요약」「내 칭호」 카드에 쓰는 순수 계산. 화면 없이 시험할 수 있게 따로 둔다.
import type { Barrier, Rating } from '../types'
import type { NextGrade } from './rewards'

export type RatingCounts = { total: number; X: number; TRIANGLE: number; O: number }

// 조사한 장애요소를 등급별로 센다. 묶음(group)은 세지 않고, 등급이 없으면 부모의 등급을 따른다. 등급을 알 수 없는 것은 합계에서 뺀다.
export function ratingCounts(barriers: readonly Barrier[]): RatingCounts {
  const byId = new Map(barriers.map((b) => [b.id, b]))
  const out: RatingCounts = { total: 0, X: 0, TRIANGLE: 0, O: 0 }
  for (const b of barriers) {
    if (b.kind === 'group') continue
    const r: Rating | undefined = b.rating ?? (b.parentId ? byId.get(b.parentId)?.rating : undefined)
    if (!r) continue
    out[r] += 1
    out.total += 1
  }
  return out
}

// 다음 칭호까지 얼마나 왔는지(0~1). 「또는」 조건(anyOf)이면 가장 가까운 쪽, 아니면 조건들의 평균.
export function nextGradeRatio(next: NextGrade | null): number {
  if (!next || next.progress.length === 0) return 0
  const rs = next.progress.map((p) => (p.need > 0 ? Math.min(1, Math.max(0, p.now / p.need)) : 0))
  return next.anyOf ? Math.max(...rs) : rs.reduce((a, b) => a + b, 0) / rs.length
}
