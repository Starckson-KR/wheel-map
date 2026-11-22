// 대중교통 경로 형식(앱이 쓰는 모양). ODsay 응답은 odsay.ts가 이 형식으로 바꾼다. 좌표는 [위도, 경도].
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
