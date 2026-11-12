// 장소 검색 결과 정렬(순수 함수). 광주 북구 → 광주 다른 구 → 그 밖의 지역, 같은 묶음 안에서는 기준점에서 가까운 순.
// 카카오 SDK를 가져오지 않아 node 테스트에서 그대로 쓴다.

export type RankItem = { address_name?: string; road_address_name?: string; x: string; y: string }
export type PlaceGroup = 0 | 1 | 2 // 0 광주 북구, 1 광주 다른 구, 2 나머지
export type LatLngLike = { lat: number; lng: number }

// 주소가 "광주 북구 …" 또는 "전남광주통합특별시 북구 …"로 시작하는지. (경기 광주시 등은 첫 단어로 걸러낸다)
const GWANGJU = /^(광주|전남광주)\S*\s+/
const BUKGU = /^(광주|전남광주)\S*\s+북구(\s|$)/

export function placeGroup(item: RankItem): PlaceGroup {
  const addrs = [item.road_address_name, item.address_name].map((s) => (s ?? '').trim())
  if (addrs.some((a) => BUKGU.test(a))) return 0
  if (addrs.some((a) => GWANGJU.test(a))) return 1
  return 2
}

// 두 지점의 거리(m, 하버사인)
export function distanceM(a: LatLngLike, b: LatLngLike): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type Ranked<T> = { items: T[]; hasBukgu: boolean }

// 묶음 순서 → 거리순(기준점이 없으면 원래 순서). 같은 값은 원래 순서를 지킨다.
export function rankPlaces<T extends RankItem>(items: T[], center: LatLngLike | null): Ranked<T> {
  const rows = items.map((it, i) => ({
    it,
    i,
    g: placeGroup(it),
    d: center ? distanceM(center, { lat: Number(it.y), lng: Number(it.x) }) : 0,
  }))
  rows.sort((a, b) => a.g - b.g || (center ? a.d - b.d : 0) || a.i - b.i)
  return { items: rows.map((r) => r.it), hasBukgu: rows.some((r) => r.g === 0) }
}
