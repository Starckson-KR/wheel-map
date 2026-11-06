// TMAP 대중교통 경로 응답(POST https://apis.openapi.sk.com/transit/routes) → 앱이 쓰는 형식. 브라우저와 Node가 함께 쓴다.
// 좌표는 [위도, 경도]. 응답의 구간 선(linestring)은 "경도,위도 경도,위도 …" 문자열이다.
import type { Pt } from '../routing/engine.ts'

export type TStop = { name: string; lat: number; lng: number; id?: string }
export type TLeg = {
  mode: string // WALK | BUS | SUBWAY | EXPRESSBUS …
  time: number // 초
  distance: number // m
  from: { name: string; lat: number; lng: number }
  to: { name: string; lat: number; lng: number }
  coords: Pt[]
  route?: string // 예: 지선:419
  lineName?: string // 예: 419
  stations?: TStop[] // 버스 구간의 정류장(탑승~하차)
}
export type TItinerary = { time: number; fare: number | null; walkDistance: number; walkTime: number; transfers: number; legs: TLeg[] }
export type TransitParsed = { ok: true; itineraries: TItinerary[] } | { ok: false; code: string; message: string }

const r6 = (n: number) => Math.round(n * 1e6) / 1e6
function line(s: unknown): Pt[] {
  if (typeof s !== 'string') return []
  const out: Pt[] = []
  for (const tok of s.trim().split(/\s+/)) {
    const [x, y] = tok.split(',').map(Number)
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([r6(y), r6(x)])
  }
  return out
}
const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d)

export function parseTransit(json: unknown, maxItin = 3): TransitParsed {
  const j = json as {
    metaData?: { plan?: { itineraries?: unknown[] } }
    error?: { id?: string; message?: string; code?: string }
    result?: { message?: string; status?: number }
    code?: string | number
    message?: string
  }
  const its = j?.metaData?.plan?.itineraries
  if (!Array.isArray(its)) {
    const code = String(j?.error?.id ?? j?.error?.code ?? j?.code ?? j?.result?.status ?? '')
    const message = String(j?.error?.message ?? j?.message ?? j?.result?.message ?? '대중교통 경로를 읽지 못했습니다.')
    return { ok: false, code, message }
  }
  const out: TItinerary[] = []
  for (const it of its.slice(0, maxItin) as Record<string, any>[]) {
    const legs: TLeg[] = []
    for (const l of (it.legs ?? []) as Record<string, any>[]) {
      const mode = String(l.mode ?? '')
      let coords: Pt[] = []
      if (mode === 'WALK') for (const st of (l.steps ?? []) as Record<string, any>[]) coords.push(...line(st.linestring))
      else coords = line(l.passShape?.linestring)
      const dedup: Pt[] = []
      for (const p of coords) {
        const last = dedup[dedup.length - 1]
        if (!last || last[0] !== p[0] || last[1] !== p[1]) dedup.push(p)
      }
      const from = { name: String(l.start?.name ?? ''), lat: r6(n(l.start?.lat)), lng: r6(n(l.start?.lon)) }
      const to = { name: String(l.end?.name ?? ''), lat: r6(n(l.end?.lat)), lng: r6(n(l.end?.lon)) }
      const stations = ((l.passStopList?.stations ?? l.passStopList?.stationList ?? []) as Record<string, any>[]).map((s) => ({
        name: String(s.stationName ?? ''),
        lat: r6(n(s.lat)),
        lng: r6(n(s.lon)),
        ...(s.stationID != null ? { id: String(s.stationID) } : {}),
      }))
      const route = typeof l.route === 'string' ? l.route : undefined
      legs.push({
        mode,
        time: n(l.sectionTime),
        distance: n(l.distance),
        from,
        to,
        coords: dedup.length >= 2 ? dedup : [[from.lat, from.lng], [to.lat, to.lng]],
        ...(route ? { route, lineName: route.includes(':') ? route.split(':').slice(1).join(':') : route } : {}),
        ...(stations.length > 0 ? { stations } : {}),
      })
    }
    out.push({
      time: n(it.totalTime),
      fare: it.fare?.regular?.totalFare != null ? n(it.fare.regular.totalFare) : null,
      walkDistance: n(it.totalWalkDistance),
      walkTime: n(it.totalWalkTime),
      transfers: n(it.transferCount),
      legs,
    })
  }
  return out.length > 0 ? { ok: true, itineraries: out } : { ok: false, code: '14', message: '대중교통 경로가 없습니다.' }
}
