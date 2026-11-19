// ODsay 대중교통 길찾기 응답(searchPubTransPathT, 디지털융합플랫폼 경유) → 앱이 쓰는 형식(TItinerary). 브라우저·Node·Worker가 함께 쓰는 순수 함수.
// 좌표는 [위도, 경도]. ODsay는 x=경도, y=위도이고 시간은 분 단위(앱은 초)다.
// 응답에는 구간 선이 없어 버스 구간은 지나는 정류장(passStopList)을 이은 선으로 그린다. 도보 구간은 양 끝을 곧게 잇는다.
// 저상버스 정보는 응답에 없다 → 화면이 광주 BIS(LOW_BUS)로 따로 채운다.
import type { TItinerary, TLeg, TransitParsed, TStop } from './parse.ts'

type Pt = [number, number]

// 포털 호출 형식: GET + 헤더 api_user_key_id (키는 서버 쪽에서만 붙인다)
export const ODSAY_ENDPOINT = 'https://api.koreaconnect.kr/01/1/2604071749001710344ODS/LOGIS/v1/api/searchPubTransPathT'
export const ODSAY_KEY_HEADER = 'api_user_key_id'

/** 호출 주소(키 없음). SX,SY=출발 경도·위도, EX,EY=도착. SearchPathType 2 = 버스만 */
export function odsayUrl(from: Pt, to: Pt): string {
  const f = (n: number) => n.toFixed(6)
  return `${ODSAY_ENDPOINT}?SX=${f(from[1])}&SY=${f(from[0])}&EX=${f(to[1])}&EY=${f(to[0])}&OPT=0&SearchType=0&SearchPathType=2`
}

// 버스 종류 코드 → 광주 노선 종류 이름(busColor가 "종류:번호"에서 색을 고른다).
// 광주 실제 노선(54 간선, 419 지선, 1001 급행)으로 확인한 것만 둔다. 그 밖의 코드는 종류 없이 중립 색.
const TYPE_NAME: Record<number, string> = { 11: '간선', 12: '지선', 15: '급행' }

const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const num = (v: unknown, d = 0) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : d)
const str = (v: unknown) => (v == null ? '' : String(v))

const ERROR_TEXT: Record<string, string> = {
  '-98': '가까운 거리라 걸어가는 길이 더 좋아요.',
  '-99': '지금은 버스 경로를 찾지 못했어요.',
  '3': '출발지 가까이에 버스 정류장이 없어요.',
  '4': '도착지 가까이에 버스 정류장이 없어요.',
  '5': '출발지·도착지 가까이에 버스 정류장이 없어요.',
  '6': '버스 경로를 찾을 수 있는 지역이 아니에요.',
  '-8': '지금은 버스 경로를 찾지 못했어요.',
  '-9': '지금은 버스 경로를 찾지 못했어요.',
}

/** 오류 응답에서 코드를 꺼낸다(ODsay는 {error:{code,msg}} 또는 {error:[{code,message}]}). 없으면 '' */
export function odsayErrorCode(json: unknown): string {
  const e = (json as { error?: unknown } | null)?.error
  const one = (Array.isArray(e) ? e[0] : e) as { code?: unknown; id?: unknown } | undefined
  return one && typeof one === 'object' ? str(one.code ?? one.id) : ''
}

/** 길을 못 찾은 것(재시도해도 같은 결과라 잠깐 기억해 둘 만한 오류) */
export const isNoRouteCode = (code: string) => ['-98', '-99', '3', '4', '5', '6'].includes(code)

export function parseOdsay(json: unknown, from: Pt, to: Pt, maxItin = 3): TransitParsed {
  const paths = (json as { result?: { path?: unknown } } | null)?.result?.path
  if (!Array.isArray(paths)) {
    const code = odsayErrorCode(json)
    return { ok: false, code, message: ERROR_TEXT[code] ?? '지금은 버스 경로를 찾지 못했어요.' }
  }
  const out: TItinerary[] = []
  for (const p of paths as Record<string, any>[]) {
    if (out.length >= maxItin) break
    const subs = (Array.isArray(p.subPath) ? p.subPath : []) as Record<string, any>[]
    if (!subs.some((s) => s.trafficType === 2)) continue // 버스가 없는(지하철만 등) 경로는 쓰지 않는다
    const legs: TLeg[] = []
    let cur = { name: '출발지', lat: from[0], lng: from[1] }
    let walkTime = 0
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i]
      if (s.trafficType === 3) {
        const dist = num(s.distance)
        const sec = num(s.sectionTime) * 60
        if (dist <= 0 && sec <= 0) continue // 환승 사이의 0m 걷기
        const next = subs.slice(i + 1).find((x) => x.trafficType === 2)
        const dest = next
          ? { name: str(next.startName), lat: num(next.startY), lng: num(next.startX) }
          : { name: '도착지', lat: to[0], lng: to[1] }
        walkTime += sec
        legs.push({
          mode: 'WALK',
          time: sec,
          distance: dist,
          from: { name: cur.name, lat: r6(cur.lat), lng: r6(cur.lng) },
          to: { name: dest.name, lat: r6(dest.lat), lng: r6(dest.lng) },
          coords: [[r6(cur.lat), r6(cur.lng)], [r6(dest.lat), r6(dest.lng)]],
        })
      } else if (s.trafficType === 2) {
        const lane = (Array.isArray(s.lane) ? s.lane[0] : null) as Record<string, any> | null
        const busNo = str(lane?.busNo)
        const typeName = TYPE_NAME[num(lane?.type, -1)]
        const stations: TStop[] = ((s.passStopList?.stations ?? []) as Record<string, any>[]).map((st) => ({
          name: str(st.stationName),
          lat: r6(num(st.y)),
          lng: r6(num(st.x)),
          ...(st.stationID != null ? { id: str(st.stationID) } : {}),
        }))
        const a = { name: str(s.startName), lat: r6(num(s.startY)), lng: r6(num(s.startX)) }
        const z = { name: str(s.endName), lat: r6(num(s.endY)), lng: r6(num(s.endX)) }
        const line: Pt[] = stations.filter((x) => x.lat && x.lng).map((x) => [x.lat, x.lng])
        legs.push({
          mode: 'BUS',
          time: num(s.sectionTime) * 60,
          distance: num(s.distance),
          from: a,
          to: z,
          coords: line.length >= 2 ? line : [[a.lat, a.lng], [z.lat, z.lng]],
          ...(busNo ? { lineName: busNo, ...(typeName ? { route: `${typeName}:${busNo}` } : {}) } : {}),
          ...(stations.length > 0 ? { stations } : {}),
        })
        cur = z
      }
    }
    if (!legs.some((l) => l.mode === 'BUS')) continue
    const info = (p.info ?? {}) as Record<string, any>
    out.push({
      time: num(info.totalTime) * 60,
      fare: info.payment != null ? num(info.payment) : null,
      walkDistance: num(info.totalWalk),
      walkTime,
      transfers: Math.max(0, num(info.busTransitCount) - 1),
      legs,
    })
  }
  return out.length > 0 ? { ok: true, itineraries: out } : { ok: false, code: '-99', message: ERROR_TEXT['-99'] }
}
