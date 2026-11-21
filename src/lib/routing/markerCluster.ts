// 길찾기 지도의 정류장 딱지가 겹치지 않게 화면 거리가 가까운 것끼리 묶는다(확대하면 풀린다).
export type ScreenPt = { x: number; y: number }

/** 딱지 하나의 대략 크기(px). 가로·세로 둘 다 이보다 가까우면 같은 묶음 */
export const CLUSTER_DX = 52
export const CLUSTER_DY = 22

/** 앞에서부터 차례로, 이미 있는 묶음의 첫 점과 가까우면 그 묶음에 넣는다. 돌려주는 값은 입력 순서의 인덱스 묶음 */
export function clusterByScreen(pts: readonly ScreenPt[], dx = CLUSTER_DX, dy = CLUSTER_DY): number[][] {
  const groups: number[][] = []
  pts.forEach((p, i) => {
    const g = groups.find((m) => Math.abs(pts[m[0]].x - p.x) < dx && Math.abs(pts[m[0]].y - p.y) < dy)
    if (g) g.push(i)
    else groups.push([i])
  })
  return groups
}
