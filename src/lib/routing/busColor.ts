// 버스 노선 종류별 지도 선 색. 종류 이름은 TMAP 응답의 route("지선:419")에서 가져온다.
// 출처: 광주광역시 국제교류센터 광주생활정보 "시내버스" (https://www.gwangjuguide.or.kr/bbs/board.php?bo_table=kor_gw2&wr_id=20)
//   급행 = 빨강 버스, 간선 = 노랑 버스, 지선 = 초록 버스. 색 이름만 확인했고 지도 선에서 잘 보이도록 같은 계열의 진한 값을 썼다.
// TODO(확인 필요): 마을버스 등 위 출처에 색이 없는 종류는 중립 색으로 둔다. 공식 색을 확인하면 채운다.
const BUS_TYPE_COLOR: Record<string, string> = {
  급행: '#d32f2f',
  간선: '#b57600',
  지선: '#2e9b4a',
}
export const BUS_NEUTRAL = '#55606e'

export function busType(route?: string): string | null {
  return route && route.includes(':') ? route.split(':')[0] : null
}
export function busColor(route?: string): string {
  const t = busType(route)
  return (t && BUS_TYPE_COLOR[t]) || BUS_NEUTRAL
}
