// 길찾기가 스스로 쓰는 공공데이터 계산(순수 함수, 브라우저·Node 공용): 육교 피하기, 비 오는 날 침수 이력, 「가는 길에 있어요」.
// 이용자가 레이어를 켜는지와 상관없다. 데이터 불러오기는 layerData.ts.
import { distToRoute, type Pt } from './engine.ts'
import type { SoftSpot } from './walkRoute.ts'

// 침수 이력: 약 100m 칸마다 한 점으로 묶인 자료(건수=그 칸의 피해 기록 수)에서 피해가 3건 이상인 칸만 쓴다(2026-11-19 사용자 결정).
// 용봉동 1.5km 안에 193칸이라 전부 쓰면 길이 막히므로 기준을 둔다.
export const FLOOD_MIN_COUNT = 3
export const FLOOD_RADIUS_M = 50 // 칸 대표점에서 칸 절반(약 50m) 안의 길 토막에 벌점·「지난다」 판정
export const FLOOD_PENALTY_M = 150 // △(주의)와 같은 벌점(WALK_CFG.penaltyT). 150m까지 돌아가는 건 감수
// 육교: 점 하나(육교 가운데). 연장 20m 안팎이라 가운데에서 30m 안이면 올라타는 길 토막이다.
export const OVERPASS_RADIUS_M = 30
export const OVERPASS_PENALTY_M = 300 // 계단 벌점(5000m)은 못 쓴다: 보행망에 계단으로 안 들어간 육교 아래 길까지 막을 수 있어 △보다 조금 큰 값
// 가는 길에 있어요: 경로에서 60m 안. 걷는 속도 1.37m/s(WALK_CFG)로 편도 약 44초, 다녀와도 1분 반이라 길을 크게 벗어나지 않는 거리다.
export const ALONG_RADIUS_M = 60
// 어린이보호구역은 대표 좌표 한 점뿐이라 구역 크기를 모른다. 한 점은 보통 정문 근처이므로 100m 안이면 「근처」로 센다.
export const SCHOOL_NEAR_M = 100

export type LPt = { id: string; name: string; lat: number; lng: number }
type Raw = { id: string; name: string; lat?: number | null; lng?: number | null; fields: Record<string, unknown> }
const has = (i: Raw): i is Raw & { lat: number; lng: number } => typeof i.lat === 'number' && typeof i.lng === 'number'

/** 육교 지점 목록: 장애인편의시설(엘리베이터 등)이 있는 육교(Y)는 뺀다 */
export function overpassSpots(items: Raw[]): SoftSpot[] {
  return items
    .filter(has)
    .filter((i) => i.fields['장애인편의시설설치여부'] !== 'Y')
    .map((i) => ({ id: i.id, kind: 'overpass' as const, lat: i.lat, lng: i.lng, radiusM: OVERPASS_RADIUS_M, penaltyM: OVERPASS_PENALTY_M }))
}

/** 침수 지점 목록: 피해 건수 min건 이상인 칸만 */
export function floodSpots(items: Raw[], min = FLOOD_MIN_COUNT): SoftSpot[] {
  return items
    .filter(has)
    .filter((i) => Number(i.fields['건수'] ?? 0) >= min)
    .map((i) => ({ id: i.id, kind: 'flood' as const, lat: i.lat, lng: i.lng, radiusM: FLOOD_RADIUS_M, penaltyM: FLOOD_PENALTY_M }))
}

const dM = (a: Pt, b: Pt) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180))

/** 경로가 지나는 지점들. 출발·도착 점 바로 옆 지점은 어떤 길도 피할 수 없어 센 뒤에 뺀다(경로 계산과 같은 규칙) */
export function spotsNearRoute(coords: Pt[], spots: SoftSpot[]): SoftSpot[] {
  if (coords.length < 2) return []
  const a = coords[0]
  const b = coords[coords.length - 1]
  return spots.filter((s) => {
    const p: Pt = [s.lat, s.lng]
    return distToRoute(coords, p) <= s.radiusM && dM(p, a) > s.radiusM && dM(p, b) > s.radiusM
  })
}

export type Along = { count: number; nearestM: number; items: { item: LPt; distM: number }[] }
/** 경로 radiusM 안의 점들(가까운 순) */
export function alongRoute(coords: Pt[], items: LPt[], radiusM: number): Along {
  const list = coords.length < 2 ? [] : items.map((item) => ({ item, distM: Math.round(distToRoute(coords, [item.lat, item.lng])) })).filter((x) => x.distM <= radiusM).sort((p, q) => p.distM - q.distM)
  return { count: list.length, nearestM: list.length ? list[0].distM : 0, items: list }
}

export type LayerPool = { overpass: SoftSpot[]; flood: SoftSpot[]; toilets: LPt[]; shades: LPt[]; stops: LPt[]; schools: LPt[] }
export type RouteFacts = { overpass: SoftSpot[]; flood: SoftSpot[]; toilet: Along; shade: Along; stop: Along; school: Along }

/** 경로 하나에 대한 사실(육교·침수 지점, 가는 길의 화장실·그늘막·정류장, 어린이보호구역 근처). 침수는 pool.flood가 비어 있으면(맑은 날) 0 */
export function routeFacts(coords: Pt[], pool: LayerPool): RouteFacts {
  return {
    overpass: spotsNearRoute(coords, pool.overpass),
    flood: spotsNearRoute(coords, pool.flood),
    toilet: alongRoute(coords, pool.toilets, ALONG_RADIUS_M),
    shade: alongRoute(coords, pool.shades, ALONG_RADIUS_M),
    stop: alongRoute(coords, pool.stops, ALONG_RADIUS_M),
    school: alongRoute(coords, pool.schools, SCHOOL_NEAR_M),
  }
}

export type CardNotes = {
  avoided: ('overpass' | 'flood')[] // 「피했어요」: 가장 짧은 길은 지나는데 이 길은 하나도 안 지난다
  passes: { overpass: number; flood: number } // 이 길이 지나는 곳(0이면 안 보인다)
}
/** 카드 배지 규칙. base=가장 짧은 길의 사실, cur=이 카드 길의 사실. 가장 짧은 길 카드는 avoided가 비어 있다 */
export function cardNotes(cur: RouteFacts, base: RouteFacts, isBase: boolean): CardNotes {
  const avoided: CardNotes['avoided'] = []
  if (!isBase) {
    if (base.overpass.length > 0 && cur.overpass.length === 0) avoided.push('overpass')
    if (base.flood.length > 0 && cur.flood.length === 0) avoided.push('flood')
  }
  return { avoided, passes: { overpass: cur.overpass.length, flood: cur.flood.length } }
}

export type AlongRow = { key: 'toilet' | 'shade' | 'stop' | 'school'; icon: string; label: string; sub: string | null }
const nearText = (d: number) => (d <= 5 ? '길 바로 옆' : `길에서 ${d}m`)
/** 「가는 길에 있어요」 줄들. 정류장은 지붕(쉘터) 자료가 없어 「가까운 정류장」으로만 쓴다 */
export function alongRows(f: RouteFacts): AlongRow[] {
  const rows: AlongRow[] = []
  if (f.toilet.count > 0) rows.push({ key: 'toilet', icon: 'access', label: `장애인화장실 ${f.toilet.count}곳`, sub: nearText(f.toilet.nearestM) })
  if (f.shade.count > 0) rows.push({ key: 'shade', icon: 'umbrella', label: `그늘막 ${f.shade.count}곳`, sub: nearText(f.shade.nearestM) })
  if (f.stop.count > 0) rows.push({ key: 'stop', icon: 'bus', label: `가까운 정류장 ${f.stop.count}곳`, sub: nearText(f.stop.nearestM) })
  if (f.school.count > 0) rows.push({ key: 'school', icon: 'school', label: `어린이보호구역 근처 ${f.school.count}곳`, sub: null })
  return rows
}
