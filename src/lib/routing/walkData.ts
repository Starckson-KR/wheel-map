import { loadWalkGraph, type WalkGraph, type WalkGraphFile } from './walkGraph.ts'

// 보행망 JSON(약 300KB)은 길찾기를 처음 쓸 때만 따로 내려받는다(첫 화면 크기를 키우지 않는다). 받지 못하면 null → 기존 TMAP 방식으로 넘어간다.
let cached: Promise<WalkGraph | null> | null = null
export function getWalkGraph(): Promise<WalkGraph | null> {
  cached ??= import('../../../data/routes/walk-graph.json')
    .then((data) => loadWalkGraph(data.default as unknown as WalkGraphFile))
    .catch(() => {
      cached = null
      return null
    })
  return cached
}
