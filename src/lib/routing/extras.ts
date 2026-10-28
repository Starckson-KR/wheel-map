import { ROUTE_CROSSWALK_RADIUS_M, ROUTE_DEST_RADIUS_M, ROUTE_STOP_RADIUS_M } from '../config'
import { loadPubDataset, toiletAccessible, type PubItem } from '../publicLayers'
import { distM, distToRoute, type Pt } from './engine.ts'
import type { Place } from './provider.ts'

// 길찾기에 쓰는 공공데이터(참고 정보, ○△X 판정과 무관): 경로 근처 횡단보도, 출발·도착 근처 정류장, 목적지 장애인편의시설·화장실.
export type Near = { item: PubItem; distM: number }
export type Extras = {
  stops: { start: Near[]; end: Near[] }
  dest: { facilities: (Near & { matched: boolean })[]; toilets: Near[]; accessibleToilets: number }
  crosswalkAll: PubItem[]
}

const norm = (s: string) => s.replace(/[\s()·\-,.]/g, '').toLowerCase()
const at = (i: PubItem): Pt | null => (i.lat != null && i.lng != null ? [i.lat, i.lng] : null)

export async function loadExtras(start: Place, end: Place): Promise<Extras> {
  const [bus, fac, toilet, cross] = await Promise.all([loadPubDataset('bus'), loadPubDataset('facility'), loadPubDataset('toilet'), loadPubDataset('crosswalk')])
  const around = (items: PubItem[], c: Place, r: number): Near[] =>
    items
      .map((item) => ({ item, p: at(item) }))
      .filter((x): x is { item: PubItem; p: Pt } => !!x.p)
      .map((x) => ({ item: x.item, distM: Math.round(distM([c.lat, c.lng], x.p)) }))
      .filter((x) => x.distM <= r)
      .sort((a, b) => a.distM - b.distM)
  const destName = norm(end.name)
  const destAddr = end.address ? norm(end.address) : ''
  // 도착지 편의시설: 이름·주소가 일치하는 시설을 먼저(200m 안), 나머지는 50m 안
  const matches = around(fac.items, end, 200).filter((x) => {
    const n = norm(x.item.name)
    const a = norm(x.item.address)
    return (n.length >= 3 && destName.length >= 3 && (n.includes(destName) || destName.includes(n))) || (destAddr !== '' && a !== '' && (a.includes(destAddr) || destAddr.includes(a)))
  })
  const matchedIds = new Set(matches.map((m) => m.item.id))
  const facilities = [
    ...matches.map((m) => ({ ...m, matched: true })),
    ...around(fac.items, end, ROUTE_DEST_RADIUS_M)
      .filter((x) => !matchedIds.has(x.item.id))
      .map((x) => ({ ...x, matched: false })),
  ]
  const toilets = around(toilet.items, end, ROUTE_DEST_RADIUS_M)
  return {
    stops: { start: around(bus.items, start, ROUTE_STOP_RADIUS_M), end: around(bus.items, end, ROUTE_STOP_RADIUS_M) },
    dest: { facilities, toilets, accessibleToilets: toilets.filter((t) => toiletAccessible(t.item)).length },
    crosswalkAll: cross.items,
  }
}

// 경로 20m 안 횡단보도와 그 중 보도턱 낮춤이 없는 것(필드 '보도턱낮춤여부' == 'N')
export function crosswalksOnRoute(coords: Pt[], all: PubItem[]) {
  const list = all
    .map((item) => ({ item, p: at(item) }))
    .filter((x): x is { item: PubItem; p: Pt } => !!x.p)
    .map((x) => ({ item: x.item, distM: Math.round(distToRoute(coords, x.p)) }))
    .filter((x) => x.distM <= ROUTE_CROSSWALK_RADIUS_M)
    .sort((a, b) => a.distM - b.distM)
  return { all: list, noCurb: list.filter((x) => x.item.fields['보도턱낮춤여부'] === 'N') }
}
